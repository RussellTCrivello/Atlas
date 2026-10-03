// The longer flows around the task grid: importing a file, exporting and printing exactly what is selected, the record panel, the
// My work list, and accessibility of every dialog the grid opens. This file has its own server and data so that it does not depend on
// what the other grid tests changed.
import assert from 'node:assert/strict'
import axe from 'axe-core'
import { after, before, describe, test } from 'node:test'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, textOf } from '../helpers/ui'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let developer: Awaited<ReturnType<typeof makeUser>>
let viewer: Awaited<ReturnType<typeof makeUser>>
let project: any
let danaPerson: string
let miaPerson: string
const uis: BootedUI[] = []
const ROWS = '.project-tasks-table tbody tr[data-row]'

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  developer = await makeUser(server, admin, 'Developer', 'Dana Dev')
  viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
  const people = (await admin.get('/api/bootstrap')).body.people
  miaPerson = people.find((p: any) => p.name === 'Mia Manager').id
  danaPerson = people.find((p: any) => p.name === 'Dana Dev').id
  project = (await manager.api.post('/api/projects', { name: 'Flow project', code: 'FLW' })).body
  for (let i = 1; i <= 12; i++)
    await manager.api.post('/api/tasks', {
      title: `Flow task ${String(i).padStart(2, '0')}`,
      projectId: project.numericId,
      assigneeId: i % 2 ? danaPerson : miaPerson,
      dueDate: `2031-03-${String(i).padStart(2, '0')}`
    })
})
after(async () => {
  uis.forEach(ui => ui.close())
  await server.cleanup()
})

async function open(api: Api, hash = `/projects/${project.numericId}`, ready = ROWS) {
  const ui = await bootUI({ base: server.url, cookie: api.cookie, hash })
  uis.push(ui)
  await ui.waitFor(() => ui.doc.querySelector(ready), 15000)
  return ui
}
const rows = (ui: BootedUI) => [...ui.doc.querySelectorAll(ROWS)] as HTMLElement[]
const box = (ui: BootedUI, index: number) => rows(ui)[index].querySelector('input[type="checkbox"]') as HTMLInputElement
const bar = (ui: BootedUI) => textOf(ui.doc.querySelector('.selection-bar'))
const action = (ui: BootedUI, label: string) =>
  [...ui.doc.querySelectorAll('.selection-actions button')].find(b => textOf(b).startsWith(label)) as
    HTMLButtonElement | undefined
const count = async () => (await admin.get(`/api/tasks/ids?project=${project.numericId}`)).body.total as number
const toasts = (ui: BootedUI) => textOf(ui.doc.querySelector('.toast-host'))
/** The record panel is open and has loaded its task (while loading, its heading is the placeholder "Task"). */
const drawerReady = (ui: BootedUI) =>
  ui.waitFor(() => {
    const heading = ui.doc.querySelector('.record-drawer h2')
    return heading && heading.textContent !== 'Task' ? heading : null
  })
const requestsTo = (ui: BootedUI, url: string) => ui.requests.filter(r => r.url === url)

describe('importing a CSV file', () => {
  const paste = (ui: BootedUI, csv: string) => ui.type('.import-dialog textarea', csv)
  const importButton = (ui: BootedUI) =>
    [...ui.doc.querySelectorAll('.import-dialog .modal-foot button')].find(b =>
      /^Import/.test(textOf(b))
    ) as HTMLButtonElement
  const checkButton = (ui: BootedUI) =>
    [...ui.doc.querySelectorAll('.import-dialog .modal-foot button')].find(b =>
      /^Check/.test(textOf(b))
    ) as HTMLButtonElement

  test('checking a file creates nothing; problems are listed by row; Import waits until they are dealt with', async () => {
    const ui = await open(manager.api)
    const before = await count()
    action(ui, 'Import CSV')!.click()
    await ui.waitFor(() => ui.doc.querySelector('.import-dialog'))
    assert.equal(importButton(ui).disabled, true, 'nothing to import before a file has been checked')
    paste(ui, 'Title,Priority,Due date\nImported good,High,2031-05-01\nImported bad,Whenever,31/12/2031')
    ui.type('.import-dialog select', String(project.numericId)) // the project for rows that do not name one
    checkButton(ui).click()
    await ui.waitFor(() => ui.doc.querySelector('.import-report'))
    const report = textOf(ui.doc.querySelector('.import-report'))
    assert.match(report, /2 rows/)
    assert.match(report, /1 ready to import/)
    assert.match(report, /1 with problems/)
    assert.match(report, /Row 3/)
    assert.match(report, /"Whenever" is not a priority/)
    assert.equal(await count(), before, 'checking created nothing')
    assert.equal(importButton(ui).disabled, true, 'a file with problems is not imported by accident')
    ;(ui.doc.querySelector('.import-dialog input[type="checkbox"]') as HTMLInputElement).click()
    await ui.waitFor(() => importButton(ui).disabled === false)
    assert.match(textOf(importButton(ui)), /Import 1 tasks/)
    importButton(ui).click()
    await ui.waitFor(() => /1 tasks imported/.test(textOf(ui.doc.querySelector('.import-dialog'))))
    assert.equal(await count(), before + 1)
    assert.match(textOf(ui.doc.querySelector('.import-dialog')), /1 rows with problems/)
    ui.click('.import-dialog .primary-button', 'Close')
    await ui.waitFor(() => !ui.doc.querySelector('.import-dialog'))
    await ui.waitFor(() => rows(ui).some(row => /Imported good/.test(textOf(row))))
  })

  test('a column that was not recognised can be pointed at its field, and the check runs again by itself', async () => {
    const ui = await open(manager.api)
    action(ui, 'Import CSV')!.click()
    await ui.waitFor(() => ui.doc.querySelector('.import-dialog'))
    ui.type('.import-dialog select', String(project.numericId))
    paste(ui, 'What\nMapped by hand title')
    checkButton(ui).click()
    await ui.waitFor(() =>
      /No column holds the task title/.test(textOf(ui.doc.querySelector('.import-dialog .form-error')))
    )
    assert.equal(ui.doc.querySelector('.import-report'), null, 'there is nothing to map until the file can be read')
    // a file that is readable shows the mapping table; one column is deliberately ignored
    paste(ui, 'Title,Notes\nMapping demo,not a task field')
    checkButton(ui).click()
    await ui.waitFor(() => ui.doc.querySelector('.mapping-table'))
    const notes = ui.doc.querySelector('.mapping-table select[aria-label*="Notes"]') as HTMLSelectElement
    assert.equal(notes.value, 'ignore', 'an unknown column is ignored unless the person says otherwise')
    ui.type('.mapping-table select[aria-label*="Notes"]', 'tags')
    await ui.waitFor(
      () =>
        /Tags/.test(textOf(ui.doc.querySelector('.import-dialog'))) && requestsTo(ui, '/api/tasks/import').length >= 3
    )
    const sent = JSON.parse(requestsTo(ui, '/api/tasks/import').at(-1)!.body!)
    assert.deepEqual(sent.mapping, { Notes: 'tags' })
    assert.equal(sent.dryRun, true, 'every re-check is a dry run')
  })

  test('a file that already exists is skipped by default, and the dialog says how many', async () => {
    const ui = await open(manager.api)
    action(ui, 'Import CSV')!.click()
    await ui.waitFor(() => ui.doc.querySelector('.import-dialog'))
    ui.type('.import-dialog select', String(project.numericId))
    paste(ui, 'Title\nFlow task 01\nFlow task 02\nBrand new one')
    checkButton(ui).click()
    await ui.waitFor(() => ui.doc.querySelector('.import-report'))
    assert.match(textOf(ui.doc.querySelector('.import-report')), /2 already exist/)
    assert.match(textOf(importButton(ui)), /Import 1 tasks/)
  })

  test('a viewer is not offered the import', async () => {
    const ui = await open(viewer.api)
    assert.equal(action(ui, 'Import CSV'), undefined)
  })
})

describe('exporting and printing exactly what is selected, filtered, or everything', () => {
  const exportPanel = (ui: BootedUI) => ui.doc.querySelector('.export-panel') as HTMLElement
  const extentLabels = (ui: BootedUI) => [...ui.doc.querySelectorAll('.export-extent label')].map(l => textOf(l))
  const exportRequest = (ui: BootedUI) =>
    JSON.parse(ui.requests.filter(r => r.url === '/api/exports' && !JSON.parse(r.body!).preview).at(-1)!.body!)
  const openPanel = async (ui: BootedUI) => {
    ui.click('.grid-toolbar .export-wrap > button', 'Export / print')
    // the panel is ready once the server has said which formats this person may use
    await ui.waitFor(
      () =>
        exportPanel(ui) &&
        ui.doc.querySelector('.export-extent') &&
        ui.doc.querySelector('.export-actions .secondary-button')
    )
  }
  const download = async (ui: BootedUI) => {
    const before = ui.downloads.length
    ui.click('.export-actions .secondary-button', 'Export')
    await ui.waitFor(() => ui.downloads.length > before)
    return ui.downloads.at(-1)!.blob.text()
  }

  test('with rows selected, "Selected rows" is offered first and the file holds only those', async () => {
    const ui = await open(manager.api)
    box(ui, 1).click()
    box(ui, 3).click()
    box(ui, 5).click()
    await ui.waitFor(() => /3 selected/.test(bar(ui)))
    const ids = [1, 3, 5].map(i => Number(rows(ui)[i].dataset.row))
    await openPanel(ui)
    assert.match(extentLabels(ui)[0], /Selected rows \(3\)/)
    assert.equal(
      (ui.doc.querySelector('.export-extent input[type="radio"]') as HTMLInputElement).checked,
      true,
      'it starts on the selection'
    )
    assert.match(extentLabels(ui).join(' | '), /Filtered rows/)
    assert.match(extentLabels(ui).join(' | '), /Entire dataset/)
    ui.type('.export-panel select', 'csv')
    const text = await download(ui)
    assert.equal(text.trim().split('\r\n').length, 4, 'a header and exactly the three selected rows')
    const request = exportRequest(ui)
    assert.deepEqual([...request.ids].sort(), [...ids].sort())
    assert.ok(
      !('grid' in request) && !('scope' in request),
      'a selection is exactly its ids, not a filter that happens to match'
    )
  })

  test('"Filtered rows" is the grid\'s own query and "Entire dataset" ignores it; the three are distinguished in what is sent', async () => {
    const ui = await open(manager.api)
    ui.type('.grid-toolbar input[type="search"]', 'task 07')
    await ui.waitFor(() => /of 1 tasks/.test(textOf(ui.doc.querySelector('.grid-pager .results-meta'))))
    await openPanel(ui)
    assert.equal(extentLabels(ui).length, 2, 'nothing selected: only filtered and entire dataset are offered')
    assert.match(extentLabels(ui)[0], /Filtered rows \(1\)/)
    ui.type('.export-panel select', 'csv')
    const filtered = await download(ui)
    assert.equal(filtered.trim().split('\r\n').length, 2)
    assert.equal(new URLSearchParams(exportRequest(ui).grid).get('q'), 'task 07')
    const all = ui.doc.querySelectorAll('.export-extent input[type="radio"]')[1] as HTMLInputElement
    all.click()
    await ui.waitFor(
      () => (ui.doc.querySelectorAll('.export-extent input[type="radio"]')[1] as HTMLInputElement).checked
    )
    const everything = await download(ui)
    assert.ok(everything.trim().split('\r\n').length > 10, 'every task of the project, not the one that was found')
    const request = exportRequest(ui)
    assert.ok(!('grid' in request) && !('ids' in request) && !('q' in request), 'no filter, no search, no selection')
    assert.equal(request.scope.projectId, project.numericId, 'but still this project: that is what the dataset is here')
  })

  test('printing the selection builds a document from the database that says it is a selection', async () => {
    const ui = await open(manager.api)
    box(ui, 0).click()
    box(ui, 1).click()
    await ui.waitFor(() => /2 selected/.test(bar(ui)))
    action(ui, 'Print')!.click()
    const frame = (await ui.waitFor(() => ui.doc.querySelector('.print-preview iframe'))) as HTMLIFrameElement
    const sent = JSON.parse(ui.requests.filter(r => r.url === '/api/exports').at(-1)!.body!)
    assert.equal(sent.format, 'print')
    assert.equal(sent.ids.length, 2)
    assert.match(
      frame.getAttribute('srcdoc') || '',
      /Selected records: 2/,
      'the printout states that it holds a selection and how many rows'
    )
  })
})

describe('the record panel', () => {
  test('it duplicates, steps through the list, and deleting from it asks first and can be undone', async () => {
    const ui = await open(manager.api)
    const first = Number(rows(ui)[0].dataset.row)
    const second = Number(rows(ui)[1].dataset.row)
    rows(ui)[0]
      .querySelector('td:nth-child(3)')!
      .dispatchEvent(new ui.w.MouseEvent('click', { bubbles: true, cancelable: true }))
    await drawerReady(ui)
    const heading = () => textOf(ui.doc.querySelector('.record-drawer h2'))
    const firstTitle = heading()
    ;(ui.doc.querySelector('.drawer-nav button[aria-label^="Next task"]') as HTMLElement).click()
    await ui.waitFor(() => heading() !== firstTitle && heading() !== 'Task')
    assert.equal((await admin.get(`/api/tasks/${second}`)).body.task.title, heading())
    ;(ui.doc.querySelector('.drawer-nav button[aria-label^="Previous task"]') as HTMLElement).click()
    await ui.waitFor(() => heading() === firstTitle)
    const before = await count()
    ui.click('.drawer-foot button', 'Duplicate')
    await ui.waitFor(() => /Task duplicated/.test(toasts(ui)))
    assert.equal(await count(), before + 1)
    const copy = (
      await admin.get(`/api/tasks/ids?project=${project.numericId}&q=${encodeURIComponent(`Copy of ${firstTitle}`)}`)
    ).body
    assert.equal(copy.total, 1)
    ui.click('.drawer-foot button', 'Delete')
    const ask = (await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))) as HTMLElement
    assert.ok(
      textOf(ask).includes(firstTitle),
      `the confirmation names the task “${firstTitle}”, but says: ${textOf(ask)}`
    )
    ui.click('[role="alertdialog"] button', 'Delete task')
    await ui.waitFor(() => ui.doc.querySelector('.toast-action'))
    assert.equal((await admin.get(`/api/tasks/${first}`)).status, 404)
    assert.equal(ui.doc.querySelector('.record-drawer'), null, 'the panel closes when its record is gone')
    ;(ui.doc.querySelector('.toast-action') as HTMLElement).click()
    await ui.waitFor(() => /Task restored/.test(toasts(ui)))
    assert.equal((await admin.get(`/api/tasks/${first}`)).status, 200)
    // tidy the copy so later tests see the original twelve
    await manager.api.delete(`/api/tasks/${copy.ids[0]}`)
  })

  test('someone who may not change things sees the record and can print it, nothing else', async () => {
    const ui = await open(viewer.api)
    rows(ui)[0]
      .querySelector('td:nth-child(3)')!
      .dispatchEvent(new ui.w.MouseEvent('click', { bubbles: true, cancelable: true }))
    await drawerReady(ui)
    const buttons = [...ui.doc.querySelectorAll('.drawer-foot button')].map(b => textOf(b))
    assert.deepEqual(buttons, ['Print'])
  })
})

describe('"My work" uses the same grid in its list view', () => {
  test('the list is the signed-in person\'s tasks until "Everyone" is chosen, and the board is still there', async () => {
    const ui = await open(developer.api, '/tasks', '.board')
    ui.click('.view-toggle button', 'List')
    await ui.waitFor(() => ui.doc.querySelector('.task-table-panel tbody tr[data-row]'))
    assert.equal(ui.doc.querySelector('.board'), null)
    const mine = ui.requests.filter(r => /^\/api\/tasks\?/.test(r.url)).at(-1)!
    assert.equal(new URLSearchParams(mine.url.split('?')[1]).get('assignee'), 'me')
    await ui.waitFor(() => ui.doc.querySelectorAll('.task-table-panel tbody tr[data-row]').length === 6)
    ui.click('[aria-label="Whose tasks"] button', 'Everyone')
    await ui.waitFor(() => ui.doc.querySelectorAll('.task-table-panel tbody tr[data-row]').length > 6)
    const everyone = ui.requests.filter(r => /^\/api\/tasks\?/.test(r.url)).at(-1)!
    assert.equal(new URLSearchParams(everyone.url.split('?')[1]).get('assignee'), null)
    ui.click('.view-toggle button', 'Board')
    await ui.waitFor(() => ui.doc.querySelector('.board'))
  })
})

describe('every dialog the grid opens passes the automated accessibility rules', () => {
  async function violations(ui: BootedUI): Promise<string[]> {
    ui.w.eval(axe.source)
    const results = await ui.w.axe.run(ui.doc, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false }, 'document-title': { enabled: false } }
    })
    return [...results.violations].map(
      (v: any) =>
        `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}) e.g. ${v.nodes
          .slice(0, 2)
          .map((n: any) => n.target.join(' '))
          .join(' | ')}`
    )
  }
  test('the grid with a selection, the filter row, the columns menu and the views menu', async () => {
    const ui = await open(manager.api)
    box(ui, 0).click()
    box(ui, 1).click()
    await ui.waitFor(() => /2 selected/.test(bar(ui)))
    ui.click('.grid-toolbar button', 'Column filters')
    ui.click('.menu-wrap > button', 'Columns')
    await ui.waitFor(() => ui.doc.querySelector('.column-list'))
    assert.deepEqual(await violations(ui), [])
    ui.click('.menu-wrap > button', 'Views')
    await ui.waitFor(() => ui.doc.querySelector('.views-panel'))
    assert.deepEqual(await violations(ui), [])
  })
  test('the bulk dialog (form, then report), the confirmation, the import dialog and the record panel', async () => {
    const ui = await open(manager.api)
    box(ui, 0).click()
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    action(ui, 'Status')!.click()
    await ui.waitFor(() => ui.doc.querySelector('.bulk-dialog'))
    assert.deepEqual(await violations(ui), [], 'bulk form')
    ui.click('.bulk-dialog .secondary-button', 'Cancel')
    await ui.waitFor(() => !ui.doc.querySelector('.bulk-dialog'))
    action(ui, 'Delete')!.click()
    await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))
    assert.deepEqual(await violations(ui), [], 'confirmation')
    ui.click('[role="alertdialog"] button', 'Cancel')
    await ui.waitFor(() => !ui.doc.querySelector('[role="alertdialog"]'))
    action(ui, 'Import CSV')!.click()
    await ui.waitFor(() => ui.doc.querySelector('.import-dialog'))
    ui.type('.import-dialog textarea', 'Title\nAccessibility check')
    ui.type('.import-dialog select', String(project.numericId))
    ;[...ui.doc.querySelectorAll('.import-dialog .modal-foot button')]
      .find(b => /^Check/.test(textOf(b)))!
      .dispatchEvent(new ui.w.MouseEvent('click', { bubbles: true }))
    await ui.waitFor(() => ui.doc.querySelector('.import-report'))
    assert.deepEqual(await violations(ui), [], 'import dialog with its report')
    ui.click('.import-dialog .secondary-button', 'Cancel')
    await ui.waitFor(() => !ui.doc.querySelector('.import-dialog'))
    action(ui, 'Open')!.click()
    await drawerReady(ui)
    assert.deepEqual(await violations(ui), [], 'record panel')
  })
})
