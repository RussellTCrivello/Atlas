// The audit service: records who did what, in the same transaction as the change itself, and verifies the hash chain.
// Security events that happen at request rate (denied requests, failed sign-ins) are queued and written in batches,
// so a flood of bad requests cannot turn into a flood of commits.
import { type AuditContext, chainEntry, shouldRecord, verifyChain, type ChainStatus } from '../domain/audit-chain'
import type { ServiceContext } from './context'

export class AuditService {
  private queue: { action: string; ctx: AuditContext; detail: Record<string, unknown> }[] = []
  private timer: NodeJS.Timeout | null = null
  private chainCache: { revision: number; status: ChainStatus } | null = null
  dropped = 0

  constructor(
    private ctx: ServiceContext,
    private delayMs = 2000,
    private maxQueue = 500
  ) {}

  /** Append an entry now, as part of the surrounding transaction. Returns false when audit settings skip this action. */
  record(action: string, who: AuditContext = {}, detail: Record<string, unknown> = {}): boolean {
    const { repos, settings } = this.ctx
    if (!shouldRecord(settings, action)) return false
    const prev = repos.audit.lastHash() || repos.meta.auditAnchor()
    repos.audit.append(chainEntry(prev, action, who, detail))
    return true
  }

  /** Queue an entry for the next batch write (never blocks the request, never throws). */
  push(action: string, who: AuditContext, detail: Record<string, unknown> = {}) {
    if (this.queue.length >= this.maxQueue) {
      this.dropped++
      return
    }
    this.queue.push({ action, ctx: who, detail })
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.delayMs)
      this.timer.unref?.()
    }
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.queue.length) return
    const batch = this.queue.splice(0, this.queue.length)
    const dropped = this.dropped
    this.dropped = 0
    try {
      this.ctx.transaction(
        () => {
          for (const item of batch) this.record(item.action, item.ctx, item.detail)
          if (dropped) this.record('security.audit.overflow', {}, { dropped })
        },
        { revision: false }
      )
    } catch (error) {
      console.error('Could not write queued audit events:', (error as Error).message)
    }
  }

  /** Verify the hash chain end to end (cached until the next write). */
  verify(): ChainStatus {
    const revision = this.ctx.revision
    if (this.chainCache?.revision === revision) return this.chainCache.status
    const status = verifyChain(this.ctx.repos.audit.iterate(), this.ctx.repos.meta.auditAnchor())
    this.chainCache = { revision, status }
    return status
  }

  /** Drop entries older than the retention window; the hash of the last dropped entry becomes the new chain anchor. */
  prune(now = Date.now()): number {
    const { repos, settings } = this.ctx
    const retentionDays = Number(settings?.audit?.retentionDays || 365)
    const cutoff = new Date(now - retentionDays * 86400000).toISOString()
    const { removed, anchor } = repos.audit.prune(cutoff)
    if (removed && anchor) repos.meta.setAuditAnchor(anchor)
    return removed
  }

  /** Is there anything old enough to prune? (Cheap check so the maintenance job only writes when needed.) */
  pruneDue(now = Date.now()): boolean {
    const oldest = this.ctx.repos.audit.oldestCreatedAt()
    const retentionDays = Number(this.ctx.settings?.audit?.retentionDays || 365)
    return Boolean(oldest) && Date.parse(oldest!) < now - retentionDays * 86400000
  }
}
