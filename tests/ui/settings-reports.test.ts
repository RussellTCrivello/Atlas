import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { after, before, describe, test } from 'node:test'
import { applyAdvancedFilters, matches, sortRows } from '../../src/lib/filters'
import { isNotApplied } from '../../src/lib/settings-status'
import { Api, PASSWORD, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, textOf } from '../helpers/ui'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let dev: Awaited<ReturnType<typeof makeUser>>
const uis: BootedUI[] = []
before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  dev = await makeUser(server, admin, 'Developer', 'Dev Dana')
  const project = (await manager.api.post('/api/projects', { name: 'Atlas Core', code: 'CORE' })).body
  const people = (await admin.get('/api/bootstrap')).body.people
  const devPerson = people.find((p: any) => p.name === 'Dev Dana').id
  const t = (
    await manager.api.post('/api/tasks', {
      title: 'Ship it',
      projectId: project.numericId,
      assigneeId: devPerson,
      status: 'In progress'
    })
  ).body
  await dev.api.patch(`/api/tasks/${t.numericId}/status`, { status: 'Done' })
  await dev.api.post('/api/activity', { today: 'Shipped it', blocked: 'Waiting for sign-off' })
})
after(async () => {
  uis.forEach(ui => ui.close())
  await server.cleanup()
})
const open = async (api: Api, hash: string, ready: string, extra: Partial<Parameters<typeof bootUI>[0]> = {}) => {
  const ui = await bootUI({ base: server.url, cookie: api.cookie, hash, ...extra })
  uis.push(ui)
  await ui.waitFor(() => ui.doc.querySelector(ready))
  return ui
}

describe('settings are honest about what they do (UX-07)', () => {
  test('people without settings rights get a "My account" page, not a disabled copy of the admin console', async () => {
    const ui = await open(dev.api, '/settings', '.password-form')
    assert.equal(textOf(ui.doc.querySelector('.topbar h1')), 'My account')
    assert.equal(ui.doc.querySelector('.advanced-settings-nav'), null)
    assert.ok([...ui.doc.querySelectorAll('.settings-card h2')].some(h => textOf(h) === 'Your preferences'))
    assert.equal(ui.doc.querySelector('.nav-item.active span')?.textContent, 'My account')
  })

  test('administrators see which settings are stored but not applied, shown disabled', async () => {
    const ui = await open(admin, '/settings', '.advanced-settings-nav')
    ui.click('.advanced-settings-nav button', 'Workspace')
    await ui.settle(150)
    const badges = [...ui.doc.querySelectorAll('.setting-badge')].map(textOf)
    assert.ok(badges.length >= 5 && badges.every(b => b === 'Not applied yet'), `badges: ${badges.length}`)
    const legal = [...ui.doc.querySelectorAll('label')].find(l => textOf(l).startsWith('Legal organization'))!
    assert.equal((legal.querySelector('input') as HTMLInputElement).disabled, true)
    const name = [...ui.doc.querySelectorAll('label')].find(l => textOf(l).startsWith('Workspace name'))!
    assert.equal((name.querySelector('input') as HTMLInputElement).disabled, false, 'applied settings stay editable')
    ui.click('.advanced-settings-nav button', 'Integrations')
    await ui.settle(150)
    assert.match(textOf(ui.doc.querySelector('.integrations-admin .permission-notice')), /not connected yet/)
    ui.click('.advanced-settings-nav button', 'Operations')
    await ui.settle(150)
    assert.match(textOf(ui.doc.querySelector('.settings-detail')), /Atlas does not send notifications yet/)
  })

  test('saving sends only what changed, and a rejected value is reported instead of vanishing', async () => {
    const ui = await open(admin, '/settings', '.advanced-settings-nav')
    ui.click('.advanced-settings-nav button', 'Workspace')
    await ui.settle(150)
    const labelIndex = [...ui.doc.querySelectorAll('.settings-detail label')].findIndex(l =>
      textOf(l).startsWith('Workspace name')
    )
    const input = ui.doc
      .querySelectorAll('.settings-detail label')
      [labelIndex].querySelector('input') as HTMLInputElement
    Object.getOwnPropertyDescriptor(ui.w.HTMLInputElement.prototype, 'value')!.set!.call(input, 'Renamed in UI')
    input.dispatchEvent(new ui.w.Event('input', { bubbles: true }))
    await ui.settle(100)
    assert.match(textOf(ui.doc.querySelector('.unsaved-note')), /Unsaved changes/)
    ui.click('.settings-hero .primary-button')
    await ui.waitFor(() => ui.requests.some(r => r.method === 'PUT' && r.url === '/api/settings'))
    const put = ui.requests.find(r => r.method === 'PUT' && r.url === '/api/settings')!
    const body = JSON.parse(put.body!)
    assert.ok(put.body!.length < 400, `payload ${put.body!.length} bytes: ${put.body}`)
    assert.equal(body.workspace.name, 'Renamed in UI')
    assert.equal(body.localization, undefined, 'the translation catalog is not re-sent')
    await ui.waitFor(() => /Saved/.test(textOf(ui.doc.querySelector('.settings-hero .primary-button'))))
    assert.equal((await admin.get('/api/bootstrap')).body.settings.workspace.name, 'Renamed in UI')

    // an invalid time zone is refused by the server and the message reaches the administrator
    const zone = [...ui.doc.querySelectorAll('.settings-detail label')]
      .find(l => textOf(l).startsWith('Timezone'))!
      .querySelector('select') as HTMLSelectElement
    const bad = ui.doc.createElement('option')
    bad.value = 'Mars/Olympus'
    bad.textContent = 'Mars/Olympus'
    zone.appendChild(bad)
    Object.getOwnPropertyDescriptor(ui.w.HTMLSelectElement.prototype, 'value')!.set!.call(zone, 'Mars/Olympus')
    zone.dispatchEvent(new ui.w.Event('change', { bubbles: true }))
    await ui.settle(100)
    ui.click('.settings-hero .primary-button')
    await ui.waitFor(() => /not a valid IANA time zone/.test(textOf(ui.doc.querySelector('.global-error'))))
  })

  test('the theme toggle in the top bar is personal: it never changes the workspace for everyone', async () => {
    const ui = await open(admin, '/overview', '.welcome-row')
    const before = ui.requests.filter(r => r.method === 'PUT').length
    const initial = ui.doc.documentElement.dataset.theme
    ui.click('.topbar [aria-label="Toggle theme"]')
    await ui.settle(200)
    assert.notEqual(ui.doc.documentElement.dataset.theme, initial)
    assert.equal(ui.requests.filter(r => r.method === 'PUT').length, before, 'no settings write')
    const me = (await admin.get('/api/auth/me')).body.user
    assert.ok(ui.w.localStorage.getItem(`atlas-prefs:${me.id}`))
    assert.equal(
      (await dev.api.get('/api/bootstrap')).body.settings.interface.theme,
      'light',
      'other people are unaffected'
    )
  })

  test('registry sanity: security-sounding settings that ARE enforced are not labelled as inert', () => {
    for (const path of [
      'security.sessionDays',
      'security.passwordMinLength',
      'audit.retentionDays',
      'audit.trackExports',
      'audit.trackReads',
      'audit.trackWrites',
      'reports.activityVisibility',
      'workflows.task.enforceTransitions',
      'storage.importExportEnabled',
      'localization.userLanguagePreference',
      'exports.formats.csv',
      'interface.actionVisibility.export'
    ])
      assert.equal(isNotApplied(path), false, path)
    for (const path of [
      'security.requireApprovalForRoleChanges',
      'notifications.channels.email',
      'integrations.registry',
      'permissions.fieldAccess',
      'workspace.workingHours'
    ])
      assert.equal(isNotApplied(path), true, path)
  })
})

describe('reports tell the truth (REP-01..03, DATA-04, GOV-02)', () => {
  test('the delivery report defines its numbers, never invents effort, and uses clear names', async () => {
    const ui = await open(manager.api, '/reports', '.report-hero')
    await ui.settle(300)
    const text = textOf(ui.doc.body)
    assert.match(text, /On-time delivery/)
    assert.ok(ui.doc.querySelector('.report-definitions'), 'definitions are one click away')
    assert.match(textOf(ui.doc.querySelector('.report-definitions')), /Delivered ÷ planned/)
    for (const forbidden of [/Minutes/i, /Focused effort/i, /Evidence ledger/i, /\d+(\.\d)?h\b/])
      assert.doesNotMatch(text, forbidden)
    assert.match(text, /Activity events/)
    assert.match(text, /does not measure time|not how long it took/i)
    const rates = [...ui.doc.querySelectorAll('.bar-value span')]
      .map(textOf)
      .filter(t => t.endsWith('%'))
      .map(t => parseInt(t, 10))
    assert.ok(
      rates.every(r => r >= 0 && r <= 100),
      `bar labels: ${rates.join(', ')}`
    )
  })

  test('the activity log is complete about what it counts and states its limits', async () => {
    const ui = await open(manager.api, '/reports', '.activity-report-lab')
    await ui.waitFor(() => ui.doc.querySelectorAll('.evidence-row').length > 0)
    const labels = [...ui.doc.querySelectorAll('.activity-report-totals span')].map(textOf)
    assert.deepEqual(labels, [
      'Tasks touched',
      'Completed tasks',
      'People active',
      'Projects',
      'Daily updates',
      'Blockers raised'
    ])
    assert.ok(ui.doc.querySelector('.activity-report-lab select option[value="all"]'), 'managers can pick a person')
  })

  test('a developer sees only their own activity, is told why, and has no person picker', async () => {
    const ui = await open(dev.api, '/reports', '.activity-report-lab')
    await ui.waitFor(() => ui.doc.querySelectorAll('.evidence-row').length > 0)
    assert.match(
      textOf(ui.doc.querySelector('.activity-report-lab .permission-notice')),
      /You can see your own activity/
    )
    assert.equal(ui.doc.querySelector('.report-builder-controls select option[value="all"]'), null, 'no scope picker')
    const people = new Set([...ui.doc.querySelectorAll('.evidence-main strong')].map(textOf))
    assert.deepEqual([...people], ['Dev Dana'])
  })
})

describe('query builder semantics (UX-09)', () => {
  const rows = [
    { id: 1, status: 'Open', priority: 'High', dueDate: '2026-01-10' },
    { id: 2, status: 'Open', priority: 'Low', dueDate: '2026-03-01' },
    { id: 3, status: 'Done', priority: 'High', dueDate: '2026-02-01' },
    { id: 4, status: 'Done', priority: 'Low', dueDate: '' }
  ]
  const c = (field: string, operator: string, value = '', join: 'AND' | 'OR' = 'AND') => ({
    field,
    operator,
    value,
    join
  })
  test('AND binds tighter than OR', () => {
    // status=Open AND priority=Low OR status=Done AND priority=High  ==  (Open∧Low) ∨ (Done∧High)  => ids 2 and 3
    const out = applyAdvancedFilters(rows, [
      c('status', 'equals', 'Open'),
      c('priority', 'equals', 'Low'),
      c('status', 'equals', 'Done', 'OR'),
      c('priority', 'equals', 'High')
    ])
    assert.deepEqual(
      out.map(r => r.id),
      [2, 3]
    )
    // the old left-to-right fold would have returned only id 3
  })
  test('dates compare chronologically ("due before …" works)', () => {
    assert.deepEqual(
      applyAdvancedFilters(rows, [c('dueDate', 'lt', '2026-02-15')]).map(r => r.id),
      [1, 3]
    )
    assert.deepEqual(
      applyAdvancedFilters(rows, [c('dueDate', 'gte', '2026-02-01')]).map(r => r.id),
      [2, 3]
    )
  })
  test('empty / not-empty need no value, and valueless conditions are ignored', () => {
    assert.deepEqual(
      applyAdvancedFilters(rows, [c('dueDate', 'isEmpty')]).map(r => r.id),
      [4]
    )
    assert.deepEqual(
      applyAdvancedFilters(rows, [c('dueDate', 'isNotEmpty')]).map(r => r.id),
      [1, 2, 3]
    )
    assert.equal(applyAdvancedFilters(rows, [c('status', 'equals', '')]).length, 4)
  })
  test('numbers still compare numerically; text never matches a numeric operator', () => {
    assert.equal(matches({ n: '10' }, c('n', 'gt', '9')), true)
    assert.equal(matches({ n: 'abc' }, c('n', 'gt', '1')), false)
    assert.equal(matches({ n: '' }, c('n', 'lt', '1')), false)
  })
  test('sorting puts empty values last in both directions', () => {
    assert.deepEqual(
      sortRows(rows, { key: 'dueDate', dir: 'asc' }).map(r => r.id),
      [1, 3, 2, 4]
    )
    assert.deepEqual(
      sortRows(rows, { key: 'dueDate', dir: 'desc' }).map(r => r.id),
      [2, 3, 1, 4]
    )
  })
})

describe('service worker (DESK-05)', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'sw.js'), 'utf8')
  function simulate(version: string, existingCaches: string[] = []) {
    const listeners: Record<string, (event: any) => void> = {}
    const stores = new Map<string, Map<string, string>>(existingCaches.map(name => [name, new Map([['x', 'old']])]))
    const caches = {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map())
        const store = stores.get(name)!
        return {
          addAll: async (urls: string[]) => urls.forEach(u => store.set(u, 'precached')),
          put: async (req: any, res: any) => void store.set(req.url, 'runtime')
        }
      },
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (req: any) => {
        const key = typeof req === 'string' ? req : new URL(req.url).pathname
        for (const store of stores.values())
          for (const k of store.keys()) if (k === key || k.endsWith(key)) return { cached: k }
        return undefined
      }
    }
    let online = false
    const self = {
      location: { href: `https://atlas.test/sw.js?v=${version}`, origin: 'https://atlas.test' },
      addEventListener: (type: string, fn: any) => (listeners[type] = fn),
      skipWaiting: () => {},
      clients: { claim: () => {} }
    }
    vm.runInContext(
      source,
      vm.createContext({
        self,
        caches,
        URL,
        Promise,
        fetch: async () => {
          if (!online) throw new TypeError('offline')
          return { ok: true, clone: () => ({}) }
        }
      })
    )
    const dispatch = (event: any) =>
      new Promise<void>(resolve => {
        event.waitUntil = (p: Promise<any>) => p.then(() => resolve())
        event.respondWith = (p: any) => Promise.resolve(p).then(v => ((event.result = v), resolve()))
        const consumed = !!listeners[event.type]
        listeners[event.type](event)
        if (event.type === 'fetch' && !event.handled) setTimeout(resolve, 20)
        void consumed
      })
    return { stores, dispatch, setOnline: (v: boolean) => (online = v), listeners }
  }
  test('precaches the offline page and removes caches from earlier builds on activation', async () => {
    const sw = simulate('build-2', ['atlas-static-build-1', 'atlas-shell-old', 'someone-elses-cache'])
    await sw.dispatch({ type: 'install' })
    assert.ok(sw.stores.get('atlas-static-build-2')!.has('/offline.html'))
    await sw.dispatch({ type: 'activate' })
    assert.deepEqual([...sw.stores.keys()].sort(), ['atlas-static-build-2', 'someone-elses-cache'])
  })
  test('offline navigation shows the offline page; API calls and other origins are never intercepted', async () => {
    const sw = simulate('b')
    await sw.dispatch({ type: 'install' })
    const nav: any = { type: 'fetch', request: { url: 'https://atlas.test/projects', method: 'GET', mode: 'navigate' } }
    await sw.dispatch(nav)
    assert.deepEqual(nav.result, { cached: '/offline.html' })
    for (const request of [
      { url: 'https://atlas.test/api/bootstrap', method: 'GET', mode: 'cors' },
      { url: 'https://other.example/x.js', method: 'GET', mode: 'cors' },
      { url: 'https://atlas.test/assets/a.js', method: 'POST', mode: 'cors' }
    ]) {
      const event: any = { type: 'fetch', request, respondWith: () => (event.handled = true) }
      sw.listeners.fetch(event)
      assert.notEqual(event.handled, true, `${request.method} ${request.url} must pass through`)
    }
  })
})
