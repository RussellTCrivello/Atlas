// The payload the browser loads at sign-in and whenever the revision changes: what this person is allowed to see, shaped
// for rendering. Lists that can grow without bound are capped here; the full data is always one filtered query away.
import { can, canSeePeopleAnalytics } from '../domain/permissions'
import { bucketFor } from '../domain/report-windows'
import { isDone, workflowStates } from '../domain/workflow'
import type { User } from '../domain/types'
import { activityPublic, alertPublic } from '../presenters/activity'
import { buildDashboard } from '../presenters/dashboard'
import { personPublic } from '../presenters/people'
import { settingsForClient } from '../presenters/settings-view'
import { type TaskPublic, taskPublic } from '../presenters/tasks'
import { publicAccessUser, publicUser } from '../presenters/users'
import type { TaskRow } from '../repositories/tasks'
import { addDays } from '../util'
import type { ServiceContext } from './context'
import type { PeopleService } from './people'
import type { ProjectService } from './projects'
import type { ReportService } from './reports'

const ACTIVITY_LIMIT = 500
const ALERT_LIMIT = 500

const byDueDate = (a: TaskPublic, b: TaskPublic) => {
  // Tasks without a due date sort last; ties keep a stable order by id.
  if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1
  return String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || a.numericId - b.numericId
}

export class BootstrapService {
  constructor(
    private ctx: ServiceContext,
    private projects: ProjectService,
    private people: PeopleService,
    private reports: ReportService
  ) {}

  forUser(user: User) {
    const { repos, config } = this.ctx
    const settings = this.ctx.settings
    const ref = this.ctx.reference()
    const canAdmin = can(settings, user, 'manageSettings')
    const terminal = workflowStates(settings).filter(label => isDone(settings, { status: label }))

    const projects = this.projects.list(ref)
    const present = (rows: TaskRow[]) => {
      const tags = repos.tags.forTasks(rows.map(row => row.id))
      return rows.map(row => taskPublic(ref, row, tags.get(row.id) || []))
    }
    const tasks = present(repos.tasks.workingSet(terminal, config.bootstrapTaskLimit)).sort(byDueDate)
    const counts = repos.tasks.counts(terminal, ref.today)
    const activity = repos.activities
      .recent(ACTIVITY_LIMIT)
      .map(entry => activityPublic(ref, entry))
      .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    const alerts = repos.alerts
      .list(ALERT_LIMIT)
      .map(alert => alertPublic(ref, alert))
      .sort((a, b) => Number(a.resolved) - Number(b.resolved) || String(b.createdAt).localeCompare(String(a.createdAt)))

    // "Most active this week": people ranked by the daily updates they logged in the current week (the week starts on the
    // workspace's configured day). A ranking of individuals is per-person analytics, so it follows the same visibility rule
    // as the activity report: null (hidden) for people who may only see their own activity (GOV-02).
    let mostActive: { personId: string; updates: number }[] | null = null
    if (canSeePeopleAnalytics(settings, user)) {
      const weekStart = bucketFor('weekly', ref.today, settings)
      mostActive = repos.activities.countsByPersonBetween(weekStart, addDays(weekStart, 7))
    }
    const scope = { terminal, today: ref.today, open: true }
    const mineFilter = user.personId ? { ...scope, assigneeId: user.personId } : null
    const mine = mineFilter
      ? {
          count: repos.tasks.count(mineFilter),
          first: present(repos.tasks.list(mineFilter, { key: 'due', dir: 'asc' }, { limit: 6 }))
        }
      : { count: 0, first: [] }

    const dashboard = buildDashboard({
      ref,
      counts,
      mine,
      blockedOpen: present(repos.tasks.list({ ...scope, blocked: true }, { key: 'due', dir: 'asc' }, { limit: 3 })),
      projects,
      openAlerts: repos.alerts.openCount(),
      todayEntries: repos.activities.onDate(ref.today),
      yesterdayEntries: repos.activities.onDate(addDays(ref.today, -1)),
      upcomingMilestones: repos.milestones.upcoming(ref.today, 4),
      mostActive
    })

    return {
      today: ref.today,
      revision: this.ctx.revision,
      user: publicUser(settings, user),
      settings: settingsForClient(settings, canAdmin),
      teams: this.people.teamsPublic(ref),
      people: [...ref.people.values()].map(person => personPublic(ref, person)),
      // The account directory (roles, last sign-in) is visible only to those who manage users.
      users: can(settings, user, 'manageUsers')
        ? repos.users.list().map(account => publicAccessUser(ref, account))
        : [],
      projects,
      tasks,
      // How many tasks exist, so the page can say so when it only holds the most relevant ones.
      taskStats: { total: counts.total, loaded: tasks.length, truncated: tasks.length < counts.total },
      activity,
      alerts,
      dashboard,
      reports: can(settings, user, 'viewReports')
        ? this.reports.delivery('weekly')
        : { period: 'weekly', series: [], restricted: true }
    }
  }
}
