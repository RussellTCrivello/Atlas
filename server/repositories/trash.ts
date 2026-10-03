// The task trash: a deleted task is kept (as a JSON snapshot) for 30 days so that deleting, one or many, can be undone.
import { type Database } from './base'

export interface TrashEntry {
  taskId: number
  batch: string
  snapshot: any
  deletedAt: string
  deletedBy: string
}

export class TrashRepository {
  constructor(private db: Database) {}

  put(taskId: number, batch: string, snapshot: unknown, by: string) {
    this.db.run(
      'INSERT OR REPLACE INTO task_trash(task_id, batch, snapshot, deleted_at, deleted_by) VALUES (?, ?, ?, ?, ?)',
      [taskId, batch, JSON.stringify(snapshot), new Date().toISOString(), by]
    )
  }
  /** Everything deleted in one operation (a bulk delete shares one batch id per request). */
  batch(batch: string): TrashEntry[] {
    return this.db.all('SELECT * FROM task_trash WHERE batch = ? ORDER BY task_id', [batch]).map(row => ({
      taskId: Number(row.task_id),
      batch: row.batch,
      snapshot: JSON.parse(row.snapshot),
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by
    }))
  }
  remove(taskId: number) {
    this.db.run('DELETE FROM task_trash WHERE task_id = ?', [taskId])
  }
  count(): number {
    return Number(this.db.scalar('SELECT count(*) FROM task_trash'))
  }
  purgeOlderThan(cutoffIso: string): number {
    return this.db.run('DELETE FROM task_trash WHERE deleted_at < ?', [cutoffIso]).changes
  }
}
