// The people directory and the sign-in accounts. Accounts are read from v_user_rows, which has no password column, so a
// secret cannot end up in an export however the request is phrased.
import { applyAdvancedFilters, sortRows } from '../../../../shared/filters'
import {
  type DatasetContext,
  type DatasetDefinition,
  col,
  customFieldColumns,
  customValue,
  describeConditions
} from '../kit'

const settle = (dc: DatasetContext, rows: Record<string, any>[]) => {
  let out = applyAdvancedFilters(rows, dc.request.filters ?? [])
  if (dc.request.sort) out = sortRows(out, dc.request.sort)
  return out
}

export const peopleDataset: DatasetDefinition = {
  id: 'people',
  title: 'People',
  description: 'The team directory with planned capacity and workload.',
  permissions: [],
  columns: ({ ctx, label }) => [
    col('name', label('Name'), 'text', 'people.name', { width: 24 }),
    col('email', label('Email'), 'text', 'people.email', { width: 28 }),
    col('role', label('Role'), 'text', 'people.job_title', { width: 22 }),
    col('team', label('Team'), 'text', 'teams.name', { width: 18 }),
    col('status', label('Status'), 'status', 'people.status', { width: 14 }),
    col('load', label('Planned capacity'), 'percent', 'people.capacity', { width: 12 }),
    col('focus', label('Focus'), 'longtext', 'people.focus', { width: 36, defaultVisible: false }),
    col('tasks', label('Tasks'), 'integer', 'count(tasks)', { width: 8, defaultVisible: false }),
    col('openTasks', label('Open tasks'), 'integer', 'count(tasks) where not done', {
      width: 10,
      defaultVisible: false
    }),
    ...customFieldColumns(ctx.settings, 'people', label)
  ],
  run(dc) {
    const { ctx, terminal, label } = dc
    const columns = peopleDataset.columns(dc)
    const open = ctx.repos.exports.openTasksByPerson(terminal)
    const rows = ctx.repos.exports.people().map(r => {
      const row: Record<string, string | number | boolean | null> = {
        name: r.name,
        email: r.email,
        role: r.job_title,
        team: r.team_name ?? label('Workspace'),
        status: r.status,
        load: Number(r.capacity),
        focus: r.focus,
        tasks: Number(r.task_count),
        openTasks: open.get(r.id) ?? 0
      }
      for (const column of columns)
        if (column.key.startsWith('customFields.')) row[column.key] = customValue(r.custom_fields, column.key.slice(13))
      return row
    })
    const out = settle(dc, rows)
    return {
      sections: [
        {
          kind: 'table',
          id: 'people',
          columns,
          rows: out,
          primary: true,
          tones: Object.fromEntries(
            out.map((row, i) => [
              String(i),
              row.status === 'At risk' ? { status: 'bad' } : row.status === 'Needs attention' ? { status: 'warn' } : {}
            ])
          ) as any
        }
      ],
      filters: describeConditions(dc.request.filters, columns, label)
    }
  }
}

export const usersDataset: DatasetDefinition = {
  id: 'users',
  title: 'Users',
  description: 'Sign-in accounts: roles and activity, never credentials.',
  permissions: ['manageUsers'],
  columns: ({ label }) => [
    col('name', label('Name'), 'text', 'users.name', { width: 24 }),
    col('email', label('Email'), 'text', 'users.email', { width: 28 }),
    col('role', label('Role'), 'text', 'users.role', { width: 16 }),
    col('team', label('Team'), 'text', 'teams.name', { width: 18 }),
    col('active', label('Active'), 'boolean', 'users.active', { width: 8 }),
    col('lastLoginAt', label('Last sign-in'), 'datetime', 'users.last_login_at', { width: 17, defaultVisible: false }),
    col('createdAt', label('Created'), 'datetime', 'users.created_at', { width: 17, defaultVisible: false })
  ],
  run(dc) {
    const rows = dc.ctx.repos.exports.users().map(r => ({
      name: r.name,
      email: r.email,
      role: r.role,
      team: r.team_name ?? dc.label('Workspace'),
      active: Number(r.active) === 1,
      lastLoginAt: r.last_login_at ?? '',
      createdAt: r.created_at
    }))
    const out = settle(dc, rows)
    const columns = usersDataset.columns(dc)
    return {
      sections: [
        {
          kind: 'table',
          id: 'users',
          columns,
          rows: out,
          primary: true,
          tones: Object.fromEntries(out.map((row, i) => [String(i), row.active ? {} : { active: 'bad' }])) as any
        }
      ],
      filters: describeConditions(dc.request.filters, columns, dc.label)
    }
  }
}
