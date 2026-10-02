// Reports. Two sources of truth, each used for one thing: the immutable work ledger answers "what happened, when, by
// whom" (created, completed, daily updates), and task records answer "what is the state now" (open, blocked, overdue) and
// "was it delivered by its due date". History therefore does not change retroactively when a task is later re-opened,
// edited or deleted. The counting is done by SQL (repositories/reports.ts); this service turns the counts into the report.
import {
  REPORT_DEFINITIONS,
  bucketFor,
  bucketLabel,
  isBlockerRow,
  isCompletionRow,
  makeBuckets,
  windowStart
} from '../domain/report-windows'
import { canSeePeopleAnalytics } from '../domain/permissions'
import { todayIn } from '../domain/time'
import type { User } from '../domain/types'
import { isDone, workflowStates } from '../domain/workflow'
import { type WorkLogPublic, workLogPublic } from '../presenters/activity'
import { forbidden, notFound } from '../util'
import type { ServiceContext } from './context'

export interface ActivityScope {
  /** `null` = every person; otherwise only this person id. */
  onlyPersonId: string | null
  label: string
}

const DELIVERY_PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
const ACTIVITY_PERIODS = ['daily', 'weekly', 'monthly']

export class ReportService {
  constructor(private ctx: ServiceContext) {}

  private terminal(): string[] {
    const settings = this.ctx.settings
    return workflowStates(settings).filter(label => isDone(settings, { status: label }))
  }

  /** Created / completed / planned / delivered per period, plus the current open, blocked and overdue counts. */
  delivery(rawPeriod = 'weekly') {
    const { repos } = this.ctx
    const settings = this.ctx.settings
    const today = todayIn(settings)
    const period = DELIVERY_PERIODS.includes(String(rawPeriod).toLowerCase())
      ? String(rawPeriod).toLowerCase()
      : 'weekly'
    const terminal = this.terminal()
    const counted = repos.reports.series(
      period,
      settings?.workspace?.weekStartsOn,
      windowStart(period, today, settings),
      today,
      terminal
    )
    const series = makeBuckets(period, today, settings).map(bucket => {
      const planned = counted.planned.get(bucket.key) || 0
      const delivered = counted.delivered.get(bucket.key) || 0
      return {
        ...bucket,
        created: counted.created.get(bucket.key) || 0,
        completed: counted.completed.get(bucket.key) || 0,
        planned,
        delivered,
        rate: planned ? Math.round((delivered / planned) * 100) : (null as number | null)
      }
    })
    const sum = (key: 'created' | 'completed' | 'planned' | 'delivered') =>
      series.reduce((total, bucket) => total + bucket[key], 0)
    const planned = sum('planned')
    const delivered = sum('delivered')
    const tasks = repos.tasks.counts(terminal, today)
    const projects = repos.reports.projectTotals()
    return {
      period,
      series,
      created: sum('created'),
      completed: sum('completed'),
      planned,
      delivered,
      deliveryRate: planned ? Math.round((delivered / planned) * 100) : null,
      remainingTasks: tasks.open,
      activeProjects: projects.active,
      completedProjects: projects.completed,
      blockedTasks: tasks.blocked,
      overdue: tasks.overdue,
      alerts: repos.alerts.openCount(),
      activities: series.reduce((total, bucket) => total + (counted.activities.get(bucket.key) || 0), 0),
      definitions: REPORT_DEFINITIONS
    }
  }

  /**
   * The activity report as one person is allowed to see it. Per-person analytics are visible to people managers (and
   * administrators), or to everyone when the workspace opted in (Settings > Reports). Everyone can always see their own.
   */
  activityFor(user: User, rawPeriod: string, requested: string, limit: number) {
    const everyone = canSeePeopleAnalytics(this.ctx.settings, user)
    let scope: ActivityScope = { onlyPersonId: null, label: 'All users' }
    if (!everyone) {
      if (requested !== 'all' && requested !== user.personId)
        throw forbidden('You can only view your own activity. Ask a manager for team reports.')
      scope = { onlyPersonId: user.personId || '__none__', label: 'Your activity' }
    }
    // Checked after the visibility rule, so a restricted caller cannot probe which person ids exist (VAL-03).
    if (requested !== 'all' && !this.ctx.repos.people.exists(requested)) throw notFound('Person not found')
    return this.activity(rawPeriod, requested, scope, limit)
  }

  /** Who did what in a window: the ledger rows, per-person and per-project summaries, and a time series. */
  activity(rawPeriod: string, userId: string, scope: ActivityScope, rowLimit = 500) {
    const { repos } = this.ctx
    const settings = this.ctx.settings
    const ref = this.ctx.reference()
    const period = ACTIVITY_PERIODS.includes(String(rawPeriod).toLowerCase())
      ? String(rawPeriod).toLowerCase()
      : 'weekly'
    const terminal = this.terminal()
    // The same windows as the delivery report (makeBuckets), so the two reports always cover the same periods.
    const buckets = makeBuckets(period, ref.today, settings)
    const bucketKeys = new Set(buckets.map(bucket => bucket.key))
    const selected = scope.onlyPersonId ?? (!userId || userId === 'all' ? null : userId)
    const include = (personId: string) => selected === null || String(personId) === String(selected)

    const logs = repos.ledger.since(windowStart(period, ref.today, settings), selected)
    const live = repos.tasks.liveInfo([
      ...new Set(logs.map(log => log.taskId).filter((id): id is number => id != null))
    ])
    const rows: WorkLogPublic[] = []
    for (const log of logs) {
      const key = bucketFor(period, log.date, settings)
      if (!bucketKeys.has(key) || !include(log.personId)) continue
      const task = log.taskId != null ? live.get(log.taskId) : undefined
      rows.push(
        workLogPublic(
          ref,
          { ...log, projectId: log.projectId ?? task?.projectId },
          key,
          bucketLabel(period, log.date, settings),
          task?.title,
          task?.key
        )
      )
    }
    rows.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))

    const completedRow = (row: WorkLogPublic) =>
      isCompletionRow({ action: row.action, statusFrom: row.statusFrom, statusTo: row.statusTo }, terminal)
    const distinct = (items: (string | number)[]) => new Set(items.filter(item => item !== '' && item != null)).size

    const people = [...ref.people.values()].filter(person => include(person.id))
    const users = people
      .map(person => {
        const mine = rows.filter(row => row.personId === person.id)
        const taskRows = mine.filter(row => row.taskNumericId !== '')
        return {
          personId: person.id,
          person: person.name,
          role: person.jobTitle,
          team: ref.teams.get(person.teamId)?.name || 'Workspace',
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
      scope: selected === null ? scope.label || 'All users' : ref.people.get(selected)?.name || 'Selected user',
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
}
