import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const port = Number(process.env.TEST_PORT || 5193)
const base = `http://127.0.0.1:${port}`
const dataDir = process.env.TEST_DATA_DIR || '/tmp/atlas-final-validation'
const resultPath = path.join(root, 'docs', 'final-validation-results.json')
const report = { startedAt: new Date().toISOString(), port, dataDir, checks: [], metrics: {}, knownLimitations: [] }
let server

function record(name, status, detail = {}) { report.checks.push({ name, status, ...detail }) }
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
  delete(pathname, expect = 200) { return this.request(pathname, { method: 'DELETE', expect }) }
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
  s.customFields.tasks = [{ key: 'client_code', label: 'Client code', type: 'text', visible: true, required: false }]
  s.permissions.roles.Reporter = { name: 'Reporter', summary: 'Reports and exports only.', permissions: ['viewReports', 'exportData'], rank: 2 }
  s.exports.formats = ['csv', 'xlsx', 'json', 'pdf', 'print']
  s.reports.defaultTemplate = 'executive'
  s.audit.enabled = true
  return s
}

async function main() {
  fs.mkdirSync(path.dirname(resultPath), { recursive: true })
  await startServer()
  try {
    const publicClient = new Client('public')
    const health = await publicClient.get('/api/health')
    assert.equal(health.body.ok, true)
    record('health endpoint', 'pass', { ms: health.ms })
    const setupStatus = await publicClient.get('/api/setup/status')
    assert.deepEqual(setupStatus.body, { configured: false, demoAllowed: false, demo: null })
    record('production first-run has no demo credentials', 'pass')
    const runtime = await publicClient.get('/api/runtime-config')
    assert.equal(runtime.body.database.schemaVersion, '3.0.0')
    assert.equal(runtime.body.designSystem.version, '2.0.0')
    record('runtime config schema/design metadata', 'pass', { schema: runtime.body.database.schemaVersion, designSystem: runtime.body.designSystem.version })
    const rootHtml = await raw('/')
    assert.equal(rootHtml.res.status, 200)
    assert.match(String(rootHtml.body), /<div id="root"><\/div>/)
    record('production HTML served', 'pass', { ms: rootHtml.ms })
    await publicClient.post('/api/setup', { name: 'Bad Admin', email: 'bad@example.com', password: 'short' }, 400)
    record('invalid setup password rejected', 'pass')

    const admin = new Client('admin')
    await admin.post('/api/setup', { name: 'Amina Admin', email: 'admin@example.com', password: 'StrongPass123', workspaceName: 'Atlas Acceptance', workspaceUnit: 'Operations' })
    let bootstrap = await admin.get('/api/bootstrap')
    assert.equal(bootstrap.body.user.role, 'Administrator')
    assert.equal(bootstrap.body.settings.workspace.name, 'Atlas Acceptance')
    assert.ok(bootstrap.body.settings.localization.textDirectionByLanguage.ar === 'rtl')
    record('administrator setup and bootstrap', 'pass')

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
    fs.copyFileSync(backupFile, path.join(dataDir, 'atlas-store.json'))
    await restartPreservingData()
    const admin2 = new Client('admin-restored')
    await admin2.post('/api/auth/login', { email: 'admin@example.com', password: 'StrongPass123' })
    bootstrap = await admin2.get('/api/bootstrap')
    assert.equal(bootstrap.body.settings.workspace.name, 'Atlas Acceptance Backup Point')
    record('backup restoration and restart persistence', 'pass')

    const team = (await admin2.post('/api/teams', { name: 'Global Delivery', color: 'blue' })).body
    const managerPerson = (await admin2.post('/api/people', { name: 'Mona Manager', email: 'manager@example.com', jobTitle: 'Delivery Manager', teamId: team.id, focus: 'Portfolio health', capacity: 80 })).body
    const developerPerson = (await admin2.post('/api/people', { name: 'ليلى Developer', email: 'developer@example.com', jobTitle: 'Engineer', teamId: team.id, focus: 'Feature delivery', capacity: 75 })).body
    const viewerPerson = (await admin2.post('/api/people', { name: 'Omar Viewer', email: 'viewer@example.com', jobTitle: 'Analyst', teamId: team.id, focus: 'Reporting', capacity: 40 })).body
    await admin2.post('/api/users', { name: 'Mona Manager', email: 'manager@example.com', password: 'ManagerPass123', role: 'Manager', personId: managerPerson.id, avatarColor: 'blue', active: true })
    await admin2.post('/api/users', { name: 'ليلى Developer', email: 'developer@example.com', password: 'DeveloperPass123', role: 'Developer', personId: developerPerson.id, avatarColor: 'green', active: true })
    await admin2.post('/api/users', { name: 'Omar Viewer', email: 'viewer@example.com', password: 'ViewerPass123', role: 'Viewer', personId: viewerPerson.id, avatarColor: 'orange', active: true })
    await admin2.post('/api/users', { name: 'Duplicate Viewer', email: 'viewer@example.com', password: 'ViewerPass123', role: 'Viewer', personId: viewerPerson.id }, 409)
    await admin2.post('/api/users', { name: 'Invalid Role', email: 'invalid@example.com', password: 'InvalidPass123', role: 'NoSuchRole', personId: viewerPerson.id }, 400)
    await admin2.delete(`/api/people/${viewerPerson.id}`, 400)
    await admin2.delete(`/api/teams/${team.id}`, 400)
    record('user creation and invalid relationship operations', 'pass')

    const manager = new Client('manager')
    await manager.post('/api/auth/login', { email: 'manager@example.com', password: 'ManagerPass123' })
    let project = (await manager.post('/api/projects', { name: 'Client Portal مشروع', code: 'CP', description: 'Bilingual delivery project', teamId: team.id, ownerId: managerPerson.id, color: 'purple', status: 'On track' })).body
    await manager.post('/api/milestones', { name: 'Pilot review', projectId: project.numericId, status: 'Upcoming' })
    const managerTask = (await manager.post('/api/tasks', { title: 'Plan release checklist', projectId: project.numericId, assigneeId: managerPerson.id, status: 'Draft', priority: 'High', customFields: { client_code: 'MGR-1' } })).body
    const devTask = (await manager.post('/api/tasks', { title: 'تنفيذ لوحة التقارير CP-42', projectId: project.numericId, assigneeId: developerPerson.id, status: 'Draft', priority: 'High', customFields: { client_code: 'AR-42' } })).body
    const alert = (await manager.post('/api/alerts', { title: 'Release blocker', body: 'Waiting for review', type: 'blocker', tone: 'orange', projectId: project.numericId, taskId: devTask.numericId })).body
    await manager.patch(`/api/alerts/${alert.id}`, { resolved: true })
    const managerReport = await manager.get('/api/reports/weekly')
    assert.ok(managerReport.body.series.length)
    record('manager project/task/alert/report journey', 'pass')

    const developer = new Client('developer')
    await developer.post('/api/auth/login', { email: 'developer@example.com', password: 'DeveloperPass123' })
    await developer.patch(`/api/tasks/${devTask.numericId}/status`, { status: 'Active' })
    await developer.patch(`/api/tasks/${devTask.numericId}/status`, { status: 'Review' })
    const doneTask = (await developer.patch(`/api/tasks/${devTask.numericId}/status`, { status: 'Done' })).body
    assert.equal(doneTask.status, 'Done')
    assert.equal(doneTask.customFields.client_code, 'AR-42')
    await developer.post('/api/activity', { personId: developerPerson.id, yesterday: 'راجعت المتطلبات', today: 'أنهيت لوحة التقارير CP-42', blocked: '', upcoming: 'اختبار القبول' })
    await developer.post('/api/projects', { name: 'Unauthorized', code: 'NO' }, 403)
    record('developer task/activity journey and protected project mutation', 'pass')

    const viewer = new Client('viewer')
    await viewer.post('/api/auth/login', { email: 'viewer@example.com', password: 'ViewerPass123' })
    const activityReport = await viewer.get(`/api/reports/activity/daily?userId=${developerPerson.id}`)
    assert.ok(activityReport.body.rows.some(row => row.task === 'تنفيذ لوحة التقارير CP-42' && row.project === 'Client Portal مشروع'))
    await viewer.post('/api/tasks', { title: 'Viewer should fail', projectId: project.numericId }, 403)
    await viewer.put('/api/settings', bootstrap.body.settings, 403)
    record('viewer report access and protected mutations rejected', 'pass')

    const monthReport = await admin2.get(`/api/reports/activity/monthly?userId=${developerPerson.id}`)
    assert.ok(monthReport.body.totals.completedTasks >= 1)
    assert.ok(JSON.stringify(monthReport.body).includes('تنفيذ لوحة التقارير'))
    record('Arabic/mixed LTR-RTL report data integrity', 'pass')

    const largeProject = (await admin2.post('/api/projects', { name: 'Scale Validation', code: 'SCL', teamId: team.id, ownerId: managerPerson.id })).body
    const createStart = performance.now()
    for (let i = 0; i < 160; i++) {
      await admin2.post('/api/tasks', { title: `Load task ${i + 1}`, projectId: largeProject.numericId, assigneeId: i % 2 ? developerPerson.id : managerPerson.id, status: i % 3 === 0 ? 'Done' : 'Draft', priority: ['Low', 'Medium', 'High'][i % 3], customFields: { client_code: `LOAD-${i + 1}` } })
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
    record('final restart data/settings persistence', 'pass')
  } finally {
    await stopServer()
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(resultPath, JSON.stringify(report, null, 2))
  }
}

main().catch(async error => {
  report.failedAt = new Date().toISOString()
  report.error = { message: error.message, stack: error.stack }
  try { fs.writeFileSync(resultPath, JSON.stringify(report, null, 2)) } catch {}
  await stopServer().catch(() => {})
  console.error(error)
  process.exit(1)
})
