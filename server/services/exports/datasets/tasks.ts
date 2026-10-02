// Tasks, read from the v_task_rows view (names joined by SQL), filtered and sorted in SQL where the database can do it and by
// the shared condition engine for the "advanced filter" the screen offers.
import { applyAdvancedFilters, sortRows } from '../../../../shared/filters'
import type { TableSection } from '../../../export/model'
import { dueLabel } from '../../../presenters/tasks'
import type { TaskFilter } from '../../../repositories/tasks'
import {
  type DatasetContext,
  type DatasetDefinition,
  col,
  customFieldColumns,
  customValue,
  describeConditions,
  tones
} from '../kit'

const list = (value: string | undefined) =>
  value
    ? value
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
    : undefined

export function taskColumns(dc: Pick<DatasetContext, 'ctx' | 'label'>) {
  const { label } = dc
  return [
    col('id', label('Task ID'), 'text', 'tasks.key', { width: 11 }),
    col('title', label('Task'), 'longtext', 'tasks.title', { width: 38 }),
    col('project', label('Project'), 'text', 'projects.name', { width: 22 }),
    col('projectCode', label('Code'), 'text', 'projects.code', { defaultVisible: false, width: 9 }),
    col('status', label('Status'), 'status', 'tasks.status', { width: 14 }),
    col('priority', label('Priority'), 'priority', 'tasks.priority', { width: 10 }),
    col('type', label('Type'), 'text', 'tasks.type', { defaultVisible: false, width: 14 }),
    col('assignee', label('Owner'), 'text', 'people.name', { width: 20 }),
    col('dueDate', label('Due date'), 'date', 'tasks.due_date', { width: 13 }),
    col('dueStatus', label('Due'), 'text', 'tasks.due_date, tasks.status', { width: 13 }),
    col('due', label('Due'), 'text', 'tasks.due_date', { filterOnly: true }),
    col('blocked', label('Blocked'), 'boolean', 'tasks.blocked', { defaultVisible: false, width: 9 }),
    col('team', label('Team'), 'text', 'teams.name', { defaultVisible: false, width: 16 }),
    col('createdAt', label('Created'), 'date', 'tasks.created_at', { defaultVisible: false, width: 13 }),
    col('completedAt', label('Completed'), 'date', 'tasks.completed_at', { defaultVisible: false, width: 13 }),
    col('createdBy', label('Created by'), 'text', 'people.name', { defaultVisible: false, width: 18 }),
    ...customFieldColumns(dc.ctx.settings, 'tasks', label)
  ]
}

/** The database filter a request describes. Also used by the project report. */
export function taskFilterFor(dc: DatasetContext, extra: Partial<TaskFilter> = {}): TaskFilter {
  const filter: TaskFilter = { terminal: dc.terminal, today: dc.ref.today, q: dc.request.q, ...extra }
  const project = Number(dc.scope('projectId'))
  if (Number.isInteger(project) && project > 0) filter.projectId = project
  const assignee = dc.scope('assignee')
  if (assignee === 'me') filter.assigneeId = dc.user.personId || '\u0000none'
  else if (assignee === 'none') filter.unassigned = true
  else if (assignee) filter.assigneeId = assignee
  filter.priority = list(dc.scope('priority')) ?? filter.priority
  filter.status = list(dc.scope('status')) ?? filter.status
  if (dc.scope('blocked') === 'true') filter.blocked = true
  const scope = dc.scope('state')
  if (scope === 'open') filter.open = true
  if (scope === 'done') filter.done = true
  if (scope === 'overdue') filter.overdue = true
  return filter
}

/** Task rows as export rows, plus the tones that colour them. */
export function taskTable(
  dc: DatasetContext,
  id = 'tasks',
  title?: string,
  extra: Partial<TaskFilter> = {}
): TableSection {
  const { label, ref, terminal } = dc
  const columns = taskColumns(dc)
  const filter = taskFilterFor(dc, extra)
  const rows = []
  for (const r of dc.ctx.repos.tasks.iterate(filter, { key: 'due', dir: 'asc' })) {
    const done = terminal.includes(r.status)
    const overdue = !done && Boolean(r.due_date) && r.due_date < ref.today
    const row: Record<string, string | number | boolean | null> = {
      id: r.key,
      title: r.title,
      project: r.project_name,
      projectCode: r.project_code,
      status: r.status,
      priority: r.priority,
      type: r.type,
      assignee: r.assignee_name ?? label('Unassigned'),
      dueDate: r.due_date ?? '',
      dueStatus: done
        ? label('Done')
        : overdue
          ? label('Overdue')
          : r.due_date === ref.today
            ? label('Due today')
            : r.due_date
              ? label('Upcoming')
              : label('No due date'),
      due: dueLabel(ref, { dueDate: r.due_date ?? '' }),
      blocked: Number(r.blocked) === 1,
      team: r.team_name ?? '',
      createdAt: r.created_at,
      completedAt: r.completed_at ?? '',
      createdBy: r.created_by_name ?? '',
      _done: done,
      _overdue: overdue
    }
    for (const column of columns)
      if (column.key.startsWith('customFields.')) row[column.key] = customValue(r.custom_fields, column.key.slice(13))
    rows.push(row)
  }
  let out = applyAdvancedFilters(rows, dc.request.filters ?? [])
  if (dc.request.sort) out = sortRows(out, dc.request.sort)
  const rowTones: Record<string, Record<string, ReturnType<typeof tones.status>>> = {}
  out.forEach((row, index) => {
    const tone = {
      status: tones.status(Boolean(row._done), Boolean(row.blocked), String(row.status)),
      priority: tones.priority(String(row.priority)),
      dueDate: row._overdue ? ('bad' as const) : row.dueDate === ref.today ? ('warn' as const) : undefined,
      dueStatus: row._overdue
        ? ('bad' as const)
        : row._done
          ? ('good' as const)
          : row.dueDate === ref.today
            ? ('warn' as const)
            : undefined,
      blocked: row.blocked ? ('bad' as const) : undefined
    }
    rowTones[index] = Object.fromEntries(Object.entries(tone).filter(([, value]) => value))
  })
  return { kind: 'table', id, title, columns, rows: out, tones: rowTones as TableSection['tones'], primary: true }
}

export const tasksDataset: DatasetDefinition = {
  id: 'tasks',
  title: 'Tasks',
  description: 'Every task that matches your filters, straight from the database.',
  permissions: [],
  columns: dc => taskColumns(dc),
  run(dc) {
    const section = taskTable(dc)
    return { sections: [section], filters: describeConditions(dc.request.filters, section.columns, dc.label) }
  }
}
