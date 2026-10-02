// The two composite documents: a project's status report and the workspace summary. They are the "advanced" print jobs: a
// title block, headline figures, charts, and several tables in a readable order, all drawn from the same database reads the
// project page and the overview use.
import { workflowStates } from '../../../domain/workflow'
import { displayCell } from '../../../export/values'
import type { Section, TableSection, Tone } from '../../../export/model'
import { notFound } from '../../../util'
import { type DatasetContext, type DatasetDefinition, col } from '../kit'
import { taskColumns, taskTable } from './tasks'

const healthTone = (health: string): Tone => (health === 'At risk' ? 'bad' : health === 'Completed' ? 'info' : 'good')

export const projectReportDataset: DatasetDefinition = {
  id: 'project-report',
  title: 'Project report',
  description:
    'One project: headline numbers, charts, milestones, who is working on it, open alerts and every task, grouped by status.',
  permissions: [],
  columns: dc => taskColumns(dc),
  run(dc) {
    const { ctx, label, ref } = dc
    const id = Number(dc.scope('projectId'))
    if (!Number.isInteger(id)) throw notFound('Choose a project for this report')
    const detail = dc.services.projects.detail(id)
    const project = detail.project
    const sections: Section[] = [
      {
        kind: 'summary',
        title: label('At a glance'),
        items: [
          {
            label: label('Progress'),
            value: `${project.progress}%`,
            tone: project.progress >= 100 ? 'good' : undefined
          },
          { label: label('Health'), value: label(project.health), tone: healthTone(project.health) },
          { label: label('Open tasks'), value: detail.totals.open },
          { label: label('Done'), value: detail.totals.done, tone: 'good' },
          { label: label('Overdue'), value: detail.totals.overdue, tone: detail.totals.overdue ? 'bad' : 'good' },
          { label: label('Blocked'), value: detail.totals.blocked, tone: detail.totals.blocked ? 'warn' : 'good' },
          {
            label: label('Deadline'),
            value: project.deadlineDate
              ? displayCell(project.deadlineDate, { key: 'd', label: '', type: 'date' }, dc.language, dc.words)
              : label('No date'),
            hint: project.deadlineDays === null ? undefined : project.days
          },
          { label: label('Milestones'), value: project.milestoneRows.length }
        ]
      },
      {
        kind: 'bars',
        title: label('Tasks by status'),
        items: detail.byStatus.map(entry => ({
          label: entry.status,
          value: entry.count,
          tone: entry.done ? ('good' as const) : ('info' as const)
        }))
      },
      {
        kind: 'bars',
        title: label('Tasks by priority'),
        items: detail.byPriority.map(entry => ({
          label: label(entry.priority),
          value: entry.count,
          tone:
            entry.priority === 'High'
              ? ('bad' as const)
              : entry.priority === 'Medium'
                ? ('warn' as const)
                : ('muted' as const)
        }))
      }
    ]
    if (project.milestoneRows.length)
      sections.push({
        kind: 'table',
        id: 'milestones',
        title: label('Milestones'),
        columns: [
          col('name', label('Milestone'), 'text', 'milestones.name', { width: 36 }),
          col('status', label('Status'), 'status', 'milestones.status', { width: 12 }),
          col('dueDate', label('Due date'), 'date', 'milestones.due_date', { width: 13 })
        ],
        rows: project.milestoneRows.map(m => ({ name: m.name, status: m.status, dueDate: m.dueDate })),
        tones: Object.fromEntries(
          project.milestoneRows.map((m, i) => [
            String(i),
            m.status === 'Complete' || m.status === 'Completed'
              ? { status: 'good' }
              : m.status === 'At risk' || (m.dueDate && m.dueDate < ref.today)
                ? { status: 'bad', dueDate: 'bad' }
                : {}
          ])
        ) as any
      })
    if (detail.people.length)
      sections.push({
        kind: 'table',
        id: 'people',
        title: label('People'),
        columns: [
          col('name', label('Name'), 'text', 'people.name', { width: 28 }),
          col('open', label('Open tasks'), 'integer', 'count(tasks) where not done', { width: 12 }),
          col('done', label('Done'), 'integer', 'count(tasks) where done', { width: 10 })
        ],
        rows: detail.people.map(person => ({ name: person.name, open: person.open, done: person.done })),
        totals: { name: label('Total'), open: detail.totals.open, done: detail.totals.done }
      })
    if (detail.alerts.length)
      sections.push({
        kind: 'table',
        id: 'alerts',
        title: label('Open alerts'),
        columns: [
          col('title', label('Alert'), 'text', 'alerts.title', { width: 34 }),
          col('type', label('Type'), 'status', 'alerts.type', { width: 11 }),
          col('time', label('Created'), 'date', 'alerts.created_at', { width: 13 })
        ],
        rows: detail.alerts.map(alert => ({ title: alert.title, type: alert.type, time: alert.createdAt })),
        tones: Object.fromEntries(
          detail.alerts.map((alert, i) => [
            String(i),
            alert.type === 'blocker' || alert.type === 'overdue'
              ? { type: 'bad' }
              : alert.type === 'risk'
                ? { type: 'warn' }
                : {}
          ])
        ) as any
      })

    // The tasks: every one of them, grouped by workflow status in workflow order, soonest due first inside each group.
    const tasks = taskTable(dc, 'tasks', label('Tasks'), { projectId: id })
    const order = workflowStates(ctx.settings)
    const rank = (status: unknown) => {
      const index = order.indexOf(String(status))
      return index === -1 ? order.length : index
    }
    const indexed = tasks.rows.map((row, i) => ({ row, tone: tasks.tones?.[String(i)] }))
    indexed.sort(
      (a, b) =>
        rank(a.row.status) - rank(b.row.status) ||
        String(a.row.dueDate || '9999').localeCompare(String(b.row.dueDate || '9999'))
    )
    const grouped: TableSection = {
      ...tasks,
      rows: indexed.map(entry => entry.row),
      tones: Object.fromEntries(indexed.map((entry, i) => [String(i), entry.tone || {}])),
      groupBy: 'status'
    }
    sections.push(grouped)
    return { subtitle: `${project.code} · ${project.team} · ${project.owner}`, filters: [], sections }
  }
}

export const workspaceSummaryDataset: DatasetDefinition = {
  id: 'workspace-summary',
  title: 'Workspace summary',
  description:
    'The state of the workspace on one page: headline numbers, tasks by status, projects at risk, what is overdue and what is next.',
  permissions: [],
  columns: () => [],
  run(dc: DatasetContext) {
    const { ctx, label, ref, terminal } = dc
    const { repos } = ctx
    const counts = repos.tasks.counts(terminal, ref.today)
    const projects = dc.services.projects.list(ref)
    const atRisk = projects.filter(project => project.health === 'At risk')
    const states = workflowStates(ctx.settings)
    const byStatus = repos.tasks.statusCounts({})
    const overdue = repos.tasks.list(
      { terminal, today: ref.today, overdue: true },
      { key: 'due', dir: 'asc' },
      { limit: 25 }
    )
    const milestones = repos.milestones.upcoming(ref.today, 10)
    const alerts = repos.alerts
      .list()
      .filter(alert => !alert.resolved)
      .slice(0, 10)
    const sections: Section[] = [
      {
        kind: 'summary',
        title: label('At a glance'),
        items: [
          { label: label('Active projects'), value: projects.filter(project => project.health !== 'Completed').length },
          { label: label('Open tasks'), value: counts.open },
          { label: label('Overdue'), value: counts.overdue, tone: counts.overdue ? 'bad' : 'good' },
          { label: label('Blocked'), value: counts.blocked, tone: counts.blocked ? 'warn' : 'good' },
          { label: label('Projects at risk'), value: atRisk.length, tone: atRisk.length ? 'bad' : 'good' },
          {
            label: label('Open alerts'),
            value: repos.alerts.openCount(),
            tone: repos.alerts.openCount() ? 'warn' : 'good'
          }
        ]
      },
      {
        kind: 'bars',
        title: label('Tasks by status'),
        items: [...states, ...[...byStatus.keys()].filter(status => !states.includes(status))].map(status => ({
          label: status,
          value: byStatus.get(status) || 0,
          tone: terminal.includes(status) ? ('good' as const) : ('info' as const)
        }))
      }
    ]
    if (atRisk.length)
      sections.push({
        kind: 'table',
        id: 'at-risk',
        title: label('Projects at risk'),
        columns: [
          col('name', label('Project'), 'text', 'projects.name', { width: 28 }),
          col('code', label('Code'), 'text', 'projects.code', { width: 9 }),
          col('owner', label('Owner'), 'text', 'people.name', { width: 20 }),
          col('progress', label('Progress'), 'percent', 'tasks', { width: 10 }),
          col('deadline', label('Deadline'), 'date', 'projects.deadline', { width: 13 })
        ],
        rows: atRisk.map(project => ({
          name: project.name,
          code: project.code,
          owner: project.owner,
          progress: project.progress,
          deadline: project.deadlineDate
        }))
      })
    if (overdue.length)
      sections.push({
        kind: 'table',
        id: 'overdue',
        title: `${label('Overdue')} (${counts.overdue})`,
        columns: [
          col('id', label('Task ID'), 'text', 'tasks.key', { width: 11 }),
          col('title', label('Task'), 'longtext', 'tasks.title', { width: 36 }),
          col('project', label('Project'), 'text', 'projects.name', { width: 22 }),
          col('assignee', label('Owner'), 'text', 'people.name', { width: 18 }),
          col('dueDate', label('Due date'), 'date', 'tasks.due_date', { width: 13 })
        ],
        rows: overdue.map(task => ({
          id: task.key ?? '',
          title: task.title,
          project: task.projectName,
          assignee: task.assigneeName || label('Unassigned'),
          dueDate: task.dueDate
        })),
        tones: Object.fromEntries(overdue.map((_, i) => [String(i), { dueDate: 'bad' }])) as any,
        note: counts.overdue > overdue.length ? `${label('Showing')} ${overdue.length} / ${counts.overdue}` : undefined
      })
    if (milestones.length)
      sections.push({
        kind: 'table',
        id: 'milestones',
        title: label('Upcoming milestones'),
        columns: [
          col('name', label('Milestone'), 'text', 'milestones.name', { width: 34 }),
          col('project', label('Project'), 'text', 'projects.name', { width: 24 }),
          col('status', label('Status'), 'status', 'milestones.status', { width: 12 }),
          col('dueDate', label('Due date'), 'date', 'milestones.due_date', { width: 13 })
        ],
        rows: milestones.map(m => ({
          name: m.name,
          project: ref.projects.get(String(m.projectId))?.name ?? '',
          status: m.status,
          dueDate: m.dueDate
        })),
        tones: Object.fromEntries(
          milestones.map((m, i) => [String(i), m.status === 'At risk' ? { status: 'bad' } : {}])
        ) as any
      })
    if (alerts.length)
      sections.push({
        kind: 'table',
        id: 'alerts',
        title: label('Open alerts'),
        columns: [
          col('title', label('Alert'), 'text', 'alerts.title', { width: 36 }),
          col('type', label('Type'), 'status', 'alerts.type', { width: 11 }),
          col('project', label('Project'), 'text', 'projects.name', { width: 22 }),
          col('time', label('Created'), 'date', 'alerts.created_at', { width: 13 })
        ],
        rows: alerts.map(alert => ({
          title: alert.title,
          type: alert.type,
          project: ref.projects.get(String(alert.projectId))?.name ?? label('Workspace'),
          time: alert.createdAt
        }))
      })
    return { sections, filters: [] }
  }
}
