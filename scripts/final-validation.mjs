import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { openSqliteDatabase } from '../src/server/database/connection.js'
import { SqliteStoreRepository } from '../src/server/database/store-repository.js'
import { UserPreferencesRepository } from '../src/server/database/user-preferences-repository.js'

const root = process.cwd()
const port = Number(process.env.TEST_PORT || 5193)
const base = `http://127.0.0.1:${port}`
const validationRoot = path.resolve(root, '.audit-test-data')
const dataDir = path.resolve(process.env.TEST_DATA_DIR || path.join(validationRoot, 'final-validation-data'))
const databaseFile = path.join(dataDir, 'atlas.sqlite')
const legacyImportDataDir = path.join(validationRoot, 'legacy-json-import-data')
const legacyImportDatabaseFile = path.join(legacyImportDataDir, 'atlas.sqlite')
const schemaMigrationDataDir = path.join(validationRoot, 'schema-migration-data')
const schemaMigrationDatabaseFile = path.join(schemaMigrationDataDir, 'atlas.sqlite')
const resultPath = path.resolve(process.env.TEST_RESULT_PATH || path.join(dataDir, 'final-validation-results.json'))
if (dataDir === root || !dataDir.startsWith(`${validationRoot}${path.sep}`)) throw new Error('Refusing to delete validation data outside .audit-test-data')
if (resultPath === root || !resultPath.startsWith(`${validationRoot}${path.sep}`)) throw new Error('Refusing to write validation results outside .audit-test-data')
if (path.dirname(dataDir) !== validationRoot) throw new Error('Validation data must be a direct child of .audit-test-data')
if (path.dirname(resultPath) !== dataDir) throw new Error('Validation results must be a direct child of the validation data directory')
function assertSafeChildDataDir(targetDirectory) {
  if (path.dirname(targetDirectory) !== validationRoot) throw new Error('Validation child data must be a direct child of .audit-test-data')
  const realValidationRoot = fs.realpathSync(validationRoot)
  if (fs.realpathSync(path.dirname(targetDirectory)) !== realValidationRoot) throw new Error('Refusing to clean a child outside .audit-test-data')
  try {
    const targetStat = fs.lstatSync(targetDirectory)
    if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) throw new Error('Refusing to clean an unsafe child data directory')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
function assertSafeDataDir() {
  const repositoryRoot = fs.realpathSync(root)
  if (fs.realpathSync(path.dirname(validationRoot)) !== repositoryRoot) throw new Error('Refusing to use a validation root outside the repository')
  try {
    const validationRootStat = fs.lstatSync(validationRoot)
    if (validationRootStat.isSymbolicLink() || !validationRootStat.isDirectory()) throw new Error('Refusing to use an unsafe validation root')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    fs.mkdirSync(validationRoot)
  }
  const realValidationRoot = fs.realpathSync(validationRoot)
  if (realValidationRoot !== path.join(repositoryRoot, '.audit-test-data')) throw new Error('Refusing to use an unexpected validation root')
  const realParent = fs.realpathSync(path.dirname(dataDir))
  if (realParent !== realValidationRoot) throw new Error('Refusing to clean a data directory outside .audit-test-data')
  try {
    const dataDirStat = fs.lstatSync(dataDir)
    if (dataDirStat.isSymbolicLink() || !dataDirStat.isDirectory()) throw new Error('Refusing to clean an unsafe validation data directory')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  try {
    const resultStat = fs.lstatSync(resultPath)
    if (resultStat.isSymbolicLink() || !resultStat.isFile()) throw new Error('Refusing to write validation results through an unsafe path')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}
const report = { startedAt: new Date().toISOString(), port, dataDir, checks: [], metrics: {}, knownLimitations: [] }
let server
let safePathsValidated = false

function record(name, status, detail = {}) { report.checks.push({ name, status, ...detail }) }
function validateSchemaV1Migration() {
  assertSafeChildDataDir(schemaMigrationDataDir)
  fs.rmSync(schemaMigrationDataDir, { recursive: true, force: true })
  fs.mkdirSync(schemaMigrationDataDir, { recursive: true })
  const legacyDatabase = new DatabaseSync(schemaMigrationDatabaseFile)
  legacyDatabase.exec(`
    CREATE TABLE schema_migrations(version INTEGER NOT NULL PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
    CREATE TABLE users(id TEXT NOT NULL PRIMARY KEY) STRICT;
    INSERT INTO schema_migrations(version, name, applied_at) VALUES(1, 'initial-relational-schema', datetime('now'));
    PRAGMA user_version = 1;
  `)
  legacyDatabase.close()

  const database = openSqliteDatabase(schemaMigrationDatabaseFile, { dataDirectory: schemaMigrationDataDir })
  try {
    assert.equal(Number(database.prepare('PRAGMA user_version').get().user_version), 5)
    assert.equal(database.prepare("SELECT name FROM schema_migrations WHERE version = 2").get().name, 'user-saved-filters')
    assert.equal(database.prepare("SELECT name FROM schema_migrations WHERE version = 3").get().name, 'offline-sync-idempotency')
    assert.equal(database.prepare("SELECT name FROM schema_migrations WHERE version = 4").get().name, 'offline-sync-conflict-audit')
    assert.equal(database.prepare("SELECT name FROM schema_migrations WHERE version = 5").get().name, 'per-user-language-preference')
    const syncRepository = new SqliteStoreRepository(database, { filePath: schemaMigrationDatabaseFile, dataDirectory: schemaMigrationDataDir })
    const syncOperation = { operationId: 'migration-offline-op-00000001', actorId: 'migration-user', requestHash: 'migration-hash' }
    syncRepository.completeSyncOperation(syncOperation, 200, { ok: true, entityId: 'offline-task-test' })
    assert.deepEqual(syncRepository.getSyncOperation(syncOperation.operationId).responseBody, { ok: true, entityId: 'offline-task-test' })
    const conflict = { operationId: 'migration-conflict-00000001', actorId: 'migration-user', collection: 'tasks', entityId: 'offline-task-test', method: 'PUT', path: '/api/tasks/offline-task-test', code: 'field-conflict', baseRecord: { title: 'base' }, localRecord: { title: 'local' }, serverRecord: { title: 'server' }, fields: [{ path: 'title', base: 'base', local: 'local', server: 'server' }] }
    assert.equal(syncRepository.recordSyncConflict(conflict).status, 'open')
    assert.deepEqual(syncRepository.getSyncConflict(conflict.operationId).localRecord, conflict.localRecord)
    assert.equal(syncRepository.resolveSyncConflict(conflict.operationId, 'migration-user', { action: 'merge', fields: { title: 'local' } }).status, 'resolved')
    assert.equal(syncRepository.listSyncConflicts({ status: 'resolved' }).length, 1)
    assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_preferences'").get().name, 'user_preferences')
    database.prepare('INSERT INTO users(id) VALUES(?)').run('migration-user')
    const preferences = new UserPreferencesRepository(database)
    const filters = { projects: [{ field: 'name', operator: 'contains', join: 'AND', value: 'legacy' }] }
    assert.deepEqual(preferences.saveFilters('migration-user', filters), filters)
    database.prepare('DELETE FROM users WHERE id = ?').run('migration-user')
    assert.equal(Number(database.prepare('SELECT COUNT(*) AS count FROM user_preferences').get().count), 0)
  } finally {
    database.close()
  }
  record('SQLite schema v1-to-v5 migrations, offline-sync receipts and conflict-audit retention, and user-preference cascade', 'pass')
}
async function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }
async function raw(pathname, options = {}) {
  const started = performance.now()
  const res = await fetch(`${base}${pathname}`, options)
  const text = await res.text()
  const ms = Math.round(performance.now() - started)
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { res, body, ms }
}
async function startServer() {
  fs.rmSync(dataDir, { recursive: true, force: true })
  fs.mkdirSync(dataDir, { recursive: true })
  server = spawn(process.execPath, ['dist-desktop/app.mjs'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ATLAS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let logs = ''
  server.stdout.on('data', chunk => { logs += chunk.toString() })
  server.stderr.on('data', chunk => { logs += chunk.toString() })
  for (let i = 0; i < 80; i++) {
    try {
      const { res } = await raw('/api/health')
      if (res.ok) { record('production server startup', 'pass', { logs: logs.trim().split('\n').slice(-4).join('\n') }); return }
    } catch {}
    if (server.exitCode != null) throw new Error(`Server exited during startup: ${logs}`)
    await wait(150)
  }
  throw new Error(`Server did not start. Logs: ${logs}`)
}
async function stopServer() {
  if (!server || server.exitCode != null) return
  server.kill('SIGTERM')
  for (let i = 0; i < 30; i++) { if (server.exitCode != null) return; await wait(100) }
  server.kill('SIGKILL')
}
async function restartPreservingData() {
  await stopServer()
  server = spawn(process.execPath, ['dist-desktop/app.mjs'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ATLAS_DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let logs = ''
  server.stdout.on('data', chunk => { logs += chunk.toString() })
  server.stderr.on('data', chunk => { logs += chunk.toString() })
  for (let i = 0; i < 80; i++) {
    try { const { res } = await raw('/api/health'); if (res.ok) { record('production restart', 'pass', { logs: logs.trim().split('\n').slice(-4).join('\n') }); return } } catch {}
    if (server.exitCode != null) throw new Error(`Server exited during restart: ${logs}`)
    await wait(150)
  }
  throw new Error(`Server did not restart. Logs: ${logs}`)
}


async function startServerForDataDir(targetDirectory, label) {
  server = spawn(process.execPath, ['dist-desktop/app.mjs'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), ATLAS_DATA_DIR: targetDirectory },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let logs = ''
  server.stdout.on('data', chunk => { logs += chunk.toString() })
  server.stderr.on('data', chunk => { logs += chunk.toString() })
  for (let i = 0; i < 80; i++) {
    try {
      const { res } = await raw('/api/health')
      if (res.ok) {
        record(`${label} server startup`, 'pass', { logs: logs.trim().split('\n').slice(-5).join('\n') })
        return logs
      }
    } catch {}
    if (server.exitCode != null) throw new Error(`${label} server exited during startup: ${logs}`)
    await wait(150)
  }
  throw new Error(`${label} server did not start. Logs: ${logs}`)
}

class Client {
  constructor(name) { this.name = name; this.cookie = '' }
  async request(pathname, { method = 'GET', body, expect = 200 } = {}) {
    const headers = { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.cookie ? { Cookie: this.cookie } : {}) }
    const started = performance.now()
    const res = await fetch(`${base}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) this.cookie = setCookie.split(';')[0]
    const text = await res.text()
    const ms = Math.round(performance.now() - started)
    let payload
    try { payload = JSON.parse(text) } catch { payload = text }
    if (res.status !== expect) throw new Error(`${this.name} ${method} ${pathname} expected ${expect}, got ${res.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`)
    return { status: res.status, body: payload, ms }
  }
  get(pathname, expect = 200) { return this.request(pathname, { expect }) }
  post(pathname, body, expect = 200) { return this.request(pathname, { method: 'POST', body, expect }) }
  put(pathname, body, expect = 200) { return this.request(pathname, { method: 'PUT', body, expect }) }
  patch(pathname, body, expect = 200) { return this.request(pathname, { method: 'PATCH', body, expect }) }
  sync(pathname, { method = 'POST', body = {}, metadata, expect = 200 } = {}) {
    return this.request(pathname, { method, body: { ...body, __atlasSync: metadata }, expect })
  }
  delete(pathname, expect = 200) { return this.request(pathname, { method: 'DELETE', expect }) }
}

function canonicalTask(task) {
  return {
    title: task.title, projectId: task.projectId, assigneeId: task.assigneeId, priority: task.priority,
    dueDate: task.dueDate || '', status: task.status, type: task.type, blocked: Boolean(task.blocked),
    createdAt: task.createdAt || '', completedAt: task.completedAt || '', customFields: structuredClone(task.customFields || {})
  }
}

function mutateSettings(settings) {
  const s = structuredClone(settings)
  s.workspace.name = 'Atlas Acceptance Backup Point'
  s.workspace.unit = 'Operations QA'
  s.workspace.organization.legalName = 'Atlas Validation Cooperative'
  s.workspace.defaultTimezone = 'Europe/Amsterdam'
  s.workspace.workingDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday']
  s.interface.theme = 'light'
  s.interface.density = 'compact'; s.density = 'compact'
  s.interface.tableBehavior.pageSize = 100; s.pageSize = 100
  s.interface.accessibility.highContrast = true
  s.localization.defaultLanguage = 'ar'; s.language = 'ar'
  s.localization.fallbackLanguage = 'en'
  s.localization.activeLanguages = ['en', 'ar', 'fa', 'he']
  s.localization.translations.ar['settings.projects.create_button'] = 'إنشاء مشروع'
  s.modules.activity.enabled = true
  s.interface.navigationVisibility.activity = true
  s.workflows.task.states = [
    { id: 'draft', label: 'Draft', color: 'blue', terminal: false },
    { id: 'active', label: 'Active', color: 'purple', terminal: false },
    { id: 'review', label: 'Review', color: 'orange', terminal: false },
    { id: 'done', label: 'Done', color: 'green', terminal: true }
  ]
  s.workflows.task.transitions = [
    { from: 'Draft', to: 'Active', permission: 'writeTasks' },
    { from: 'Active', to: 'Review', permission: 'writeTasks' },
    { from: 'Review', to: 'Done', permission: 'writeTasks' }
  ]
  s.customFields.tasks = [{ key: 'client_code', label: 'Client code', type: 'text', visible: true, required: false }, { key: 'ticket_ref', label: 'Ticket reference', type: 'text', visible: true, required: true }, { key: 'quality_score', label: 'Quality score', type: 'number', visible: true, required: false }]
  s.permissions.roles.Reporter = { name: 'Reporter', summary: 'Reports and exports only.', permissions: ['viewReports', 'exportData'], rank: 2 }
  s.permissions.roles.SettingsDelegate = { name: 'Settings Delegate', summary: 'Test role with a settings permission but not the Administrator role.', permissions: ['manageSettings', 'viewReports', 'exportData'], rank: 4 }
  s.exports.formats = ['csv', 'xlsx', 'json', 'pdf', 'print']
  s.reports.defaultTemplate = 'executive'
  s.integrations.webhooks = [{ id: 'acceptance-hook', endpoint: 'https://internal.invalid/events', secret: 'validation-secret-must-not-leak', apiKey: 'validation-key-must-not-leak' }]
  s.audit.enabled = true
  return s
}

async function main() {
  assertSafeDataDir()
  safePathsValidated = true
  fs.mkdirSync(path.dirname(resultPath), { recursive: true })
  validateSchemaV1Migration()
  await startServer()
  try {
    const publicClient = new Client('public')
    const health = await publicClient.get('/api/health')
    assert.equal(health.body.ok, true)
    record('health endpoint', 'pass', { ms: health.ms })
    const setupStatus = await publicClient.get('/api/setup/status')
    assert.deepEqual(setupStatus.body, { configured: false, demoAllowed: false, demo: null })
    record('production first-run has no demo credentials', 'pass')
    await publicClient.get('/api/runtime-config', 401)
    record('runtime configuration is not exposed before local authentication', 'pass')
    const rootHtml = await raw('/')
    assert.equal(rootHtml.res.status, 200)
    assert.match(String(rootHtml.body), /<div id="root"><\/div>/)
    record('production HTML served', 'pass', { ms: rootHtml.ms })
    await publicClient.post('/api/setup', { name: 'Bad Admin', email: 'bad@example.com', password: 'short' }, 400)
    await publicClient.request('/api/setup', { method: 'POST', body: [], expect: 400 })
    record('invalid setup password rejected', 'pass')

    const admin = new Client('admin')
    await admin.post('/api/setup', { name: 'Amina Admin', email: 'admin@example.com', password: 'StrongPass123', workspaceName: 'Atlas Acceptance', workspaceUnit: 'Operations' })
    let bootstrap = await admin.get('/api/bootstrap')
    assert.equal(bootstrap.body.user.role, 'Administrator')
    assert.equal(bootstrap.body.settings.workspace.name, 'Atlas Acceptance')
    assert.equal(bootstrap.body.settings.audit.retentionDays, 365)
    assert.equal(bootstrap.body.settings.workLedger.retentionMonths, 24)
    assert.ok(bootstrap.body.settings.localization.textDirectionByLanguage.ar === 'rtl')
    const runtime = await admin.get('/api/runtime-config')
    assert.equal(runtime.body.database.schemaVersion, 5)
    assert.equal(runtime.body.database.engine, 'SQLite')
    assert.equal(runtime.body.database.transactionalWrites, true)
    assert.equal(runtime.body.designSystem.version, '2.0.0')
    const settingsMergeBase = structuredClone(bootstrap.body.settings)
    await admin.put('/api/settings', { workspace: { unit: 'Host-side unit' } })
    const settingsMerge = await admin.sync('/api/settings', {
      method: 'PUT', body: { workspace: { name: 'Atlas Offline Settings', unit: settingsMergeBase.workspace.unit } },
      metadata: { operationId: 'offline-settings-merge-op-000001', collection: 'settings', baseRecord: settingsMergeBase, enforceConflicts: true }
    })
    assert.equal(settingsMerge.body.workspace.name, 'Atlas Offline Settings')
    assert.equal(settingsMerge.body.workspace.unit, 'Host-side unit')
    const settingsConflictBase = structuredClone(settingsMerge.body)
    await admin.put('/api/settings', { workspace: { organization: { website: 'https://host.local' } } })
    const settingsConflictId = 'offline-settings-overlap-op-000001'
    const settingsConflict = await admin.sync('/api/settings', {
      method: 'PUT', body: { workspace: { organization: { website: 'https://device.local' } } },
      metadata: { operationId: settingsConflictId, collection: 'settings', baseRecord: settingsConflictBase, enforceConflicts: true }, expect: 409
    })
    assert.deepEqual(settingsConflict.body.fields.map(field => field.path), ['workspace.organization.website'])
    const settingsResolution = await admin.sync(`/api/offline-sync/conflicts/${settingsConflictId}/resolve`, {
      method: 'POST', body: { action: 'merge', fields: { 'workspace.organization.website': 'server' } },
      metadata: { operationId: 'offline-settings-resolution-op-00001', collection: 'syncConflicts', baseRecord: null, enforceConflicts: true }
    })
    assert.equal(settingsResolution.body.status, 'resolved')
    assert.equal((await admin.get('/api/bootstrap')).body.settings.workspace.organization.website, 'https://host.local')
    await admin.get('/api/i18n/catalog')
    record('administrator setup, bootstrap, schema, and offline global-settings field merge/conflict audit', 'pass', { schema: runtime.body.database.schemaVersion, designSystem: runtime.body.designSystem.version })

    const adminFilters = {
      projects: [{ field: 'name', operator: 'contains', join: 'AND', value: 'Atlas' }],
      tasks: []
    }
    assert.deepEqual((await admin.get('/api/preferences')).body, { filters: {}, language: '' })
    assert.deepEqual((await admin.put('/api/preferences', { filters: adminFilters })).body, { filters: adminFilters, language: '' })
    assert.deepEqual((await admin.get('/api/preferences')).body, { filters: adminFilters, language: '' })
    assert.deepEqual((await admin.put('/api/preferences', { language: 'ar' })).body, { filters: adminFilters, language: 'ar' })
    assert.deepEqual((await admin.get('/api/preferences')).body, { filters: adminFilters, language: 'ar' })
    await admin.put('/api/preferences', { filters: { tasks: [{ field: 'status', operator: 'invalid', value: 'Done' }] } }, 400)
    await admin.put('/api/preferences', { filters: { tasks: [{ field: 'status', operator: 'equals', join: 'XOR', value: 'Done' }] } }, 400)
    await admin.put('/api/preferences', { filters: adminFilters, unexpected: true }, 400)
    record('authenticated SQL saved filters, input validation, and per-user preferences', 'pass')

    await admin.post('/api/auth/login', { email: 'admin@example.com', password: 'wrong-password' }, 401)
    record('invalid login rejected', 'pass')

    const configured = mutateSettings(bootstrap.body.settings)
    const updatedSettings = await admin.put('/api/settings', configured)
    assert.equal(updatedSettings.body.language, 'ar')
    assert.equal(updatedSettings.body.workspace.defaultTimezone, 'Europe/Amsterdam')
    assert.equal(updatedSettings.body.workflows.task.states.at(-1).label, 'Done')
    assert.ok(updatedSettings.body.customFields.tasks.some(f => f.key === 'client_code'))
    record('administrator configured workspace, language, appearance, workflow, custom fields, roles', 'pass')

    const exportedSettings = await admin.get('/api/settings/export')
    assert.equal(exportedSettings.body.settings.language, 'ar')
    record('settings export', 'pass')
    const importedSettings = structuredClone(exportedSettings.body.settings)
    importedSettings.workspace.name = 'Atlas Acceptance Backup Point'
    await admin.post('/api/settings/import', { settings: importedSettings })
    record('settings import', 'pass')

    const backup = await admin.post('/api/system/backup', {})
    assert.equal(backup.body.ok, true)
    const backupFile = path.join(dataDir, 'backups', backup.body.backup)
    assert.equal(fs.existsSync(backupFile), true)
    record('backup creation', 'pass', { backup: backup.body.backup })
    const afterBackup = structuredClone(importedSettings)
    afterBackup.workspace.name = 'Changed After Backup'
    await admin.put('/api/settings', afterBackup)
    await stopServer()
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databaseFile}${suffix}`, { force: true })
    fs.copyFileSync(backupFile, databaseFile)
    await restartPreservingData()
    const admin2 = new Client('admin-restored')
    await admin2.post('/api/auth/login', { email: 'admin@example.com', password: 'StrongPass123' })
    bootstrap = await admin2.get('/api/bootstrap')
    assert.equal(bootstrap.body.settings.workspace.name, 'Atlas Acceptance Backup Point')
    assert.deepEqual((await admin2.get('/api/preferences')).body, { filters: adminFilters, language: 'ar' })
    record('backup restoration and restart persistence', 'pass')
    await admin2.get('/api/no-such-route', 404)
    await admin2.post('/api/audit/export', { title: 'API audit smoke test', format: 'csv', rowCount: 1 })
    record('unknown API route and export audit handling', 'pass')

    const team = (await admin2.post('/api/teams', { name: 'Global Delivery', color: 'blue' })).body
    const failureTriggerDb = new DatabaseSync(databaseFile)
    try {
      failureTriggerDb.exec(`CREATE TRIGGER acceptance_abort_person_insert BEFORE INSERT ON people WHEN NEW.email = 'rollback@example.com' BEGIN SELECT RAISE(ABORT, 'injected acceptance failure'); END`)
    } finally { failureTriggerDb.close() }
    await admin2.post('/api/people', { name: 'Rolled Back Person', email: 'rollback@example.com', teamId: team.id }, 500)
    const rollbackCheckDb = new DatabaseSync(databaseFile)
    try {
      rollbackCheckDb.exec('DROP TRIGGER acceptance_abort_person_insert')
      assert.equal(Number(rollbackCheckDb.prepare("SELECT COUNT(*) AS count FROM people WHERE email = 'rollback@example.com'").get().count), 0)
    } finally { rollbackCheckDb.close() }
    const rollbackBootstrap = await admin2.get('/api/bootstrap')
    assert.equal(rollbackBootstrap.body.people.some(person => person.email === 'rollback@example.com'), false)
    record('failed SQL writes roll back in-memory state to the last committed snapshot', 'pass')

    const managerPerson = (await admin2.post('/api/people', { name: 'Mona Manager', email: 'manager@example.com', jobTitle: 'Delivery Manager', teamId: team.id, focus: 'Portfolio health', capacity: 80 })).body
    const developerPerson = (await admin2.post('/api/people', { name: 'ليلى Developer', email: 'developer@example.com', jobTitle: 'Engineer', teamId: team.id, focus: 'Feature delivery', capacity: 75 })).body
    const viewerPerson = (await admin2.post('/api/people', { name: 'Omar Viewer', email: 'viewer@example.com', jobTitle: 'Analyst', teamId: team.id, focus: 'Reporting', capacity: 40 })).body
    const settingsDelegatePerson = (await admin2.post('/api/people', { name: 'Ravi Settings Delegate', email: 'settings-delegate@example.com', jobTitle: 'Coordinator', teamId: team.id, focus: 'Operations', capacity: 55 })).body
    await admin2.post('/api/users', { name: 'Mona Manager', email: 'manager@example.com', password: 'ManagerPass123', role: 'Manager', personId: managerPerson.id, avatarColor: 'blue', active: true })
    await admin2.post('/api/users', { name: 'ليلى Developer', email: 'developer@example.com', password: 'DeveloperPass123', role: 'Developer', personId: developerPerson.id, avatarColor: 'green', active: true })
    await admin2.post('/api/users', { name: 'Omar Viewer', email: 'viewer@example.com', password: 'ViewerPass123', role: 'Viewer', personId: viewerPerson.id, avatarColor: 'orange', active: true })
    await admin2.post('/api/users', { name: 'Ravi Settings Delegate', email: 'settings-delegate@example.com', password: 'SettingsPass123', role: 'SettingsDelegate', personId: settingsDelegatePerson.id, avatarColor: 'teal', active: true })
    await admin2.post('/api/users', { name: 'Duplicate Viewer', email: 'viewer@example.com', password: 'ViewerPass123', role: 'Viewer', personId: viewerPerson.id }, 409)
    await admin2.post('/api/users', { name: 'Invalid Role', email: 'invalid@example.com', password: 'InvalidPass123', role: 'NoSuchRole', personId: viewerPerson.id }, 400)
    await admin2.delete(`/api/people/${viewerPerson.id}`, 400)
    await admin2.delete(`/api/teams/${team.id}`, 400)
    record('user creation and invalid relationship operations', 'pass')

    const settingsDelegate = new Client('settings-delegate')
    await settingsDelegate.post('/api/auth/login', { email: 'settings-delegate@example.com', password: 'SettingsPass123' })
    const delegateBootstrap = await settingsDelegate.get('/api/bootstrap')
    assert.ok(delegateBootstrap.body.user.permissions.includes('manageSettings'))
    assert.equal(Object.hasOwn(delegateBootstrap.body.settings, 'security'), false)
    assert.equal(Object.hasOwn(delegateBootstrap.body.settings, 'audit'), false)
    assert.equal(Object.hasOwn(delegateBootstrap.body.settings, 'workLedger'), false)
    await settingsDelegate.get('/api/settings/export', 403)
    await settingsDelegate.get('/api/runtime-config', 403)
    await settingsDelegate.get('/api/i18n/catalog', 403)
    await settingsDelegate.get('/api/system', 403)
    record('settings permission alone does not bypass Administrator-only settings access', 'pass')

    const manager = new Client('manager')
    await manager.post('/api/auth/login', { email: 'manager@example.com', password: 'ManagerPass123' })
    await manager.get('/api/runtime-config', 403)
    await manager.get('/api/i18n/catalog', 403)
    await manager.get('/api/settings/export', 403)
    await manager.get('/api/users', 403)
    record('non-administrator access to global settings, runtime metadata, translation catalog, and account directory is denied', 'pass')
    assert.deepEqual((await manager.get('/api/preferences')).body, { filters: {}, language: '' })
    const managerFilters = { tasks: [{ field: 'title', operator: 'contains', join: 'AND', value: 'release' }] }
    assert.deepEqual((await manager.put('/api/preferences', { filters: managerFilters })).body, { filters: managerFilters, language: '' })
    assert.deepEqual((await admin2.get('/api/preferences')).body, { filters: adminFilters, language: 'ar' })
    record('saved filters are isolated between authenticated users', 'pass')
    let project = (await manager.post('/api/projects', { name: 'Client Portal مشروع', code: 'CP', description: 'Bilingual delivery project', teamId: team.id, ownerId: managerPerson.id, color: 'purple', status: 'On track' })).body
    await manager.post('/api/milestones', { name: 'Pilot review', projectId: project.numericId, status: 'Upcoming' })
    await manager.post('/api/tasks', { title: 'Required field check', projectId: project.numericId, assigneeId: managerPerson.id, status: 'Draft', priority: 'High', customFields: { client_code: 'MGR-0' } }, 400)
    await manager.post('/api/tasks', { title: 'Typed field check', projectId: project.numericId, assigneeId: managerPerson.id, status: 'Draft', priority: 'High', customFields: { client_code: 'MGR-0', ticket_ref: 'OPS-100', quality_score: 'not-a-number' } }, 400)
    const managerTask = (await manager.post('/api/tasks', { title: 'Plan release checklist', projectId: project.numericId, assigneeId: managerPerson.id, status: 'Draft', priority: 'High', customFields: { client_code: 'MGR-1', ticket_ref: 'OPS-101' } })).body
    const devTask = (await manager.post('/api/tasks', { title: 'تنفيذ لوحة التقارير CP-42', projectId: project.numericId, assigneeId: developerPerson.id, status: 'Draft', priority: 'High', customFields: { client_code: 'AR-42', ticket_ref: 'OPS-102' } })).body
    await manager.post('/api/activity', { personId: managerPerson.id, yesterday: 'Reviewed planning.', today: 'Coordinated the release.', blocked: '', upcoming: 'Review handoff.' })
    const alert = (await manager.post('/api/alerts', { title: 'Release blocker', body: 'Waiting for review', type: 'blocker', tone: 'orange', projectId: project.numericId, taskId: devTask.numericId })).body
    await manager.patch(`/api/alerts/${alert.id}`, { resolved: true })
    const managerReport = await manager.get('/api/reports/weekly')
    assert.ok(managerReport.body.series.length)
    record('manager project/task/alert/report journey', 'pass')

    const projectPortfolio = await manager.get(`/api/projects/${project.numericId}/tasks`)
    assert.equal(projectPortfolio.body.source, 'sqlite')
    assert.equal(projectPortfolio.body.project.name, 'Client Portal مشروع')
    assert.equal(projectPortfolio.body.tasks.length, 2)
    assert.equal(projectPortfolio.body.milestones.length, 1)
    assert.deepEqual(new Set(projectPortfolio.body.tasks.map(task => task.numericId)), new Set([managerTask.numericId, devTask.numericId]))
    record('project detail loads the complete linked task portfolio from SQLite', 'pass')

    const sqlExport = await manager.post('/api/exports/prepare', {
      dataset: 'tasks', recordIds: [managerTask.numericId, devTask.numericId], fields: ['id', 'title', 'project', 'status', 'due'], query: { projectId: project.numericId }
    })
    assert.equal(sqlExport.body.source, 'sqlite')
    assert.equal(sqlExport.body.recordCount, 2)
    assert.ok(sqlExport.body.rows.some(row => row.title === 'Plan release checklist'))
    assert.ok(sqlExport.body.rows.some(row => row.title === 'تنفيذ لوحة التقارير CP-42'))
    const customFieldExport = await manager.post('/api/exports/prepare', { dataset: 'tasks', recordIds: [managerTask.numericId], fields: ['customFields.client_code'] })
    assert.deepEqual(customFieldExport.body.rows[0], { 'customFields.client_code': 'MGR-1' })
    const reportExport = await manager.post('/api/exports/prepare', {
      dataset: 'delivery-report', recordIds: [managerReport.body.series[0].key], fields: ['label', 'completed', 'created', 'rate'], query: { period: 'weekly' }
    })
    assert.equal(reportExport.body.source, 'sqlite')
    assert.equal(reportExport.body.recordCount, 1)
    await manager.post('/api/exports/prepare', { dataset: 'users', fields: ['name'] }, 403)
    await manager.post('/api/exports/prepare', { dataset: 'tasks', fields: ['passwordHash'] }, 400)
    await manager.post('/api/exports/prepare', { dataset: 'tasks', fields: [] }, 400)
    await manager.post('/api/exports/prepare', { dataset: 'activity-evidence', query: { period: 'quarterly', personId: 'all' } }, 400)
    record('database-backed exports select allowlisted fields and enforce dataset permissions', 'pass')

    const offlineTaskId = 'offline-sync-task-000000000001'
    const offlineCreateMeta = { operationId: 'offline-create-task-op-000000000001', collection: 'tasks', localId: offlineTaskId, baseRecord: null, enforceConflicts: true }
    const offlineCreateBody = { title: 'Durable offline retry task', projectId: project.numericId, assigneeId: managerPerson.id, priority: 'Low', dueDate: '', status: 'Draft', type: 'Development', blocked: false, customFields: { client_code: 'OFF-1', ticket_ref: 'OFF-1' } }
    const createBefore = await manager.sync('/api/tasks', { body: offlineCreateBody, metadata: offlineCreateMeta })
    assert.equal(String(createBefore.body.numericId), offlineTaskId)
    const createRetry = await manager.sync('/api/tasks', { body: offlineCreateBody, metadata: offlineCreateMeta })
    assert.equal(createRetry.body.numericId, createBefore.body.numericId)
    const syncDb = new DatabaseSync(databaseFile)
    try {
      assert.equal(Number(syncDb.prepare('SELECT COUNT(*) AS count FROM tasks WHERE id = ?').get(offlineTaskId).count), 1)
      assert.equal(Number(syncDb.prepare('SELECT COUNT(*) AS count FROM sync_operations WHERE operation_id = ?').get(offlineCreateMeta.operationId).count), 1)
    } finally { syncDb.close() }

    const mergeBaseRow = (await manager.get('/api/bootstrap')).body.tasks.find(task => String(task.numericId) === String(managerTask.numericId))
    const mergeBase = canonicalTask(mergeBaseRow)
    await manager.put(`/api/tasks/${managerTask.numericId}`, { priority: 'Low' })
    const disjointMeta = { operationId: 'offline-disjoint-task-op-000000001', collection: 'tasks', baseRecord: mergeBase, enforceConflicts: true }
    const disjointBody = { ...mergeBase, type: 'Testing' }
    const disjointResult = await manager.sync(`/api/tasks/${managerTask.numericId}`, { method: 'PUT', body: disjointBody, metadata: disjointMeta })
    assert.equal(disjointResult.body.priority, 'Low')
    assert.equal(disjointResult.body.type, 'Testing')
    const afterMerge = (await manager.get('/api/bootstrap')).body.tasks.find(task => String(task.numericId) === String(managerTask.numericId))
    const conflictBase = canonicalTask(afterMerge)
    await manager.put(`/api/tasks/${managerTask.numericId}`, { priority: 'Medium' })
    const conflictOperationId = 'offline-overlap-task-op-000000001'
    const overlap = await manager.sync(`/api/tasks/${managerTask.numericId}`, {
      method: 'PUT', body: { ...conflictBase, priority: 'High' },
      metadata: { operationId: conflictOperationId, collection: 'tasks', baseRecord: conflictBase, enforceConflicts: true }, expect: 409
    })
    assert.equal(overlap.body.conflict, true)
    assert.deepEqual(overlap.body.fields.map(field => field.path), ['priority'])
    assert.equal((await manager.get('/api/bootstrap')).body.tasks.find(task => String(task.numericId) === String(managerTask.numericId)).priority, 'Medium')
    const conflictAudit = await admin2.get('/api/offline-sync/conflicts?limit=100')
    const auditedOverlap = conflictAudit.body.find(row => row.operationId === conflictOperationId)
    assert.equal(auditedOverlap.status, 'open')
    assert.equal(auditedOverlap.localRecord.priority, 'High')
    assert.equal(auditedOverlap.serverRecord.priority, 'Medium')
    const resolutionAck = await manager.sync(`/api/offline-sync/conflicts/${conflictOperationId}/resolve`, {
      method: 'POST', body: { action: 'merge', fields: { priority: 'local' } },
      metadata: { operationId: 'offline-conflict-resolution-op-00001', collection: 'syncConflicts', baseRecord: null, enforceConflicts: true }
    })
    assert.equal(resolutionAck.body.status, 'resolved')
    assert.equal((await admin2.get('/api/offline-sync/conflicts?status=resolved')).body.some(row => row.operationId === conflictOperationId), true)

    const deleteConflictBaseRow = (await manager.get('/api/bootstrap')).body.tasks.find(task => String(task.numericId) === offlineTaskId)
    const deleteConflictBase = canonicalTask(deleteConflictBaseRow)
    await manager.put(`/api/tasks/${offlineTaskId}`, { title: 'Edited while device was offline' })
    const deleteConflict = await manager.sync(`/api/tasks/${offlineTaskId}`, {
      method: 'DELETE', metadata: { operationId: 'offline-delete-overlap-op-00000001', collection: 'tasks', baseRecord: deleteConflictBase, enforceConflicts: true }, expect: 409
    })
    assert.equal(deleteConflict.body.localDelete, true)
    assert.ok((await manager.get('/api/bootstrap')).body.tasks.some(task => String(task.numericId) === offlineTaskId))
    record('offline sync merges disjoint fields, surfaces same-field and delete/edit conflicts, and deduplicates retries', 'pass')

    await stopServer()
    await restartPreservingData()
    await manager.post('/api/auth/login', { email: 'manager@example.com', password: 'ManagerPass123' })
    await admin2.post('/api/auth/login', { email: 'admin@example.com', password: 'StrongPass123' })
    const replayAfterRestart = await manager.sync('/api/tasks', { body: offlineCreateBody, metadata: offlineCreateMeta })
    assert.equal(replayAfterRestart.body.numericId, offlineTaskId)
    const receiptDb = new DatabaseSync(databaseFile)
    try {
      assert.equal(Number(receiptDb.prepare('SELECT COUNT(*) AS count FROM tasks WHERE id = ?').get(offlineTaskId).count), 1)
      assert.equal(receiptDb.prepare('SELECT status FROM sync_operations WHERE operation_id = ?').get(offlineCreateMeta.operationId).status, 'completed')
    } finally { receiptDb.close() }
    record('offline outbox replay remains idempotent across an interrupted-client/server-restart boundary', 'pass')

    const developer = new Client('developer')
    await developer.post('/api/auth/login', { email: 'developer@example.com', password: 'DeveloperPass123' })
    await developer.patch(`/api/tasks/${devTask.numericId}/status`, { status: 'Active' })
    await developer.patch(`/api/tasks/${devTask.numericId}/status`, { status: 'Review' })
    const doneTask = (await developer.patch(`/api/tasks/${devTask.numericId}/status`, { status: 'Done' })).body
    assert.equal(doneTask.status, 'Done')
    assert.equal(doneTask.customFields.client_code, 'AR-42')
    const blockerText = 'Waiting for API contract approval.'
    await developer.post('/api/activity', { personId: developerPerson.id, yesterday: 'راجعت المتطلبات', today: 'أنهيت لوحة التقارير CP-42', blocked: blockerText, upcoming: 'اختبار القبول' })
    let blockerSnapshot = await developer.get('/api/bootstrap')
    let automaticBlockers = blockerSnapshot.body.alerts.filter(row => row.source === 'activity-blocker' && row.body === blockerText)
    assert.equal(automaticBlockers.length, 1)
    await developer.post('/api/activity', { personId: developerPerson.id, yesterday: '', today: 'Still waiting.', blocked: blockerText, upcoming: '' })
    blockerSnapshot = await developer.get('/api/bootstrap')
    automaticBlockers = blockerSnapshot.body.alerts.filter(row => row.source === 'activity-blocker' && row.body === blockerText)
    assert.equal(automaticBlockers.length, 1)
    assert.equal(automaticBlockers[0].occurrences, 2)
    assert.ok(blockerSnapshot.body.activity.every(row => row.personId === developerPerson.id))
    assert.ok(!JSON.stringify(blockerSnapshot.body.activity).includes('Coordinated the release'))
    assert.ok(blockerSnapshot.body.teamActivitySummary.today >= 3)
    await developer.patch(`/api/alerts/${automaticBlockers[0].id}`, { resolved: true }, 403)
    await developer.post('/api/projects', { name: 'Unauthorized', code: 'NO' }, 403)
    record('developer task/activity journey and protected project mutation', 'pass')

    const viewer = new Client('viewer')
    await viewer.post('/api/auth/login', { email: 'viewer@example.com', password: 'ViewerPass123' })
    const viewerBootstrap = await viewer.get('/api/bootstrap')
    assert.equal(JSON.stringify(viewerBootstrap.body.settings).includes('validation-secret-must-not-leak'), false)
    assert.equal(JSON.stringify(viewerBootstrap.body.settings).includes('validation-key-must-not-leak'), false)
    assert.equal(Object.hasOwn(viewerBootstrap.body.settings, 'security'), false)
    assert.equal(Object.hasOwn(viewerBootstrap.body.settings, 'audit'), false)
    assert.equal(viewerBootstrap.body.activity.length, 0)
    assert.equal(viewerBootstrap.body.dashboard.dailyPulse.today.length, 0)
    assert.ok(viewerBootstrap.body.teamActivitySummary.today >= 3)
    assert.equal(JSON.stringify(viewerBootstrap.body.alerts).includes(blockerText), false)
    const activityReport = await viewer.get(`/api/reports/activity/daily?userId=${developerPerson.id}`)
    assert.equal(activityReport.body.userId, viewerPerson.id)
    assert.equal(activityReport.body.rows.length, 0)
    const activityExport = await viewer.post('/api/exports/prepare', { dataset: 'activity-evidence', query: { period: 'weekly', personId: developerPerson.id }, fields: ['person', 'task', 'summary'] })
    assert.equal(activityExport.body.recordCount, 0)
    await viewer.post('/api/exports/prepare', { dataset: 'activity', recordIds: [developerPerson.id], fields: ['person', 'today'] }, 400)
    await viewer.post('/api/tasks', { title: 'Viewer should fail', projectId: project.numericId }, 403)
    await viewer.put('/api/settings', bootstrap.body.settings, 403)
    record('ordinary users receive only own activity plus team aggregates; cross-person reports/exports are denied', 'pass')

    const monthReport = await admin2.get(`/api/reports/activity/monthly?userId=${developerPerson.id}`)
    assert.ok(monthReport.body.totals.completedTasks >= 1)
    assert.ok(JSON.stringify(monthReport.body).includes('تنفيذ لوحة التقارير'))
    record('Arabic/mixed LTR-RTL report data integrity', 'pass')

    const largeProject = (await admin2.post('/api/projects', { name: 'Scale Validation', code: 'SCL', teamId: team.id, ownerId: managerPerson.id })).body
    const createStart = performance.now()
    for (let i = 0; i < 160; i++) {
      await admin2.post('/api/tasks', { title: `Load task ${i + 1}`, projectId: largeProject.numericId, assigneeId: i % 2 ? developerPerson.id : managerPerson.id, status: i % 3 === 0 ? 'Done' : 'Draft', priority: ['Low', 'Medium', 'High'][i % 3], customFields: { client_code: `LOAD-${i + 1}`, ticket_ref: `LOAD-${i + 1}` } })
    }
    report.metrics.create160TasksMs = Math.round(performance.now() - createStart)
    const bootstrapPerf = await admin2.get('/api/bootstrap')
    const weeklyPerf = await admin2.get('/api/reports/weekly')
    const monthlyPerf = await admin2.get('/api/reports/activity/monthly?userId=all')
    report.metrics.bootstrapMs = bootstrapPerf.ms
    report.metrics.weeklyReportMs = weeklyPerf.ms
    report.metrics.monthlyActivityReportMs = monthlyPerf.ms
    assert.ok(bootstrapPerf.body.tasks.length >= 162)
    assert.ok(weeklyPerf.ms < 3000)
    assert.ok(monthlyPerf.ms < 3000)
    record('realistic data volume performance', 'pass', report.metrics)

    const system = await admin2.get('/api/system')
    assert.equal(system.body.integrity, 'ok')
    assert.ok(system.body.counts.auditLogs > 0)
    record('system integrity and audit log', 'pass', { counts: system.body.counts })

    await restartPreservingData()
    const admin3 = new Client('admin-after-final-restart')
    await admin3.post('/api/auth/login', { email: 'admin@example.com', password: 'StrongPass123' })
    const finalBootstrap = await admin3.get('/api/bootstrap')
    assert.ok(finalBootstrap.body.tasks.length >= 162)
    assert.equal(finalBootstrap.body.settings.language, 'ar')
    assert.ok(finalBootstrap.body.settings.customFields.tasks.some(f => f.key === 'client_code'))
    assert.deepEqual((await admin3.get('/api/preferences')).body, { filters: adminFilters, language: 'ar' })
    const persistedManager = new Client('manager-after-final-restart')
    await persistedManager.post('/api/auth/login', { email: 'manager@example.com', password: 'ManagerPass123' })
    assert.deepEqual((await persistedManager.get('/api/preferences')).body, { filters: managerFilters, language: '' })
    record('final restart data/settings and per-user filters persistence', 'pass')

    await stopServer()
    let preservedWorkLogId = ''
    const fixtureDb = new DatabaseSync(databaseFile)
    try {
      const metaRow = fixtureDb.prepare("SELECT value_json FROM application_meta WHERE meta_key = 'store.meta'").get()
      const legacyMeta = JSON.parse(metaRow.value_json)
      legacyMeta.schemaVersion = '3.0.0'
      fixtureDb.prepare("UPDATE application_meta SET value_json = ? WHERE meta_key = 'store.meta'").run(JSON.stringify(legacyMeta))
      const firstWorkLog = fixtureDb.prepare('SELECT * FROM work_logs ORDER BY ordinal LIMIT 1').get()
      if (firstWorkLog) {
        preservedWorkLogId = firstWorkLog.id
        fixtureDb.prepare('UPDATE work_logs SET minutes = 45 WHERE id = ?').run(preservedWorkLogId)
        const fake = { ...firstWorkLog, id: 'wl_seed_legacy_fake', id_type: 'string', minutes: 999, ordinal: Number(firstWorkLog.ordinal) + 100000, row_hash: 'legacy-test-row' }
        const columns = Object.keys(fake)
        fixtureDb.prepare(`INSERT INTO work_logs (${columns.map(name => `"${name}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map(name => fake[name]))
      }
    } finally { fixtureDb.close() }
    await restartPreservingData()
    const migrated = new Client('admin-after-migration')
    await migrated.post('/api/auth/login', { email: 'admin@example.com', password: 'StrongPass123' })
    const migrationReport = await migrated.get('/api/reports/activity/monthly?userId=all')
    assert.equal(migrationReport.body.rows.some(row => row.id === 'wl_seed_legacy_fake'), false)
    if (preservedWorkLogId) assert.equal(migrationReport.body.rows.find(row => row.id === preservedWorkLogId)?.minutes, 45)
    const migrationHealth = await migrated.get('/api/system')
    assert.equal(migrationHealth.body.store.schemaVersion, '5.0.0')
    assert.equal(migrationHealth.body.store.databaseSchemaVersion, 5)
    record('legacy work-log migration removes generated rows and preserves explicit minutes', 'pass')

    await stopServer()
    assertSafeChildDataDir(legacyImportDataDir)
    fs.rmSync(legacyImportDataDir, { recursive: true, force: true })
    fs.mkdirSync(legacyImportDataDir, { recursive: true })
    const legacyDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles' }).format(new Date())
    const legacyCreatedAt = new Date().toISOString()
    const legacyFixture = {
      meta: { schemaVersion: '3.0.0', model: 'embedded-json-document-store', createdAt: legacyCreatedAt, updatedAt: legacyCreatedAt, writeCount: 8 },
      configured: false,
      counters: { project: 23, task: 45 },
      settings: {},
      users: [],
      teams: [{ id: 'legacy-team-1', name: 'Legacy Import Team', color: 'teal', sample: false, customFields: { district: 'Amsterdam' } }],
      people: [{ id: 'legacy-person-1', name: 'Imported Person', email: 'legacy-admin@example.com', jobTitle: 'Operations Analyst', teamId: 'legacy-team-1', focus: 'Preserved legacy focus', capacity: 50, status: 'On track', color: 'teal', sample: false, customFields: { legacyField: 'preserved' } }],
      projects: [{ id: 22, name: 'Legacy Project', code: 'LGC', description: 'Imported from the one-time JSON migration fixture.', teamId: 'legacy-team-1', ownerId: 'legacy-person-1', color: 'teal', status: 'On track', deadline: legacyDate, createdAt: legacyDate, sample: false, customFields: { client: 'preserved' } }],
      tasks: [{ id: 44, title: 'Imported legacy task', projectId: 22, assigneeId: 'legacy-person-1', priority: 'Medium', dueDate: legacyDate, status: 'To do', type: 'Operations', blocked: false, createdAt: legacyCreatedAt, sample: false, customFields: { ticket_ref: 'LGC-44' } }],
      milestones: [{ id: 'legacy-milestone-1', projectId: 22, name: 'Imported milestone', dueDate: legacyDate, status: 'Upcoming', sample: false, customFields: {} }],
      activities: [{ id: 'legacy-activity-1', personId: 'legacy-person-1', date: legacyDate, time: '10:30', yesterday: 'Legacy yesterday update', today: 'Legacy update preserved', blocked: '', upcoming: 'Imported next step', status: 'Confirmed', sample: false, customFields: {} }],
      alerts: [{ id: 'legacy-alert-1', title: 'Legacy alert', body: 'Imported alert details.', type: 'info', tone: 'blue', projectId: 22, taskId: 44, personId: 'legacy-person-1', activityId: 'legacy-activity-1', source: 'legacy-import', occurrences: 1, resolved: false, createdAt: legacyCreatedAt, lastSeenAt: legacyCreatedAt, sample: false, customFields: {} }],
      workLogs: [{ id: 'wl_explicit_legacy_01', personId: 'legacy-person-1', actorUserId: '', taskId: 44, projectId: 22, taskTitle: 'Imported legacy task', projectName: 'Legacy Project', projectCode: 'LGC', action: 'Imported task event', statusFrom: 'In progress', statusTo: 'Done', summary: 'Explicit legacy history must survive migration.', date: legacyDate, time: '11:30', minutes: 37, sample: false, source: 'legacy-json' }],
      auditLogs: [{ id: 'legacy-audit-1', action: 'legacy.import.source', actorId: '', detail: { preserved: true }, createdAt: legacyCreatedAt, source: 'legacy-json' }]
    }
    const legacySourceFile = path.join(legacyImportDataDir, 'atlas-store.json')
    fs.writeFileSync(legacySourceFile, JSON.stringify(legacyFixture, null, 2))
    const importLogs = await startServerForDataDir(legacyImportDataDir, 'legacy JSON import')
    assert.match(importLogs, /Imported legacy JSON store into SQLite and archived the source/)
    assert.equal(fs.existsSync(legacySourceFile), false)
    const legacyArchiveDirectory = path.join(legacyImportDataDir, 'legacy')
    const archivedSources = fs.readdirSync(legacyArchiveDirectory).filter(file => file.startsWith('atlas-store-imported-') && file.endsWith('.json'))
    assert.equal(archivedSources.length, 1)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(legacyArchiveDirectory, archivedSources[0]), 'utf8')), legacyFixture)
    const importAdmin = new Client('legacy-import-admin')
    await importAdmin.post('/api/setup', { name: 'Legacy Import Admin', email: 'legacy-admin@example.com', password: 'LegacyImportPass123', workspaceName: 'Imported Workspace', workspaceUnit: 'Legacy Import Team' })
    const importedBootstrap = await importAdmin.get('/api/bootstrap')
    assert.equal(importedBootstrap.body.user.personId, 'legacy-person-1')
    assert.equal(importedBootstrap.body.teams.filter(row => row.name === 'Legacy Import Team').length, 1)
    assert.ok(importedBootstrap.body.teams.some(row => row.id === 'legacy-team-1' && row.customFields.district === 'Amsterdam'))
    assert.ok(importedBootstrap.body.people.some(row => row.id === 'legacy-person-1' && row.customFields.legacyField === 'preserved'))
    assert.ok(importedBootstrap.body.projects.some(row => row.numericId === 22 && row.customFields.client === 'preserved'))
    assert.ok(importedBootstrap.body.tasks.some(row => row.numericId === 44 && row.customFields.ticket_ref === 'LGC-44'))
    const importedReport = await importAdmin.get('/api/reports/activity/monthly?userId=legacy-person-1')
    assert.ok(importedReport.body.rows.some(row => row.id === 'wl_explicit_legacy_01' && row.minutes === 37))
    const importedDatabase = new DatabaseSync(legacyImportDatabaseFile)
    try {
      assert.equal(importedDatabase.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
      assert.equal(importedDatabase.prepare('PRAGMA foreign_key_check').all().length, 0)
      assert.equal(Number(importedDatabase.prepare('SELECT COUNT(*) AS count FROM tasks').get().count), 1)
      assert.equal(Number(importedDatabase.prepare('SELECT COUNT(*) AS count FROM teams').get().count), 1)
      assert.equal(Number(importedDatabase.prepare('SELECT COUNT(*) AS count FROM people').get().count), 1)
      assert.equal(Number(importedDatabase.prepare('SELECT COUNT(*) AS count FROM work_logs').get().count), 1)
    } finally { importedDatabase.close() }
    await stopServer()
    await startServerForDataDir(legacyImportDataDir, 'legacy SQLite restart')
    const importedRestartClient = new Client('legacy-import-restart')
    await importedRestartClient.post('/api/auth/login', { email: 'legacy-admin@example.com', password: 'LegacyImportPass123' })
    const restartedImportBootstrap = await importedRestartClient.get('/api/bootstrap')
    assert.equal(restartedImportBootstrap.body.people.filter(row => row.id === 'legacy-person-1').length, 1)
    assert.equal(fs.existsSync(legacySourceFile), false)
    assert.equal(fs.readdirSync(legacyArchiveDirectory).filter(file => file.startsWith('atlas-store-imported-') && file.endsWith('.json')).length, 1)
    assert.equal(restartedImportBootstrap.body.settings.workLedger.retentionMonths, 0)
    record('one-time legacy JSON import, SQL restart persistence, content preservation, archival, and unchanged legacy retention', 'pass', { archivedFile: archivedSources[0] })

    await stopServer()
    const scaleDatabase = openSqliteDatabase(legacyImportDatabaseFile, { dataDirectory: legacyImportDataDir })
    try {
      const scaleRepository = new SqliteStoreRepository(scaleDatabase, {
        filePath: legacyImportDatabaseFile, dataDirectory: legacyImportDataDir, backupRetention: 25
      })
      const scaleSnapshot = scaleRepository.loadSnapshot()
      const targetTaskCount = 50000
      const maximumTaskId = scaleSnapshot.tasks.reduce((maximum, task) => Math.max(maximum, Number(task.id) || 0), 0)
      const nextId = Math.max(Number(scaleSnapshot.counters.task) || 1, maximumTaskId + 1)
      const dueDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Los_Angeles' }).format(new Date())
      const additionalTasks = Math.max(0, targetTaskCount - scaleSnapshot.tasks.length)
      for (let index = 0; index < additionalTasks; index++) {
        const id = nextId + index
        scaleSnapshot.tasks.push({
          id, title: `50k scale benchmark task ${id}`, projectId: 22, assigneeId: 'legacy-person-1',
          priority: ['Low', 'Medium', 'High'][index % 3], dueDate, status: 'To do', type: 'Benchmark',
          blocked: false, createdAt: dueDate, completedAt: '', sample: false, customFields: {}
        })
      }
      scaleSnapshot.counters.task = nextId + additionalTasks
      const seedStart = performance.now()
      scaleRepository.writeSnapshot(scaleSnapshot)
      report.metrics.seed50kTasksMs = Math.round(performance.now() - seedStart)
      report.metrics.taskCountBenchmark = scaleSnapshot.tasks.length
    } finally { scaleDatabase.close() }

    await startServerForDataDir(legacyImportDataDir, '50,000-task scale benchmark')
    const scaleAdmin = new Client('50k-scale-admin')
    await scaleAdmin.post('/api/auth/login', { email: 'legacy-admin@example.com', password: 'LegacyImportPass123' })
    const scaleBootstrap = await scaleAdmin.get('/api/bootstrap')
    assert.equal(scaleBootstrap.body.tasks.length, 50000)
    report.metrics.bootstrap50kMs = scaleBootstrap.ms
    const scaleProject = await scaleAdmin.get('/api/projects/22/tasks')
    assert.equal(scaleProject.body.tasks.length, 50000)
    report.metrics.projectDrilldown50kMs = scaleProject.ms
    const scaleExport = await scaleAdmin.post('/api/exports/prepare', {
      dataset: 'tasks', recordIds: scaleBootstrap.body.tasks.map(task => task.numericId), fields: ['id', 'title', 'project', 'status']
    })
    assert.equal(scaleExport.body.recordCount, 50000)
    report.metrics.export50kMs = scaleExport.ms
    const scaleReport = await scaleAdmin.get('/api/reports/weekly')
    assert.ok(scaleReport.body.series.length)
    report.metrics.weeklyReport50kMs = scaleReport.ms
    assert.ok(scaleBootstrap.ms < 15000 && scaleProject.ms < 15000 && scaleExport.ms < 15000 && scaleReport.ms < 5000)
    record('50,000-task benchmark: SQL seed, bootstrap, project drill-down, unbounded selected export, and aggregate report', 'pass', report.metrics)
  } finally {
    await stopServer()
    report.finishedAt = new Date().toISOString()
    assertSafeDataDir()
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2))
  }
}

main().catch(async error => {
  report.failedAt = new Date().toISOString()
  report.error = { message: error.message, stack: error.stack }
  try {
    if (safePathsValidated) {
      assertSafeDataDir()
      fs.writeFileSync(resultPath, JSON.stringify(report, null, 2))
    }
  } catch {}
  await stopServer().catch(() => {})
  console.error(error)
  process.exit(1)
})
