// Alerts and daily updates.
import { applyAdvancedFilters, sortRows } from '../../../../shared/filters'
import { addDays } from '../../../util'
import { type DatasetContext, type DatasetDefinition, col, describeConditions } from '../kit'

const settle = (dc: DatasetContext, rows: Record<string, any>[]) => {
  let out = applyAdvancedFilters(rows, dc.request.filters ?? [])
  if (dc.request.sort) out = sortRows(out, dc.request.sort)
  return out
}

export const alertsDataset: DatasetDefinition = {
  id: 'alerts',
  title: 'Alerts',
  description: 'Open and resolved alerts with the project and task they are about.',
  permissions: [],
  columns: ({ label }) => [
    col('title', label('Alert'), 'text', 'alerts.title', { width: 30 }),
    col('type', label('Type'), 'status', 'alerts.type', { width: 11 }),
    col('project', label('Project'), 'text', 'projects.name', { width: 22 }),
    col('task', label('Task'), 'text', 'tasks.key', { width: 11, defaultVisible: false }),
    col('resolved', label('Resolved'), 'boolean', 'alerts.resolved', { width: 10 }),
    col('time', label('Created'), 'date', 'alerts.created_at', { width: 13 }),
    col('body', label('Details'), 'longtext', 'alerts.body', { width: 44, defaultVisible: false })
  ],
  run(dc) {
    const projectId = Number(dc.scope('projectId'))
    const rows = dc.ctx.repos.exports
      .alerts(Number.isInteger(projectId) && projectId > 0 ? projectId : undefined)
      .map(r => ({
        title: r.title,
        type: r.type,
        project: r.project_name ?? dc.label('Workspace'),
        task: r.task_key ?? '',
        resolved: Number(r.resolved) === 1,
        time: r.created_at,
        body: r.body
      }))
    const state = dc.scope('state')
    const out = settle(
      dc,
      state === 'open'
        ? rows.filter(row => !row.resolved)
        : state === 'resolved'
          ? rows.filter(row => row.resolved)
          : rows
    )
    const columns = alertsDataset.columns(dc)
    const tone = (row: (typeof rows)[number]) =>
      row.resolved
        ? { type: 'muted' }
        : row.type === 'blocker' || row.type === 'overdue'
          ? { type: 'bad' }
          : row.type === 'risk' || row.type === 'deadline'
            ? { type: 'warn' }
            : {}
    return {
      sections: [
        {
          kind: 'table',
          id: 'alerts',
          columns,
          rows: out,
          primary: true,
          tones: Object.fromEntries(out.map((row, i) => [String(i), tone(row as any)])) as any
        }
      ],
      filters: describeConditions(dc.request.filters, columns, dc.label)
    }
  }
}

export const activityDataset: DatasetDefinition = {
  id: 'activity',
  title: 'Daily updates',
  description: 'What people posted: yesterday, today, blockers and what is next.',
  permissions: [],
  columns: ({ label }) => [
    col('person', label('Person'), 'text', 'people.name', { width: 20 }),
    col('date', label('Date'), 'date', 'activities.date', { width: 13 }),
    col('time', label('Time'), 'text', 'activities.time', { width: 8, defaultVisible: false }),
    col('yesterday', label('Yesterday'), 'longtext', 'activities.yesterday', { width: 34 }),
    col('today', label('Today'), 'longtext', 'activities.today', { width: 34 }),
    col('blocked', label('Blocked'), 'longtext', 'activities.blocked', { width: 28 }),
    col('upcoming', label('Upcoming'), 'longtext', 'activities.upcoming', { width: 28 }),
    col('status', label('Status'), 'status', 'activities.status', { width: 12, defaultVisible: false })
  ],
  run(dc) {
    const range = dc.scope('range')
    const rows = dc.ctx.repos.exports
      .activities()
      .map(r => ({
        person: r.person_name ?? dc.label('Unknown'),
        date: r.date,
        time: r.time,
        yesterday: r.yesterday,
        today: r.today,
        blocked: r.blocked,
        upcoming: r.upcoming,
        status: r.status
      }))
      .filter(
        row =>
          !range ||
          range === 'all' ||
          (range === 'today' && row.date === dc.ref.today) ||
          (range === 'yesterday' && row.date === addDays(dc.ref.today, -1))
      )
    const out = settle(dc, rows)
    const columns = activityDataset.columns(dc)
    return {
      sections: [
        {
          kind: 'table',
          id: 'activity',
          columns,
          rows: out,
          primary: true,
          tones: Object.fromEntries(out.map((row, i) => [String(i), row.blocked ? { blocked: 'bad' } : {}])) as any
        }
      ],
      filters: describeConditions(dc.request.filters, columns, dc.label)
    }
  }
}
