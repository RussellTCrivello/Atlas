import assert from 'node:assert/strict'
import { createSettingsService } from './settings.js'
import { ROLE_PERMISSIONS } from './security.js'

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const service = createSettingsService({
  ROLE_PERMISSIONS,
  boundedInteger: (value, fallback, min, max) => {
    const number = Number(value)
    return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : fallback
  },
  isPlainObject,
  isValidTimezone: value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true } catch { return false }
  },
  id: prefix => `${prefix}_test`,
  env: {},
  DATABASE_MODEL: 'sqlite-relational',
  STORE_SCHEMA_VERSION: '5.0.0',
  I18N_MISSING_LIMIT: 2000,
  MAX_I18N_KEY_LENGTH: 200,
  DEFAULT_BACKUP_RETENTION: 25,
  MIN_PASSWORD_LENGTH: 8
})

const defaults = service.defaultSettings()
assert.equal(defaults.audit.retentionDays, 365)
assert.equal(defaults.workLedger.retentionMonths, 24)
assert.equal(service.settingsInputError(defaults), '', 'normalized new-workspace settings pass validation')
const keepAuditIndefinitely = structuredClone(defaults)
keepAuditIndefinitely.audit.retentionDays = 0
assert.equal(service.settingsInputError(keepAuditIndefinitely), '', 'zero audit retention is an explicit indefinite-retention choice')

const current = {
  customFields: { tasks: [{ key: 'obsolete' }], reports: [{ key: 'keep-unless-replaced' }] },
  localization: { translations: { en: { 'settings.projects.create_button': 'Create project' }, ar: { hello: 'مرحبا' } } },
  permissions: { roles: { Administrator: { permissions: ['manageSettings'] }, Custom: { permissions: ['viewReports'] } } },
  workspace: { organization: { legalName: 'Atlas', website: 'https://example.local' } }
}
const patch = {
  customFields: { tasks: [] },
  localization: { translations: { en: { greeting: 'Welcome' } } },
  permissions: { roles: { Administrator: { permissions: ['manageSettings'] } } },
  workspace: { organization: { legalName: 'New name' } }
}
const merged = service.mergeSettingsUpdate(current, patch)
assert.deepEqual(merged.customFields, { tasks: [] }, 'full snapshots can clear a custom-field map')
assert.deepEqual(merged.localization.translations, { en: { greeting: 'Welcome' } }, 'full snapshots can remove translation catalogs and keys')
assert.deepEqual(merged.permissions.roles, { Administrator: { permissions: ['manageSettings'] } }, 'full snapshots can remove roles')
assert.deepEqual(merged.workspace.organization, { legalName: 'New name', website: 'https://example.local' }, 'ordinary object branches retain deep-merge behavior')
assert.deepEqual(current.customFields.tasks, [{ key: 'obsolete' }], 'merging settings does not mutate the current snapshot')

const noTerminalState = structuredClone(defaults)
noTerminalState.workflows.task.states = noTerminalState.workflows.task.states.map(state => ({ ...state, terminal: false }))
assert.match(service.settingsInputError(noTerminalState), /at least one workflow state must be terminal/i)
const unsafeRole = structuredClone(defaults)
unsafeRole.permissions.roles.Custom = { permissions: ['manageSettings', 'admin'] }
assert.match(service.settingsInputError(unsafeRole), /unsupported permission/i)

console.log('Settings normalization, validation, retention, and full-snapshot map replacement checks passed')
