// The work ledger: an append-only record of what happened to work items and who did it. It has no foreign keys on
// purpose, so the history outlives the tasks, projects and people it names.
import type { WorkLog } from '../domain/types'
import { type Database, type Row, isOne, orEmpty } from './base'

const toLog = (row: Row): WorkLog => ({
  id: row.id,
  personId: row.person_id,
  actorUserId: row.actor_user_id ?? undefined,
  assigneeId: row.assignee_id ?? undefined,
  taskId: row.task_id === null ? undefined : Number(row.task_id),
  projectId: row.project_id === null ? undefined : Number(row.project_id),
  taskKey: row.task_key ?? undefined,
  taskTitle: row.task_title ?? undefined,
  projectName: row.project_name ?? undefined,
  action: row.action,
  statusFrom: row.status_from,
  statusTo: row.status_to,
  summary: row.summary,
  date: row.date,
  time: row.time,
  at: row.at ?? undefined,
  source: row.source,
  derived: isOne(row.derived),
  sample: isOne(row.sample)
})

export class LedgerRepository {
  constructor(private db: Database) {}

  insert(log: WorkLog) {
    this.db.run(
      'INSERT INTO work_logs(id, person_id, actor_user_id, assignee_id, task_id, project_id, task_key, task_title, project_name, action, status_from, status_to, summary, date, time, at, source, derived, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        log.id,
        orEmpty(log.personId),
        log.actorUserId ?? null,
        log.assigneeId ?? null,
        log.taskId ?? null,
        log.projectId ?? null,
        log.taskKey ?? null,
        log.taskTitle ?? null,
        log.projectName ?? null,
        log.action,
        log.statusFrom || '',
        log.statusTo || '',
        log.summary || '',
        log.date,
        log.time || '',
        log.at ?? null,
        log.source || 'Task event',
        Boolean(log.derived),
        Boolean(log.sample)
      ]
    )
  }

  /** Every event on or after `from`, optionally for one person, oldest first (report windows are read this way). */
  since(from: string, personId?: string | null): WorkLog[] {
    return personId
      ? this.db
          .all('SELECT * FROM work_logs WHERE date >= ? AND person_id = ? ORDER BY rowid', [from, personId])
          .map(toLog)
      : this.db.all('SELECT * FROM work_logs WHERE date >= ? ORDER BY rowid', [from]).map(toLog)
  }

  forTask(taskId: number, limit = 50): WorkLog[] {
    return this.db
      .all('SELECT * FROM work_logs WHERE task_id = ? ORDER BY date DESC, rowid DESC LIMIT ?', [taskId, limit])
      .map(toLog)
  }

  /** The latest events on any task of a project (the "recent activity" strip of the project page). */
  forProject(projectId: number, limit = 10): WorkLog[] {
    return this.db
      .all('SELECT * FROM work_logs WHERE project_id = ? ORDER BY date DESC, time DESC, rowid DESC LIMIT ?', [
        projectId,
        limit
      ])
      .map(toLog)
  }

  count(): number {
    return Number(this.db.scalar('SELECT count(*) FROM work_logs'))
  }
  deleteBefore(date: string): number {
    return this.db.run("DELETE FROM work_logs WHERE date != '' AND date < ?", [date]).changes
  }
  hasOlderThan(date: string): boolean {
    return Boolean(this.db.get("SELECT 1 FROM work_logs WHERE date != '' AND date < ? LIMIT 1", [date]))
  }
  deleteSamples() {
    this.db.run('DELETE FROM work_logs WHERE sample = 1')
  }
}
