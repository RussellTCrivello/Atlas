// Facts about the database as a whole: integrity checks, size, record counts. Read by the administrator's system page.
import type { Database } from './base'

const SAMPLE_TABLES = ['people', 'projects', 'tasks', 'activities', 'alerts', 'work_logs', 'users'] as const

export class SystemRepository {
  constructor(private db: Database) {}

  /** SQLite's quick integrity check: `ok`, or a description of the first problem. */
  quickCheck(): string {
    return String(this.db.pragma('quick_check'))
  }
  /** Records that point at something that no longer exists (always 0 while foreign keys are enforced). */
  danglingReferences(): number {
    return this.db.all('PRAGMA foreign_key_check').length
  }
  sqliteVersion(): string {
    return String(this.db.scalar('SELECT sqlite_version()'))
  }
  sizeBytes(): number {
    return Number(this.db.pragma('page_count')) * Number(this.db.pragma('page_size'))
  }
  file(): string {
    return this.db.file
  }
  counts() {
    const count = (table: string) => Number(this.db.scalar(`SELECT count(*) FROM ${table}`))
    return {
      teams: count('teams'),
      people: count('people'),
      projects: count('projects'),
      tasks: count('tasks'),
      activity: count('activities'),
      alerts: count('alerts'),
      workLogs: count('work_logs'),
      auditLogs: count('audit_log')
    }
  }
  /** Rows flagged as demo data across the tables that can hold it. */
  sampleRows(): number {
    return SAMPLE_TABLES.reduce(
      (sum, table) => sum + Number(this.db.scalar(`SELECT count(*) FROM ${table} WHERE sample = 1`)),
      0
    )
  }
  livePeople(): number {
    return Number(this.db.scalar('SELECT count(*) FROM people WHERE sample = 0'))
  }
  /** Did the last write fail for a storage reason (full or failing disk)? Cleared by the next successful write. */
  storage() {
    return { lastWriteError: this.db.lastWriteError, lastCommitAt: this.db.lastCommitAt }
  }
}
