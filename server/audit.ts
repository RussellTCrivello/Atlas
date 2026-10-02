// Tamper-evident audit trail. Each entry stores the SHA-256 of the previous entry, so an edited, removed or reordered
// entry breaks the chain and is reported by /api/system. This detects accidental damage and casual tampering; it does
// not stop someone who can rewrite the whole data file (that needs an off-box log shipper, see docs/SECURITY.md).
import { id, sha256, truncate } from './util'
import type { AuditEntry, StoreState } from './types'

export interface AuditContext {
  actorId?: string
  ip?: string
  userAgent?: string
}

/** Actions that are recorded even when an administrator switched general audit logging off. */
const ALWAYS_LOGGED = /^(settings\.|auth\.|user\.|security\.|system\.|setup\.)/

function digest(entry: Omit<AuditEntry, 'hash'>): string {
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

export function appendAudit(
  state: StoreState,
  action: string,
  ctx: AuditContext = {},
  detail: Record<string, unknown> = {}
): AuditEntry | null {
  const enabled = state.settings?.audit?.enabled !== false
  if (!enabled && !ALWAYS_LOGGED.test(action)) return null
  if (state.settings?.audit?.trackWrites === false && WRITE_ACTIONS.test(action)) return null
  const last = state.auditLogs[state.auditLogs.length - 1]
  const base: Omit<AuditEntry, 'hash'> = {
    id: id('audit'),
    action,
    actorId: ctx.actorId || '',
    detail: detail || {},
    createdAt: new Date().toISOString(),
    ip: ctx.ip ? truncate(ctx.ip, 64) : undefined,
    userAgent: ctx.userAgent ? truncate(ctx.userAgent, 160) : undefined,
    prev: last?.hash || state.meta.auditAnchor || ''
  }
  const entry: AuditEntry = { ...base, hash: digest(base) }
  state.auditLogs.push(entry)
  return entry
}

/** Drop entries older than the retention window, remembering the hash that anchors the surviving chain. */
export function pruneAudit(state: StoreState, now = Date.now()): number {
  const retentionDays = Number(state.settings?.audit?.retentionDays || 365)
  const cutoff = now - retentionDays * 86400000
  let drop = 0
  while (drop < state.auditLogs.length) {
    const createdAt = Date.parse(state.auditLogs[drop].createdAt)
    if (Number.isFinite(createdAt) && createdAt < cutoff) drop++
    else break
  }
  if (drop) {
    state.meta.auditAnchor = state.auditLogs[drop - 1].hash || state.meta.auditAnchor
    state.auditLogs.splice(0, drop)
  }
  return drop
}

export interface ChainStatus {
  ok: boolean
  checked: number
  legacy: number
  brokenAt?: string
}
/** Verify the hash chain. Entries written before chaining existed (no hash) are counted as `legacy`. */
export function verifyAuditChain(state: StoreState): ChainStatus {
  let expectedPrev = state.meta.auditAnchor || ''
  let checked = 0
  let legacy = 0
  let seenChained = false
  for (const entry of state.auditLogs) {
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
