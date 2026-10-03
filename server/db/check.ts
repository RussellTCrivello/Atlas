// Read-only database checks for `--check-data`: SQLite's own integrity and foreign-key checks, the schema state, and the
// audit hash chain. Works on a read-only connection, so it is safe while the server runs.
import { verifyChain } from '../domain/audit-chain'
import type { AuditEntry } from '../domain/types'
import type { Database } from './driver'
import { SCHEMA_VERSION } from './migrations'

export interface CheckResult {
  integrity: 'ok' | 'warning' | 'attention'
  errors: string[]
  warnings: string[]
  schemaVersion: number
  sqliteVersion: string
  counts: Record<string, number>
}

export function runChecks(db: Database): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const integrity = db.all<{ integrity_check: string }>('PRAGMA integrity_check').map(row => row.integrity_check)
  if (integrity.length !== 1 || integrity[0] !== 'ok')
    errors.push(...integrity.slice(0, 5).map(line => `integrity: ${line}`))
  const dangling = db.all('PRAGMA foreign_key_check')
  if (dangling.length) errors.push(`${dangling.length} record(s) point to something that no longer exists`)
  const schemaVersion = Number(db.pragma('user_version'))
  if (schemaVersion < SCHEMA_VERSION)
    warnings.push(`schema ${schemaVersion} will be upgraded to ${SCHEMA_VERSION} on next start`)
  const anchor = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'audit_anchor'")?.value || ''
  const rows = db.iterate<Record<string, any>>('SELECT * FROM audit_log ORDER BY seq')
  const entries = (function* (): Generator<AuditEntry> {
    for (const row of rows)
      yield {
        id: row.id,
        action: row.action,
        actorId: row.actor_id,
        detail: JSON.parse(row.detail || '{}'),
        createdAt: row.created_at,
        ip: row.ip ?? undefined,
        userAgent: row.user_agent ?? undefined,
        prev: row.prev_hash,
        hash: row.hash ?? undefined
      }
  })()
  const chain = verifyChain(entries, anchor)
  if (!chain.ok) errors.push(`the audit trail's hash chain is broken at entry ${chain.brokenAt}`)
  const counts: Record<string, number> = {}
  for (const table of ['users', 'people', 'projects', 'tasks', 'work_logs', 'audit_log'])
    counts[table] = Number(db.scalar(`SELECT count(*) FROM ${table}`))
  return {
    integrity: errors.length ? 'attention' : warnings.length ? 'warning' : 'ok',
    errors,
    warnings,
    schemaVersion,
    sqliteVersion: String(db.scalar('SELECT sqlite_version()')),
    counts
  }
}
