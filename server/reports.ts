// Reporting. Two sources of truth, each used for one thing:
//   * the immutable work ledger (state.workLogs) answers "what happened, when, by whom" (created, completed, activity);
//   * task records answer "what is the state now" (open, blocked, overdue) and "was it delivered by its due date".
// History therefore does not change retroactively when a task is later re-opened, edited or deleted.
import { type Index, formatDate, isDone, terminalStates } from './domain'
import { workLogPublic } from './presenters'
import type { StoreState, WorkLog } from './types'
import { addDays, isIsoDate, weekday } from './util'

export type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
const START_DAY: Record<string, number> = { sunday: 0, monday: 1, saturday: 6 }

export function bucketFor(period: string, dateValue: string, settings: any): string {
  if (!isIsoDate(dateValue)) return ''
  if (period === 'daily') return dateValue
  if (period === 'weekly') {
    const start = START_DAY[settings?.workspace?.weekStartsOn] ?? 1
    const offset = (weekday(dateValue) - start + 7) % 7
    return addDays(dateValue, -offset)
  }
  const [year, month] = dateValue.split('-').map(Number)
  if (period === 'monthly') return `${year}-${String(month).padStart(2, '0')}`
  if (period === 'quarterly') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
  return String(year)
}

export interface Bucket {
  key: string
  label: string
}
export function makeBuckets(period: string, today: string, settings: any): Bucket[] {
  const [ty, tm] = today.split('-').map(Number)
  const count =
    period === 'daily' ? 10 : period === 'weekly' ? 10 : period === 'monthly' ? 12 : period === 'quarterly' ? 8 : 5
  const buckets: Bucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    let iso = today
    if (period === 'daily') iso = addDays(today, -i)
    else if (period === 'weekly') iso = addDays(today, -i * 7)
    else if (period === 'monthly') iso = new Date(Date.UTC(ty, tm - 1 - i, 1)).toISOString().slice(0, 10)
    else if (period === 'quarterly') iso = new Date(Date.UTC(ty, tm - 1 - i * 3, 1)).toISOString().slice(0, 10)
    else if (period === 'yearly') iso = new Date(Date.UTC(ty - i, 0, 1)).toISOString().slice(0, 10)
    const key = bucketFor(period, iso, settings)
    let label = formatDate(settings, iso, { month: 'short', day: 'numeric' })
    if (period === 'weekly') label = `Wk ${formatDate(settings, key, { month: 'short', day: 'numeric' })}`
    if (period === 'monthly') label = formatDate(settings, iso, { month: 'short' })
    if (period === 'quarterly') label = key.split('-')[1]
    if (period === 'yearly') label = iso.slice(0, 4)
    buckets.push({ key, label })
  }
  return buckets
}

export function bucketLabel(period: string, dateValue: string, settings: any): string {
  if (period === 'daily') return formatDate(settings, dateValue, { weekday: 'short', month: 'short', day: 'numeric' })
  if (period === 'weekly')
    return `Week of ${formatDate(settings, bucketFor('weekly', dateValue, settings), { month: 'short', day: 'numeric' })}`
  if (period === 'monthly')
    return formatDate(settings, `${dateValue.slice(0, 7)}-01`, { month: 'long', year: 'numeric' })
  return formatDate(settings, dateValue)
}

/** A ledger row that records a task being completed (including older rows that only carry the status change). */
export function isCompletionRow(row: Pick<WorkLog, 'action' | 'statusFrom' | 'statusTo'>, terminal: string[]): boolean {
  if (row.action === 'Completed task') return true
  return Boolean(row.statusTo) && terminal.includes(row.statusTo!) && !terminal.includes(row.statusFrom || '')
}
const isBlockerRow = (row: Pick<WorkLog, 'action'>) => row.action === 'Raised blocker' || row.action === 'Blocked task'

export const REPORT_DEFINITIONS = {
  created: 'Tasks created in the period (from the work ledger).',
  completed:
    'Distinct tasks completed in the period (from the work ledger). Re-opening a task later does not change past periods.',
  planned: 'Tasks whose due date fell in the period and has already passed (due date as currently recorded).',
  delivered: 'Of the planned tasks, those completed on or before their due date.',
  deliveryRate:
    'Delivered ÷ planned. Both counts describe the same set of tasks, so the rate is always between 0% and 100%. Empty when nothing came due.'
}

export function reportFor(index: Index, rawPeriod = 'weekly') {
  const state = index.state
  const settings = index.settings
  const period = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(String(rawPeriod).toLowerCase())
    ? String(rawPeriod).toLowerCase()
    : 'weekly'
  const terminal = terminalStates(settings)
  const series = makeBuckets(period, index.today, settings).map(bucket => ({
    ...bucket,
    created: 0,
    completed: 0,
    planned: 0,
    delivered: 0,
    rate: null as number | null
  }))
  const byKey = new Map(series.map(bucket => [bucket.key, bucket]))
  const createdSeen = new Set<string>()
  const completedSeen = new Set<string>()
  let activities = 0
  for (const log of state.workLogs) {
    const key = bucketFor(period, log.date, settings)
    const bucket = byKey.get(key)
    if (!bucket) continue
    if (log.source === 'Activity log') activities++
    if (log.taskId == null) continue
    const mark = `${key}|${log.taskId}`
    if (log.action === 'Created task' && !createdSeen.has(mark)) {
      createdSeen.add(mark)
      bucket.created++
    } else if (isCompletionRow(log, terminal) && !completedSeen.has(mark)) {
      completedSeen.add(mark)
      bucket.completed++
    }
  }
  for (const task of state.tasks) {
    if (!task.dueDate || !isIsoDate(task.dueDate) || task.dueDate > index.today) continue
    const bucket = byKey.get(bucketFor(period, task.dueDate, settings))
    if (!bucket) continue
    bucket.planned++
    if (isDone(settings, task) && task.completedAt && task.completedAt <= task.dueDate) bucket.delivered++
  }
  series.forEach(bucket => {
    bucket.rate = bucket.planned ? Math.round((bucket.delivered / bucket.planned) * 100) : null
  })
  const sum = (key: 'created' | 'completed' | 'planned' | 'delivered') =>
    series.reduce((total, bucket) => total + bucket[key], 0)
  const planned = sum('planned')
  const delivered = sum('delivered')
  let remainingTasks = 0
  let blockedTasks = 0
  let overdue = 0
  for (const task of state.tasks) {
    if (isDone(settings, task)) continue
    remainingTasks++
    if (task.blocked) blockedTasks++
    if (task.dueDate && task.dueDate < index.today) overdue++
  }
  return {
    period,
    series,
    created: sum('created'),
    completed: sum('completed'),
    planned,
    delivered,
    deliveryRate: planned ? Math.round((delivered / planned) * 100) : null,
    remainingTasks,
    activeProjects: state.projects.filter(project => project.status !== 'Completed').length,
    completedProjects: state.projects.filter(project => project.status === 'Completed').length,
    blockedTasks,
    overdue,
    alerts: state.alerts.filter(alert => !alert.resolved).length,
    activities,
    definitions: REPORT_DEFINITIONS
  }
}

export interface ActivityScope {
  /** `null` = every person; otherwise only this person id. */
  onlyPersonId: string | null
  label: string
}

export function activityReportFor(
  index: Index,
  rawPeriod: string,
  userId: string,
  scope: ActivityScope,
  rowLimit = 500
) {
  const settings = index.settings
  const state: StoreState = index.state
  const period = ['daily', 'weekly', 'monthly'].includes(String(rawPeriod).toLowerCase())
    ? String(rawPeriod).toLowerCase()
    : 'weekly'
  const terminal = terminalStates(settings)
  // The same windows as the delivery report (makeBuckets), so the two reports always cover the same periods.
  const buckets = makeBuckets(period, index.today, settings)
  const bucketKeys = new Set(buckets.map(bucket => bucket.key))
  const selected = scope.onlyPersonId ?? (!userId || userId === 'all' ? null : userId)
  const include = (personId: string) => selected === null || String(personId) === String(selected)

  const rows: ReturnType<typeof workLogPublic>[] = []
  for (const log of state.workLogs) {
    const key = bucketFor(period, log.date, settings)
    if (!bucketKeys.has(key) || !include(log.personId)) continue
    rows.push(workLogPublic(index, log, key, bucketLabel(period, log.date, settings)))
  }
  rows.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))

  const completedRow = (row: (typeof rows)[number]) =>
    isCompletionRow({ action: row.action, statusFrom: row.statusFrom, statusTo: row.statusTo }, terminal)
  const distinct = (items: (string | number)[]) => new Set(items.filter(item => item !== '' && item != null)).size

  const people = state.people.filter(person => include(person.id))
  const users = people
    .map(person => {
      const mine = rows.filter(row => row.personId === person.id)
      const taskRows = mine.filter(row => row.taskNumericId !== '')
      return {
        personId: person.id,
        person: person.name,
        role: person.jobTitle,
        team: index.teams.get(person.teamId)?.name || 'Workspace',
        tasksTouched: distinct(taskRows.map(row => row.taskNumericId)),
        completedTasks: distinct(taskRows.filter(completedRow).map(row => row.taskNumericId)),
        projects: distinct(taskRows.map(row => row.project)),
        updates: mine.filter(row => row.source === 'Activity log').length,
        blockers: mine.filter(isBlockerRow).length,
        events: mine.length
      }
    })
    .filter(summary => summary.events || selected !== null)

  const projectMap = new Map<
    string,
    {
      project: string
      projectCode: string
      tasks: Set<string | number>
      completed: Set<string | number>
      users: Set<string>
      events: number
    }
  >()
  for (const row of rows) {
    if (!row.project || row.project === 'Workspace') continue
    const entry = projectMap.get(row.project) || {
      project: row.project,
      projectCode: row.projectCode,
      tasks: new Set(),
      completed: new Set(),
      users: new Set(),
      events: 0
    }
    if (row.taskNumericId !== '') {
      entry.tasks.add(row.taskNumericId)
      if (completedRow(row)) entry.completed.add(row.taskNumericId)
    }
    entry.users.add(row.person)
    entry.events++
    projectMap.set(row.project, entry)
  }
  const projects = [...projectMap.values()].map(entry => ({
    project: entry.project,
    projectCode: entry.projectCode,
    tasksTouched: entry.tasks.size,
    completedTasks: entry.completed.size,
    users: entry.users.size,
    events: entry.events
  }))

  const series = buckets.map(bucket => {
    const inBucket = rows.filter(row => row.periodKey === bucket.key)
    const taskRows = inBucket.filter(row => row.taskNumericId !== '')
    return {
      key: bucket.key,
      label: bucket.label,
      tasksTouched: distinct(taskRows.map(row => row.taskNumericId)),
      completedTasks: distinct(taskRows.filter(completedRow).map(row => row.taskNumericId)),
      users: distinct(inBucket.map(row => row.personId)),
      updates: inBucket.filter(row => row.source === 'Activity log').length,
      events: inBucket.length
    }
  })
  const allTaskRows = rows.filter(row => row.taskNumericId !== '')
  return {
    period,
    userId: selected === null ? 'all' : selected,
    scope: selected === null ? scope.label || 'All users' : index.people.get(selected)?.name || 'Selected user',
    restricted: scope.onlyPersonId !== null,
    generatedAt: new Date().toISOString(),
    series,
    users,
    projects,
    // Summaries above are computed over every event in the window; the detail table is capped to the newest rows.
    rows: rows.slice(0, rowLimit),
    rowsTotal: rows.length,
    rowsTruncated: rows.length > rowLimit,
    totals: {
      tasksTouched: distinct(allTaskRows.map(row => row.taskNumericId)),
      completedTasks: distinct(allTaskRows.filter(completedRow).map(row => row.taskNumericId)),
      activeUsers: distinct(rows.map(row => row.personId)),
      projects: distinct(rows.map(row => (row.project === 'Workspace' ? '' : row.project))),
      updates: rows.filter(row => row.source === 'Activity log').length,
      blockers: rows.filter(isBlockerRow).length,
      events: rows.length
    },
    definitions: {
      events:
        'Facts recorded in the work ledger (task created/updated/moved/completed, updates posted, blockers raised).',
      tasksTouched: 'Distinct tasks with at least one event in the period.',
      completedTasks: 'Distinct tasks completed in the period.',
      note: 'Atlas records what happened, not how long it took: no effort or time-spent figures are produced.'
    }
  }
}
