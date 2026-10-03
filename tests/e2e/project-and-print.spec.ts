// Real-browser checks of the project page and of printing: a click on a project shows all of its tasks, printing produces a report
// built from the database (never a picture of the screen), the print document uses the embedded font and the right direction,
// and both pages pass axe including colour contrast (which the jsdom tests cannot measure).
import { createRequire } from 'node:module'
import { ADMIN, SETUP_TOKEN, api, expect, freshServer, seedWorkspace, test, trackProblems } from './fixtures'

freshServer({ env: { ATLAS_BOOTSTRAP_TASK_LIMIT: '200' } })

const axeSource = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

test.beforeEach(async ({ page, request }) => {
  // The first test of the file creates the workspace through the API; every test then signs in with its own browser context.
  const status = await request.get('/api/setup/status')
  if (!(await status.json()).configured)
    expect(
      (await request.post('/api/setup', { data: { ...ADMIN, token: SETUP_TOKEN } })).status(),
      'setup through the API'
    ).toBe(200)
  const login = await page.request.post('/api/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } })
  expect(login.status()).toBe(200)
})

test('a click on a project shows every task of that project, 50 to a page, and the address can be shared', async ({
  page
}) => {
  const problems = trackProblems(page)
  const { project } = await seedWorkspace(page, 0, { name: 'Big project', code: 'BIG' })
  const client = api(page)
  for (let i = 1; i <= 120; i++)
    await client.post('/api/tasks', { title: `Item ${String(i).padStart(3, '0')}`, projectId: project.numericId })
  await seedWorkspace(page, 3, { name: 'Other project', code: 'OTH' })

  await page.goto('/#/projects')
  await page
    .locator('.project-card', { hasText: 'Big project' })
    .getByRole('link', { name: /Big project/ })
    .click()
  await expect(page).toHaveURL(new RegExp(`#/projects/${project.numericId}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Big project' })).toBeVisible()
  await expect(page.locator('.project-tasks-table tbody tr')).toHaveCount(50)
  await expect(page.locator('.table-pager .results-meta')).toContainText('Showing 1–50 of 120 tasks')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.locator('.table-pager .results-meta')).toContainText('Showing 51–100 of 120 tasks')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.locator('.project-tasks-table tbody tr')).toHaveCount(20)

  // search reaches tasks on pages the browser never loaded
  await page.getByLabel('Search this project').fill('Item 117')
  await expect(page.locator('.project-tasks-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.project-tasks-table tbody tr')).toContainText('Item 117')

  // the address is shareable: a reload lands on the same project
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Big project' })).toBeVisible()
  await expect(page.locator('.project-tasks-table tbody tr')).toHaveCount(50)
  problems.expectNone()
})

test('adding a task and changing a status on the project page work in a real browser', async ({ page }) => {
  const problems = trackProblems(page)
  await page.goto('/')
  const { project } = await seedWorkspace(page, 2, { name: 'Quick project', code: 'QCK' })
  await page.goto(`/#/projects/${project.numericId}`)
  await page.getByLabel('Add a task to this project').fill('Added from the project page')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  const row = page.locator('.project-tasks-table tbody tr', { hasText: 'Added from the project page' })
  await expect(row).toBeVisible()
  await row.getByRole('combobox').selectOption('In progress')
  await expect
    .poll(async () => (await api(page).get(`/api/projects/${project.numericId}/tasks?q=Added`)).body.rows[0]?.status)
    .toBe('In progress')
  problems.expectNone()
})

test('printing builds a report from the data: the preview is the document, the frame prints, the application does not', async ({
  page
}) => {
  const problems = trackProblems(page)
  // The preview frame is sandboxed without scripts, so the browser refuses the helper script Playwright tries to inject into it.
  // That refusal is the sandbox working; it is the only message expected here.
  problems.allow(/Blocked script execution in 'about:srcdoc'/)
  await page.goto('/')
  const { project } = await seedWorkspace(page, 6, { name: 'Printed project', code: 'PRN' })
  await page.goto(`/#/projects/${project.numericId}`)
  await expect(page.locator('.project-tasks-table tbody tr')).toHaveCount(6)
  // Record who calls print(): the application window would print the screen, the preview frame prints the report.
  await page.evaluate(() => {
    ;(window as any).__prints = []
    window.print = () => (window as any).__prints.push('application')
  })

  await page.keyboard.press('Control+P') // the browser's own print would print the screen
  const preview = page.locator('.print-preview')
  await expect(preview).toBeVisible()
  const frame = page.frameLocator('.print-preview iframe')
  await expect(frame.locator('table tbody tr')).toHaveCount(6)
  await expect(frame.locator('h1')).toContainText('Tasks')
  expect(await page.evaluate(() => (window as any).__prints)).toEqual([]) // nothing printed yet
  await page.evaluate(() => {
    const frameWindow = (document.querySelector('.print-preview iframe') as HTMLIFrameElement).contentWindow!
    frameWindow.print = () => (window as any).__prints.push('document')
  })

  // the document uses the embedded font (loaded by the real server) and is left-to-right in English
  const inFrame = page.frames().find(candidate => candidate !== page.mainFrame() && candidate.url() === 'about:srcdoc')!
  expect(await inFrame.evaluate(async () => (await document.fonts.load('12px "Atlas Sans"')).length > 0)).toBe(true)
  expect(await inFrame.evaluate(() => getComputedStyle(document.body).direction)).toBe('ltr')
  expect(await inFrame.evaluate(() => document.querySelectorAll('script').length)).toBe(0)

  await preview.getByRole('button', { name: 'Print' }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__prints)).toEqual(['document'])

  await preview.getByRole('button', { name: 'Close' }).click()
  await expect(preview).toBeHidden()
  problems.expectNone()
})

test('if the application window is printed by any other route, the screen is not what comes out', async ({
  page,
  browserName
}) => {
  await page.goto('/')
  const { project } = await seedWorkspace(page, 3, { name: 'Secret project', code: 'SEC' })
  await page.goto(`/#/projects/${project.numericId}`)
  await expect(page.locator('.project-tasks-table tbody tr')).toHaveCount(3)
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('#root')).toBeHidden()
  const notice = await page.evaluate(() => getComputedStyle(document.body, '::before').content)
  expect(notice).toContain('does not print its screens')
  if (browserName === 'chromium') {
    const pdf = await page.pdf()
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.toString('latin1')).not.toContain('Secret project') // the titles are not in what would be printed
  }
})

test('right-to-left languages print right-to-left with the translated column titles', async ({ page }) => {
  await page.goto('/')
  const { project } = await seedWorkspace(page, 2, { name: 'مشروع الدفع', code: 'ARB' })
  const response = await page.request.post('/api/exports', {
    data: { dataset: 'tasks', format: 'print', language: 'ar', scope: { projectId: project.numericId } },
    headers: { 'Content-Type': 'application/json' }
  })
  expect(response.status()).toBe(200)
  const html = await response.text()
  await page.setContent(html.replace('<head>', `<head><base href="${new URL(page.url()).origin}/">`))
  expect(await page.evaluate(() => document.documentElement.dir)).toBe('rtl')
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('th')!).textAlign)).toMatch(/right|start/)
  await expect(page.locator('thead th').first()).toHaveText('معرّف المهمة')
  expect(await page.evaluate(async () => (await document.fonts.load('12px "Atlas Sans"', 'مرحبا')).length > 0)).toBe(
    true
  )
})

// axe is injected into the page, which the application's strict Content-Security-Policy (correctly) refuses; this one test
// bypasses the policy so the check can run. Every other test in this file runs under the real policy.
test.describe('accessibility in a real browser', () => {
  test.use({ bypassCSP: true })

  test('the project page and the print preview have no accessibility violations, colour contrast included', async ({
    page
  }) => {
    await page.goto('/')
    const { project } = await seedWorkspace(page, 8, { name: 'Accessible project', code: 'ACC' })
    await page.goto(`/#/projects/${project.numericId}`)
    await expect(page.locator('.project-tasks-table tbody tr')).toHaveCount(8)
    await page.addScriptTag({ path: axeSource })
    const run = (context: string) =>
      page.evaluate(async selector => {
        const result = await (window as any).axe.run(document.querySelector(selector) || document, {
          runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa']
        })
        return result.violations.map(
          (v: any) =>
            `${v.id}: ${v.nodes
              .slice(0, 3)
              .map((n: any) => n.target.join(' '))
              .join(' | ')}`
        )
      }, context)
    expect(await run('.project-page')).toEqual([])
    await page.keyboard.press('Control+P')
    await expect(page.locator('.print-preview')).toBeVisible()
    expect(await run('.print-preview')).toEqual([])
  })
})
