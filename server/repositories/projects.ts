import type { Project } from '../domain/types'
import {
  type Database,
  type Row,
  isOne,
  marks,
  nullable,
  orEmpty,
  parseFields,
  stringifyFields,
  updatePlan
} from './base'

const COLUMNS = {
  name: 'name',
  code: 'code',
  description: 'description',
  teamId: 'team_id',
  ownerId: 'owner_id',
  color: 'color',
  status: 'status',
  deadline: 'deadline',
  customFields: 'custom_fields'
}

export const toProject = (row: Row): Project => ({
  id: Number(row.id),
  name: row.name,
  code: row.code,
  description: row.description,
  teamId: orEmpty(row.team_id),
  ownerId: orEmpty(row.owner_id),
  color: row.color,
  status: row.status,
  deadline: orEmpty(row.deadline),
  createdAt: row.created_at,
  customFields: parseFields(row.custom_fields),
  sample: isOne(row.sample)
})

export interface ProjectStats {
  total: number
  done: number
  open: number
  overdue: number
  blocked: number
}

export class ProjectRepository {
  constructor(private db: Database) {}

  list(): Project[] {
    return this.db.all('SELECT * FROM projects ORDER BY id').map(toProject)
  }
  count(): number {
    return Number(this.db.scalar('SELECT count(*) FROM projects'))
  }
  byId(id: number): Project | undefined {
    const row = this.db.get('SELECT * FROM projects WHERE id = ?', [id])
    return row && toProject(row)
  }
  /** Project with this code (case-insensitive), optionally ignoring one project (for edits). */
  byCode(code: string, exceptId?: number): Project | undefined {
    const row = this.db.get('SELECT * FROM projects WHERE upper(code) = upper(?) AND id IS NOT ?', [
      code,
      exceptId ?? null
    ])
    return row && toProject(row)
  }
  codes(): string[] {
    return this.db.all<{ code: string }>('SELECT code FROM projects').map(row => row.code)
  }

  insert(project: Omit<Project, 'id'>): number {
    return this.db.run(
      'INSERT INTO projects(name, code, description, team_id, owner_id, color, status, deadline, created_at, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        project.name,
        project.code,
        project.description,
        nullable(project.teamId),
        nullable(project.ownerId),
        project.color,
        project.status,
        nullable(project.deadline),
        project.createdAt,
        stringifyFields(project.customFields),
        Boolean(project.sample)
      ]
    ).lastInsertRowid
  }

  update(id: number, patch: Partial<Project>) {
    const plan = updatePlan('projects', 'id', id, COLUMNS, patch as Record<string, unknown>, {
      teamId: nullable,
      ownerId: nullable,
      deadline: nullable,
      customFields: stringifyFields
    })
    if (plan) this.db.run(plan.sql, plan.params)
  }

  /** What deleting this project takes with it (foreign keys cascade to all three). */
  dependents(id: number): { tasks: number; milestones: number; alerts: number } {
    const count = (table: string) => Number(this.db.scalar(`SELECT count(*) FROM ${table} WHERE project_id = ?`, [id]))
    return { tasks: count('tasks'), milestones: count('milestones'), alerts: count('alerts') }
  }
  delete(id: number) {
    this.db.run('DELETE FROM projects WHERE id = ?', [id])
  }

  /** Demo projects that still hold something a person added are kept and become ordinary projects. */
  adoptSamplesWithRealWork(): number {
    return this.db.run(
      `UPDATE projects SET sample = 0 WHERE sample = 1 AND (
         id IN (SELECT project_id FROM tasks WHERE sample = 0) OR
         id IN (SELECT project_id FROM milestones WHERE sample = 0) OR
         id IN (SELECT project_id FROM alerts WHERE sample = 0 AND project_id IS NOT NULL))`
    ).changes
  }
  deleteSamples() {
    this.db.run('DELETE FROM projects WHERE sample = 1')
  }

  /** Task counts per project in one pass (progress, health and the numbers on the project page come from here). */
  stats(terminal: string[], today: string, projectId?: number): Map<number, ProjectStats> {
    const done = `status IN (${marks(terminal.length)})`
    const only = projectId === undefined ? '' : 'WHERE project_id = ?'
    const rows = this.db.all(
      `SELECT project_id,
              count(*) AS total,
              sum(CASE WHEN ${done} THEN 1 ELSE 0 END) AS done,
              sum(CASE WHEN NOT ${done} AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
              sum(CASE WHEN NOT ${done} AND blocked = 1 THEN 1 ELSE 0 END) AS blocked
       FROM tasks ${only} GROUP BY project_id`,
      [...terminal, ...terminal, today, ...terminal, ...(projectId === undefined ? [] : [projectId])]
    )
    return new Map(
      rows.map(row => [
        Number(row.project_id),
        {
          total: Number(row.total),
          done: Number(row.done),
          open: Number(row.total) - Number(row.done),
          overdue: Number(row.overdue),
          blocked: Number(row.blocked)
        }
      ])
    )
  }

  /** Distinct assignees per project (the avatars on a project card). */
  memberIds(projectId?: number): Map<number, string[]> {
    const map = new Map<number, string[]>()
    const only = projectId === undefined ? '' : 'AND project_id = ?'
    for (const row of this.db.all<{ project_id: number; assignee_id: string }>(
      `SELECT DISTINCT project_id, assignee_id FROM tasks WHERE assignee_id IS NOT NULL ${only} ORDER BY project_id, assignee_id`,
      projectId === undefined ? [] : [projectId]
    )) {
      const list = map.get(Number(row.project_id))
      if (list) list.push(row.assignee_id)
      else map.set(Number(row.project_id), [row.assignee_id])
    }
    return map
  }

  /** Open and finished task counts per assignee within one project (the "who is on this" strip of the project page). */
  workload(projectId: number, terminal: string[]): { personId: string; open: number; done: number }[] {
    const done = `status IN (${marks(terminal.length)})`
    return this.db
      .all<{ assignee_id: string | null; done: number; total: number }>(
        `SELECT assignee_id, count(*) AS total, sum(CASE WHEN ${done} THEN 1 ELSE 0 END) AS done
         FROM tasks WHERE project_id = ? GROUP BY assignee_id ORDER BY total DESC, assignee_id`,
        [...terminal, projectId]
      )
      .map(row => ({
        personId: row.assignee_id ?? '',
        open: Number(row.total) - Number(row.done),
        done: Number(row.done)
      }))
  }
}
