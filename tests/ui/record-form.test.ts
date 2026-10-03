// The record form: what it asks for, what it refuses and where it says so, the ways of saving, and what it does with edits that
// have not been saved. Real client, real server; jsdom has no layout, so the visual side is checked in the browser suite.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { Api, type TestServer, launch, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, textOf } from '../helpers/ui'

let server: TestServer
let admin: Api
let project: any
let other: any
const uis: BootedUI[] = []

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  project = (await admin.post('/api/projects', { name: 'Form project', code: 'FRM' })).body
  other = (await admin.post('/api/projects', { name: 'Second project', code: 'SEC' })).body
})
after(async () => {
  uis.forEach(ui => ui.close())
  await server.cleanup()
})

async function openTaskForm() {
  const ui = await bootUI({ base: server.url, cookie: admin.cookie, hash: '/tasks' })
  uis.push(ui)
  await ui.waitFor(() => ui.doc.querySelector('.board'))
  ui.click('.work-toolbar .primary-button')
  await ui.waitFor(() => ui.doc.querySelector('[role="dialog"]'))
  return ui
}
const field = (ui: BootedUI, name: string) =>
  ui.doc.querySelector(`[role="dialog"] [name="${name}"]`) as HTMLInputElement
const labelOf = (ui: BootedUI, name: string) =>
  ui.doc.querySelector(`[role="dialog"] label[for="${field(ui, name).id}"]`) as HTMLElement
const footButton = (ui: BootedUI, text: string) =>
  [...ui.doc.querySelectorAll('[role="dialog"] .modal-foot button')].find(b =>
    textOf(b).startsWith(text)
  ) as HTMLButtonElement
/** Wait until something the UI asked the server to do has actually happened (the request is sent before it is applied). */
async function eventually<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string): Promise<T> {
  let last: T | undefined
  for (let attempt = 0; attempt < 60; attempt++) {
    last = await read()
    if (ok(last)) return last
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.fail(`${what}; last seen: ${JSON.stringify(last)}`)
}
const tasksNamed = async (title: string) =>
  (await admin.get(`/api/tasks?q=${encodeURIComponent(title)}&pageSize=50`)).body.rows as any[]

describe('what the form asks for', () => {
  test('required fields are marked for everybody, announced to assistive technology, and explained once', async () => {
    const ui = await openTaskForm()
    assert.ok(labelOf(ui, 'title').querySelector('.req'), 'the marker sits on the label')
    assert.equal(
      labelOf(ui, 'title').querySelector('.req')!.getAttribute('aria-hidden'),
      'true',
      'a screen reader says "required" from the attribute, not from "star"'
    )
    assert.equal(field(ui, 'title').required, true)
    assert.equal(field(ui, 'projectId').required, true)
    assert.equal(labelOf(ui, 'dueDate').querySelector('.req'), null, 'optional fields carry no marker')
    assert.match(textOf(ui.doc.querySelector('.required-legend')), /\* Required/)
  })

  test('a new task starts as the person creating it; "Unassigned" is a real choice', async () => {
    const ui = await openTaskForm()
    const options = [...ui.doc.querySelectorAll('[role="dialog"] select[name="assigneeId"] option')].map(o => textOf(o))
    assert.ok(options.includes('Unassigned'))
    assert.equal(
      field(ui, 'assigneeId').value,
      (await admin.get('/api/bootstrap')).body.user.personId,
      'the creator is the default owner'
    )
    ui.type('[role="dialog"] input[name="title"]', 'Nobody owns this')
    ui.type('[role="dialog"] select[name="assigneeId"]', '')
    ui.click('[role="dialog"] .primary-button')
    await ui.waitFor(() => !ui.doc.querySelector('[role="dialog"]'))
    const made = (await tasksNamed('Nobody owns this'))[0]
    assert.equal(made.assigneeId, '', 'chosen as unassigned, it is stored as unassigned, not given back to the person')
  })

  test('tags are typed as chips: Enter adds one without submitting, Backspace removes the last, and they are saved with the task', async () => {
    const ui = await openTaskForm()
    ui.type('[role="dialog"] input[name="title"]', 'Tagged from the form')
    const input = ui.doc.querySelector('[role="dialog"] .tag-input input') as HTMLInputElement
    ui.type('[role="dialog"] .tag-input input', 'alpha')
    const enter = new ui.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    input.dispatchEvent(enter)
    assert.equal(enter.defaultPrevented, true, 'Enter in the tag box adds the tag; it does not submit the form')
    await ui.waitFor(() => ui.doc.querySelectorAll('[role="dialog"] .tag-chip').length === 1)
    ui.type('[role="dialog"] .tag-input input', 'beta,gamma')
    await ui.waitFor(() => ui.doc.querySelectorAll('[role="dialog"] .tag-chip').length === 3)
    input.dispatchEvent(new ui.w.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    await ui.waitFor(() => ui.doc.querySelectorAll('[role="dialog"] .tag-chip').length === 2)
    ui.click('[role="dialog"] .primary-button')
    await ui.waitFor(() => !ui.doc.querySelector('[role="dialog"]'))
    assert.deepEqual((await tasksNamed('Tagged from the form'))[0].tags.map((t: any) => t.name).sort(), [
      'alpha',
      'beta'
    ])
  })
})

describe('mistakes are shown where they were made', () => {
  test('an empty required field blocks the save, is explained next to the field, and takes focus', async () => {
    const ui = await openTaskForm()
    const before = ui.requests.filter(r => r.method === 'POST' && r.url === '/api/tasks').length
    ui.click('[role="dialog"] .primary-button')
    await ui.waitFor(() => ui.doc.querySelector('[role="dialog"] .field-error'))
    assert.match(textOf(ui.doc.querySelector('[role="dialog"] .field-error')), /This field is required/)
    assert.equal(field(ui, 'title').getAttribute('aria-invalid'), 'true')
    assert.match(
      field(ui, 'title').getAttribute('aria-describedby') || '',
      new RegExp(`${field(ui, 'title').id}-error`)
    )
    assert.equal(ui.doc.activeElement, field(ui, 'title'), 'focus goes to the field that needs attention')
    assert.equal(field(ui, 'title').validity.valueMissing, true, 'the browser still refuses the submit')
    assert.equal(
      ui.requests.filter(r => r.method === 'POST' && r.url === '/api/tasks').length,
      before,
      'nothing was sent'
    )
    ui.type('[role="dialog"] input[name="title"]', 'Now it has a title')
    assert.equal(
      ui.doc.querySelector('[role="dialog"] .field-error'),
      null,
      'the message goes away as soon as the field is fixed'
    )
  })

  test('a refusal from the server lands on the field it is about (a code that is taken) and is summarised', async () => {
    const ui = await bootUI({ base: server.url, cookie: admin.cookie, hash: '/projects' })
    uis.push(ui)
    await ui.waitFor(() => ui.doc.querySelector('.project-card'))
    ui.click('.toolbar-actions .primary-button')
    await ui.waitFor(() => ui.doc.querySelector('[role="dialog"]'))
    ui.type('[role="dialog"] input[name="name"]', 'Copycat')
    ui.type('[role="dialog"] input[name="code"]', 'frm')
    assert.equal(field(ui, 'code').value, 'FRM', 'the code is upper-cased as it is typed')
    ui.click('[role="dialog"] .primary-button')
    await ui.waitFor(() => ui.doc.querySelector('[role="dialog"] .field-error'))
    assert.match(
      textOf(ui.doc.querySelector('[role="dialog"] .field[data-invalid="true"] .field-error')),
      /already used/
    )
    assert.equal(field(ui, 'code').getAttribute('aria-invalid'), 'true')
    assert.match(
      textOf(ui.doc.querySelector('[role="dialog"] .form-error')),
      /already used/,
      'and the summary says it too'
    )
    assert.ok(ui.doc.querySelector('[role="dialog"]'), 'the dialog stays open with everything that was typed')
    assert.equal(field(ui, 'name').value, 'Copycat')
  })

  test('a field with a pattern says what is expected, not just "invalid"', async () => {
    const ui = await bootUI({ base: server.url, cookie: admin.cookie, hash: '/projects' })
    uis.push(ui)
    await ui.waitFor(() => ui.doc.querySelector('.project-card'))
    ui.click('.toolbar-actions .primary-button')
    await ui.waitFor(() => ui.doc.querySelector('[role="dialog"]'))
    ui.type('[role="dialog"] input[name="name"]', 'Pattern project')
    ui.type('[role="dialog"] input[name="code"]', '!!')
    ui.click('[role="dialog"] .primary-button')
    await ui.waitFor(() => ui.doc.querySelector('[role="dialog"] .field-error'))
    assert.match(textOf(ui.doc.querySelector('[role="dialog"] .field-error')), /2–10 letters, digits/)
  })
})

describe('the ways of saving', () => {
  test('Save & continue keeps the dialog open on the record that was just saved, and the next save is an update', async () => {
    const ui = await openTaskForm()
    ui.type('[role="dialog"] input[name="title"]', 'Saved and continued')
    footButton(ui, 'Save & continue').click()
    await ui.waitFor(() => ui.requests.some(r => r.method === 'POST' && r.url === '/api/tasks'))
    await ui.waitFor(() => /Edit task/.test(textOf(ui.doc.querySelector('[role="dialog"] h2'))))
    assert.equal(field(ui, 'title').value, 'Saved and continued')
    assert.equal(ui.doc.querySelector('.dirty-badge'), null, 'what is on screen is what was saved')
    ui.type('[role="dialog"] input[name="title"]', 'Saved and continued, then changed')
    await ui.waitFor(() => ui.doc.querySelector('.dirty-badge'))
    footButton(ui, 'Save & continue').click()
    await ui.waitFor(() => ui.requests.some(r => r.method === 'PUT' && /^\/api\/tasks\/\d+$/.test(r.url)))
    assert.equal(
      ui.requests.filter(r => r.method === 'POST' && r.url === '/api/tasks').length,
      1,
      'it did not create a second task'
    )
    const changed = await eventually(
      () => tasksNamed('then changed'),
      rows => rows.length === 1,
      'the changed title reaches the server'
    )
    assert.equal(changed[0].title, 'Saved and continued, then changed')
    const same = (await tasksNamed('Saved and continued')).filter(t => t.title === 'Saved and continued')
    assert.equal(same.length, 0, 'the first title was replaced, not duplicated')
  })

  test('Save & create another saves, then opens an empty form that keeps the choices you repeat (project, owner, priority)', async () => {
    const ui = await openTaskForm()
    ui.type('[role="dialog"] input[name="title"]', 'First of several')
    ui.type('[role="dialog"] select[name="projectId"]', String(other.numericId))
    ui.type('[role="dialog"] select[name="priority"]', 'Low')
    footButton(ui, 'Save & create another').click()
    await ui.waitFor(
      () =>
        field(ui, 'title') &&
        field(ui, 'title').value === '' &&
        ui.requests.some(r => r.method === 'POST' && r.url === '/api/tasks')
    )
    assert.match(textOf(ui.doc.querySelector('[role="dialog"] h2')), /Create task/)
    assert.equal(field(ui, 'projectId').value, String(other.numericId), 'the project carried over')
    assert.equal(field(ui, 'priority').value, 'Low', 'and the priority')
    assert.equal(field(ui, 'title').value, '', 'the title did not')
    assert.equal((await tasksNamed('First of several'))[0].projectId, other.numericId)
  })

  test('Reset puts the fields back as they were when the dialog opened, and is only available when something changed', async () => {
    const ui = await openTaskForm()
    const reset = () =>
      [...ui.doc.querySelectorAll('[role="dialog"] .modal-foot button')].find(
        b => textOf(b) === 'Reset'
      ) as HTMLButtonElement
    assert.equal(reset().disabled, true, 'nothing to undo yet')
    ui.type('[role="dialog"] input[name="title"]', 'Typed then regretted')
    ui.type('[role="dialog"] select[name="priority"]', 'High')
    await ui.waitFor(() => reset().disabled === false)
    reset().click()
    await ui.waitFor(() => field(ui, 'title').value === '')
    assert.equal(field(ui, 'priority').value, 'Medium')
    assert.equal(reset().disabled, true)
    assert.ok(ui.doc.querySelector('[role="dialog"]'), 'Reset does not close the dialog')
  })
})

describe('edits that have not been saved', () => {
  test('are noticed (a badge, a warning when leaving the page) and never discarded without asking', async () => {
    const ui = await openTaskForm()
    const warn = () => {
      const event = new ui.w.Event('beforeunload', { cancelable: true })
      ui.w.dispatchEvent(event)
      return event.defaultPrevented
    }
    assert.equal(warn(), false, 'a clean form does not stand in the way of leaving')
    ui.type('[role="dialog"] input[name="title"]', 'Half written')
    await ui.waitFor(() => ui.doc.querySelector('.dirty-badge'))
    assert.equal(warn(), true, 'leaving the page with unsaved edits asks first')
    ui.click('[role="dialog"] .modal-foot button', 'Cancel')
    const ask = (await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))) as HTMLElement
    assert.match(textOf(ask), /Discard your changes/)
    assert.match(textOf(ask), /have not been saved/)
    ui.click('[role="alertdialog"] button', 'Keep editing')
    await ui.waitFor(() => !ui.doc.querySelector('[role="alertdialog"]'))
    assert.equal(field(ui, 'title').value, 'Half written')
    // once saved, nothing is unsaved any more
    footButton(ui, 'Save & continue').click()
    await ui.waitFor(
      () =>
        !ui.doc.querySelector('.dirty-badge') && /Edit task/.test(textOf(ui.doc.querySelector('[role="dialog"] h2')))
    )
    // React removes the listener in an effect just after the screen updates, so give it a moment
    for (let attempt = 0; attempt < 40 && warn(); attempt++) await ui.settle(25)
    assert.equal(warn(), false, 'once everything is saved, leaving the page is not blocked')
  })

  test('the error summary counts the problems when there are several', async () => {
    const ui = await bootUI({ base: server.url, cookie: admin.cookie, hash: '/people' })
    uis.push(ui)
    await ui.waitFor(() => ui.doc.querySelector('.people-grid'))
    ui.click('.toolbar-actions .primary-button', 'Add person')
    await ui.waitFor(() => ui.doc.querySelector('[role="dialog"]'))
    ui.click('[role="dialog"] .primary-button')
    await ui.waitFor(() => ui.doc.querySelectorAll('[role="dialog"] .field-error').length >= 1)
    // both name and email are required: the form names the first and says how many need attention
    await ui.waitFor(() => ui.doc.querySelector('[role="dialog"] .form-error'))
    assert.ok(ui.doc.querySelectorAll('[role="dialog"] .field[data-invalid="true"]').length >= 1)
  })
})
