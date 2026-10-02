import type { Alert } from '../domain/types'
import { type Database, type Row, isOne, nullable, orEmpty, parseFields, stringifyFields, updatePlan } from './base'

const COLUMNS = {
  title: 'title',
  body: 'body',
  type: 'type',
  tone: 'tone',
  projectId: 'project_id',
  taskId: 'task_id',
  resolved: 'resolved',
  customFields: 'custom_fields'
}

const toAlert = (row: Row): Alert => ({
  id: row.id,
  title: row.title,
  body: row.body,
  type: row.type,
  tone: row.tone,
  projectId: row.project_id === null ? '' : Number(row.project_id),
  taskId: row.task_id === null ? '' : Number(row.task_id),
  resolved: isOne(row.resolved),
  createdAt: orEmpty(row.created_at),
  customFields: parseFields(row.custom_fields),
  sample: isOne(row.sample)
})
const refId = (value: number | string | undefined) =>
  value === '' || value === undefined || value === null ? null : Number(value)

export class AlertRepository {
  constructor(private db: Database) {}
  /** Open alerts first, then newest first. */
  list(limit = 1000): Alert[] {
    return this.db
      .all('SELECT * FROM alerts ORDER BY resolved, created_at DESC, rowid DESC LIMIT ?', [limit])
      .map(toAlert)
  }
  forProject(projectId: number): Alert[] {
    return this.db
      .all('SELECT * FROM alerts WHERE project_id = ? ORDER BY resolved, created_at DESC, rowid DESC', [projectId])
      .map(toAlert)
  }
  openCount(): number {
    return Number(this.db.scalar('SELECT count(*) FROM alerts WHERE resolved = 0'))
  }
  byId(id: string): Alert | undefined {
    const row = this.db.get('SELECT * FROM alerts WHERE id = ?', [id])
    return row && toAlert(row)
  }
  insert(alert: Alert) {
    this.db.run(
      'INSERT INTO alerts(id, title, body, type, tone, project_id, task_id, resolved, created_at, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        alert.id,
        alert.title,
        alert.body,
        alert.type,
        alert.tone,
        refId(alert.projectId),
        refId(alert.taskId),
        alert.resolved,
        alert.createdAt,
        stringifyFields(alert.customFields),
        Boolean(alert.sample)
      ]
    )
  }
  update(id: string, patch: Partial<Alert>) {
    const plan = updatePlan('alerts', 'id', id, COLUMNS, patch as Record<string, unknown>, {
      projectId: refId,
      taskId: refId,
      resolved: Boolean,
      customFields: stringifyFields
    })
    if (plan) this.db.run(plan.sql, plan.params)
  }
  delete(id: string) {
    this.db.run('DELETE FROM alerts WHERE id = ?', [id])
  }
  deleteSamples() {
    this.db.run('DELETE FROM alerts WHERE sample = 1')
  }
}
export { nullable }
