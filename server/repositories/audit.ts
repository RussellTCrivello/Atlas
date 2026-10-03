// The audit trail. Rows are only ever appended (the database refuses UPDATE and DELETE except for the retention job,
// which raises a flag first), and each row carries the hash of the one before it.
import type { AuditEntry } from '../domain/types'
import { type Database, type Row } from './base'

const toEntry = (row: Row): AuditEntry => ({
  id: row.id,
  action: row.action,
  actorId: row.actor_id,
  detail: safeParse(row.detail),
  createdAt: row.created_at,
  ip: row.ip ?? undefined,
  userAgent: row.user_agent ?? undefined,
  prev: row.prev_hash,
  hash: row.hash ?? undefined
})
function safeParse(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

export class AuditRepository {
  constructor(private db: Database) {}

  append(entry: AuditEntry) {
    this.db.run(
      'INSERT INTO audit_log(id, action, actor_id, detail, created_at, ip, user_agent, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        entry.id,
        entry.action,
        entry.actorId,
        JSON.stringify(entry.detail ?? {}),
        entry.createdAt,
        entry.ip ?? null,
        entry.userAgent ?? null,
        entry.prev || '',
        entry.hash ?? null
      ]
    )
  }

  lastHash(): string | undefined {
    return (
      this.db.get<{ hash: string | null }>('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1')?.hash ?? undefined
    )
  }
  count(): number {
    return Number(this.db.scalar('SELECT count(*) FROM audit_log'))
  }
  /** Newest first. */
  recent(limit: number): AuditEntry[] {
    return this.db.all('SELECT * FROM audit_log ORDER BY seq DESC LIMIT ?', [limit]).map(toEntry)
  }
  /** Oldest first, one at a time (chain verification reads the whole log without holding it in memory). */
  *iterate(): Generator<AuditEntry> {
    for (const row of this.db.iterate('SELECT * FROM audit_log ORDER BY seq')) yield toEntry(row)
  }
  oldestCreatedAt(): string | undefined {
    return this.db.get<{ created_at: string }>('SELECT created_at FROM audit_log ORDER BY seq LIMIT 1')?.created_at
  }

  /**
   * Remove the oldest entries that are older than `cutoffIso` (a contiguous prefix of the log) and return the hash of the
   * newest removed one: it anchors the surviving chain so verification still starts from a known value.
   */
  prune(cutoffIso: string): { removed: number; anchor: string | undefined } {
    const firstKept = this.db.scalar<number | null>('SELECT min(seq) FROM audit_log WHERE created_at >= ?', [cutoffIso])
    const boundary = firstKept ?? Number.MAX_SAFE_INTEGER
    const last = this.db.get<{ seq: number; hash: string | null }>(
      'SELECT seq, hash FROM audit_log WHERE seq < ? ORDER BY seq DESC LIMIT 1',
      [boundary]
    )
    if (!last) return { removed: 0, anchor: undefined }
    this.db.run('UPDATE audit_maintenance SET enabled = 1 WHERE id = 1')
    try {
      const removed = this.db.run('DELETE FROM audit_log WHERE seq < ?', [boundary]).changes
      return { removed, anchor: last.hash ?? undefined }
    } finally {
      this.db.run('UPDATE audit_maintenance SET enabled = 0 WHERE id = 1')
    }
  }

  /** Counts of rows per action (the system page's overview of what is being recorded). */
  countsByAction(limit = 20): { action: string; n: number }[] {
    return this.db
      .all<{ action: string; n: number }>(
        'SELECT action, count(*) AS n FROM audit_log GROUP BY action ORDER BY n DESC LIMIT ?',
        [limit]
      )
      .map(row => ({ action: row.action, n: Number(row.n) }))
  }
}
