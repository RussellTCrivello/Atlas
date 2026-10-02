// Replacing the whole workspace in one transaction (demo data, empty workspace, restore of a document). The work is done by
// db/snapshot.ts; this wrapper gives services a repository to call instead of reaching below the repository layer.
import type { Database } from './base'
import type { Snapshot } from '../domain/types'
import { type SnapshotReport, writeSnapshot } from '../db/snapshot'
import type { SettingsRepository } from './settings'

export class SnapshotRepository {
  constructor(
    private db: Database,
    private settings: SettingsRepository,
    private defaults: { defaultTimezone: string }
  ) {}

  /** Wipe every record and load `snapshot`. Everything or nothing. */
  replaceAll(snapshot: Snapshot): SnapshotReport {
    this.settings.invalidate()
    this.db.onRollback(() => this.settings.invalidate())
    const report = writeSnapshot(this.db, snapshot, this.defaults)
    this.settings.invalidate()
    return report
  }
}
