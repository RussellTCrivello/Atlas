// Tamper-evident audit trail. Each entry stores the SHA-256 of the previous entry, so an edited, removed or reordered
// entry breaks the chain and is reported by /api/system. This detects accidental damage and casual tampering; it does
// not stop someone who can rewrite the whole data file (that needs an off-box log shipper, see docs/SECURITY.md).
import { id, sha256, truncate } from '../util'
import type { AuditEntry } from './types'

export interface AuditContext {
  actorId?: string
  ip?: string
  userAgent?: string
  /** Hash of the session making the request (not stored in the audit trail; lets a service keep that session signed in). */
  sessionHash?: string
}

/** Actions that are recorded even when an administrator switched general audit logging off. */
const ALWAYS_LOGGED = /^(settings\.|auth\.|user\.|security\.|system\.|setup\.)/

export function digest(entry: Omit<AuditEntry, 'hash'>): string {
  return sha256(
    JSON.stringify([
      entry.prev || '',
      entry.id,
      entry.action,
      entry.actorId,
      entry.createdAt,
      entry.ip || '',
      entry.userAgent || '',
      entry.detail
    ])
  )
}

/** Routine data changes: skipped when the administrator turned "track writes" off. */
const WRITE_ACTIONS = /^(task|project|person|team|milestone|activity|alert|i18n|demo-data)\./

/** Should this action be written to the audit trail under the workspace's audit settings? */
export function shouldRecord(settings: any, action: string): boolean {
  const enabled = settings?.audit?.enabled !== false
  if (!enabled && !ALWAYS_LOGGED.test(action)) return false
  if (settings?.audit?.trackWrites === false && WRITE_ACTIONS.test(action)) return false
  return true
}

/** Build the next entry in the chain. `prev` is the hash of the previous entry (or the anchor when the log is empty). */
export function chainEntry(
  prev: string,
  action: string,
  ctx: AuditContext = {},
  detail: Record<string, unknown> = {},
  now = new Date()
): AuditEntry {
  const base: Omit<AuditEntry, 'hash'> = {
    id: id('audit'),
    action,
    actorId: ctx.actorId || '',
    detail: detail || {},
    createdAt: now.toISOString(),
    ip: ctx.ip ? truncate(ctx.ip, 64) : undefined,
    userAgent: ctx.userAgent ? truncate(ctx.userAgent, 160) : undefined,
    prev
  }
  return { ...base, hash: digest(base) }
}

export interface ChainStatus {
  ok: boolean
  checked: number
  legacy: number
  brokenAt?: string
}

/**
 * Verify the hash chain over entries in order. Entries written before chaining existed (no hash) are counted as `legacy`.
 * `anchor` is the hash of the last entry removed by retention (the surviving chain starts from it).
 */
export function verifyChain(entries: Iterable<AuditEntry>, anchor = ''): ChainStatus {
  let expectedPrev = anchor
  let checked = 0
  let legacy = 0
  let seenChained = false
  for (const entry of entries) {
    if (!entry.hash) {
      if (seenChained) return { ok: false, checked, legacy, brokenAt: entry.id }
      legacy++
      continue
    }
    seenChained = true
    if ((entry.prev || '') !== expectedPrev || digest({ ...entry }) !== entry.hash)
      return { ok: false, checked, legacy, brokenAt: entry.id }
    expectedPrev = entry.hash
    checked++
  }
  return { ok: true, checked, legacy }
}
