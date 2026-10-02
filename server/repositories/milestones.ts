import type { Milestone } from '../domain/types'
import { type Database, type Row, isOne, nullable, orEmpty, parseFields, stringifyFields, updatePlan } from './base'

const COLUMNS = {
  name: 'name',
  projectId: 'project_id',
  dueDate: 'due_date',
  status: 'status',
  customFields: 'custom_fields'
}

const toMilestone = (row: Row): Milestone => ({
  id: row.id,
  name: row.name,
  projectId: Number(row.project_id),
  dueDate: orEmpty(row.due_date),
  status: row.status,
  customFields: parseFields(row.custom_fields),
  sample: isOne(row.sample)
})

export class MilestoneRepository {
  constructor(private db: Database) {}
  list(): Milestone[] {
    return this.db.all('SELECT * FROM milestones ORDER BY rowid').map(toMilestone)
  }
  forProject(projectId: number): Milestone[] {
    return this.db
      .all('SELECT * FROM milestones WHERE project_id = ? ORDER BY (due_date IS NULL), due_date, rowid', [projectId])
      .map(toMilestone)
  }
  byId(id: string): Milestone | undefined {
    const row = this.db.get('SELECT * FROM milestones WHERE id = ?', [id])
    return row && toMilestone(row)
  }
  insert(milestone: Milestone) {
    this.db.run(
      'INSERT INTO milestones(id, name, project_id, due_date, status, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        milestone.id,
        milestone.name,
        milestone.projectId,
        nullable(milestone.dueDate),
        milestone.status,
        stringifyFields(milestone.customFields),
        Boolean(milestone.sample)
      ]
    )
  }
  update(id: string, patch: Partial<Milestone>) {
    const plan = updatePlan('milestones', 'id', id, COLUMNS, patch as Record<string, unknown>, {
      dueDate: nullable,
      customFields: stringifyFields
    })
    if (plan) this.db.run(plan.sql, plan.params)
  }
  delete(id: string) {
    this.db.run('DELETE FROM milestones WHERE id = ?', [id])
  }
  deleteSamples() {
    this.db.run('DELETE FROM milestones WHERE sample = 1')
  }
  /** Milestones that are not finished and not in the past, soonest first. */
  upcoming(today: string, limit: number): Milestone[] {
    return this.db
      .all(
        "SELECT * FROM milestones WHERE status NOT IN ('Complete', 'Completed') AND due_date >= ? ORDER BY due_date, rowid LIMIT ?",
        [today, limit]
      )
      .map(toMilestone)
  }
}
