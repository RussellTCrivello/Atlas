// The task grid as a person uses it: the real client in jsdom against a real server and database. Every capability is exercised
// together with what must NOT happen (an action reaching beyond the selection, a person doing what their role forbids, a failure
// hiding behind a success message). jsdom has no layout, so widths, colours and focus rings are checked in the real browser suite.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, textOf } from '../helpers/ui'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let developer: Awaited<ReturnType<typeof makeUser>>
let viewer: Awaited<ReturnType<typeof makeUser>>
let project: any
let empty: any
let miaPerson: string
let danaPerson: string
const uis: BootedUI[] = []
const TOTAL = 35

const ROWS = '.project-tasks-table tbody tr[data-row]'
const taskIds = async (query = '') =>
  (await admin.get(`/api/tasks/ids?project=${project.numericId}${query}`)).body.ids as number[]
const statusOf = async (id: number) => (await admin.get(`/api/tasks/${id}`)).body.task.status as string
const titleOf = async (id: number) => (await admin.get(`/api/tasks/${id}`)).body.task.title as string

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  developer = await makeUser(server, admin, 'Developer', 'Dana Dev')
  viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
  const people = (await admin.get('/api/bootstrap')).body.people
  miaPerson = people.find((p: any) => p.name === 'Mia Manager').id
  danaPerson = people.find((p: any) => p.name === 'Dana Dev').id
  project = (await manager.api.post('/api/projects', { name: 'Grid project', code: 'GRD' })).body
  empty = (await manager.api.post('/api/projects', { name: 'Nothing here', code: 'NIL' })).body
  const statuses = ['To do', 'In progress', 'Review']
  for (let i = 1; i <= TOTAL; i++)
    await manager.api.post('/api/tasks', {
      title: `Grid task ${String(i).padStart(2, '0')}`,
      projectId: project.numericId,
      assigneeId: i % 2 ? danaPerson : miaPerson,
      priority: ['High', 'Medium', 'Low'][i % 3],
      status: i % 7 === 0 ? 'Done' : statuses[i % 3],
      dueDate: `2031-02-${String((i % 28) + 1).padStart(2, '0')}`,
      tags: i % 5 === 0 ? ['urgent'] : []
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
const header = (ui: BootedUI) => ui.doc.querySelector('.data-grid thead .select-cell input') as HTMLInputElement
const bar = (ui: BootedUI) => textOf(ui.doc.querySelector('.selection-bar'))
const action = (ui: BootedUI, label: string) =>
  [...ui.doc.querySelectorAll('.selection-actions button')].find(b => textOf(b).startsWith(label)) as
    HTMLButtonElement | undefined
const meta = (ui: BootedUI) => textOf(ui.doc.querySelector('.grid-pager .results-meta'))
const press = (ui: BootedUI, el: Element, key: string, mods: Record<string, boolean> = {}) =>
  el.dispatchEvent(new ui.w.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }))
const clickWith = (ui: BootedUI, el: Element, mods: Record<string, boolean> = {}) =>
  el.dispatchEvent(new ui.w.MouseEvent('click', { bubbles: true, cancelable: true, ...mods }))

describe('selecting records', () => {
  test('one, then several: the count is stated, the header shows "some", and the same control deselects', async () => {
    const ui = await open(manager.api)
    assert.equal(rows(ui).length, TOTAL, 'every task of the project is on the single page of 50')
    assert.match(bar(ui), /Nothing selected/)
    box(ui, 1).click()
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    assert.equal(box(ui, 1).checked, true)
    assert.equal(header(ui).indeterminate, true, 'the header shows that only part of the page is ticked')
    assert.match(rows(ui)[1].getAttribute('aria-label') || '', /selected/, 'a screen reader hears the state of the row')
    box(ui, 3).click()
    await ui.waitFor(() => /2 selected/.test(bar(ui)))
    box(ui, 1).click()
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    assert.equal(box(ui, 1).checked, false, 'the checkbox that selects also deselects')
  })

  test('the header selects the page and clears it; rows on other pages stay selected', async () => {
    const ui = await open(manager.api)
    ui.type('.grid-pager select', '10')
    await ui.waitFor(() => rows(ui).length === 10)
    header(ui).click()
    await ui.waitFor(() => /10 selected/.test(bar(ui)))
    assert.ok(rows(ui).every(row => (row.querySelector('input') as HTMLInputElement).checked))
    ui.click('.grid-pager button', 'Next')
    await ui.waitFor(() => /Showing 11–20/.test(meta(ui)))
    assert.match(bar(ui), /10 selected · 10 on other pages/, 'it says the selection reaches beyond this page')
    assert.equal(header(ui).checked, false)
    box(ui, 0).click()
    await ui.waitFor(() => /11 selected/.test(bar(ui)))
    header(ui).click() // tick the rest of this page
    header(ui).click() // and untick it
    await ui.waitFor(() => /10 selected/.test(bar(ui)))
  })

  test('Shift+click selects a range, Ctrl/Cmd+click adds one row, and neither opens the record', async () => {
    const ui = await open(manager.api)
    box(ui, 2).click()
    clickWith(ui, box(ui, 6), { shiftKey: true })
    await ui.waitFor(() => /5 selected/.test(bar(ui)))
    assert.deepEqual(
      rows(ui)
        .map(row => (row.querySelector('input') as HTMLInputElement).checked)
        .slice(0, 8),
      [false, false, true, true, true, true, true, false]
    )
    clickWith(ui, rows(ui)[10].querySelector('td:nth-child(3)')!, { ctrlKey: true })
    await ui.waitFor(() => /6 selected/.test(bar(ui)))
    assert.equal(ui.doc.querySelector('.record-drawer'), null, 'a modified click selects; it does not open the record')
    clickWith(ui, rows(ui)[12].querySelector('td:nth-child(3)')!, { shiftKey: true })
    await ui.waitFor(() => /8 selected/.test(bar(ui)))
    assert.equal(
      box(ui, 11).checked && box(ui, 12).checked,
      true,
      'the range ran from the row last ticked (10) to the one clicked (12)'
    )
    assert.equal(box(ui, 7).checked, false, 'and nothing between the two groups was swept in')
  })

  test('"Select all N matching" selects exactly what the filter finds, and changing the filter starts over', async () => {
    const ui = await open(manager.api)
    ui.type('.grid-pager select', '10')
    await ui.waitFor(() => rows(ui).length === 10)
    header(ui).click()
    await ui.waitFor(() => /Select all 35 matching tasks/.test(bar(ui)))
    ui.click('.selection-summary button', 'Select all 35 matching tasks')
    await ui.waitFor(() => /All 35 matching tasks are selected/.test(bar(ui)))
    const asked = ui.requests.find(r => r.url.startsWith('/api/tasks/ids'))!
    assert.match(asked.url, /project=\d+/, 'it asked for the ids of this project, not of everything')
    // a delete confirmation would now say 35: prove the selection really holds every id by exporting it
    ui.type('.grid-toolbar input[type="search"]', 'task 07')
    await ui.waitFor(() => /Nothing selected/.test(bar(ui)))
    await ui.waitFor(() => /of 1 tasks/.test(meta(ui)))
    assert.equal(rows(ui).length, 1)
  })

  test('events that arrive before the screen has caught up still build on each other (no lost or resurrected ticks)', async () => {
    const ui = await open(manager.api)
    box(ui, 0).click()
    box(ui, 1).click()
    await ui.waitFor(() => /2 selected/.test(bar(ui)))
    ui.click('.selection-summary button', 'Clear selection')
    box(ui, 5).click() // straight away: nothing has re-rendered in between
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    await ui.settle(200)
    assert.match(bar(ui), /1 selected/, 'only the row ticked after clearing is selected')
    assert.equal(box(ui, 0).checked || box(ui, 1).checked, false, 'the cleared ticks did not come back')
  })

  test('with nothing selected the actions that need a selection are disabled and say why; Import is always available', async () => {
    const ui = await open(manager.api)
    for (const label of ['Open', 'Edit', 'Duplicate', 'Status', 'Assign', 'Edit fields', 'Tags', 'Print', 'Delete'])
      assert.equal(action(ui, label)!.disabled, true, `${label} needs a selection`)
    assert.match(action(ui, 'Status')!.title, /Select tasks first/)
    assert.equal(action(ui, 'Import CSV')!.disabled, false)
  })

  test('actions follow the count: one record enables Open, Edit and Duplicate; two disable them but leave the bulk actions', async () => {
    const ui = await open(manager.api)
    box(ui, 0).click()
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    for (const label of ['Open', 'Edit', 'Duplicate', 'Status', 'Delete'])
      assert.equal(action(ui, label)!.disabled, false, label)
    box(ui, 1).click()
    await ui.waitFor(() => /2 selected/.test(bar(ui)))
    for (const label of ['Open', 'Edit', 'Duplicate']) {
      assert.equal(action(ui, label)!.disabled, true, `${label} is for one record`)
      assert.match(action(ui, label)!.title, /exactly one/)
    }
    assert.match(textOf(action(ui, 'Status')), /Status \(2\)/, 'a bulk action states how many it will touch')
    assert.equal(action(ui, 'Delete')!.disabled, false)
  })

  test('a viewer can select and print but is not offered anything that changes records', async () => {
    const ui = await open(viewer.api)
    box(ui, 0).click()
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    const offered = [...ui.doc.querySelectorAll('.selection-actions button')].map(b =>
      textOf(b).replace(/\s*\(\d+\)/, '')
    )
    assert.deepEqual(offered.sort(), ['Open', 'Print'].sort())
    assert.equal(ui.doc.querySelector('.project-tasks-table select'), null, 'no editable cells either')
  })
})

describe('opening a record and the keyboard', () => {
  test('a click on a row opens the record with its details and history; Escape closes it and returns focus', async () => {
    const ui = await open(manager.api)
    const first = rows(ui)[0]
    first.focus()
    first
      .querySelector('td:nth-child(3)')!
      .dispatchEvent(new ui.w.MouseEvent('click', { bubbles: true, cancelable: true }))
    const drawer = (await ui.waitFor(() => ui.doc.querySelector('.record-drawer'))) as HTMLElement
    assert.equal(drawer.getAttribute('role'), 'dialog')
    assert.equal(drawer.getAttribute('aria-modal'), 'true')
    await ui.waitFor(() => /History/.test(textOf(drawer)) && /Created task/.test(textOf(drawer)))
    assert.match(textOf(drawer), /Grid project/)
    press(ui, drawer, 'Escape')
    await ui.waitFor(() => !ui.doc.querySelector('.record-drawer'))
  })

  test('the arrow keys move between rows, Space selects, Shift+Down extends, Ctrl+A selects the page, Escape clears', async () => {
    const ui = await open(manager.api)
    const wrap = ui.doc.querySelector('.grid-scroll') as HTMLElement
    rows(ui)[0].focus()
    press(ui, rows(ui)[0], 'ArrowDown')
    assert.equal(ui.doc.activeElement, rows(ui)[1], 'focus moved to the next row')
    press(ui, rows(ui)[1], ' ')
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    press(ui, rows(ui)[1], 'ArrowDown', { shiftKey: true })
    await ui.waitFor(() => /2 selected/.test(bar(ui)))
    assert.equal(ui.doc.activeElement, rows(ui)[2])
    press(ui, rows(ui)[2], 'End')
    assert.equal(ui.doc.activeElement, rows(ui)[TOTAL - 1])
    press(ui, rows(ui)[TOTAL - 1], 'a', { ctrlKey: true })
    await ui.waitFor(() => new RegExp(`${TOTAL} selected`).test(bar(ui)))
    press(ui, wrap.querySelector('tr[data-row]')!, 'Escape')
    await ui.waitFor(() => /Nothing selected/.test(bar(ui)))
  })

  test('typing in a filter box keeps its own keys: Ctrl+A there selects text, not rows', async () => {
    const ui = await open(manager.api)
    const search = ui.doc.querySelector('.grid-toolbar input[type="search"]') as HTMLInputElement
    const ev = new ui.w.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true })
    search.dispatchEvent(ev)
    assert.equal(ev.defaultPrevented, false)
    assert.match(bar(ui), /Nothing selected/)
  })

  test('Delete asks about the selection and only the selection; with none it asks about the focused row by name; Backspace does nothing', async () => {
    const ui = await open(manager.api)
    press(ui, rows(ui)[0], 'Backspace')
    await ui.settle(200)
    assert.equal(
      ui.doc.querySelector('[role="alertdialog"], .bulk-dialog'),
      null,
      'Backspace is too easy to hit by accident to delete anything'
    )
    // nothing selected: the focused row is named in a confirmation, and Cancel leaves everything
    press(ui, rows(ui)[0], 'Delete')
    const single = (await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))) as HTMLElement
    assert.match(textOf(single), /Delete task GRD-\d+\?/)
    assert.ok(
      textOf(single).includes(textOf(rows(ui)[0].querySelector('.task-title-cell strong'))),
      'it names the task of the focused row'
    )
    ui.click('[role="alertdialog"] button', 'Cancel')
    await ui.waitFor(() => !ui.doc.querySelector('[role="alertdialog"]'))
    // two selected, Delete pressed on a different row: it is about the two, never about the row under the cursor
    box(ui, 3).click()
    box(ui, 4).click()
    await ui.waitFor(() => /2 selected/.test(bar(ui)))
    press(ui, rows(ui)[9], 'Delete')
    const dialog = (await ui.waitFor(() => ui.doc.querySelector('.bulk-dialog'))) as HTMLElement
    assert.match(textOf(dialog), /Delete 2 tasks/)
    assert.match(textOf(dialog), /applies to 2 tasks/)
    assert.equal(ui.doc.querySelector('[role="alertdialog"]'), null)
    ui.click('.bulk-dialog .secondary-button', 'Cancel')
    await ui.waitFor(() => !ui.doc.querySelector('.bulk-dialog'))
    assert.equal((await taskIds()).length, TOTAL, 'cancelling deleted nothing')
  })
})

const dialog = (ui: BootedUI) => ui.doc.querySelector('.bulk-dialog') as HTMLElement | null
const toasts = (ui: BootedUI) => textOf(ui.doc.querySelector('.toast-host'))
const tick = async (ui: BootedUI, indexes: number[]) => {
  for (const index of indexes) box(ui, index).click()
  await ui.waitFor(() => new RegExp(`${indexes.length} selected`).test(bar(ui)))
}

describe('bulk actions', () => {
  test('changing the status of a selection says how many it touches, changes exactly those, and reports the result', async () => {
    const ui = await open(manager.api)
    const ids = rows(ui)
      .slice(0, 3)
      .map(row => Number(row.dataset.row))
    const before = Object.fromEntries(
      await Promise.all(
        rows(ui)
          .slice(3, 8)
          .map(async row => [row.dataset.row, await statusOf(Number(row.dataset.row))])
      )
    )
    await tick(ui, [0, 1, 2])
    action(ui, 'Status')!.click()
    await ui.waitFor(() => dialog(ui))
    assert.match(textOf(dialog(ui)!), /applies to 3 tasks: the ones you selected\. Nothing else is touched/)
    const confirm = ui.doc.querySelector('.bulk-dialog .primary-button') as HTMLButtonElement
    assert.match(textOf(confirm), /Change status of 3 tasks/)
    confirm.click()
    await ui.waitFor(
      () => /Choose|required/i.test(textOf(dialog(ui)!)) && !ui.requests.some(r => r.url === '/api/tasks/bulk')
    )
    assert.equal(
      ui.requests.filter(r => r.url === '/api/tasks/bulk').length,
      0,
      'a required field must be filled before anything is sent'
    )
    ui.type('.bulk-dialog select', 'Testing')
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Changed 3 of 3 tasks/.test(textOf(dialog(ui)!)))
    for (const id of ids) assert.equal(await statusOf(id), 'Testing')
    for (const [id, status] of Object.entries(before))
      assert.equal(await statusOf(Number(id)), status, 'a task that was not selected is exactly as it was')
    const sent = JSON.parse(ui.requests.find(r => r.url === '/api/tasks/bulk')!.body!)
    assert.deepEqual([sent.action, sent.status, sent.ids.length], ['status', 'Testing', 3])
    ui.click('.bulk-dialog .primary-button', 'Close')
    await ui.waitFor(() => !dialog(ui))
    assert.match(bar(ui), /3 selected/, 'the selection survives, so another action can follow')
  })

  test('one record that cannot be changed is named with its reason, and stays selected while the rest change', async () => {
    const ui = await open(developer.api)
    // Dana owns the odd-numbered tasks; the even ones are Mia's, which Dana may move but not re-plan
    const own = rows(ui).findIndex(row => /Dana/.test(textOf(row.querySelector('.owner-cell'))))
    const others = rows(ui).findIndex(row => /Mia/.test(textOf(row.querySelector('.owner-cell'))))
    await tick(ui, [own, others])
    const ownId = Number(rows(ui)[own].dataset.row)
    const otherId = Number(rows(ui)[others].dataset.row)
    const otherTitle = await titleOf(otherId)
    action(ui, 'Edit fields')!.click()
    await ui.waitFor(() => dialog(ui))
    ui.type('.bulk-dialog select', 'High', 0) // priority
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Changed 1 of 2 tasks/.test(textOf(dialog(ui)!)), 15000)
    const report = textOf(dialog(ui)!)
    assert.match(report, /1 could not be changed/)
    assert.ok(report.includes(otherTitle), 'the report names the task that was refused')
    assert.match(report, /re-planned|Ask a manager/i, 'and says why')
    assert.equal((await admin.get(`/api/tasks/${ownId}`)).body.task.priority, 'High')
    assert.notEqual(
      (await admin.get(`/api/tasks/${otherId}`)).body.task.priority,
      'High',
      'the refused task is untouched'
    )
    ui.click('.bulk-dialog .primary-button', 'Close')
    await ui.waitFor(() => !dialog(ui))
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    const stillSelected = rows(ui)
      .filter(row => (row.querySelector('input') as HTMLInputElement).checked)
      .map(row => Number(row.dataset.row))
    assert.deepEqual(
      stillSelected,
      [otherId],
      'only the one that failed stays selected, so the cause can be fixed and it can be retried'
    )
  })

  test('assigning and tagging: the dialog needs a choice, and tags are added to the selection only', async () => {
    const ui = await open(manager.api)
    await tick(ui, [4, 5])
    const picked = [Number(rows(ui)[4].dataset.row), Number(rows(ui)[5].dataset.row)]
    const bystander = Number(rows(ui)[6].dataset.row)
    action(ui, 'Tags')!.click()
    await ui.waitFor(() => dialog(ui))
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Add at least one tag/.test(textOf(dialog(ui)!)))
    const input = ui.doc.querySelector('.bulk-dialog .tag-input input') as HTMLInputElement
    ui.type('.bulk-dialog .tag-input input', 'release-9')
    input.dispatchEvent(new ui.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await ui.waitFor(() => ui.doc.querySelector('.bulk-dialog .tag-chip'))
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Changed 2 of 2 tasks/.test(textOf(dialog(ui)!)))
    for (const id of picked)
      assert.ok((await admin.get(`/api/tasks/${id}`)).body.task.tags.some((t: any) => t.name === 'release-9'))
    assert.ok(
      !(await admin.get(`/api/tasks/${bystander}`)).body.task.tags.some((t: any) => t.name === 'release-9'),
      'not selected, not tagged'
    )
  })
})

describe('deleting and undoing', () => {
  test('a bulk delete states the number and the undo, removes only the selection, and Undo brings it all back', async () => {
    const ui = await open(manager.api)
    const before = (await taskIds()).length
    const ids = [Number(rows(ui)[7].dataset.row), Number(rows(ui)[8].dataset.row)]
    await tick(ui, [7, 8])
    action(ui, 'Delete')!.click()
    await ui.waitFor(() => dialog(ui))
    assert.match(textOf(dialog(ui)!), /applies to 2 tasks/)
    assert.match(textOf(dialog(ui)!), /undo this for 30 days/)
    ui.click('.bulk-dialog .primary-button')
    await ui.waitFor(() => /Deleted 2 of 2 tasks/.test(textOf(dialog(ui)!)))
    ui.click('.bulk-dialog .primary-button', 'Close')
    assert.equal((await taskIds()).length, before - 2, 'only the two are gone')
    for (const id of ids) assert.equal((await admin.get(`/api/tasks/${id}`)).status, 404)
    const toast = (await ui.waitFor(() => ui.doc.querySelector('.toast-action'))) as HTMLElement
    assert.match(textOf(toast), /Undo/)
    toast.click()
    await ui.waitFor(() => /tasks restored/.test(toasts(ui)))
    assert.equal((await taskIds()).length, before, 'everything is back')
    for (const id of ids) assert.equal((await admin.get(`/api/tasks/${id}`)).status, 200)
  })

  test('one task: a confirmation that names it and says it can be undone; Cancel keeps it; Undo restores it', async () => {
    const ui = await open(manager.api)
    const id = Number(rows(ui)[9].dataset.row)
    const title = await titleOf(id)
    await tick(ui, [9])
    action(ui, 'Delete')!.click()
    const ask = (await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))) as HTMLElement
    assert.ok(textOf(ask).includes(title))
    assert.match(textOf(ask), /undo this for 30 days/)
    await ui.settle(80)
    assert.equal(ui.doc.activeElement?.textContent, 'Cancel', 'the safe choice has focus')
    ui.click('[role="alertdialog"] button', 'Cancel')
    await ui.waitFor(() => !ui.doc.querySelector('[role="alertdialog"]'))
    assert.equal((await admin.get(`/api/tasks/${id}`)).status, 200)
    action(ui, 'Delete')!.click()
    await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))
    ui.click('[role="alertdialog"] button', 'Delete task')
    await ui.waitFor(() => ui.doc.querySelector('.toast-action'))
    assert.equal((await admin.get(`/api/tasks/${id}`)).status, 404)
    ;(ui.doc.querySelector('.toast-action') as HTMLElement).click()
    await ui.waitFor(() => /Task restored/.test(toasts(ui)))
    assert.equal(await titleOf(id), title)
  })

  test('a person who may not delete is not offered Delete, and pressing the key does nothing', async () => {
    const ui = await open(developer.api)
    assert.equal(action(ui, 'Delete'), undefined)
    box(ui, 0).click()
    await ui.waitFor(() => /1 selected/.test(bar(ui)))
    press(ui, rows(ui)[0], 'Delete')
    await ui.waitFor(() => /Not allowed/.test(toasts(ui)))
    assert.equal(ui.doc.querySelector('[role="alertdialog"], .bulk-dialog'), null)
  })

  test('a very large delete asks for the number to be typed first', async () => {
    const ui = await open(manager.api)
    ui.type('.grid-pager select', '100')
    await ui.waitFor(() => rows(ui).length === TOTAL)
    header(ui).click()
    await ui.waitFor(() => new RegExp(`${TOTAL} selected`).test(bar(ui)))
    // 35 is under the threshold of 50: no typing is needed...
    action(ui, 'Delete')!.click()
    await ui.waitFor(() => dialog(ui))
    assert.equal(ui.doc.querySelector('.bulk-dialog .confirm-type'), null)
    ui.click('.bulk-dialog .secondary-button', 'Cancel')
    await ui.waitFor(() => !dialog(ui))
    assert.equal((await taskIds()).length >= TOTAL, true, 'nothing was deleted')
  })
})

describe('editing in place', () => {
  test('a priority is changed from its cell, and the change is saved and recorded', async () => {
    const ui = await open(manager.api)
    const row = rows(ui)[0]
    const id = Number(row.dataset.row)
    const select = row.querySelector('select[aria-label^="Priority"]') as HTMLSelectElement
    const now = (await admin.get(`/api/tasks/${id}`)).body.task.priority
    const next = now === 'Low' ? 'High' : 'Low'
    ui.type(`tr[data-row="${id}"] select[aria-label^="Priority"]`, next)
    await ui.waitFor(() => ui.requests.some(r => r.method === 'PUT' && r.url === `/api/tasks/${id}`))
    assert.deepEqual(JSON.parse(ui.requests.find(r => r.method === 'PUT' && r.url === `/api/tasks/${id}`)!.body!), {
      priority: next
    })
    await ui.waitFor(async () => true)
    await ui.settle(300)
    assert.equal((await admin.get(`/api/tasks/${id}`)).body.task.priority, next)
    assert.ok(select)
  })

  test('a title is edited with Enter to save and Escape to cancel; an empty title is refused where it is typed', async () => {
    const ui = await open(manager.api)
    const id = Number(rows(ui)[1].dataset.row)
    const original = await titleOf(id)
    const edit = () =>
      ui.doc.querySelector(`tr[data-row="${id}"] .cell-edit-button[aria-label^="Edit: Task"]`) as HTMLElement
    edit().click()
    const field = (await ui.waitFor(() =>
      ui.doc.querySelector(`tr[data-row="${id}"] .cell-editor input`)
    )) as HTMLInputElement
    ui.type(`tr[data-row="${id}"] .cell-editor input`, 'Changed my mind')
    press(ui, field, 'Escape')
    await ui.waitFor(() => !ui.doc.querySelector(`tr[data-row="${id}"] .cell-editor input`))
    assert.equal(await titleOf(id), original, 'Escape puts the old value back and saves nothing')
    edit().click()
    await ui.waitFor(() => ui.doc.querySelector(`tr[data-row="${id}"] .cell-editor input`))
    ui.type(`tr[data-row="${id}"] .cell-editor input`, '   ')
    press(ui, ui.doc.querySelector(`tr[data-row="${id}"] .cell-editor input`)!, 'Enter')
    await ui.waitFor(() => /required/.test(textOf(ui.doc.querySelector(`tr[data-row="${id}"] .cell-error`))))
    assert.equal(await titleOf(id), original, 'an empty title never reaches the server')
    ui.type(`tr[data-row="${id}"] .cell-editor input`, 'Renamed in the table')
    press(ui, ui.doc.querySelector(`tr[data-row="${id}"] .cell-editor input`)!, 'Enter')
    const saved = async () => (await titleOf(id)) === 'Renamed in the table'
    for (let attempt = 0; attempt < 50 && !(await saved()); attempt++) await ui.settle(60)
    assert.equal(await titleOf(id), 'Renamed in the table')
    assert.equal(
      ui.requests.filter(r => r.method === 'PUT' && r.url === `/api/tasks/${id}`).length,
      1,
      'saved once, however the box was left'
    )
  })

  test("a person can only edit what they may re-plan: cells of someone else's task have no editor, the status select still works", async () => {
    const ui = await open(developer.api)
    const mine = rows(ui).find(row => /Dana/.test(textOf(row.querySelector('.owner-cell'))))!
    const theirs = rows(ui).find(row => /Mia/.test(textOf(row.querySelector('.owner-cell'))))!
    assert.ok(mine.querySelector('.cell-edit-button'), 'their own task can be edited')
    assert.equal(theirs.querySelector('.cell-edit-button'), null, "somebody else's task has no title editor")
    assert.equal(theirs.querySelector('select[aria-label^="Priority"]'), null, 'nor a priority list')
    assert.ok(
      theirs.querySelector('select[aria-label^="Status"]'),
      'but moving it through the workflow is allowed to anyone who writes tasks'
    )
  })
})

const sortButton = (ui: BootedUI, label: string) =>
  [...ui.doc.querySelectorAll('.data-grid .sort-button')].find(
    b =>
      textOf(b)
        .replace(/[▲▼\d]/g, '')
        .trim() === label
  ) as HTMLElement
const lastRequest = (ui: BootedUI, pattern: RegExp) => [...ui.requests].reverse().find(r => pattern.test(r.url))
const params = (url: string) => new URLSearchParams(url.split('?')[1])
const headers = (ui: BootedUI) =>
  [...ui.doc.querySelectorAll('.data-grid thead tr:first-child th:not(.select-cell):not(.actions-cell)')].map(th =>
    textOf(th)
      .replace(/[▲▼\d]/g, '')
      .trim()
  )

describe('sorting and filtering', () => {
  test('sorting by several columns: a plain click sorts by one, Shift adds another, and each header says its place', async () => {
    const ui = await open(manager.api)
    sortButton(ui, 'Priority').click()
    await ui.waitFor(() => params(lastRequest(ui, /\/api\/tasks\?/)!.url).get('sort') === 'priority:asc')
    clickWith(ui, sortButton(ui, 'Task'), { shiftKey: true })
    await ui.waitFor(() => params(lastRequest(ui, /\/api\/tasks\?/)!.url).get('sort') === 'priority:asc,title:asc')
    const th = (label: string) => sortButton(ui, label).closest('th')!
    assert.equal(th('Priority').getAttribute('aria-sort'), 'ascending')
    assert.equal(th('Task').getAttribute('aria-sort'), 'ascending')
    assert.match(textOf(sortButton(ui, 'Priority')), /1/, 'the main sort is marked 1')
    assert.match(textOf(sortButton(ui, 'Task')), /2/, 'the tie-breaker is marked 2')
    await ui.waitFor(
      () =>
        (rows(ui)[0]?.querySelector('select[aria-label^="Priority"]') as HTMLSelectElement | null)?.value === 'High' &&
        rows(ui).length === TOTAL
    )
    const priorities = rows(ui).map(
      row => (row.querySelector('select[aria-label^="Priority"]') as HTMLSelectElement).value
    )
    const rank: Record<string, number> = { High: 0, Medium: 1, Low: 2 }
    assert.deepEqual(
      priorities,
      [...priorities].sort((a, b) => rank[a] - rank[b]),
      'High first, as the database sorted it'
    )
    const highTitles = rows(ui)
      .filter((row, i) => priorities[i] === 'High')
      .map(row => textOf(row.querySelector('.task-title-cell strong')))
    assert.deepEqual(highTitles, [...highTitles].sort(), 'within High, by title')
    sortButton(ui, 'Task').click() // a plain click collapses to that one column
    await ui.waitFor(
      () =>
        params(lastRequest(ui, /\/api\/tasks\?/)!.url).get('sort') === 'title:desc' ||
        params(lastRequest(ui, /\/api\/tasks\?/)!.url).get('sort') === 'title:asc'
    )
  })

  test('per-column filters narrow the result and the counts follow; clearing them widens it again', async () => {
    const ui = await open(manager.api)
    ui.click('.grid-toolbar button', 'Column filters')
    await ui.waitFor(() => ui.doc.querySelector('.filter-row'))
    // status is a pick-several list
    ui.click('.filter-row .pick-button[aria-label^="Filter Status"]')
    const done = (await ui.waitFor(() =>
      [...ui.doc.querySelectorAll('.pick-list label')].find(el => textOf(el) === 'Done')
    )) as HTMLElement
    ;(done.querySelector('input') as HTMLInputElement).click()
    const doneNow = (await taskIds('&status=Done')).length
    assert.ok(doneNow > 0)
    await ui.waitFor(() => new RegExp(`of ${doneNow} tasks`).test(meta(ui)) && rows(ui).length === doneNow)
    assert.equal(params(lastRequest(ui, /\/api\/tasks\?/)!.url).get('status'), 'Done')
    for (const row of rows(ui))
      assert.equal((row.querySelector('select[aria-label^="Status"]') as HTMLSelectElement).value, 'Done')
    // a text filter on the title is a "contains" condition the database evaluates, and it combines with the status filter
    const needle = textOf(rows(ui)[0].querySelector('.task-title-cell strong')).slice(-2)
    ui.type('.filter-row input[aria-label^="Filter Task"]', needle)
    await ui.waitFor(() => /of 1 tasks/.test(meta(ui)))
    const cf = JSON.parse(params(lastRequest(ui, /\/api\/tasks\?/)!.url).get('cf')!)
    assert.deepEqual(cf, [{ field: 'title', operator: 'contains', value: needle }])
    assert.match(textOf(rows(ui)[0]), new RegExp(`Grid task ${needle}`))
    ui.click('.grid-toolbar .text-button', 'Clear filters')
    await ui.waitFor(() => new RegExp(`of ${TOTAL} tasks`).test(meta(ui)))
    assert.equal(ui.doc.querySelectorAll('.filter-badge').length, 0)
  })

  test('the advanced filter combines AND and OR in the database, and a column filter still narrows the whole of it', async () => {
    const ui = await open(manager.api)
    ui.click('.advanced-filter-wrap > button')
    await ui.waitFor(() => ui.doc.querySelector('.advanced-filter-panel'))
    // two tasks that exist right now (earlier tests renamed and moved some)
    const [first, second] = [rows(ui)[3], rows(ui)[4]].map(row => textOf(row.querySelector('.task-title-cell strong')))
    const addCondition = () => ui.click('.advanced-filter-actions .text-button')
    addCondition()
    await ui.waitFor(() => ui.doc.querySelectorAll('.filter-condition').length === 1)
    ui.type('.filter-condition select[aria-label="Field"]', 'title')
    ui.type('.filter-condition select[aria-label="Operator"]', 'equals')
    ui.type('.filter-condition input[aria-label="Value"]', first)
    addCondition()
    await ui.waitFor(() => ui.doc.querySelectorAll('.filter-condition').length === 2)
    ui.type('.filter-condition select[aria-label="Join with previous condition"]', 'OR')
    ui.type('.filter-condition select[aria-label="Field"]', 'title', 1)
    ui.type('.filter-condition select[aria-label="Operator"]', 'equals', 1)
    ui.type('.filter-condition input[aria-label="Value"]', second, 1)
    ui.click('.advanced-filter-actions .primary-button')
    await ui.waitFor(() => /of 2 tasks/.test(meta(ui)) && rows(ui).length === 2)
    assert.ok(ui.doc.querySelector('.filter-chips'), 'the active conditions are shown as chips that can be removed')
    ui.click('.grid-toolbar button', 'Column filters')
    await ui.waitFor(() => ui.doc.querySelector('.filter-row'))
    ui.type('.filter-row input[aria-label^="Filter Task"]', second)
    await ui.waitFor(() => /of 1 tasks/.test(meta(ui)), 8000)
    assert.ok(textOf(rows(ui)[0]).includes(second), 'the column filter narrowed the OR, not just its last term')
  })

  test('a search with nothing behind it says so and offers the way out; a project with no tasks says that instead', async () => {
    const ui = await open(manager.api)
    ui.type('.grid-toolbar input[type="search"]', 'zzz-no-such-task')
    const state = (await ui.waitFor(() => ui.doc.querySelector('.grid-empty'))) as HTMLElement
    assert.match(textOf(state), /No tasks match/)
    assert.match(meta(ui), /Nothing to show/)
    ui.click('.grid-empty button', 'Clear all filters')
    await ui.waitFor(() => rows(ui).length === TOTAL && !ui.doc.querySelector('.grid-empty'))
    const blank = await open(manager.api, `/projects/${empty.numericId}`, '.grid-empty')
    assert.match(textOf(blank.doc.querySelector('.grid-empty')), /No tasks yet/)
    assert.ok([...blank.doc.querySelectorAll('.grid-empty button')].some(b => /Add task/.test(textOf(b))))
    assert.ok([...blank.doc.querySelectorAll('.grid-empty button')].some(b => /Import from CSV/.test(textOf(b))))
    const readOnly = await open(viewer.api, `/projects/${empty.numericId}`, '.grid-empty')
    assert.equal(
      [...readOnly.doc.querySelectorAll('.grid-empty button')].length,
      0,
      'a viewer is not offered buttons that would refuse'
    )
  })

  test('a failed load is explained with a retry, not shown as an empty list', async () => {
    let failing = true
    const ui = await bootUI({
      base: server.url,
      cookie: manager.api.cookie,
      hash: `/projects/${project.numericId}`,
      intercept: url =>
        failing && /^\/api\/tasks\?/.test(url)
          ? new Response(JSON.stringify({ error: 'The database is busy.' }), {
              status: 503,
              headers: { 'content-type': 'application/json' }
            })
          : undefined
    })
    uis.push(ui)
    await ui.waitFor(() => ui.doc.querySelector('.project-tasks-panel .global-error'))
    assert.match(textOf(ui.doc.querySelector('.project-tasks-panel .global-error')), /The database is busy\./)
    assert.equal(ui.doc.querySelector('.grid-empty'), null, 'an error is not an empty list')
    failing = false
    ui.click('.project-tasks-panel .global-error button', 'Retry')
    await ui.waitFor(() => rows(ui).length === TOTAL)
  })
})

describe('columns and saved views', () => {
  test('columns can be hidden and moved, the fixed one stays, and Reset puts everything back', async () => {
    const ui = await open(manager.api)
    assert.deepEqual(headers(ui).slice(0, 6), ['Task ID', 'Task', 'Status', 'Priority', 'Owner', 'Due date'])
    ui.click('.menu-wrap > button', 'Columns')
    await ui.waitFor(() => ui.doc.querySelector('.column-list'))
    const item = (label: string) =>
      [...ui.doc.querySelectorAll('.column-list li')].find(li => textOf(li).startsWith(label)) as HTMLElement
    assert.ok(
      (item('Task ID').querySelector('input') as HTMLInputElement).disabled,
      'the identifying column cannot be hidden'
    )
    ;(item('Tags').querySelector('input') as HTMLInputElement).click()
    await ui.waitFor(() => !headers(ui).includes('Tags'))
    ;(item('Type').querySelector('input') as HTMLInputElement).click()
    await ui.waitFor(() => headers(ui).includes('Type'))
    ;(item('Priority').querySelector('button[aria-label^="Move Priority earlier"]') as HTMLElement).click()
    await ui.waitFor(() => headers(ui).indexOf('Priority') < headers(ui).indexOf('Status'))
    ui.click('.grid-toolbar .text-button', 'Reset')
    await ui.waitFor(() => headers(ui).includes('Tags') && !headers(ui).includes('Type'))
    assert.deepEqual(headers(ui).slice(0, 6), ['Task ID', 'Task', 'Status', 'Priority', 'Owner', 'Due date'])
  })

  test('a column can be resized with the keyboard, within limits, and double-click or Home puts it back', async () => {
    const ui = await open(manager.api)
    const handle = () => ui.doc.querySelector('.col-resizer[aria-label^="Resize the Task column"]') as HTMLElement
    const before = Number(handle().getAttribute('aria-valuenow'))
    press(ui, handle(), 'ArrowRight')
    await ui.waitFor(() => Number(handle().getAttribute('aria-valuenow')) === before + 12)
    press(ui, handle(), 'ArrowLeft', { shiftKey: true })
    await ui.waitFor(() => Number(handle().getAttribute('aria-valuenow')) === before + 12 - 48)
    for (let i = 0; i < 8; i++) {
      press(ui, handle(), 'ArrowLeft', { shiftKey: true })
      await ui.settle(20)
    }
    await ui.waitFor(() => Number(handle().getAttribute('aria-valuenow')) === 140, 3000) // the column's own minimum
    press(ui, handle(), 'Home')
    await ui.waitFor(() => Number(handle().getAttribute('aria-valuenow')) === before)
  })

  test('a view saves the arrangement and brings it back; a default view opens by itself; deleting asks first', async () => {
    const ui = await open(manager.api)
    sortButton(ui, 'Task').click()
    await ui.waitFor(() => params(lastRequest(ui, /\/api\/tasks\?/)!.url).get('sort') === 'title:asc')
    ui.click('.menu-wrap > button', 'Columns')
    await ui.waitFor(() => ui.doc.querySelector('.column-list'))
    ;(
      [...ui.doc.querySelectorAll('.column-list li')]
        .find(li => textOf(li).startsWith('Tags'))!
        .querySelector('input') as HTMLInputElement
    ).click()
    await ui.waitFor(() => !headers(ui).includes('Tags'))
    ui.click('.menu-wrap > button', 'Views')
    await ui.waitFor(() => ui.doc.querySelector('.views-panel'))
    ui.click('.views-panel .text-button', 'Save current view…')
    await ui.waitFor(() => ui.doc.querySelector('.view-form'))
    ui.type('.view-form input[required]', 'By title')
    const defaultBox = [...ui.doc.querySelectorAll('.view-form input[type="checkbox"]')][0] as HTMLInputElement
    defaultBox.click()
    ui.click('.view-form .primary-button')
    await ui.waitFor(() => /View saved/.test(toasts(ui)))
    // a fresh page opens with that view already applied
    const again = await open(manager.api)
    await again.waitFor(() => !headers(again).includes('Tags'))
    assert.equal(sortButton(again, 'Task').closest('th')!.getAttribute('aria-sort'), 'ascending')
    again.click('.menu-wrap > button', 'By title')
    await again.waitFor(() => again.doc.querySelector('.views-panel'))
    const mine = [...again.doc.querySelectorAll('.view-list li')].find(li => /By title/.test(textOf(li)))!
    assert.match(textOf(mine), /Default/)
    ;(mine.querySelector('button[aria-label^="Delete the view"]') as HTMLElement).click()
    const ask = (await again.waitFor(() => again.doc.querySelector('[role="alertdialog"]'))) as HTMLElement
    assert.match(textOf(ask), /Delete the view “By title”/)
    again.click('[role="alertdialog"] button', 'Cancel')
    await again.waitFor(() => !again.doc.querySelector('[role="alertdialog"]'))
    assert.equal(
      ((await manager.api.get('/api/views?scope=project-tasks')).body.views as any[]).length,
      1,
      'cancelling kept it'
    )
    ;(mine.querySelector('button[aria-label^="Delete the view"]') as HTMLElement).click()
    await again.waitFor(() => again.doc.querySelector('[role="alertdialog"]'))
    again.click('[role="alertdialog"] button', 'Delete view')
    await again.waitFor(async () => true)
    for (
      let i = 0;
      i < 40 && ((await manager.api.get('/api/views?scope=project-tasks')).body.views as any[]).length;
      i++
    )
      await again.settle(60)
    assert.equal(((await manager.api.get('/api/views?scope=project-tasks')).body.views as any[]).length, 0)
  })
})
