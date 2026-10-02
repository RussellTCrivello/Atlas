// Health, diagnostics and the destructive housekeeping an administrator can trigger: backup now, audit trail, removing
// demo data. Nothing here is reachable without the manageSettings permission, except the one-line health check.
import path from 'node:path'
import { DATABASE_MODEL } from '../../shared/settings'
import type { AuditContext } from '../domain/audit-chain'
import { isAdministrator } from '../domain/permissions'
import { sha256 } from '../util'
import { HttpError } from '../util'
import { DESIGN_SYSTEM_VERSION } from '../config'
import { SCHEMA_VERSION } from '../db/migrations'
import type { AuditService } from './audit'
import type { BackupService } from './backups'
import type { ServiceContext } from './context'
import type { SessionService } from './sessions'

export interface Validation {
  integrity: 'ok' | 'warning' | 'attention'
  errors: string[]
  warnings: string[]
}

export class SystemService {
  private validation: { revision: number; at: number; value: Validation } | null = null

  constructor(
    private ctx: ServiceContext,
    private audit: AuditService,
    private backups: BackupService,
    private sessions: SessionService
  ) {}

  /** Can the database take a write right now? (The one fact the unauthenticated health check reveals.) */
  health() {
    const { lastWriteError, lastCommitAt } = this.ctx.repos.system.storage()
    return { writable: lastWriteError === null, lastSavedAt: lastCommitAt, error: lastWriteError }
  }

  /** What the administrator's runtime-config shows about storage: where it lives and which schema it is on. */
  databaseInfo() {
    const { config, repos } = this.ctx
    return {
      fileName: path.relative(config.appRoot, repos.system.file()),
      storeModel: DATABASE_MODEL,
      schemaVersion: String(SCHEMA_VERSION),
      atomicWrites: true,
      backupRetention: config.backupRetention
    }
  }

  /** Database integrity (SQLite's own checks) plus the rules the application relies on. Cached briefly: it scans the file. */
  validate(): Validation {
    const revision = this.ctx.revision
    if (this.validation && this.validation.revision === revision && Date.now() - this.validation.at < 60_000)
      return this.validation.value
    const { repos } = this.ctx
    const settings = this.ctx.settings
    const errors: string[] = []
    const warnings: string[] = []
    const check = repos.system.quickCheck()
    if (check !== 'ok') errors.push(`SQLite integrity check: ${check}`)
    const dangling = repos.system.danglingReferences()
    if (dangling) errors.push(`${dangling} record(s) point to something that no longer exists`)
    if (!settings?.workspace || !settings?.interface || !settings?.localization)
      errors.push('Settings must include workspace, interface, and localization configuration branches')
    if (!settings?.workflows?.task?.states?.length) errors.push('Task workflow must define at least one state')
    if (!settings?.permissions?.roles?.Administrator?.permissions?.includes('manageSettings'))
      errors.push('Administrator role must retain manageSettings permission')
    if (repos.meta.configured() && !repos.users.list().some(user => isAdministrator(settings, user)))
      errors.push('The workspace has no active administrator')
    const known = new Set((settings?.workflows?.task?.states || []).map((state: any) => state.label))
    if (known.size) {
      const stray = [...repos.tasks.statusUsage()].filter(([status]) => !known.has(status))
      for (const [status, count] of stray)
        warnings.push(`${count} task(s) have the status "${status}", which is not in the workflow`)
    }
    const value: Validation = {
      integrity: errors.length ? 'attention' : warnings.length ? 'warning' : 'ok',
      errors,
      warnings
    }
    this.validation = { revision, at: Date.now(), value }
    return value
  }

  /** The administrator's overview: integrity, audit chain, storage, backups and record counts. */
  status() {
    const { config, repos } = this.ctx
    const validation = this.validate()
    const backups = this.backups.list()
    const chain = this.audit.verify()
    const counts = repos.system.counts()
    const writable = this.health()
    return {
      ok: validation.integrity === 'ok' && chain.ok && writable.writable,
      integrity: validation.integrity,
      errors: validation.errors,
      warnings: validation.warnings,
      // A fingerprint of the data's current state (revision, record counts, newest audit hash), not a hash of every row.
      checksum: sha256(JSON.stringify([repos.meta.revision(), counts, repos.audit.lastHash() || ''])),
      auditChain: chain,
      storage: writable,
      store: {
        fileName: path.relative(config.appRoot, repos.system.file()),
        storeModel: DATABASE_MODEL,
        schemaVersion: String(SCHEMA_VERSION),
        sqliteVersion: repos.system.sqliteVersion(),
        sizeBytes: repos.system.sizeBytes(),
        meta: {
          createdAt: repos.meta.createdAt(),
          updatedAt: repos.meta.updatedAt(),
          writeCount: repos.meta.revision(),
          designSystemVersion: DESIGN_SYSTEM_VERSION,
          schemaVersion: String(SCHEMA_VERSION),
          model: DATABASE_MODEL,
          atomicPersistence: true,
          auditAnchor: repos.meta.auditAnchor() || undefined
        },
        legacyImport: repos.meta.legacyImport(),
        backups: backups.slice(0, 5).map(backup => ({
          file: backup.file,
          createdAt: backup.createdAt,
          reason: backup.reason,
          size: backup.size,
          format: backup.format
        })),
        backupCount: backups.length,
        sampleRows: repos.system.sampleRows(),
        livePeople: repos.system.livePeople()
      },
      counts
    }
  }

  /** Take a snapshot now. */
  backupNow(who: AuditContext) {
    const backup = this.backups.snapshot('manual', { required: true })
    this.audit.push('system.backup.created', who, { backup: backup && path.basename(backup) })
    return { ok: Boolean(backup), backup: backup && path.basename(backup) }
  }

  /** The newest audit entries with actor names resolved, plus the state of the hash chain. */
  auditPage(limit: number) {
    const { repos } = this.ctx
    const names = new Map(repos.users.list().map(user => [user.id, user.name]))
    const rows = repos.audit.recent(limit).map(entry => ({
      id: entry.id,
      action: entry.action,
      actor: names.get(entry.actorId) || entry.actorId || 'system',
      createdAt: entry.createdAt,
      ip: entry.ip || '',
      detail: entry.detail
    }))
    return { rows, total: repos.audit.count(), chain: this.audit.verify() }
  }

  /**
   * Remove the demo records. Demo projects that someone has since put real work into (their own tasks, milestones or
   * alerts) are kept and become ordinary projects, so removing demo data never deletes anything a person created.
   */
  removeDemoData(who: AuditContext) {
    const { repos } = this.ctx
    const settings = this.ctx.settings
    if (!repos.users.list().some(user => !user.sample && isAdministrator(settings, user)))
      throw new HttpError(
        409,
        'Create your own administrator account first: demo accounts are removed together with the demo data.',
        'NEEDS_REAL_ADMIN'
      )
    this.backups.snapshot('pre-remove-demo')
    const result = this.ctx.transaction(() => {
      const keptProjects = repos.projects.adoptSamplesWithRealWork()
      repos.tasks.deleteSamples()
      repos.projects.deleteSamples()
      repos.milestones.deleteSamples()
      repos.activities.deleteSamples()
      repos.alerts.deleteSamples()
      repos.ledger.deleteSamples()
      const removedUsers = repos.users.deleteSamples()
      repos.people.deleteSamplesWithoutAccount()
      repos.teams.deleteUnusedSamples()
      this.audit.record('demo-data.removed', who, { accountsRemoved: removedUsers.length, projectsKept: keptProjects })
      return { removedUsers, keptProjects }
    })
    result.removedUsers.forEach(userId => this.sessions.revokeUser(userId))
    return { ok: true, accountsRemoved: result.removedUsers.length, projectsKept: result.keptProjects }
  }
}
