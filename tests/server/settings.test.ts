import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { buildTranslationCatalog } from '../../shared/i18n/catalog'
import { diffPatch, mergePatch, normalizeSettings } from '../../shared/settings'
import { auditRows, listBackups, openDirect, settingsOf } from '../helpers/db'
import { Api, PASSWORD, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'

let server: TestServer
let admin: Api
before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
})
after(() => server.cleanup())
const settings = async () => (await admin.get('/api/bootstrap')).body.settings

describe('settings updates (VAL-01, VAL-03, UX-07, MIN-05)', () => {
  test('an invalid time zone is rejected up front', async () => {
    const res = await admin.put('/api/settings', { workspace: { defaultTimezone: 'Mars/Olympus' } })
    assert.equal(res.status, 400)
    assert.match(res.body.error, /time zone/i)
    assert.notEqual((await settings()).workspace.defaultTimezone, 'Mars/Olympus')
  })

  test('other invalid values are rejected: page size, session days, password length, language list, theme', async () => {
    const bad = [
      { interface: { tableBehavior: { pageSize: 100000 } } },
      { interface: { tableBehavior: { pageSize: 'abc' } } },
      { security: { sessionDays: 0 } },
      { security: { passwordMinLength: 3 } },
      { audit: { retentionDays: 1 } },
      { localization: { activeLanguages: [] } },
      { localization: { activeLanguages: ['not a code!'] } },
      { interface: { theme: 'neon' } },
      { workflows: { task: { states: [{ label: 'A' }, { label: 'a' }] } } },
      { reports: { activityVisibility: 'whatever' } }
    ]
    for (const body of bad) assert.equal((await admin.put('/api/settings', body)).status, 400, JSON.stringify(body))
  })

  test('a partial update never resets values it does not mention (merge-patch)', async () => {
    assert.equal(
      (
        await admin.put('/api/settings', {
          workspace: { defaultTimezone: 'Asia/Tokyo', workingDays: ['Monday', 'Tuesday'] }
        })
      ).status,
      200
    )
    assert.equal((await admin.put('/api/settings', { workspace: { name: 'Renamed Only' } })).status, 200)
    const s = await settings()
    assert.equal(s.workspace.name, 'Renamed Only')
    assert.equal(s.workspace.defaultTimezone, 'Asia/Tokyo')
    assert.deepEqual(s.workspace.workingDays, ['Monday', 'Tuesday'])
    assert.equal(s.workspaceName, 'Renamed Only', 'derived legacy key follows')
    assert.equal((await admin.put('/api/settings', { workspace: { defaultTimezone: 'Europe/Amsterdam' } })).status, 200)
  })

  test('null removes a key (here a custom role); users of a removed role degrade to read-only, never to nothing or admin', async () => {
    assert.equal(
      (
        await admin.put('/api/settings', {
          permissions: { roles: { Temp: { permissions: ['writeTasks', 'viewReports'] } } }
        })
      ).status,
      200
    )
    const temp = await makeUser(server, admin, 'Temp', 'Temp Role Person')
    assert.ok((await temp.api.get('/api/auth/me')).body.user.permissions.includes('writeTasks'))
    assert.equal((await admin.put('/api/settings', { permissions: { roles: { Temp: null } } })).status, 200)
    assert.equal((await settings()).permissions.roles.Temp, undefined)
    const me = (await temp.api.get('/api/auth/me')).body.user
    assert.deepEqual(me.permissions, ['viewReports', 'exportData'])
  })

  test('administrators cannot be locked out through the registry and non-admins cannot change settings', async () => {
    const viewer = await makeUser(server, admin, 'Viewer', 'Settings Viewer')
    assert.equal((await viewer.api.put('/api/settings', { workspace: { name: 'Hacked' } })).status, 403)
    assert.equal((await viewer.api.get('/api/settings/export')).status, 403)
    assert.equal((await viewer.api.post('/api/settings/import', { settings: {} })).status, 403)
  })

  test('the client round-trip: a built-in catalog sent back by the UI is never frozen into the store', async () => {
    const catalog = buildTranslationCatalog()
    const before = Number(server.db.scalar('SELECT length(document) FROM settings WHERE id = 1'))
    const res = await admin.put('/api/settings', {
      localization: { translations: { ar: { ...catalog.ar, 'nav.reports': 'تقاريرنا' }, en: { ...catalog.en } } }
    })
    assert.equal(res.status, 200)
    const stored = settingsOf(server).localization.translations
    assert.deepEqual(stored.ar, { 'nav.reports': 'تقاريرنا' })
    assert.deepEqual(Object.keys(stored), ['ar'], 'languages without overrides are not stored at all')
    const growth = Number(server.db.scalar('SELECT length(document) FROM settings WHERE id = 1')) - before
    assert.ok(growth < 8_000, `the settings document grew by ${growth} bytes`)
    const catalogResponse = await new Api(server.url).get('/api/i18n/catalog?language=ar')
    assert.equal(catalogResponse.body.catalog['nav.reports'], 'تقاريرنا')
    assert.equal(catalogResponse.body.catalog['nav.projects'], catalog.ar['nav.projects'], 'built-ins still served')
    assert.equal(catalogResponse.body.interfaces, undefined)
  })

  test('import replaces settings atomically after a snapshot and validates the file', async () => {
    const exported = (await admin.get('/api/settings/export')).body
    assert.ok(exported.settings.workspace)
    assert.equal(
      (await admin.post('/api/settings/import', { settings: { workspace: { defaultTimezone: 'Nope/Nope' } } })).status,
      400
    )
    const edited = structuredClone(exported.settings)
    edited.workspace.name = 'Imported Name'
    const res = await admin.post('/api/settings/import', { settings: edited })
    assert.equal(res.status, 200)
    assert.equal(res.body.workspace.name, 'Imported Name')
    assert.ok(listBackups(server).some(b => b.reason === 'pre-settings-import'))
  })

  test('workflow states are validated and drive task statuses', async () => {
    const dup = await admin.put('/api/settings', {
      workflows: { task: { states: [{ label: 'Open' }, { label: 'Open' }] } }
    })
    assert.equal(dup.status, 400)
    const ok = await admin.put('/api/settings', {
      workflows: { task: { states: [{ label: 'Backlog' }, { label: 'Doing' }, { label: 'Shipped', terminal: true }] } }
    })
    assert.equal(ok.status, 200)
    const states = (await settings()).workflows.task.states
    assert.deepEqual(
      states.map((s: any) => s.label),
      ['Backlog', 'Doing', 'Shipped']
    )
    assert.equal(states.at(-1).terminal, true)
    assert.ok(states.every((s: any) => s.id))
    // restore defaults for later tests
    await admin.put('/api/settings', {
      workflows: {
        task: {
          states: [
            { label: 'To do' },
            { label: 'In progress' },
            { label: 'Review' },
            { label: 'Testing' },
            { label: 'Done', terminal: true }
          ]
        }
      }
    })
  })

  test('non-Latin workflow labels get stable ids', async () => {
    const res = await admin.put('/api/settings', {
      workflows: { task: { states: [{ label: 'قيد التنفيذ' }, { label: 'تم' }] } }
    })
    assert.equal(res.status, 200)
    const first = (await settings()).workflows.task.states.map((s: any) => s.id)
    assert.ok(first.every((id: string) => id && id !== 'state_1'))
    await admin.put('/api/settings', { audit: { retentionDays: 365 } })
    assert.deepEqual(
      (await settings()).workflows.task.states.map((s: any) => s.id),
      first,
      'ids do not change between saves'
    )
    await admin.put('/api/settings', {
      workflows: {
        task: {
          states: [
            { label: 'To do' },
            { label: 'In progress' },
            { label: 'Review' },
            { label: 'Testing' },
            { label: 'Done', terminal: true }
          ]
        }
      }
    })
  })

  test('changes to security and audit settings are themselves audited with before/after values', async () => {
    await admin.put('/api/settings', { audit: { retentionDays: 90 } })
    const entry = auditRows(server, 'settings.updated').at(-1)!
    assert.deepEqual(entry.detail.audit.from.retentionDays, 365)
    assert.deepEqual(entry.detail.audit.to.retentionDays, 90)
    await admin.put('/api/settings', { audit: { retentionDays: 365 } })
  })

  test('the password policy and session length are enforced from settings (UX-07)', async () => {
    await admin.put('/api/settings', { security: { passwordMinLength: 14 } })
    const short = await admin.post('/api/users', {
      name: 'Short Pw',
      email: 'shortpw@example.com',
      password: 'Twelve-chars1',
      role: 'Viewer'
    })
    assert.equal(short.status, 400)
    assert.match(short.body.error, /14/)
    assert.equal(
      (
        await admin.post('/api/users', {
          name: 'Long Pw',
          email: 'longpw@example.com',
          password: 'Fourteen-chars-ok1',
          role: 'Viewer'
        })
      ).status,
      200
    )
    await admin.put('/api/settings', { security: { passwordMinLength: 8, sessionDays: 2 } })
    const api = new Api(server.url)
    const login = await api.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
    assert.match(login.headers.getSetCookie()[0], new RegExp(`Max-Age=${2 * 86400}`))
    await admin.put('/api/settings', { security: { sessionDays: 14 } })
  })
})

describe('safe mode: damaged stored settings cannot break the server (VAL-01)', () => {
  test('an invalid stored time zone, theme and page size fall back to defaults instead of failing every request', async () => {
    const dir = fs.mkdtempSync(path.join(server.dataDir, 'damaged-'))
    const fresh = await launch({ dataDir: dir, keep: true })
    const a = await setupAdmin(fresh)
    await fresh.close()
    // Damage the stored settings document directly in the database file.
    const damaged = openDirect(dir)
    damaged.run(
      "UPDATE settings SET document = json_set(document, '$.workspace.defaultTimezone', 'Not/AZone', '$.interface.theme', 'neon', '$.interface.tableBehavior.pageSize', -5) WHERE id = 1"
    )
    damaged.close()
    const again = await launch({ dataDir: dir })
    try {
      const b = new Api(again.url)
      await b.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
      const boot = await b.get('/api/bootstrap')
      assert.equal(boot.status, 200)
      assert.equal(boot.body.settings.interface.theme, 'light')
      assert.equal(boot.body.settings.interface.tableBehavior.pageSize, 10)
      assert.match(boot.body.today, /^\d{4}-\d{2}-\d{2}$/)
      assert.ok(a)
    } finally {
      await again.cleanup()
    }
  })

  test('mergePatch / diffPatch are inverse and never touch prototypes', () => {
    const before = { a: 1, b: { c: 2, d: [1, 2] }, e: 'x' }
    const after = { a: 1, b: { c: 3, d: [1, 2, 3] }, f: true }
    const patch = diffPatch(before, after)
    assert.deepEqual(patch, { b: { c: 3, d: [1, 2, 3] }, e: null, f: true })
    assert.deepEqual(mergePatch(before, patch), after)
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}')
    mergePatch({}, hostile)
    normalizeSettings({ ...hostile, permissions: hostile })
    assert.equal(({} as any).polluted, undefined)
    assert.deepEqual(diffPatch({ a: 1 }, { a: 1 }), {})
  })
})

describe('server-built labels and week boundaries (REP-03)', () => {
  test('month and weekday names follow the workspace language, digits stay Latin', async () => {
    await admin.put('/api/settings', { localization: { defaultLanguage: 'ar' } })
    const report = (await admin.get('/api/reports/daily')).body
    assert.ok(/[\u0600-\u06FF]/.test(report.series.at(-1).label), report.series.at(-1).label)
    assert.ok(!/[٠-٩]/.test(report.series.at(-1).label), 'Latin digits')
    await admin.put('/api/settings', { localization: { defaultLanguage: 'en' } })
  })

  test('the week can start on Sunday', async () => {
    const monday = (await admin.get('/api/reports/weekly')).body.series.at(-1).key
    await admin.put('/api/settings', { workspace: { weekStartsOn: 'sunday' } })
    const sunday = (await admin.get('/api/reports/weekly')).body.series.at(-1).key
    assert.equal(new Date(`${sunday}T00:00:00Z`).getUTCDay(), 0)
    assert.equal(new Date(`${monday}T00:00:00Z`).getUTCDay(), 1)
    await admin.put('/api/settings', { workspace: { weekStartsOn: 'monday' } })
  })
})

describe('workflow edits keep tasks attached to their state (data integrity)', () => {
  test('renaming a state by id carries its tasks along; removing a state in use is refused', async () => {
    const project = (await admin.post('/api/projects', { name: 'Flow', code: 'FLW' })).body
    const t1 = (await admin.post('/api/tasks', { title: 'in review', projectId: project.numericId, status: 'Review' }))
      .body
    const states = (await settings()).workflows.task.states
    const review = states.find((s: any) => s.label === 'Review')
    const renamed = states.map((s: any) => (s.id === review.id ? { ...s, label: 'Peer review' } : s))
    const res = await admin.put('/api/settings', { workflows: { task: { states: renamed } } })
    assert.equal(res.status, 200, res.text)
    const row = (await admin.get('/api/bootstrap')).body.tasks.find((t: any) => t.numericId === t1.numericId)
    assert.equal(row.status, 'Peer review')
    assert.ok(
      (await settings()).workflows.task.transitions.some(
        (t: any) => t.from === 'Peer review' || t.to === 'Peer review'
      ),
      'transitions follow the rename'
    )
    // removing a state that tasks use is refused with an explanation
    const without = renamed.filter((s: any) => s.id !== review.id)
    const refused = await admin.put('/api/settings', { workflows: { task: { states: without } } })
    assert.equal(refused.status, 400)
    assert.match(refused.body.error, /Peer review.*1 task/)
    // restore
    await admin.put('/api/settings', { workflows: { task: { states } } })
    assert.equal(
      (await admin.get('/api/bootstrap')).body.tasks.find((t: any) => t.numericId === t1.numericId).status,
      'Review'
    )
  })
})
