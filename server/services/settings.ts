// Workspace settings: change, export, import. Settings are edited as RFC 7386 merge-patches, so a client that only knows
// one section can change just that section. A change that would leave nobody able to administer the workspace, or that
// removes a workflow status that tasks still use, is refused.
import { STORE_SCHEMA_VERSION, compactSettingsForStorage, mergePatch, normalizeSettings } from '../../shared/settings'
import type { AuditContext } from '../domain/audit-chain'
import { isAdministrator } from '../domain/permissions'
import { workflowDefinitions } from '../domain/workflow'
import { settingsForClient } from '../presenters/settings-view'
import { HttpError, badRequest } from '../util'
import { settingsProblems } from '../validation/schemas'
import type { AuditService } from './audit'
import type { BackupService } from './backups'
import type { ServiceContext } from './context'

export class SettingsService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService,
    private backups: BackupService
  ) {}

  forClient(admin: boolean) {
    return settingsForClient(this.ctx.settings, admin)
  }

  /**
   * Tasks store their status as the state's label, so editing the workflow must keep them attached to their state: states
   * are matched by id, a renamed state carries its tasks along, and a removed state that still has tasks is refused.
   * Returns old-label -> new-label renames to apply once the new settings are accepted.
   */
  private workflowRenames(next: any): Map<string, string> {
    const before = workflowDefinitions(this.ctx.settings)
    const after = workflowDefinitions(next)
    const afterById = new Map(after.map(entry => [entry.id, entry]))
    const afterLabels = new Set(after.map(entry => entry.label))
    const usage = this.ctx.repos.tasks.statusUsage()
    const renames = new Map<string, string>()
    for (const old of before) {
      const kept = afterById.get(old.id)
      if (kept && kept.label !== old.label) renames.set(old.label, kept.label)
      if (!kept && !afterLabels.has(old.label)) {
        const used = usage.get(old.label) || 0
        if (used)
          throw badRequest(
            `The status "${old.label}" is used by ${used} task(s). Rename it instead, or move those tasks to another status first.`
          )
      }
    }
    return renames
  }

  /** Store new settings (after the administrator check) and carry renamed workflow statuses over to the tasks. */
  private apply(next: any, renames: Map<string, string>) {
    const compact = compactSettingsForStorage(next)
    if (!this.ctx.repos.users.list().some(user => isAdministrator(compact, user)))
      throw badRequest('That change would leave the workspace without an active administrator')
    this.ctx.repos.settings.save(compact)
    this.ctx.repos.tasks.renameStatuses(renames)
  }

  update(body: Record<string, any>, who: AuditContext) {
    const problems = settingsProblems(body)
    if (problems.length) throw new HttpError(400, `Invalid settings. ${problems[0]}`, 'VALIDATION_FAILED', problems)
    const timezone = this.ctx.config.defaultTimezone
    return this.ctx.transaction(() => {
      const current = this.ctx.settings
      // RFC 7386 merge-patch: only the leaves present in the body change; `null` resets a key to its default.
      const merged = mergePatch(structuredClone(current), body)
      let next = normalizeSettings(merged, { timezone })
      const renames = this.workflowRenames(next)
      if (renames.size && body.workflows?.task?.transitions === undefined) {
        // The request renamed states but did not restate the transitions: carry the stored ones along.
        merged.workflows.task.transitions = (merged.workflows.task.transitions || []).map((t: any) => ({
          ...t,
          from: renames.get(t.from) ?? t.from,
          to: renames.get(t.to) ?? t.to
        }))
        next = normalizeSettings(merged, { timezone })
      }
      const security = ['security', 'audit'].filter(
        branch => body[branch] !== undefined && JSON.stringify(current[branch]) !== JSON.stringify(next[branch])
      )
      const detail: Record<string, unknown> = {
        branches: Object.keys(body).filter(key => typeof body[key] === 'object')
      }
      security.forEach(branch => (detail[branch] = { from: current[branch], to: next[branch] }))
      this.apply(next, renames)
      if (renames.size) detail.statusRenames = Object.fromEntries(renames)
      this.audit.record('settings.updated', who, detail)
      return settingsForClient(this.ctx.settings, true)
    })
  }

  private requireTransfer() {
    if (this.ctx.settings.storage?.importExportEnabled === false)
      throw new HttpError(403, 'Settings import and export are turned off (Settings > System).', 'TRANSFER_DISABLED')
  }

  export() {
    this.requireTransfer()
    return { exportedAt: new Date().toISOString(), schemaVersion: STORE_SCHEMA_VERSION, settings: this.ctx.settings }
  }

  import(raw: any, who: AuditContext) {
    this.requireTransfer()
    const incoming = raw?.settings ?? raw
    const problems = settingsProblems(incoming)
    if (problems.length)
      throw new HttpError(400, `Invalid settings file. ${problems[0]}`, 'VALIDATION_FAILED', problems)
    const next = normalizeSettings(incoming, { timezone: this.ctx.config.defaultTimezone })
    if (!this.ctx.repos.users.list().some(user => isAdministrator(next, user)))
      throw badRequest('Importing these settings would leave the workspace without an active administrator')
    this.backups.snapshot('pre-settings-import')
    return this.ctx.transaction(() => {
      const renames = this.workflowRenames(next)
      this.apply(next, renames)
      this.audit.record('settings.imported', who, { keys: Object.keys(incoming) })
      return settingsForClient(this.ctx.settings, true)
    })
  }
}
