import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { Api, PASSWORD, SETUP_TOKEN, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, signIn, textOf } from '../helpers/ui'

const uis: BootedUI[] = []
after(() => uis.forEach(ui => ui.close()))
const boot = async (options: Parameters<typeof bootUI>[0]) => {
  const ui = await bootUI(options)
  uis.push(ui)
  return ui
}
const field = (ui: BootedUI, label: string) => {
  const el = [...ui.doc.querySelectorAll('label')].find(l => textOf(l).startsWith(label))
  if (!el) throw new Error(`no field "${label}"`)
  return el.querySelector('input,select,textarea') as HTMLInputElement
}
const typeInto = (ui: BootedUI, label: string, value: string) => {
  const el = field(ui, label)
  const proto =
    el instanceof ui.w.HTMLSelectElement ? ui.w.HTMLSelectElement.prototype : ui.w.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new ui.w.Event(el instanceof ui.w.HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

describe('first-run setup in the UI (SEC-01)', () => {
  test('the wizard asks for the setup token, previews password quality, and sends only a settings diff', async () => {
    const server = await launch()
    try {
      const ui = await boot({ base: server.url })
      await ui.waitFor(() => ui.doc.querySelector('.setup-shell'))
      for (let step = 0; step < 3; step++) {
        ui.click('.setup-submit')
        await ui.settle(120)
      }
      assert.match(textOf(ui.doc.querySelector('.setup-preview h1')), /Administrator/)
      typeInto(ui, 'Administrator name', 'Ada Admin')
      typeInto(ui, 'Email', 'ada@example.com')
      typeInto(ui, 'Password', 'password123')
      await ui.settle(100)
      assert.match(textOf(ui.doc.querySelector('#password-help')), /too common/)
      assert.equal(
        (ui.doc.querySelector('.setup-submit') as HTMLButtonElement).disabled,
        true,
        'cannot submit with a weak password or without the token'
      )
      typeInto(ui, 'Password', 'Correct-Horse-9')
      typeInto(ui, 'Setup token', 'wrong-token-value')
      await ui.settle(100)
      ui.click('.setup-submit')
      await ui.waitFor(() => /valid setup token/i.test(textOf(ui.doc.querySelector('.form-error'))))
      typeInto(ui, 'Setup token', SETUP_TOKEN)
      await ui.settle(100)
      ui.click('.setup-submit')
      await ui.waitFor(() => ui.doc.querySelector('.app-shell'), 12000)
      const request = ui.requests.filter(r => r.url === '/api/setup').at(-1)!
      assert.ok(
        request.body!.length < 6000,
        `setup payload is ${request.body!.length} bytes (the old client sent the full 130 KB catalog)`
      )
      const body = JSON.parse(request.body!)
      assert.equal(body.token, SETUP_TOKEN)
      assert.equal(JSON.stringify(body.settings).includes('ui.overview'), false)
      assert.deepEqual(ui.errors, [])
    } finally {
      await server.cleanup()
    }
  })
})

describe('signing in', () => {
  test("wrong passwords show the server's message and repeated failures show the lockout", async () => {
    const server = await launch()
    try {
      await setupAdmin(server)
      const ui = await boot({ base: server.url })
      for (let i = 0; i < 5; i++) {
        await signIn(ui, 'admin@example.com', `wrong-password-${i}`)
        await ui.waitFor(
          () =>
            textOf(ui.doc.querySelector('.form-error')).includes('Invalid email or password') ||
            /Try again in/.test(textOf(ui.doc.querySelector('.form-error')))
        )
        await ui.settle(60)
      }
      await signIn(ui, 'admin@example.com', PASSWORD)
      await ui.waitFor(() =>
        /Too many attempts\. Try again in \d+ seconds?\./.test(textOf(ui.doc.querySelector('.form-error')))
      )
    } finally {
      await server.cleanup()
    }
  })

  test('an account whose password an administrator chose must pick its own before it can do anything (SEC-06)', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      await admin.post('/api/users', {
        name: 'Fresh Hire',
        email: 'fresh@example.com',
        password: PASSWORD,
        role: 'Viewer'
      })
      const ui = await boot({ base: server.url })
      await signIn(ui, 'fresh@example.com', PASSWORD)
      await ui.waitFor(() => /Choose a new password/.test(textOf(ui.doc.body)))
      assert.equal(ui.doc.querySelector('.app-shell'), null, 'the application is not available yet')
      assert.equal(
        ui.requests.some(r => r.url === '/api/bootstrap'),
        false,
        'no workspace data was requested'
      )
      typeInto(ui, 'Current password', PASSWORD)
      typeInto(ui, 'New password', 'short')
      typeInto(ui, 'Confirm new password', 'short')
      await ui.settle(100)
      assert.equal((ui.doc.querySelector('.password-form button.primary-button') as HTMLButtonElement).disabled, true)
      typeInto(ui, 'New password', 'My-Own-Passphrase-31')
      typeInto(ui, 'Confirm new password', 'My-Own-Passphrase-31')
      await ui.settle(100)
      ui.click('.password-form button.primary-button')
      await ui.waitFor(() => ui.doc.querySelector('.app-shell'), 12000)
      assert.ok(ui.requests.some(r => r.url === '/api/bootstrap'))
    } finally {
      await server.cleanup()
    }
  })

  test('when the session ends mid-use the user is taken to sign-in with an explanation, not shown a broken screen', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      const viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
      const ui = await boot({ base: server.url, cookie: viewer.api.cookie, hash: '/reports' })
      await ui.waitFor(() => ui.doc.querySelector('.report-hero'))
      await viewer.api.post('/api/auth/logout-all') // revoked elsewhere
      ui.click('.report-tabs button', 'Monthly')
      await ui.waitFor(() => ui.doc.querySelector('.login-form'))
      assert.match(textOf(ui.doc.querySelector('.form-notice')), /session ended/i)
    } finally {
      await server.cleanup()
    }
  })
})

describe('failure handling (UX-04)', () => {
  test('if the workspace cannot be loaded the user is told, with a retry — not shown an empty workspace', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      await admin.post('/api/projects', { name: 'Keep', code: 'KEEP' })
      let failing = true
      const ui = await boot({
        base: server.url,
        cookie: admin.cookie,
        intercept: url =>
          failing && url === '/api/bootstrap'
            ? new Response(JSON.stringify({ error: 'The store is being repaired.' }), {
                status: 500,
                headers: { 'content-type': 'application/json' }
              })
            : undefined
      })
      await ui.waitFor(() => /could not load your workspace/i.test(textOf(ui.doc.body)))
      assert.match(textOf(ui.doc.body), /The store is being repaired\./)
      assert.equal(ui.doc.querySelector('.app-shell'), null, 'no empty shell that looks like lost data')
      failing = false
      ui.click('.loading-screen .primary-button')
      await ui.waitFor(() => ui.doc.querySelector('.app-shell'))
    } finally {
      await server.cleanup()
    }
  })

  test('a screen that throws while rendering is contained: the rest of the app keeps working', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      const project = (await admin.post('/api/projects', { name: 'Boom', code: 'BOOM' })).body
      await admin.post('/api/tasks', { title: 'Will break rendering', projectId: project.numericId })
      const ui = await boot({
        base: server.url,
        cookie: admin.cookie,
        hash: '/overview',
        intercept: async (url, init) => {
          if (url !== '/api/bootstrap') return undefined
          const real = await fetch(server.url + url, {
            ...init,
            headers: { ...(init.headers as any), Cookie: admin.cookie }
          })
          const body = await real.json()
          body.tasks.forEach((task: any) => (task.priority = null)) // malformed data a board card cannot render
          return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
        }
      })
      await ui.waitFor(() => ui.doc.querySelector('.app-shell'))
      ui.click('.nav-item', 'My work')
      await ui.waitFor(() => /could not be displayed/i.test(textOf(ui.doc.body)))
      assert.ok(ui.doc.querySelector('.sidebar'), 'navigation is still there')
      ui.click('.error-actions .primary-button')
      await ui.waitFor(() => ui.doc.querySelector('.welcome-row'))
    } finally {
      await server.cleanup()
    }
  })

  test('losing the connection shows an offline notice', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      const ui = await boot({ base: server.url, cookie: admin.cookie })
      await ui.waitFor(() => ui.doc.querySelector('.app-shell'))
      ui.w.dispatchEvent(new ui.w.Event('offline'))
      await ui.waitFor(() => /appear to be offline/.test(textOf(ui.doc.body)))
      ui.w.dispatchEvent(new ui.w.Event('online'))
      await ui.waitFor(() => !/appear to be offline/.test(textOf(ui.doc.body)))
    } finally {
      await server.cleanup()
    }
  })

  test('changes made by someone else appear without reloading (revision polling)', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      const project = (await admin.post('/api/projects', { name: 'Shared', code: 'SHR' })).body
      const ui = await boot({ base: server.url, cookie: admin.cookie, hash: '/tasks' })
      await ui.waitFor(() => ui.doc.querySelector('.board'))
      assert.equal(ui.doc.querySelectorAll('.board-card').length, 0)
      const other = new Api(server.url)
      await other.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
      await other.post('/api/tasks', { title: 'Added from another browser', projectId: project.numericId })
      ui.w.dispatchEvent(new ui.w.Event('focus')) // returning to the tab triggers the revision check
      await ui.waitFor(() =>
        [...ui.doc.querySelectorAll('.board-card h3')].some(el => textOf(el) === 'Added from another browser')
      )
    } finally {
      await server.cleanup()
    }
  })
})

describe('routing and dialogs (UX-08, UX-05, UX-06)', () => {
  test('pages have URLs: navigation changes the hash, Back works, and a reload lands on the same page', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      const ui = await boot({ base: server.url, cookie: admin.cookie, hash: '/people' })
      await ui.waitFor(() => ui.doc.querySelector('.app-shell'))
      assert.equal(textOf(ui.doc.querySelector('.topbar h1')), 'People')
      ui.click('.nav-item', 'Projects')
      await ui.settle(150)
      assert.equal(ui.w.location.hash, '#/projects')
      await ui.goto('/people')
      assert.equal(textOf(ui.doc.querySelector('.topbar h1')), 'People')
      const reloaded = await boot({ base: server.url, cookie: admin.cookie, hash: '/alerts' })
      await reloaded.waitFor(() => reloaded.doc.querySelector('.app-shell'))
      assert.equal(textOf(reloaded.doc.querySelector('.topbar h1')), 'Alerts')
    } finally {
      await server.cleanup()
    }
  })

  test('record dialogs are real dialogs: labelled, Escape asks before discarding edits, and a clean dialog closes silently', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      await admin.post('/api/projects', { name: 'P', code: 'PRJ' })
      const ui = await boot({ base: server.url, cookie: admin.cookie, hash: '/tasks' })
      await ui.waitFor(() => ui.doc.querySelector('.board'))
      ui.click('.work-toolbar .primary-button')
      const dialog = (await ui.waitFor(() => ui.doc.querySelector('[role="dialog"]'))) as HTMLElement
      assert.equal(dialog.getAttribute('aria-modal'), 'true')
      assert.equal(textOf(ui.doc.getElementById(dialog.getAttribute('aria-labelledby')!)), 'Create task')
      const escape = (el: Element) =>
        el.dispatchEvent(new ui.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      escape(dialog)
      await ui.settle(100)
      assert.equal(ui.doc.querySelector('[role="dialog"]'), null, 'nothing was typed: closes without asking')
      assert.equal(ui.doc.querySelector('[role="alertdialog"]'), null)
      assert.equal(ui.confirms.length, 0, "and the browser's own confirm() is never used")

      ui.click('.work-toolbar .primary-button')
      await ui.waitFor(() => ui.doc.querySelector('[role="dialog"]'))
      ui.type('[role="dialog"] input[required]', 'Half-written task')
      assert.match(textOf(ui.doc.querySelector('.dirty-badge')), /Unsaved changes/, 'unsaved edits are noticed')
      escape(ui.doc.querySelector('[role="dialog"]')!)
      const ask = (await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))) as HTMLElement
      assert.match(textOf(ask), /Discard your changes/)
      assert.equal(ask.getAttribute('aria-modal'), 'true')
      assert.ok(ask.getAttribute('aria-labelledby') && ask.getAttribute('aria-describedby'), 'labelled and described')
      ui.click('[role="alertdialog"] button', 'Keep editing')
      await ui.settle(100)
      assert.equal(ui.doc.querySelector('[role="alertdialog"]'), null)
      assert.ok(ui.doc.querySelector('[role="dialog"]'), 'declined to discard: stays open with the text intact')
      assert.equal(
        (ui.doc.querySelector('[role="dialog"] input[required]') as HTMLInputElement).value,
        'Half-written task'
      )
      ui.click('.modal-backdrop')
      assert.ok(ui.doc.querySelector('[role="dialog"]'), 'a stray click on the backdrop does not throw away typing')
      escape(ui.doc.querySelector('[role="dialog"]')!)
      await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))
      ui.click('[role="alertdialog"] button', 'Discard changes')
      await ui.waitFor(() => !ui.doc.querySelector('[role="dialog"]'))
      assert.equal(ui.doc.querySelector('[role="alertdialog"]'), null)
    } finally {
      await server.cleanup()
    }
  })

  test('a server-side validation error is shown inside the dialog and the dialog stays open', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      await admin.post('/api/projects', { name: 'P', code: 'PRJ' })
      const ui = await boot({ base: server.url, cookie: admin.cookie, hash: '/tasks' })
      await ui.waitFor(() => ui.doc.querySelector('.board'))
      ui.click('.work-toolbar .primary-button')
      await ui.waitFor(() => ui.doc.querySelector('[role="dialog"]'))
      ui.type('[role="dialog"] input[required]', 'x'.repeat(400))
      ui.click('[role="dialog"] .primary-button')
      await ui.waitFor(() => /title/.test(textOf(ui.doc.querySelector('[role="dialog"] .form-error'))))
      assert.ok(ui.doc.querySelector('[role="dialog"]'))
    } finally {
      await server.cleanup()
    }
  })

  test('deleting a project spells out what goes with it and requires a cascade', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      const project = (await admin.post('/api/projects', { name: 'Doomed Project', code: 'DOOM' })).body
      for (let i = 0; i < 3; i++) await admin.post('/api/tasks', { title: `t${i}`, projectId: project.numericId })
      const ui = await boot({ base: server.url, cookie: admin.cookie, hash: '/projects' })
      await ui.waitFor(() => ui.doc.querySelector('.project-card'))
      ui.click('.project-card [aria-label="Edit"]')
      await ui.waitFor(() => ui.doc.querySelector('[role="dialog"]'))
      ui.click('[role="dialog"] .danger-button')
      const ask = (await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))) as HTMLElement
      assert.match(textOf(ask), /Doomed Project.*3 task\(s\)/, 'it names the project and the tasks that go with it')
      assert.match(textOf(ask), /cannot be undone/i, 'and says there is no way back')
      assert.equal(
        ui.requests.filter(r => r.method === 'DELETE').length,
        0,
        'nothing is deleted until the person agrees'
      )
      ui.click('[role="alertdialog"] button', 'Cancel')
      await ui.settle(150)
      assert.equal(ui.requests.filter(r => r.method === 'DELETE').length, 0, 'cancelling deletes nothing')
      assert.ok(ui.doc.querySelector('.project-card'))
      ui.click('[role="dialog"] .danger-button')
      await ui.waitFor(() => ui.doc.querySelector('[role="alertdialog"]'))
      ui.click('[role="alertdialog"] button', 'Delete project')
      await ui.waitFor(() => ui.requests.some(r => r.method === 'DELETE'))
      assert.ok(ui.requests.find(r => r.method === 'DELETE')!.url.endsWith('?cascade=true'))
      await ui.waitFor(() => !ui.doc.querySelector('.project-card'))
    } finally {
      await server.cleanup()
    }
  })
})
