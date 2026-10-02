import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, textOf } from '../helpers/ui'

let server: TestServer
let admin: Api
let dev: Awaited<ReturnType<typeof makeUser>>
let devPerson: string
const uis: BootedUI[] = []

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  dev = await makeUser(server, admin, 'Developer', 'Dev Dana')
  const manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  const people = (await admin.get('/api/bootstrap')).body.people
  devPerson = people.find((p: any) => p.name === 'Dev Dana').id
  const managerPerson = people.find((p: any) => p.name === 'Mia Manager').id
  const project = (await manager.api.post('/api/projects', { name: 'Payments', code: 'PAY' })).body
  // 60 tasks owned by the manager and 10 by the developer, all in the first workflow state
  for (let i = 0; i < 60; i++)
    await manager.api.post('/api/tasks', {
      title: `Manager task ${i + 1}`,
      projectId: project.numericId,
      assigneeId: managerPerson,
      dueDate: '2030-01-01'
    })
  for (let i = 0; i < 10; i++)
    await manager.api.post('/api/tasks', {
      title: `Dana task ${i + 1}`,
      projectId: project.numericId,
      assigneeId: devPerson,
      dueDate: '2030-01-02'
    })
})
after(async () => {
  uis.forEach(ui => ui.close())
  await server.cleanup()
})

async function openWork(options: Partial<Parameters<typeof bootUI>[0]> = {}, ready = '.board') {
  const ui = await bootUI({ base: server.url, cookie: dev.api.cookie, hash: '/tasks', ...options })
  uis.push(ui)
  await ui.waitFor(() => ui.doc.querySelector(ready))
  return ui
}

describe('"My work" is the signed-in person\'s work (UX-02)', () => {
  test('the sidebar counter and the default view show only tasks assigned to me', async () => {
    const ui = await openWork()
    assert.equal(textOf(ui.doc.querySelector('.nav-count')), '10', 'badge = my open tasks, not the 70 in the workspace')
    assert.equal(ui.doc.querySelectorAll('.board-card').length, 10)
    assert.match(textOf(ui.doc.querySelector('.results-meta')), /Showing 10 of 10 matching tasks/)
    const pressed = [...ui.doc.querySelectorAll('[aria-label="Whose tasks"] button')].map(
      b => `${textOf(b)}:${b.getAttribute('aria-pressed')}`
    )
    assert.deepEqual(pressed, ['Assigned to me (10):true', 'Everyone (70):false'])
  })

  test('the Overview "My focus" list is mine too', async () => {
    const ui = await openWork({ hash: '/overview' }, '.focus-panel')
    const titles = [...ui.doc.querySelectorAll('.focus-panel .task-row-main strong')].map(textOf)
    assert.ok(titles.length > 0 && titles.every(title => title.startsWith('Dana task')), titles.join(', '))
  })
})

describe('nothing is silently truncated (UX-01)', () => {
  test('"Everyone" shows a window onto the full result with an explicit count, "Show more", and exports every row', async () => {
    const ui = await openWork()
    ui.click('[aria-label="Whose tasks"] button', 'Everyone')
    await ui.settle(150)
    assert.match(textOf(ui.doc.querySelector('.results-meta')), /Showing 50 of 70 matching tasks/)
    assert.equal(ui.doc.querySelectorAll('.board-card').length, 50, 'the first window is pageSize cards')
    const more = ui.doc.querySelector('.board .show-more')
    assert.ok(more, 'a "Show more" control is offered')
    assert.match(textOf(more), /Show 20 more/)
    // The export dialog works on the complete filtered set, not on what is on screen
    ui.click('.export-wrap > button')
    await ui.settle(100)
    assert.equal((ui.doc.querySelector('.export-panel input[readonly]') as HTMLInputElement).value, '70')
    ui.click('.board .show-more')
    await ui.settle(150)
    assert.equal(ui.doc.querySelectorAll('.board-card').length, 70)
    assert.match(textOf(ui.doc.querySelector('.results-meta')), /Showing 70 of 70 matching tasks/)
  })

  test('filters narrow the result and the counts follow', async () => {
    const ui = await openWork()
    ui.click('[aria-label="Whose tasks"] button', 'Everyone')
    ui.type('input[aria-label="Filter tasks"]', 'Dana task 3')
    await ui.settle(200)
    assert.match(textOf(ui.doc.querySelector('.results-meta')), /Showing 1 of 1 matching tasks · 70 in the workspace/)
  })
})

describe('changing status is deliberate and failures are visible (UX-06, UX-04)', () => {
  test('clicking a card does not move it; the advance button and the "Move to" select do', async () => {
    const ui = await openWork()
    const card = ui.doc.querySelector('.board-card')!
    const id = textOf(card.querySelector('.task-id'))
    ui.click('.board-card h3')
    await ui.settle(200)
    assert.equal(ui.requests.filter(r => r.method === 'PATCH').length, 0, 'a plain click sends no change')

    ui.click('.board-card [aria-label^="Advance"]')
    await ui.waitFor(() => ui.requests.some(r => r.method === 'PATCH' && r.url.includes('/status')))
    const patch = ui.requests.find(r => r.method === 'PATCH')!
    assert.deepEqual(JSON.parse(patch.body!), { advance: true })
    await ui.waitFor(() => [...ui.doc.querySelectorAll('.column-in-progress .task-id')].some(el => textOf(el) === id))

    const moved = ui.doc.querySelector('.column-in-progress .card-move') as HTMLSelectElement
    ui.type('.column-in-progress .card-move', 'Review')
    await ui.waitFor(() => [...ui.doc.querySelectorAll('.column-review .task-id')].some(el => textOf(el) === id))
    assert.ok(moved)
  })

  test('a failed move is explained to the user and does not crash or leave an unhandled rejection', async () => {
    const ui = await openWork({
      intercept: (url, init) =>
        init.method === 'PATCH' && url.includes('/status')
          ? new Response(JSON.stringify({ error: 'Moving this task is not allowed.', code: 'FORBIDDEN' }), {
              status: 403,
              headers: { 'content-type': 'application/json' }
            })
          : undefined
    })
    ui.click('.board-card [aria-label^="Advance"]')
    await ui.waitFor(() => textOf(ui.doc.querySelector('.toast-host')).includes('Moving this task is not allowed.'))
    await ui.settle(100)
    assert.deepEqual(ui.errors, [])
  })

  test('the list view has an explicit advance control too, with an accessible name', async () => {
    const ui = await openWork()
    ui.click('.view-toggle button', 'List')
    await ui.waitFor(() => ui.doc.querySelector('.task-table-panel .task-row'))
    const check = ui.doc.querySelector('.task-row .task-check')!
    assert.match(check.getAttribute('aria-label') || '', /^Advance .* to the next status$/)
  })
})

describe('the query builder (UX-09)', () => {
  test('saved filters are scoped to the signed-in user and removed when signing out', async () => {
    const ui = await openWork()
    ui.click('.advanced-filter-wrap > button')
    await ui.settle(100)
    ui.click('.advanced-filter-actions .text-button')
    await ui.settle(100)
    ui.type('.filter-condition input[aria-label="Value"]', 'Dana')
    ui.click('.advanced-filter-actions .primary-button')
    await ui.settle(150)
    const keys = Object.keys(ui.w.localStorage).filter(k => k.startsWith('atlas-filter'))
    assert.equal(keys.length, 1)
    assert.match(keys[0], new RegExp(`^atlas-filter-${dev.user.id}-tasks$`))
    ui.click('.logout-button')
    await ui.waitFor(() => ui.doc.querySelector('.login-form'))
    assert.deepEqual(
      Object.keys(ui.w.localStorage).filter(k => k.startsWith('atlas-filter')),
      []
    )
  })
})
