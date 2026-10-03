// Backup policy on top of db/backup.ts: snapshots before risky operations, one a day, and (optionally) after every write.
import type { BackupInfo } from '../db/backup'
import { createBackup, listBackupsIn } from '../db/backup'
import type { ServiceContext } from './context'

const DAY_MS = 24 * 60 * 60 * 1000
const WRITE_SNAPSHOT_MIN_GAP_MS = 1000

export class BackupService {
  private lastDaily = 0
  private lastWriteSnapshot = 0

  constructor(private ctx: ServiceContext) {
    this.lastDaily = Math.max(
      0,
      ...this.list()
        .filter(b => b.reason === 'daily')
        .map(b => Date.parse(b.createdAt) || 0)
    )
  }

  list(): BackupInfo[] {
    return listBackupsIn(this.ctx.config.dataDir)
  }

  /** Snapshot the live database. `required` makes a failure stop the caller (use it before anything destructive). */
  snapshot(reason = 'manual', { required = true } = {}): string | null {
    return createBackup(this.ctx.config, this.ctx.db, reason, { required })
  }

  maybeDaily() {
    if (Date.now() - this.lastDaily < DAY_MS) return
    if (this.snapshot('daily', { required: false })) this.lastDaily = Date.now()
  }

  /** Called after every committed write. */
  afterWrite() {
    if (!this.ctx.config.backupOnWrite) return this.maybeDaily()
    const now = Date.now()
    if (now - this.lastWriteSnapshot < WRITE_SNAPSHOT_MIN_GAP_MS) return
    this.lastWriteSnapshot = now
    this.snapshot('write', { required: false })
  }
}
