// Importing tasks from a CSV file. The columns are matched to task fields (by name, or by the mapping the person chose), every
// row is checked against the same rules as creating a task by hand, and the answer says exactly what will happen (dry run) or
// what did. Nothing is half-imported: an invalid row stops the import unless the person chose to skip invalid rows.
import type { AuditContext } from '../domain/audit-chain'
import { CsvError, parseCsv } from '../domain/csv'
import { can } from '../domain/permissions'
import type { Person, Project, User } from '../domain/types'
import { workflowStates } from '../domain/workflow'
import { HttpError, badRequest, forbidden, isIsoDate } from '../util'
import { type ImportField, type ImportInput, IMPORT_FIELDS } from '../validation/records'
import { PRIORITIES, TASK_TYPES, type TaskCreateInput } from '../validation/schemas'
import type { AuditService } from './audit'
import type { ServiceContext } from './context'
import type { TaskService } from './tasks'

const MAX_ROWS = 20_000
const MAX_PROBLEMS = 200
const PREVIEW_ROWS = 25

const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
/** Header names people use, by the task field they fill. The weak ones lose to a stronger header in the same file. */
const STRONG: Record<string, ImportField> = {
  title: 'title',
  task: 'title',
  tasktitle: 'title',
  summary: 'title',
  project: 'project',
  projectname: 'project',
  projectcode: 'project',
  assignee: 'assignee',
  owner: 'assignee',
  assignedto: 'assignee',
  priority: 'priority',
  status: 'status',
  state: 'status',
  type: 'type',
  category: 'type',
  tasktype: 'type',
  duedate: 'dueDate',
  deadline: 'dueDate',
  dueon: 'dueDate',
  blocked: 'blocked',
  isblocked: 'blocked',
  tags: 'tags',
  labels: 'tags',
  tag: 'tags',
  label: 'tags'
}
const WEAK: Record<string, ImportField> = { name: 'title', code: 'project', person: 'assignee', due: 'dueDate' }

/** The tags in one cell: separated by comma, semicolon or bar, each once, in the order written. */
const splitTags = (cell: string): string[] => {
  const seen = new Set<string>()
  for (const part of cell.split(/[;,|]/)) {
    const tag = part.trim()
    if (tag) seen.add(tag)
  }
  return [...seen]
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'blocked', 'x'])
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', ''])

export interface ImportColumn {
  index: number
  header: string
  field: ImportField | null
  /** The first non-empty value in the column, so the person can see what the column holds. */
  sample: string
}
export interface ImportRowReport {
  /** Line number in the file (the header is line 1). */
  row: number
  title: string
  project: string
  assignee: string
  status: string
  priority: string
  dueDate: string
  tags: string[]
  outcome: 'ok' | 'error' | 'duplicate'
  problems: { field: string; message: string }[]
}
export interface ImportReport {
  dryRun: boolean
  /** True when tasks were written. */
  imported: boolean
  delimiter: string
  columns: ImportColumn[]
  fields: readonly ImportField[]
  totals: { rows: number; valid: number; invalid: number; duplicates: number; created: number }
  preview: ImportRowReport[]
  problems: { row: number; title: string; field: string; message: string }[]
  problemsTruncated: boolean
}

export class TaskImportService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService,
    private tasks: TaskService
  ) {}

  /** Match each column to a task field: the person's mapping first, then the header's name. */
  private mapColumns(headers: string[], rows: string[][], mapping: ImportInput['mapping']): ImportColumn[] {
    const sample = (index: number) => rows.map(row => (row[index] ?? '').trim()).find(Boolean) ?? ''
    const columns: ImportColumn[] = headers.map((header, index) => ({
      index,
      header,
      field: null,
      sample: sample(index)
    }))
    const taken = new Map<ImportField, string>()
    const claim = (column: ImportColumn, field: ImportField, explicit: boolean) => {
      const owner = taken.get(field)
      if (owner !== undefined) {
        if (explicit) throw badRequest(`Two columns ("${owner}" and "${column.header}") are mapped to the same field`)
        return
      }
      taken.set(field, column.header)
      column.field = field
    }
    for (const column of columns) {
      const chosen = mapping?.[column.header]
      if (chosen && chosen !== 'ignore') claim(column, chosen, true)
    }
    for (const table of [STRONG, WEAK])
      for (const column of columns) {
        if (column.field || mapping?.[column.header]) continue
        const field = table[squash(column.header)]
        if (field) claim(column, field, false)
      }
    return columns
  }

  private lookups(projectId: number | undefined) {
    const { repos } = this.ctx
    const settings = this.ctx.settings
    const projects = repos.projects.list()
    const people = repos.people.list()
    const group = <T>(items: T[], keys: (item: T) => string[]) => {
      const map = new Map<string, T[]>()
      for (const item of items)
        for (const key of keys(item).filter(Boolean)) map.set(key, [...(map.get(key) || []), item])
      return map
    }
    return {
      byProjectCode: group<Project>(projects, p => [p.code.toLowerCase()]),
      byProjectName: group<Project>(projects, p => [p.name.toLowerCase()]),
      byPersonEmail: group<Person>(people, p => [p.email.toLowerCase()]),
      byPersonName: group<Person>(people, p => [p.name.toLowerCase()]),
      states: new Map(workflowStates(settings).map(label => [squash(label), label])),
      stateNames: workflowStates(settings),
      defaultProject: projectId === undefined ? undefined : repos.projects.byId(projectId)
    }
  }

  /** Check the file and, unless it is a dry run, create the tasks. */
  run(user: User, input: ImportInput, who: AuditContext): ImportReport {
    if (!can(this.ctx.settings, user, 'writeTasks'))
      throw forbidden('Importing tasks needs the "writeTasks" permission.')
    let parsed
    try {
      parsed = parseCsv(input.csv, MAX_ROWS)
    } catch (error) {
      if (error instanceof CsvError) throw badRequest(error.message)
      throw error
    }
    if (parsed.headers.length === 1 && parsed.headers[0] === '')
      throw badRequest('The first line must name the columns')
    const projectId = input.projectId === '' || input.projectId == null ? undefined : Number(input.projectId)
    if (projectId !== undefined && !this.ctx.repos.projects.byId(projectId))
      throw badRequest('The selected project does not exist')
    const columns = this.mapColumns(parsed.headers, parsed.rows, input.mapping)
    const find = new Map<ImportField, number>()
    for (const column of columns) if (column.field) find.set(column.field, column.index)
    if (!find.has('title'))
      throw badRequest('No column holds the task title. Name a column "Title" or choose one for it.')
    if (!find.has('project') && projectId === undefined)
      throw badRequest('Choose the project the tasks go to, or include a "Project" column.')

    const look = this.lookups(projectId)
    const known = new Map<number, Set<string>>() // project -> titles that exist (and, as the file is read, titles already in it)
    const titlesIn = (project: number) => {
      let set = known.get(project)
      if (!set) known.set(project, (set = this.ctx.repos.tasks.titlesOf(project)))
      return set
    }
    const skipDuplicates = input.duplicates !== 'create'

    const reports: ImportRowReport[] = []
    const ready: { report: ImportRowReport; body: TaskCreateInput }[] = []
    const problems: ImportReport['problems'] = []
    let invalid = 0
    let duplicates = 0

    parsed.rows.forEach((cells, offset) => {
      const cell = (field: ImportField) => (find.has(field) ? (cells[find.get(field)!] ?? '').trim() : '')
      const report: ImportRowReport = {
        row: offset + 2,
        title: cell('title'),
        project: cell('project'),
        assignee: cell('assignee'),
        status: cell('status'),
        priority: cell('priority'),
        dueDate: cell('dueDate'),
        tags: [],
        outcome: 'ok',
        problems: []
      }
      const problem = (field: ImportField, message: string) => report.problems.push({ field, message })
      const body: TaskCreateInput = { title: report.title, projectId: 0 }

      if (!report.title) problem('title', 'The title is empty')
      else if (report.title.length > 300) problem('title', 'The title is longer than 300 characters')

      let project: Project | undefined = look.defaultProject
      if (report.project) {
        const matches =
          look.byProjectCode.get(report.project.toLowerCase()) ||
          look.byProjectName.get(report.project.toLowerCase()) ||
          []
        if (matches.length === 1) project = matches[0]
        else {
          project = undefined
          problem(
            'project',
            matches.length
              ? `More than one project is called "${report.project}"; use its code`
              : `There is no project "${report.project}"`
          )
        }
      } else if (!project) problem('project', 'No project: the cell is empty and no default project was chosen')
      if (project) body.projectId = project.id

      if (report.assignee && report.assignee.toLowerCase() !== 'unassigned') {
        const lower = report.assignee.toLowerCase()
        const matches = look.byPersonEmail.get(lower) || look.byPersonName.get(lower) || []
        if (matches.length === 1) body.assigneeId = matches[0].id
        else
          problem(
            'assignee',
            matches.length
              ? `More than one person is called "${report.assignee}"; use the email address`
              : `Nobody is called "${report.assignee}"`
          )
      } else body.assigneeId = ''

      const priority = cell('priority')
      if (priority) {
        const match = PRIORITIES.find(value => value.toLowerCase() === priority.toLowerCase())
        if (match) body.priority = match
        else problem('priority', `"${priority}" is not a priority (${PRIORITIES.join(', ')})`)
      }
      const type = cell('type')
      if (type) {
        const match = TASK_TYPES.find(value => value.toLowerCase() === type.toLowerCase())
        if (match) body.type = match
        else problem('type', `"${type}" is not a task type (${TASK_TYPES.join(', ')})`)
      }
      if (report.status) {
        const match = look.states.get(squash(report.status))
        if (match) {
          body.status = match
          report.status = match
        } else problem('status', `"${report.status}" is not a status (${look.stateNames.join(', ')})`)
      }
      if (report.dueDate) {
        const date = report.dueDate.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, '$1-$2-$3').slice(0, 10)
        if (isIsoDate(date)) {
          body.dueDate = date
          report.dueDate = date
        } else problem('dueDate', `"${report.dueDate}" is not a date. Use YYYY-MM-DD, for example 2026-10-02`)
      } else body.dueDate = ''
      const blocked = cell('blocked').toLowerCase()
      if (TRUE_WORDS.has(blocked)) body.blocked = true
      else if (FALSE_WORDS.has(blocked)) body.blocked = false
      else problem('blocked', `"${cell('blocked')}" is not yes or no`)
      const tags = splitTags(cell('tags'))
      if (tags.some(tag => tag.length > 40)) problem('tags', 'A tag is longer than 40 characters')
      else if (tags.length > 20) problem('tags', 'More than 20 tags')
      else {
        body.tags = tags
        report.tags = tags
      }

      if (report.problems.length) {
        report.outcome = 'error'
        invalid++
        for (const entry of report.problems)
          if (problems.length < MAX_PROBLEMS) problems.push({ row: report.row, title: report.title, ...entry })
      } else if (project) {
        const key = report.title.toLowerCase()
        const titles = titlesIn(project.id)
        if (skipDuplicates && titles.has(key)) {
          report.outcome = 'duplicate'
          duplicates++
          report.problems.push({ field: 'title', message: `Already exists in ${project.name}` })
        } else {
          titles.add(key)
          ready.push({ report, body })
        }
      }
      reports.push(report)
    })

    const report = (created: number): ImportReport => ({
      dryRun: Boolean(input.dryRun),
      imported: created > 0,
      delimiter: parsed.delimiter,
      columns,
      fields: IMPORT_FIELDS,
      totals: { rows: reports.length, valid: ready.length, invalid, duplicates, created },
      preview: reports.slice(0, PREVIEW_ROWS),
      problems,
      problemsTruncated: problems.length >= MAX_PROBLEMS
    })

    if (input.dryRun) return report(0)
    if (invalid && !input.skipInvalid)
      throw new HttpError(
        422,
        `${invalid.toLocaleString('en')} of ${reports.length.toLocaleString('en')} rows have problems, so nothing was imported. Fix the file, or choose to skip the invalid rows.`,
        'IMPORT_INVALID',
        report(0)
      )
    if (!ready.length)
      throw new HttpError(422, 'There is nothing to import: no row is valid and new.', 'IMPORT_EMPTY', report(0))

    const created = this.ctx.transaction(() => {
      let count = 0
      for (const { body } of ready) {
        this.tasks.insertTask(user, body, who, { audit: false })
        count++
      }
      this.audit.record('task.imported', who, {
        rows: reports.length,
        created: count,
        skippedInvalid: invalid,
        skippedDuplicates: duplicates,
        projectId
      })
      return count
    })
    return report(created)
  }
}
