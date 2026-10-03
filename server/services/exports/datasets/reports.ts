// The report tables: delivery over time, and the activity log with its per-person and per-project summaries. The figures come
// from the same report service the Reports page uses, so a printed report can never disagree with the screen.
import { col, type DatasetContext, type DatasetDefinition } from '../kit'

const period = (dc: DatasetContext, allowed: string[]) =>
  allowed.includes(String(dc.scope('period'))) ? String(dc.scope('period')) : 'weekly'

export const deliveryDataset: DatasetDefinition = {
  id: 'report',
  title: 'Delivery report',
  description: 'Tasks created, completed, planned and delivered on time, period by period.',
  permissions: ['viewReports'],
  columns: ({ label }) => [
    col('label', label('Period'), 'text', 'work_logs.date (bucketed)', { width: 16 }),
    col('created', label('Created'), 'integer', 'work_logs: Created task', { width: 10 }),
    col('completed', label('Completed'), 'integer', 'work_logs: Completed task', { width: 11 }),
    col('planned', label('Due'), 'integer', 'tasks.due_date', { width: 8 }),
    col('delivered', label('Delivered on time'), 'integer', 'tasks.completed_at <= tasks.due_date', { width: 16 }),
    col('rate', label('On-time rate %'), 'percent', 'delivered / planned', { width: 14 })
  ],
  run(dc) {
    const report = dc.services.reports.delivery(period(dc, ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']))
    const { label } = dc
    return {
      subtitle: `${label('Period')}: ${label(report.period)}`,
      filters: [],
      sections: [
        {
          kind: 'summary',
          items: [
            { label: label('Created'), value: report.created },
            { label: label('Completed'), value: report.completed },
            {
              label: label('Delivered on time'),
              value: report.delivered,
              hint: `${report.planned} ${label('Due').toLowerCase()}`
            },
            {
              label: label('On-time rate %'),
              value: report.deliveryRate === null ? '—' : `${report.deliveryRate}%`,
              tone:
                report.deliveryRate === null
                  ? undefined
                  : report.deliveryRate >= 80
                    ? 'good'
                    : report.deliveryRate >= 50
                      ? 'warn'
                      : 'bad'
            },
            { label: label('Open tasks'), value: report.remainingTasks },
            { label: label('Overdue'), value: report.overdue, tone: report.overdue ? 'bad' : 'good' },
            { label: label('Blocked'), value: report.blockedTasks, tone: report.blockedTasks ? 'warn' : 'good' }
          ]
        },
        {
          kind: 'table',
          id: 'report',
          columns: deliveryDataset.columns(dc),
          primary: true,
          rows: report.series.map(bucket => ({
            label: bucket.label,
            created: bucket.created,
            completed: bucket.completed,
            planned: bucket.planned,
            delivered: bucket.delivered,
            rate: bucket.rate
          })),
          totals: {
            label: label('Total'),
            created: report.created,
            completed: report.completed,
            planned: report.planned,
            delivered: report.delivered,
            rate: report.deliveryRate
          },
          note: report.definitions.deliveryRate
        }
      ]
    }
  }
}

const activity = (dc: DatasetContext) =>
  dc.services.reports.activityFor(
    dc.user,
    period(dc, ['daily', 'weekly', 'monthly']),
    String(dc.scope('userId') || 'all'),
    5000
  )

const scopeLine = (dc: DatasetContext, report: ReturnType<typeof activity>) =>
  `${dc.label(report.period)} · ${report.scope}`

export const activityLogDataset: DatasetDefinition = {
  id: 'activity-log',
  title: 'Activity log',
  description: 'Every recorded event in the period, from the work ledger.',
  permissions: ['viewReports'],
  columns: ({ label }) => [
    col('date', label('Date'), 'date', 'work_logs.date', { width: 13 }),
    col('time', label('Time'), 'text', 'work_logs.time', { width: 8 }),
    col('person', label('Person'), 'text', 'work_logs.person_id → people.name', { width: 20 }),
    col('project', label('Project'), 'text', 'work_logs.project_name', { width: 22 }),
    col('taskId', label('Task ID'), 'text', 'work_logs.task_key', { width: 11 }),
    col('task', label('Task / Update'), 'longtext', 'work_logs.task_title', { width: 32 }),
    col('action', label('Action'), 'text', 'work_logs.action', { width: 16 }),
    col('status', label('Status'), 'status', 'work_logs.status_to', { width: 14 }),
    col('summary', label('Details'), 'longtext', 'work_logs.summary', { width: 40 })
  ],
  run(dc) {
    const report = activity(dc)
    return {
      subtitle: scopeLine(dc, report),
      filters: report.rowsTruncated ? [`${dc.label('Newest')} ${report.rows.length} / ${report.rowsTotal}`] : [],
      sections: [
        {
          kind: 'table',
          id: 'activity-log',
          columns: activityLogDataset.columns(dc),
          rows: report.rows as any,
          primary: true
        }
      ]
    }
  }
}

export const activitySummaryDataset: DatasetDefinition = {
  id: 'activity-summary',
  title: 'Activity summary',
  description: 'What each person did in the period, aggregated.',
  permissions: ['viewReports'],
  columns: ({ label }) => [
    col('person', label('Person'), 'text', 'people.name', { width: 22 }),
    col('role', label('Job title'), 'text', 'people.job_title', { width: 20 }),
    col('team', label('Team'), 'text', 'teams.name', { width: 16 }),
    col('tasksTouched', label('Tasks touched'), 'integer', 'work_logs', { width: 12 }),
    col('completedTasks', label('Completed'), 'integer', 'work_logs', { width: 11 }),
    col('projects', label('Projects'), 'integer', 'work_logs', { width: 10 }),
    col('updates', label('Updates'), 'integer', 'work_logs', { width: 9 }),
    col('blockers', label('Blockers'), 'integer', 'work_logs', { width: 9 }),
    col('events', label('Events'), 'integer', 'work_logs', { width: 9 })
  ],
  run(dc) {
    const report = activity(dc)
    return {
      subtitle: scopeLine(dc, report),
      filters: [],
      sections: [
        {
          kind: 'table',
          id: 'activity-summary',
          columns: activitySummaryDataset.columns(dc),
          rows: report.users as any,
          primary: true
        }
      ]
    }
  }
}

export const activityProjectsDataset: DatasetDefinition = {
  id: 'activity-projects',
  title: 'Project contribution',
  description: 'Tasks completed per project in the period.',
  permissions: ['viewReports'],
  columns: ({ label }) => [
    col('project', label('Project'), 'text', 'work_logs.project_name', { width: 26 }),
    col('projectCode', label('Code'), 'text', 'projects.code', { width: 9 }),
    col('tasksTouched', label('Tasks touched'), 'integer', 'work_logs', { width: 12 }),
    col('completedTasks', label('Completed'), 'integer', 'work_logs', { width: 11 }),
    col('users', label('People'), 'integer', 'work_logs', { width: 9 }),
    col('events', label('Events'), 'integer', 'work_logs', { width: 9 })
  ],
  run(dc) {
    const report = activity(dc)
    return {
      subtitle: scopeLine(dc, report),
      filters: [],
      sections: [
        {
          kind: 'table',
          id: 'activity-projects',
          columns: activityProjectsDataset.columns(dc),
          rows: report.projects as any,
          primary: true
        }
      ]
    }
  }
}
