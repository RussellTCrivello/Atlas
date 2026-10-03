// The table view of projects, people and alerts: the same selection and bulk behaviour as the task grid, on lists the browser holds.
// Each action is checked for what it changes and for what it must not (records outside the selection, people without the right).
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, textOf } from '../helpers/ui'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let developer: Awaited<ReturnType<typeof makeUser>>
let viewer: Awaited<ReturnType<typeof makeUser>>
let projects: any[] = []
let team: any
const uis: BootedUI[] = []

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  developer = await makeUser(server, admin, 'Developer', 'Dana Dev')
  viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
  team = (await manager.api.post('/api/teams', { name: 'Platform' })).body
  for (const [name, code] of [
    ['Alpha', 'ALP'],
    ['Bravo', 'BRV'],
    ['Charlie', 'CHA'],
    ['Delta', 'DEL']
  ])
    projects.push((await manager.api.post('/api/projects', { name, code })).body)
  for (let i = 1; i <= 3; i++)
    await manager.api.post('/api/tasks', {
      title: `Alpha task ${i}`,
      projectId: projects[0].numericId,
      tags: ['copy-me']
    })
  for (let i = 1; i <= 3; i++) await manager.api.post('/api/alerts', { title: `Alert number ${i}` })
  for (let i = 1; i <= 3; i++)
    await manager.api.post('/api/people', { name: `Extra Person ${i}`, email: `extra${i}@example.com` })
})
after(async () => {
  uis.forEach(ui => ui.close())
  await server.cleanup()
})

async function open(api: Api, hash: string, ready: string) {
  const ui = await bootUI({ base: server.url, cookie: api.cookie, hash })
  uis.push(ui)
  await ui.waitFor(() => ui.doc.querySelector(ready), 15000)
  return ui
}
const rows = (ui: BootedUI, scope: string) =>
  [...ui.doc.querySelectorAll(`.${scope}-table tbody tr[data-row]`)] as HTMLElement[]
const bar = (ui: BootedUI) => textOf(ui.doc.querySelector('.selection-bar'))
const action = (ui: BootedUI, label: string) =>
  [...ui.doc.querySelectorAll('.selection-actions button')].find(b => textOf(b).startsWith(label)) as
    HTMLButtonElement | undefined
const tick = async (ui: BootedUI, scope: string, names: string[]) => {
  // match the name cell exactly: "Alpha" must not also pick "Copy of Alpha"
  for (const row of rows(ui, scope).filter(r =>
    names.includes(textOf(r.querySelector('td:nth-child(2) strong') ?? r.querySelector('td:nth-child(2)')))
  ))
    (row.querySelector('input[type="checkbox"]') as HTMLInputElement).click()
  await ui.waitFor(() => new RegExp(`${names.length} selected`).test(bar(ui)))
}
const toTable = async (ui: BootedUI, scope: string) => {
  ui.click('.view-toggle button', 'Table')
  await ui.waitFor(() => rows(ui, scope).length > 0)
}
const dialog = (ui: BootedUI) => ui.doc.querySelector('.bulk-dialog') as HTMLElement | null
const bootstrap = async () => (await admin.get('/api/bootstrap')).body

describe('projects as a table', () => {
  test('the layout choice is remembered, the cards are still there, and the table lists every project with its columns', async () => {
    const ui = await open(manager.api, '/projects', '.project-card')
    assert.ok(ui.doc.querySelector('.project-card'))
    await toTable(ui, 'projects-table')
    assert.equal(ui.doc.querySelector('.project-card'), null)
    const heads = [...ui.doc.querySelectorAll('.data-grid thead th:not(.select-cell):not(.actions-cell)')].map(th =>
      textOf(th)
        .replace(/[▲▼\d]/g, '')
        .trim()
    )
    assert.deepEqual(heads.slice(0, 4), ['Project', 'Code', 'Team', 'Owner'])
    assert.ok(rows(ui, 'projects-table').length >= 4)
    // the choice is stored for this person, so the next visit opens the same way (a new test window has no storage to share)
    const stored = Object.entries(ui.w.localStorage).filter(
      ([key]) => key.startsWith('atlas-mode-') && key.endsWith('-projects')
    )
    assert.deepEqual(
      stored.map(([, value]) => value),
      ['table']
    )
    ui.click('.view-toggle button', 'Cards')
    await ui.waitFor(() => ui.doc.querySelector('.project-card'))
    assert.equal(ui.doc.querySelector('.projects-table-table'), null, 'and the cards come back unchanged')
  })

  test('changing the status of selected projects changes those and no others, and says how many', async () => {
    const ui = await open(manager.api, '/projects', '.project-card')
    await toTable(ui, 'projects-table')
    await tick(ui, 'projects-table', ['Bravo', 'Charlie'])
    action(ui, 'Status')!.click()
    await ui.waitFor(() => dialog(ui))
    assert.match(textOf(dialog(ui)!), /applies to 2 projects/)
    ui.type('.bulk-dialog select', 'At risk')
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Changed 2 of 2 projects/.test(textOf(dialog(ui)!)))
    const boot = await bootstrap()
    const status = (name: string) => boot.projects.find((p: any) => p.name === name).status
    assert.deepEqual(
      [status('Bravo'), status('Charlie'), status('Alpha'), status('Delta')],
      ['At risk', 'At risk', 'On track', 'On track']
    )
  })

  test('duplicating a project offers its tasks as a choice, and copies exactly what was asked', async () => {
    const ui = await open(manager.api, '/projects', '.project-card')
    await toTable(ui, 'projects-table')
    await tick(ui, 'projects-table', ['Alpha'])
    action(ui, 'Duplicate')!.click()
    const ask = (await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))) as HTMLElement
    assert.match(textOf(ask), /Duplicate “Alpha”\?/)
    assert.match(textOf(ask), /Also copy its 3 tasks/)
    ui.click('[role="alertdialog"] button', 'Cancel')
    await ui.waitFor(() => !ui.doc.querySelector('[role="alertdialog"]'))
    assert.ok(!(await bootstrap()).projects.some((p: any) => /^Copy of/.test(p.name)), 'cancelling copies nothing')
    action(ui, 'Duplicate')!.click()
    await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))
    ;(ui.doc.querySelector('[role="alertdialog"] .confirm-check input') as HTMLInputElement).click()
    ui.click('[role="alertdialog"] button', 'Duplicate')
    await ui.waitFor(() => /Project duplicated/.test(textOf(ui.doc.querySelector('.toast-host'))))
    const copy = (await bootstrap()).projects.find((p: any) => p.name === 'Copy of Alpha')
    assert.equal((await admin.get(`/api/tasks/ids?project=${copy.numericId}`)).body.total, 3, 'its tasks came with it')
  })

  test('deleting several: a project that still has tasks is refused unless the box is ticked, and the refusal is reported', async () => {
    const ui = await open(manager.api, '/projects', '.project-card')
    await toTable(ui, 'projects-table')
    await tick(ui, 'projects-table', ['Delta', 'Alpha'])
    action(ui, 'Delete')!.click()
    await ui.waitFor(() => dialog(ui))
    assert.match(textOf(dialog(ui)!), /A backup is taken first/)
    assert.match(textOf(dialog(ui)!), /cannot be undone/)
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Deleted 1 of 2 projects/.test(textOf(dialog(ui)!)))
    assert.match(textOf(dialog(ui)!), /still has 3 task/, 'it names why Alpha was refused')
    const boot = await bootstrap()
    assert.ok(
      boot.projects.some((p: any) => p.name === 'Alpha'),
      'the project with tasks is intact'
    )
    assert.ok(!boot.projects.some((p: any) => p.name === 'Delta'), 'the empty one was deleted')
    ui.click('.bulk-dialog .primary-button', 'Close')
    await ui.waitFor(() => !dialog(ui))
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    assert.ok(
      /Alpha/.test(
        textOf(rows(ui, 'projects-table').find(r => (r.querySelector('input') as HTMLInputElement).checked)!)
      ),
      'the refused project stays selected'
    )
  })

  test('a developer sees the table and can open and print, but is offered nothing that changes projects', async () => {
    const ui = await open(developer.api, '/projects', '.project-card')
    await toTable(ui, 'projects-table')
    await tick(ui, 'projects-table', ['Alpha'])
    const offered = [...ui.doc.querySelectorAll('.selection-actions button')].map(b => textOf(b))
    assert.deepEqual(offered.sort(), ['Open', 'Print'])
  })
})

describe('people as a table', () => {
  test('moving people to a team and duplicating one (without the email address)', async () => {
    const ui = await open(manager.api, '/people', '.person-card')
    await toTable(ui, 'people-table')
    await tick(ui, 'people-table', ['Extra Person 1', 'Extra Person 2'])
    action(ui, 'Team')!.click()
    await ui.waitFor(() => dialog(ui))
    ui.type('.bulk-dialog select', team.id)
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Moved 2 of 2 people/.test(textOf(dialog(ui)!)))
    const boot = await bootstrap()
    const teamOf = (name: string) => boot.people.find((p: any) => p.name === name).teamId
    assert.deepEqual(
      [teamOf('Extra Person 1'), teamOf('Extra Person 2'), teamOf('Extra Person 3') === team.id],
      [team.id, team.id, false]
    )
    ui.click('.bulk-dialog .primary-button', 'Close')
    await ui.waitFor(() => !dialog(ui))
    ui.click('.selection-summary button', 'Clear selection')
    await tick(ui, 'people-table', ['Extra Person 3'])
    action(ui, 'Duplicate')!.click()
    await ui.waitFor(() => /Person duplicated/.test(textOf(ui.doc.querySelector('.toast-host'))))
    const copy = (await bootstrap()).people.find((p: any) => p.name === 'Copy of Extra Person 3')
    assert.equal(copy.email, '', 'an address belongs to one person')
  })

  test('deleting people with a sign-in account is refused for them and reported, and deleting the others goes ahead', async () => {
    const ui = await open(manager.api, '/people', '.person-card')
    await toTable(ui, 'people-table')
    await tick(ui, 'people-table', ['Dana Dev', 'Extra Person 3'])
    action(ui, 'Delete')!.click()
    await ui.waitFor(() => dialog(ui))
    assert.match(textOf(dialog(ui)!), /sign-in account is refused/)
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Deleted 1 of 2 people/.test(textOf(dialog(ui)!)))
    assert.match(textOf(dialog(ui)!), /sign-in account/)
    const boot = await bootstrap()
    assert.ok(boot.people.some((p: any) => p.name === 'Dana Dev'))
    assert.ok(!boot.people.some((p: any) => p.name === 'Extra Person 3'))
  })

  test('a viewer cannot change people from the table', async () => {
    const ui = await open(viewer.api, '/people', '.person-card')
    await toTable(ui, 'people-table')
    await tick(ui, 'people-table', ['Dana Dev'])
    assert.deepEqual(
      [...ui.doc.querySelectorAll('.selection-actions button')].map(b => textOf(b)),
      ['Print']
    )
  })
})

describe('alerts as a table', () => {
  test('resolving and re-opening a selection affects only that selection', async () => {
    const ui = await open(manager.api, '/alerts', '.alert-row')
    await toTable(ui, 'alerts-table')
    await tick(ui, 'alerts-table', ['Alert number 1', 'Alert number 2'])
    action(ui, 'Mark resolved')!.click()
    await ui.waitFor(() => dialog(ui))
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Resolved 2 of 2 alerts/.test(textOf(dialog(ui)!)))
    const state = async () => Object.fromEntries((await bootstrap()).alerts.map((a: any) => [a.title, a.resolved]))
    assert.deepEqual(
      [(await state())['Alert number 1'], (await state())['Alert number 2'], (await state())['Alert number 3']],
      [true, true, false]
    )
    ui.click('.bulk-dialog .primary-button', 'Close')
    await ui.waitFor(() => !dialog(ui))
    action(ui, 'Re-open')!.click()
    await ui.waitFor(() => dialog(ui))
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Re-opened 2 of 2 alerts/.test(textOf(dialog(ui)!)))
    assert.equal((await state())['Alert number 1'], false)
  })

  test('a developer can resolve alerts (as for one alert) but is not offered deleting or editing them', async () => {
    const ui = await open(developer.api, '/alerts', '.alert-row')
    await toTable(ui, 'alerts-table')
    await tick(ui, 'alerts-table', ['Alert number 3'])
    const offered = [...ui.doc.querySelectorAll('.selection-actions button')].map(b => textOf(b))
    assert.ok(offered.includes('Mark resolved') && offered.includes('Re-open'))
    assert.ok(!offered.some(label => /Delete|Edit|Duplicate/.test(label)), `unexpected: ${offered.join(', ')}`)
  })

  test('exporting selected alerts sends their ids, and the table filters and sorts like the others', async () => {
    const ui = await open(manager.api, '/alerts', '.alert-row')
    await toTable(ui, 'alerts-table')
    await tick(ui, 'alerts-table', ['Alert number 2', 'Alert number 3'])
    const ids = rows(ui, 'alerts-table')
      .filter(r => (r.querySelector('input') as HTMLInputElement).checked)
      .map(r => r.dataset.row)
    ui.click('.grid-toolbar .export-wrap > button', 'Export / print')
    await ui.waitFor(
      () => ui.doc.querySelector('.export-extent') && ui.doc.querySelector('.export-actions .secondary-button')
    )
    ui.type('.export-panel select', 'csv')
    const before = ui.downloads.length
    ui.click('.export-actions .secondary-button', 'Export')
    await ui.waitFor(() => ui.downloads.length > before)
    const sent = JSON.parse(
      ui.requests.filter(r => r.url === '/api/exports' && !JSON.parse(r.body!).preview).at(-1)!.body!
    )
    assert.deepEqual([...sent.ids].sort(), [...ids].sort())
    assert.equal(
      (await ui.downloads.at(-1)!.blob.text()).trim().split('\r\n').length,
      3,
      'a header and the two selected alerts'
    )
    // search narrows the list, and the selection does not follow records that are no longer shown
    ui.type('.grid-toolbar input[type="search"]', 'number 1')
    await ui.waitFor(() => rows(ui, 'alerts-table').length === 1)
    assert.match(bar(ui), /Nothing selected/)
  })
})
