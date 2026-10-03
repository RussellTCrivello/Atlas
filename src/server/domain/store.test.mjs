import assert from 'node:assert/strict'
import { createStoreService } from './store.js'

let currentStore = null
const defaultSettings = () => ({
  workspace: { name: 'Atlas Workspace', unit: 'Operations' },
  interface: { navigationVisibility: {}, navigationOrder: [] },
  localization: { defaultLanguage: 'en' },
  workflows: { task: { states: [{ id: 'todo', label: 'To do', terminal: false }] } },
  permissions: { roles: { Administrator: { permissions: ['manageSettings'] } } },
  storage: { backupRetention: 25 },
  audit: { enabled: true, retentionDays: 365 },
  workLedger: { retentionMonths: 24 }
})
const normalizeSettings = value => {
  const base = defaultSettings()
  return {
    ...base,
    ...structuredClone(value || {}),
    storage: { ...base.storage, ...(value?.storage || {}) },
    workLedger: { ...base.workLedger, ...(value?.workLedger || {}) }
  }
}
const service = createStoreService({
  getStore: () => currentStore,
  todayLA: () => '2026-10-02',
  timeLA: () => '12:00',
  addDays: (date, days) => date,
  id: prefix => `${prefix}_test`,
  parseNumber: value => Number(value) || 0,
  isPlainObject: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  defaultSettings,
  normalizeSettings,
  hashPassword: value => `hashed:${value}`,
  normalizeUserSecrets: user => user,
  allowDemoData: false,
  STORE_SCHEMA_VERSION: '5.0.0',
  DATABASE_MODEL: 'sqlite-relational',
  DESIGN_SYSTEM_VERSION: '2.0.0',
  configuredBackupRetention: () => 25
})

const { productionStore, normalizeStore } = service
const fresh = productionStore()
assert.equal(fresh.settings.workLedger.retentionMonths, 24, 'new workspaces use the 24-month work-ledger policy')

const cutoff = new Date()
const originalDay = cutoff.getUTCDate()
cutoff.setUTCDate(1)
cutoff.setUTCMonth(cutoff.getUTCMonth() - 24)
cutoff.setUTCDate(Math.min(originalDay, new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate()))
const cutoffDay = cutoff.toISOString().slice(0, 10)
const expiredDay = new Date(`${cutoffDay}T00:00:00.000Z`)
expiredDay.setUTCDate(expiredDay.getUTCDate() - 1)
const normalizedFresh = normalizeStore({
  ...structuredClone(fresh),
  workLogs: [
    { id: 'expired', date: expiredDay.toISOString().slice(0, 10) },
    { id: 'boundary', date: cutoffDay },
    { id: 'invalid-date', date: 'not-a-date' }
  ]
})
assert.deepEqual(normalizedFresh.workLogs.map(row => row.id), ['boundary', 'invalid-date'], '24-month cleanup removes only valid dates before the cutoff')

const legacy = structuredClone(fresh)
legacy.meta.schemaVersion = '3.0.0'
delete legacy.settings.workLedger
legacy.workLogs = [{ id: 'legacy-history', date: '2010-01-01', minutes: 35 }]
const normalizedLegacy = normalizeStore(legacy)
assert.equal(normalizedLegacy.settings.workLedger.retentionMonths, 0, 'existing workspaces without an explicit retention policy remain indefinite')
assert.deepEqual(normalizedLegacy.workLogs, [{ id: 'legacy-history', date: '2010-01-01', minutes: 35 }], 'legacy work history is not silently deleted')

console.log('Work-ledger retention defaults, cutoff cleanup, and legacy-preservation checks passed')
