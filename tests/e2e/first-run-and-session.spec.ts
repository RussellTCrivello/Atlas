// First run, sign-in, sign-out, lockout, session expiry and restart, in a real browser against the built bundle.
import {
  ADMIN,
  PASSWORD,
  SETUP_TOKEN,
  api,
  completeSetup,
  expect,
  freshServer,
  signIn,
  signOut,
  test,
  trackProblems
} from './fixtures'

const atlas = freshServer()

test('first run: the wizard insists on a strong password and the setup token, then the workspace opens', async ({
  page
}) => {
  const problems = trackProblems(page)
  await page.goto('/')
  await expect(page).toHaveTitle(/Atlas/)
  await expect(page.locator('.setup-shell')).toBeVisible()
  for (let step = 0; step < 3; step++) await page.locator('.setup-submit').click()

  await page.getByLabel('Administrator name').fill(ADMIN.name)
  await page.getByLabel('Email').fill(ADMIN.email)
  await page.getByLabel('Password').fill('password123')
  await expect(page.locator('#password-help')).toContainText(/too common/i)
  await expect(page.locator('.setup-submit')).toBeDisabled()

  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByLabel('Setup token').fill('this-is-not-the-token')
  await page.locator('.setup-submit').click()
  await expect(page.locator('.form-error')).toContainText(/valid setup token/i)
  await expect(page.locator('.app-shell')).toHaveCount(0)

  await page.getByLabel('Setup token').fill(SETUP_TOKEN)
  await page.locator('.setup-submit').click()
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Overview', exact: true })).toBeVisible()
  problems.allow(/403.*\/api\/setup/) // the deliberate wrong token
  problems.expectNone()
})

test('the workspace cannot be set up a second time', async ({ page, request }) => {
  const res = await request.post('/api/setup', {
    data: { name: 'Mallory', email: 'm@evil.test', password: 'Passw0rd!!', token: SETUP_TOKEN }
  })
  expect(res.status()).toBe(409)
  await page.goto('/')
  await expect(page.locator('.setup-shell')).toHaveCount(0) // a configured workspace shows the sign-in screen, never the wizard
  await expect(page.locator('.login-shell')).toBeVisible()
})

test('sign in, refresh, deep link, sign out; wrong passwords are explained', async ({ page }) => {
  const problems = trackProblems(page)
  await page.goto('/')
  await signIn(page, ADMIN.email, 'definitely-wrong-password')
  await expect(page.locator('.form-error')).toContainText(/Invalid email or password/i)
  await expect(page.locator('.app-shell')).toHaveCount(0)

  await signIn(page, ADMIN.email, ADMIN.password)
  await expect(page.locator('.app-shell')).toBeVisible()

  await page.reload() // the session cookie survives a refresh
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.goto('/#/people') // and a deep link opens the right page
  await expect(page.getByRole('heading', { level: 1, name: 'People', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'People', exact: true })).toBeVisible()

  await signOut(page)
  await page.goto('/#/people') // after sign-out a deep link asks for credentials instead of showing data
  await expect(page.locator('.login-shell')).toBeVisible()
  await expect(page.locator('.app-shell')).toHaveCount(0)
  problems.allow(/401|403/)
  problems.expectNone()
})

test('repeated wrong passwords lock the account for a while, even against the right password', async ({
  page,
  browser
}) => {
  // A second account, so that the administrator stays usable for the rest of the file.
  await page.goto('/')
  await signIn(page, ADMIN.email, ADMIN.password)
  await expect(page.locator('.app-shell')).toBeVisible()
  const created = await api(page).post('/api/users', {
    name: 'Lou Locked',
    email: 'lou@example.com',
    password: PASSWORD,
    role: 'Viewer',
    mustChangePassword: false
  })
  expect(created.status).toBe(200)
  await signOut(page)

  const context = await browser.newContext({ baseURL: atlas().url })
  const victim = await context.newPage()
  await victim.goto('/')
  for (let attempt = 0; attempt < 5; attempt++) {
    await signIn(victim, 'lou@example.com', `wrong-password-${attempt}`)
    await expect(victim.locator('.form-error')).toBeVisible()
  }
  await signIn(victim, 'lou@example.com', PASSWORD)
  await expect(victim.locator('.form-error')).toContainText(/Too many attempts\. Try again in \d+ seconds?\./)
  await expect(victim.locator('.app-shell')).toHaveCount(0)
  await context.close()
})

test('a session survives a server restart, and is refused once it has been revoked', async ({ page }) => {
  await page.goto('/')
  await signIn(page, ADMIN.email, ADMIN.password)
  await expect(page.locator('.app-shell')).toBeVisible()

  await atlas().restart() // a deploy, a crash and a process manager, or a reboot
  await page.reload()
  await expect(page.locator('.app-shell')).toBeVisible()

  // Revoke every session of this account from "another device" (here: the same cookie, through the API).
  expect((await api(page).post('/api/auth/logout-all')).status).toBe(200)
  // The screen notices on its next check: every 20 s, or at once when the tab regains focus (the real browser event).
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.locator('.login-shell')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.form-notice')).toContainText(/session ended/i)
  await expect(page.locator('.app-shell')).toHaveCount(0)
})

test('an account whose password an administrator chose must pick its own first', async ({ page, browser }) => {
  await page.goto('/')
  await signIn(page, ADMIN.email, ADMIN.password)
  await expect(page.locator('.app-shell')).toBeVisible()
  const created = await api(page).post('/api/users', {
    name: 'Nia New',
    email: 'nia@example.com',
    password: 'Initial-Passw0rd-1',
    role: 'Developer'
  })
  expect(created.status).toBe(200)
  await signOut(page)

  const context = await browser.newContext({ baseURL: atlas().url })
  const newcomer = await context.newPage()
  await newcomer.goto('/')
  await signIn(newcomer, 'nia@example.com', 'Initial-Passw0rd-1')
  await expect(newcomer.locator('.login-shell')).toBeVisible() // the forced-change screen reuses the sign-in layout
  await expect(newcomer.getByText(/choose a new password|change your password/i).first()).toBeVisible()
  await context.close()
})
