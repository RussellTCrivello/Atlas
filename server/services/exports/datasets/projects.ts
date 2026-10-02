// Projects and their milestones, from v_project_rows / v_milestone_rows plus the task counts SQL computes per project.
import { applyAdvancedFilters, sortRows } from '../../../../shared/filters'
import type { TableSection, Tone } from '../../../export/model'
import { projectHealth, projectProgress } from '../../../presenters/projects'
import {
  type DatasetContext,
  type DatasetDefinition,
  col,
  customFieldColumns,
  customValue,
  describeConditions,
  tones
} from '../kit'

const settle = (dc: DatasetContext, rows: Record<string, any>[]) => {
  let out = applyAdvancedFilters(rows, dc.request.filters ?? [])
  if (dc.request.sort) out = sortRows(out, dc.request.sort)
  return out
}

export const projectsDataset: DatasetDefinition = {
  id: 'projects',
  title: 'Projects',
  description: 'Projects with their health, progress and task counts.',
  permissions: [],
  columns: ({ ctx, label }) => [
    col('name', label('Project'), 'text', 'projects.name', { width: 28 }),
    col('code', label('Code'), 'text', 'projects.code', { width: 9 }),
    col('team', label('Team'), 'text', 'teams.name', { width: 18 }),
    col('owner', label('Owner'), 'text', 'people.name', { width: 20, defaultVisible: false }),
    col('status', label('Status'), 'status', 'projects.status', { width: 12, defaultVisible: false }),
    col('health', label('Health'), 'status', 'projects.status + tasks', { width: 11 }),
    col('progress', label('Progress'), 'percent', 'tasks (done / total)', { width: 10 }),
    col('tasks', label('Tasks'), 'integer', 'count(tasks)', { width: 8, defaultVisible: false }),
    col('openTasks', label('Open tasks'), 'integer', 'count(tasks) where not done', {
      width: 10,
      defaultVisible: false
    }),
    col('overdueTasks', label('Overdue'), 'integer', 'count(tasks) where overdue', { width: 9, defaultVisible: false }),
    col('deadline', label('Deadline'), 'date', 'projects.deadline', { width: 13 }),
    col('createdAt', label('Created'), 'date', 'projects.created_at', { width: 13, defaultVisible: false }),
    col('description', label('Description'), 'longtext', 'projects.description', { width: 40, defaultVisible: false }),
    ...customFieldColumns(ctx.settings, 'projects', label)
  ],
  run(dc) {
    const { ctx, ref, terminal, label } = dc
    const stats = ctx.repos.projects.stats(terminal, ref.today)
    const columns = projectsDataset.columns(dc)
    const rows = ctx.repos.exports.projects().map(r => {
      const s = stats.get(Number(r.id))
      const row: Record<string, string | number | boolean | null> = {
        name: r.name,
        code: r.code,
        team: r.team_name ?? label('Workspace'),
        owner: r.owner_name ?? label('Unassigned'),
        status: r.status,
        health: projectHealth({ status: r.status }, s),
        progress: projectProgress(s),
        tasks: s?.total ?? 0,
        openTasks: s?.open ?? 0,
        overdueTasks: s?.overdue ?? 0,
        deadline: r.deadline ?? '',
        createdAt: r.created_at,
        description: r.description
      }
      for (const column of columns)
        if (column.key.startsWith('customFields.')) row[column.key] = customValue(r.custom_fields, column.key.slice(13))
      return row
    })
    const out = settle(dc, rows)
    const section: TableSection = {
      kind: 'table',
      id: 'projects',
      columns,
      rows: out,
      primary: true,
      tones: Object.fromEntries(
        out.map((row, i) => [String(i), { health: tones.health(String(row.health)) }])
      ) as TableSection['tones']
    }
    return { sections: [section], filters: describeConditions(dc.request.filters, columns, label) }
  }
}

export const milestonesDataset: DatasetDefinition = {
  id: 'milestones',
  title: 'Milestones',
  description: 'Milestones across all projects, soonest first.',
  permissions: [],
  columns: ({ label }) => [
    col('name', label('Milestone'), 'text', 'milestones.name', { width: 32 }),
    col('project', label('Project'), 'text', 'projects.name', { width: 24 }),
    col('projectCode', label('Code'), 'text', 'projects.code', { width: 9, defaultVisible: false }),
    col('owner', label('Owner'), 'text', 'people.name', { width: 20, defaultVisible: false }),
    col('status', label('Status'), 'status', 'milestones.status', { width: 12 }),
    col('dueDate', label('Due date'), 'date', 'milestones.due_date', { width: 13 })
  ],
  run(dc) {
    const { ctx, ref, label } = dc
    const projectId = Number(dc.scope('projectId'))
    const rows = ctx.repos.exports
      .milestones(Number.isInteger(projectId) && projectId > 0 ? projectId : undefined)
      .map(r => ({
        name: r.name,
        project: r.project_name,
        projectCode: r.project_code,
        owner: r.owner_name ?? label('Unassigned'),
        status: r.status,
        dueDate: r.due_date ?? ''
      }))
    const out = settle(dc, rows)
    const tone = (row: (typeof rows)[number]): Record<string, Tone> => {
      const closed = row.status === 'Complete' || row.status === 'Completed'
      if (closed) return { status: 'good' }
      if (row.status === 'At risk' || (row.dueDate && row.dueDate < ref.today)) return { status: 'bad', dueDate: 'bad' }
      return {}
    }
    const columns = milestonesDataset.columns(dc)
    return {
      sections: [
        {
          kind: 'table',
          id: 'milestones',
          columns,
          rows: out,
          primary: true,
          tones: Object.fromEntries(out.map((row, i) => [String(i), tone(row as any)]))
        }
      ],
      filters: describeConditions(dc.request.filters, columns, label)
    }
  }
}
