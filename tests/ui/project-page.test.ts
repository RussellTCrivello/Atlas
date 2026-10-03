// The project page: a click on a project shows ALL of its tasks, read from the database (not from what the browser happened to
// be given at sign-in), with filters, sorting, paging, quick add, in-place status changes, and export/print that come from the
// database too. The real client bundle runs in jsdom against a real server; jsdom does not cover layout or CSS.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, textOf } from '../helpers/ui'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let viewer: Awaited<ReturnType<typeof makeUser>>
let big: any
let small: any
const uis: BootedUI[] = []
const TOTAL = 260

before(async () => {
  // The browser is only given 200 tasks at sign-in; the project has 260, so showing all of them proves the page asks the database.
  server = await launch({ env: { ATLAS_BOOTSTRAP_TASK_LIMIT: '200' } })
  admin = await setupAdmin(server)
  manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
  big = (
    await manager.api.post('/api/projects', {
      name: 'Payments platform',
      code: 'PAY',
      description: 'Everything about payments'
    })
  ).body
  small = (await manager.api.post('/api/projects', { name: 'Search', code: 'SRC' })).body
  const person = (await admin.get('/api/bootstrap')).body.people.find((p: any) => p.name === 'Mia Manager').id
  server.db.transaction(() => {
    for (let i = 1; i <= TOTAL; i++)
      server.db.run(
        'INSERT INTO tasks(key, title, project_id, assignee_id, priority, due_date, status, blocked, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          `PAY-${String(i).padStart(3, '0')}`,
          i === 77 ? 'The zebra migration' : `Payments task ${i}`,
          big.numericId,
          i % 5 === 0 ? null : person,
          ['High', 'Medium', 'Low'][i % 3],
          i % 10 === 0 ? '2020-01-01' : '2031-01-01',
          i % 4 === 0 ? 'Done' : i % 4 === 1 ? 'To do' : i % 4 === 2 ? 'In progress' : 'Review',
          i % 25 === 0 ? 1 : 0,
          '2026-01-01'
        ]
      )
  })
  await manager.api.post('/api/tasks', { title: 'Only task of search', projectId: small.numericId })
})
after(async () => {
  uis.forEach(ui => ui.close())
  await server.cleanup()
})

async function open(api: Api, hash: string, ready: string) {
  const ui = await bootUI({ base: server.url, cookie: api.cookie, hash })
  uis.push(ui)
  await ui.waitFor(() => ui.doc.querySelector(ready))
  return ui
}
const rows = (ui: BootedUI) => [...ui.doc.querySelectorAll('.project-tasks-table tbody tr[data-row]')]
const meta = (ui: BootedUI) => textOf(ui.doc.querySelector('.table-pager .results-meta'))
const tile = (ui: BootedUI, label: string) =>
  [...ui.doc.querySelectorAll('.kpi-tile')].find(el => textOf(el).startsWith(label))!
const settled = async (ui: BootedUI, check: () => unknown) => ui.waitFor(check)

describe('a project is a link to its page', () => {
  test('every card links to #/projects/<id>, and the link is named after the project', async () => {
    const ui = await open(manager.api, '/projects', '.project-card')
    const links = [...ui.doc.querySelectorAll('.project-card a.project-card-link')] as HTMLAnchorElement[]
    assert.equal(links.length, 2)
    const pay = links.find(link => link.textContent === 'Payments platform')!
    assert.equal(pay.getAttribute('href'), `#/projects/${big.numericId}`)
    assert.match(pay.getAttribute('aria-label')!, /Payments platform/)
  })

  test('following it shows every task of that project, found by the database, 50 to a page', async () => {
    const ui = await open(manager.api, '/projects', '.project-card')
    const bootstrapped = (await manager.api.get('/api/bootstrap')).body
    assert.equal(bootstrapped.tasks.length, 200, 'the browser was given only a working set…')
    assert.equal(bootstrapped.taskStats.total, TOTAL + 1)
    assert.equal(bootstrapped.taskStats.truncated, true)
    ui.click('.project-card-link', 'Payments platform')
    await ui.waitFor(() => ui.doc.querySelector('.project-page .project-tasks-table tbody tr[data-row]'))
    assert.equal(textOf(ui.doc.querySelector('.project-hero h1')), 'Payments platform')
    assert.equal(textOf(ui.doc.querySelector('.project-code-chip')), 'PAY')
    assert.equal(rows(ui).length, 50)
    assert.match(meta(ui), new RegExp(`Showing 1–50 of ${TOTAL} tasks`), '…but the page shows all of them')
    assert.equal(textOf(tile(ui, 'All tasks').querySelector('strong')), String(TOTAL))
    assert.equal(ui.w.location.hash, `#/projects/${big.numericId}`, 'the address is shareable')
    ui.click('.table-pager button', 'Next')
    await settled(ui, () => /Showing 51–100/.test(meta(ui)))
    assert.equal(rows(ui).length, 50)
    // the last page
    for (let page = 3; page <= 6; page++) {
      ui.click('.table-pager button', 'Next')
      await settled(ui, () => new RegExp(`Showing ${(page - 1) * 50 + 1}–`).test(meta(ui)))
    }
    await settled(ui, () => new RegExp(`Showing 251–${TOTAL} of ${TOTAL}`).test(meta(ui)))
    assert.equal(rows(ui).length, TOTAL - 250)
    assert.ok(
      (ui.doc.querySelector('.table-pager button:last-of-type') as HTMLButtonElement).disabled,
      'no page after the last'
    )
    assert.deepEqual(ui.errors, [])
  })

  test('opening the address directly works too, and another project shows only its own tasks', async () => {
    const ui = await open(manager.api, `/projects/${small.numericId}`, '.project-tasks-table tbody tr[data-row]')
    assert.deepEqual(
      rows(ui).map(row => textOf(row.querySelector('.task-title-cell'))),
      ['Only task of search']
    )
    assert.match(meta(ui), /Showing 1–1 of 1 tasks/)
  })

  test('an unknown project says so, and the way back works', async () => {
    const ui = await open(manager.api, '/projects/999999', '.empty-state, .empty')
    assert.match(textOf(ui.doc.querySelector('.page-content')), /Project not found/)
    ui.click('.page-content button', 'Back to projects')
    await ui.waitFor(() => ui.doc.querySelector('.project-card'))
    assert.equal(ui.w.location.hash, '#/projects')
  })

  test('the breadcrumb leads back to the list', async () => {
    const ui = await open(manager.api, `/projects/${big.numericId}`, '.breadcrumb a')
    ui.click('.breadcrumb a')
    await ui.waitFor(() => ui.doc.querySelector('.project-card'))
    assert.equal(ui.doc.querySelector('.project-page'), null)
  })
})

describe('filters, sorting and numbers are answered by the server', () => {
  test('the numbers on top are clickable filters: overdue shows exactly the overdue tasks', async () => {
    const ui = await open(manager.api, `/projects/${big.numericId}`, '.project-tasks-table tbody tr[data-row]')
    const overdue = Math.floor(TOTAL / 10) - Math.floor(TOTAL / 40) // every 10th, except the ones that are Done (every 4th: 20, 40…)
    ui.click('.kpi-tile', 'Overdue')
    await settled(ui, () => /of \d+ tasks/.test(meta(ui)) && !new RegExp(`of ${TOTAL} tasks`).test(meta(ui)))
    assert.ok(
      ui.requests.some(r => /scope=overdue/.test(r.url)),
      'asked the server for overdue tasks'
    )
    const shown = rows(ui)
    assert.ok(shown.length > 0 && shown.every(row => /due-overdue/.test(row.querySelector('.task-due')!.className)))
    const total = Number(/of (\d+) tasks/.exec(meta(ui))![1])
    assert.ok(total > 0 && total <= overdue, `${total} overdue`)
    assert.equal(tile(ui, 'Overdue').getAttribute('aria-pressed'), 'true')
    ui.click('.kpi-tile', 'All tasks')
    await settled(ui, () => new RegExp(`of ${TOTAL} tasks`).test(meta(ui)))
  })

  test('search finds a task anywhere in the project, whatever page it would have been on', async () => {
    const ui = await open(manager.api, `/projects/${big.numericId}`, '.project-tasks-table tbody tr[data-row]')
    ui.type('input[aria-label="Search this project"]', 'zebra')
    await settled(ui, () => rows(ui).length === 1)
    assert.equal(textOf(rows(ui)[0].querySelector('.task-title-cell')), 'The zebra migration')
    assert.match(meta(ui), /Showing 1–1 of 1 tasks/)
    assert.ok(ui.requests.some(r => /q=zebra/.test(r.url)))
  })

  test('a status segment filters, and the filter can be cleared', async () => {
    const ui = await open(manager.api, `/projects/${big.numericId}`, '.status-segment')
    const done = [...ui.doc.querySelectorAll('.status-segment')].find(el => textOf(el).startsWith('Done'))!
    const count = Number(textOf(done.querySelector('strong')))
    assert.equal(count, Math.floor(TOTAL / 4))
    ui.click('.status-segment', 'Done')
    await settled(ui, () => new RegExp(`of ${count} tasks`).test(meta(ui)))
    assert.ok(rows(ui).every(row => (row.querySelector('select') as HTMLSelectElement).value === 'Done'))
    ui.click('.grid-toolbar .text-button', 'Clear filters')
    await settled(ui, () => new RegExp(`of ${TOTAL} tasks`).test(meta(ui)))
  })

  test('columns sort on the server and say which way (aria-sort)', async () => {
    const ui = await open(manager.api, `/projects/${big.numericId}`, '.project-tasks-table tbody tr[data-row]')
    const sortBy = (label: string) =>
      [...ui.doc.querySelectorAll('.sort-button')]
        .find(button => textOf(button).replace(/[▲▼]/g, '').trim() === label)!
        .dispatchEvent(new ui.w.MouseEvent('click', { bubbles: true, cancelable: true }))
    sortBy('Task')
    await settled(
      ui,
      () =>
        ui.doc.querySelector('th[aria-sort="ascending"]') &&
        ui.fetchLog.some(line => /sort=title%3Aasc.*200/.test(line))
    )
    await ui.settle(250)
    const titles = rows(ui).map(row => textOf(row.querySelector('.task-title-cell')))
    assert.deepEqual(
      titles,
      [...titles].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    )
    sortBy('Task')
    await settled(ui, () => ui.doc.querySelector('th[aria-sort="descending"]'))
    assert.ok(ui.requests.some(r => /sort=title%3Adesc/.test(r.url)))
  })

  test('filtering by owner uses the people who work on the project', async () => {
    const ui = await open(manager.api, `/projects/${big.numericId}`, '.project-tasks-table tbody tr[data-row]')
    ui.click('.grid-toolbar button', 'Column filters')
    await ui.waitFor(() => ui.doc.querySelector('.filter-row'))
    ui.click('.filter-row .pick-button[aria-label^="Filter Owner"]')
    const unassigned = (await ui.waitFor(() =>
      [...ui.doc.querySelectorAll('.pick-list label')].find(el => textOf(el) === 'Unassigned')
    )) as HTMLElement
    ;(unassigned.querySelector('input') as HTMLInputElement).click()
    await settled(ui, () => new RegExp(`of ${TOTAL / 5} tasks`).test(meta(ui)))
    assert.ok(rows(ui).every(row => /Unassigned/.test(textOf(row.querySelector('.owner-cell')))))
  })
})

describe('working on the project from its page', () => {
  test('adding a task there puts it in this project, immediately', async () => {
    const ui = await open(manager.api, `/projects/${small.numericId}`, '.project-tasks-table tbody tr[data-row]')
    ui.type('.quick-add input', 'Write the release notes')
    ui.click('.quick-add button')
    await settled(ui, () => rows(ui).length === 2)
    assert.ok(rows(ui).some(row => textOf(row).includes('Write the release notes')))
    const created = (await manager.api.get(`/api/projects/${small.numericId}/tasks?q=release`)).body.rows[0]
    assert.equal(created.projectId, small.numericId)
    assert.equal(created.status, 'To do')
  })

  test('a status can be changed in the table, and the change is recorded', async () => {
    const ui = await open(manager.api, `/projects/${small.numericId}`, '.project-tasks-table tbody tr[data-row]')
    const select = ui.doc.querySelector('.project-tasks-table select') as HTMLSelectElement
    const id = select.closest('tr')!.getAttribute('data-row')
    ui.type('.project-tasks-table select', 'In progress')
    await settled(ui, () => ui.requests.some(r => r.method === 'PATCH' && r.url === `/api/tasks/${id}/status`))
    await ui.settle(300)
    const moved = (await manager.api.get(`/api/projects/${small.numericId}/tasks`)).body.rows.find(
      (t: any) => String(t.numericId) === id
    )
    assert.equal(moved.status, 'In progress')
  })

  test('someone who may only read sees the tasks but cannot add or move anything', async () => {
    const ui = await open(viewer.api, `/projects/${small.numericId}`, '.project-tasks-table tbody tr[data-row]')
    assert.equal(ui.doc.querySelector('.quick-add'), null)
    assert.equal(ui.doc.querySelector('.project-tasks-table select'), null)
    assert.equal(ui.doc.querySelector('.project-hero-actions .primary-button'), null, 'no "Add task"')
    assert.ok(rows(ui).length >= 1)
  })

  test('the side panels show people, milestones and recent activity of this project only', async () => {
    await manager.api.post('/api/milestones', { name: 'Launch', projectId: small.numericId, dueDate: '2031-05-01' })
    const ui = await open(manager.api, `/projects/${small.numericId}`, '.project-side')
    const side = textOf(ui.doc.querySelector('.project-side'))
    assert.match(side, /Launch/)
    assert.match(side, /Mia Manager/)
    assert.doesNotMatch(side, /Payments task/)
  })
})

describe('exporting and printing a project come from the database', () => {
  const exportCsv = async (ui: BootedUI) => {
    ui.click('.export-wrap > button', 'Export / print')
    await ui.waitFor(() => ui.doc.querySelector('.export-actions .secondary-button')) // the panel is ready once the formats are known
    ui.type('.export-panel select', 'csv')
    ui.click('.export-actions .secondary-button')
    await ui.waitFor(() => ui.downloads.length > 0)
    return ui.downloads.at(-1)!.blob.text()
  }

  test("the tasks export holds exactly this project's tasks, all of them, whatever page is showing", async () => {
    const ui = await open(manager.api, `/projects/${big.numericId}`, '.project-tasks-table tbody tr[data-row]')
    const text = await exportCsv(ui)
    const lines = text.split('\r\n')
    assert.equal(lines.length, TOTAL + 1, 'every task, not the 50 on screen')
    assert.ok(lines.slice(1).every(line => line.includes('Payments platform')))
    const request = ui.requests.find(r => r.url === '/api/exports' && !JSON.parse(r.body!).preview)!
    assert.equal(
      new URLSearchParams(JSON.parse(request.body!).grid).get('project'),
      String(big.numericId),
      'scoped to this project'
    )
  })

  test('Print opens a preview of a document the server built; the interface is not printed', async () => {
    const ui = await open(manager.api, `/projects/${small.numericId}`, '.project-tasks-table tbody tr[data-row]')
    const printed: string[] = []
    ui.w.print = () => printed.push('window')
    ui.click('.export-wrap > button', 'Export / print')
    await ui.waitFor(() => ui.doc.querySelector('.export-actions .primary-button'))
    ui.click('.export-actions .primary-button', 'Print')
    const frame = (await ui.waitFor(() => ui.doc.querySelector('.print-preview iframe'))) as HTMLIFrameElement
    const html = frame.getAttribute('srcdoc')!
    assert.match(html, /<table>/)
    assert.match(html, /Only task of search/)
    assert.equal(frame.getAttribute('sandbox'), 'allow-same-origin allow-modals')
    assert.ok(!html.includes('id="root"'), 'nothing of the application is in the printed document')
    assert.deepEqual(printed, [], 'window.print() (which would print the screen) was never called')
    ui.click('.print-preview-bar .secondary-button', 'Close')
    await ui.waitFor(() => !ui.doc.querySelector('.print-preview'))
  })

  test("Ctrl+P prints the page's report instead of the screen", async () => {
    const ui = await open(manager.api, `/projects/${small.numericId}`, '.project-tasks-table tbody tr[data-row]')
    const printed: string[] = []
    ui.w.print = () => printed.push('window')
    await ui.settle(300) // the export menu registers itself as the page's printer
    const event = new ui.w.KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true })
    ui.doc.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true, "the browser's own print is cancelled")
    const frame = (await ui.waitFor(() => ui.doc.querySelector('.print-preview iframe'))) as HTMLIFrameElement
    assert.match(frame.getAttribute('srcdoc')!, /Only task of search|Search/)
    assert.deepEqual(printed, [])
  })

  test('on a page with nothing to print, Ctrl+P prints the workspace summary', async () => {
    const ui = await open(manager.api, '/overview', '.stat-card')
    const event = new ui.w.KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true })
    ui.doc.dispatchEvent(event)
    assert.equal(event.defaultPrevented, true)
    const frame = (await ui.waitFor(() => ui.doc.querySelector('.print-preview iframe'))) as HTMLIFrameElement
    assert.match(frame.getAttribute('srcdoc')!, /Workspace summary/)
  })
})
