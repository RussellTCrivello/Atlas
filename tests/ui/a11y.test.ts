// UX-05: automated accessibility checks (axe-core, WCAG 2.x A/AA rules) on every screen and on the interactive overlays.
// What this does NOT cover: colour contrast (jsdom has no layout engine), keyboard behaviour on a real device, screen
// readers, zoom/reflow. Automated rules catch only part of WCAG; a manual audit with assistive technology is still open.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import axe from 'axe-core'
import { after, before, describe, test } from 'node:test'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI } from '../helpers/ui'

let server: TestServer
let admin: Api
let viewer: Awaited<ReturnType<typeof makeUser>>
const uis: BootedUI[] = []

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  const manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
  const project = (await manager.api.post('/api/projects', { name: 'Payments', code: 'PAY' })).body
  const mia = (await admin.get('/api/bootstrap')).body.people.find((p: any) => p.name === 'Mia Manager').id
  for (let i = 1; i <= 6; i++)
    await manager.api.post('/api/tasks', {
      title: `Task ${i}`,
      projectId: project.numericId,
      assigneeId: mia,
      dueDate: `2031-01-0${i}`,
      blocked: i === 3
    })
  await manager.api.post('/api/milestones', {
    name: 'Launch',
    projectId: project.numericId,
    dueDate: '2031-03-01',
    status: 'Upcoming'
  })
  await manager.api.post('/api/activity', { today: 'Working on things', blocked: 'Waiting on review' })
  await manager.api.post('/api/alerts', { title: 'Heads up', projectId: project.numericId })
})
after(async () => {
  uis.forEach(ui => ui.close())
  await server.cleanup()
})

async function violations(ui: BootedUI): Promise<string[]> {
  ui.w.eval(axe.source)
  const results = await ui.w.axe.run(ui.doc, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    rules: {
      'color-contrast': { enabled: false }, // needs a layout engine
      'document-title': { enabled: false } // the test page shell has no <title>; the real one is asserted below
    }
  })
  // The result comes from the jsdom realm; copy it into a Node-realm array so deepEqual compares like with like.
  return [...results.violations].map(
    (v: any) =>
      `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes
        .slice(0, 2)
        .map((n: any) => n.target.join(' '))
        .join(' | ')}`
  )
}

async function open(api: Api | null, hash: string, ready: string, extra: Partial<Parameters<typeof bootUI>[0]> = {}) {
  const ui = await bootUI({ base: server.url, cookie: api?.cookie, hash, ...extra })
  uis.push(ui)
  await ui.waitFor(() => ui.doc.querySelector(ready), 15000)
  await ui.settle(300)
  return ui
}

describe('every screen passes the automated WCAG 2.x A/AA rules (UX-05)', () => {
  const pages: [string, string][] = [
    ['/overview', '.focus-panel'],
    ['/projects', '.project-grid'],
    ['/tasks', '.board'],
    ['/people', '.team-strip'],
    ['/activity', '.timeline'],
    ['/reports', '.page-content'],
    ['/alerts', '.page-content'],
    ['/settings', '.page-content']
  ]
  for (const [hash, ready] of pages)
    test(`${hash} (administrator)`, async () => {
      assert.deepEqual(await violations(await open(admin, hash, ready)), [])
    })

  test('a read-only role sees the same screens without violations', async () => {
    for (const [hash, ready] of [
      ['/tasks', '.board'],
      ['/activity', '.timeline'],
      ['/reports', '.page-content']
    ])
      assert.deepEqual(await violations(await open(viewer.api, hash, ready)), [], hash)
  })

  test('the sign-in screen', async () => {
    assert.deepEqual(await violations(await open(null, '/overview', 'form')), [])
  })

  test('the interface in Arabic (right-to-left, translated labels)', async () => {
    const me = (await admin.get('/api/auth/me')).body.user
    const ui = await open(admin, '/tasks', '.board', {
      beforeEval: w => w.localStorage.setItem(`atlas-prefs:${me.id}`, JSON.stringify({ language: 'ar' }))
    })
    assert.equal(ui.doc.documentElement.dir, 'rtl')
    assert.deepEqual(await violations(ui), [])
  })

  test('the shipped page has a language and a title', () => {
    const html = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'index.html'), 'utf8')
    assert.match(html, /<html[^>]*\blang="[a-z-]+"/i)
    assert.match(html, /<title>[^<]+<\/title>/)
  })
})

describe('interactive overlays pass too (UX-05)', () => {
  const overlays: [string, string, string, (ui: BootedUI) => Promise<void>][] = [
    ['new-task dialog', '/tasks', '.board', async ui => void ui.click('.primary-button')],
    ['new-project dialog', '/projects', '.project-grid', async ui => void ui.click('.primary-button')],
    ['add-person dialog', '/people', '.team-strip', async ui => void ui.click('.primary-button', 'Add person')],
    ['export panel', '/tasks', '.board', async ui => void ui.click('.export-wrap > button')],
    [
      'command palette',
      '/overview',
      '.focus-panel',
      async ui =>
        void ui.w.document.dispatchEvent(new ui.w.KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    ]
  ]
  for (const [label, hash, ready, act] of overlays)
    test(label, async () => {
      const ui = await open(admin, hash, ready)
      await act(ui)
      await ui.settle(300)
      assert.ok(
        ui.doc.querySelector('[role="dialog"], .export-panel'),
        `${label} is open and exposed as a dialog or labelled panel`
      )
      assert.deepEqual(await violations(ui), [])
    })
})
