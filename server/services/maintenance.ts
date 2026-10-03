// Periodic housekeeping: the daily backup, audit and ledger retention, expired sessions. Runs on a timer started by the
// server; every step is also safe to call directly (the tests do).
import type { AuditService } from './audit'
import type { BackupService } from './backups'
import type { ServiceContext } from './context'
import type { SessionService } from './sessions'
import { TRASH_DAYS } from './task-bulk'

export class MaintenanceService {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private ctx: ServiceContext,
    private audit: AuditService,
    private backups: BackupService,
    private sessions: SessionService
  ) {}

  start(intervalMs = 6 * 60 * 60 * 1000) {
    if (this.timer) return
    const tick = () => {
      try {
        this.run()
      } catch (error) {
        console.error('Maintenance failed:', (error as Error).message)
      }
    }
    this.timer = setInterval(tick, intervalMs)
    this.timer.unref?.()
    tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  run() {
    const { repos, settings } = this.ctx
    this.backups.maybeDaily()
    this.sessions.prune(Number(settings?.security?.sessionDays || 14) * 86400000)
    this.purgeTrash()
    const retentionDays = Number(settings?.audit?.workLogRetentionDays || 0)
    const logCutoff = new Date(Date.now() - retentionDays * 86400000).toISOString().slice(0, 10)
    const logsDue = retentionDays > 0 && repos.ledger.hasOlderThan(logCutoff)
    if (!this.audit.pruneDue() && !logsDue) return
    this.ctx.transaction(() => {
      this.audit.prune()
      if (retentionDays > 0) repos.ledger.deleteBefore(logCutoff)
    })
  }

  /** A deleted task can be undone for TRASH_DAYS days; after that its recoverable copy is removed. Returns how many were purged. */
  purgeTrash(now = Date.now()): number {
    const { repos } = this.ctx
    if (!repos.trash.count()) return 0
    const cutoff = new Date(now - TRASH_DAYS * 86400000).toISOString()
    // Housekeeping, not a change to the workspace's data: it does not advance the data revision.
    return this.ctx.transaction(() => repos.trash.purgeOlderThan(cutoff), { revision: false })
  }
}
