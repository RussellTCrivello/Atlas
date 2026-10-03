// Exports and printing (the user's requirement: they draw directly from the database fields, with real formatting, and never
// print the interface). Black-box through HTTP against a real server, plus unit tests of the formats.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { JSDOM } from 'jsdom'
import { after, before, describe, test } from 'node:test'
import { neutralizeFormula, toCsv } from '../../server/export/formats/csv'
import { safeFilename } from '../../server/export'
import { resetFontCache } from '../../server/services/exports/fonts'
import { auditRows } from '../helpers/db'
import { Api, type TestServer, launch, makeUser, setupAdmin, sleep } from '../helpers/server'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let developer: Awaited<ReturnType<typeof makeUser>>
let viewer: Awaited<ReturnType<typeof makeUser>>
let project: any
let other: any
let devPerson: string

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  developer = await makeUser(server, admin, 'Developer', 'Dev Dana')
  viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
  devPerson = (await admin.get('/api/bootstrap')).body.people.find((p: any) => p.name === 'Dev Dana').id
  project = (await manager.api.post('/api/projects', { name: 'Payments', code: 'PAY' })).body
  other = (await manager.api.post('/api/projects', { name: 'Search', code: 'SRC' })).body
  const make = (body: Record<string, unknown>) =>
    manager.api.post('/api/tasks', { projectId: project.numericId, ...body })
  await make({
    title: '=HYPERLINK("http://evil","Click")',
    priority: 'High',
    dueDate: '2020-01-01',
    assigneeId: devPerson
  })
  await make({ title: 'Plain <b>bold</b> & "quoted"', priority: 'Low', dueDate: '2031-01-01', status: 'In progress' })
  await make({ title: 'Third', priority: 'Medium', status: 'Done', dueDate: '2020-06-01' })
  await manager.api.post('/api/tasks', { projectId: other.numericId, title: 'Other project task' })
})
after(() => server.cleanup())

const request = (api: Api, body: Record<string, unknown>) => api.post('/api/exports', body)
const bytes = (res: { text: string }) => Buffer.from(res.text, 'latin1')

describe('the formats themselves', () => {
  test('CSV neutralises spreadsheet formulas (CSV injection) and keeps plain numbers', () => {
    assert.equal(neutralizeFormula('=1+1'), "'=1+1")
    assert.equal(neutralizeFormula('-5'), '-5')
    assert.equal(neutralizeFormula('+31 20 123 4567'), "'+31 20 123 4567")
    assert.equal(neutralizeFormula('\tcmd'), "'\tcmd")
    assert.equal(neutralizeFormula('hello'), 'hello')
    assert.equal(toCsv([{ key: 'a', label: 'A' }], [{ a: '=x' }, { a: 5 }, { a: null }]), '"A"\r\n"\'=x"\r\n"5"\r\n""')
  })

  test('file names keep letters from every script and are safe on every OS', () => {
    assert.equal(safeFilename('تقرير المشاريع'), 'تقرير-المشاريع')
    assert.equal(safeFilename('a/b\\c:d*e?"f<g>h|i'), 'a-b-c-d-e-f-g-h-i')
    assert.equal(safeFilename('   '), 'atlas-export')
    assert.equal(safeFilename('日本語のレポート'), '日本語のレポート')
  })
})

describe('who may export what', () => {
  test('a role without exportData gets nothing: no file, no preview, no catalogue entries', async () => {
    assert.equal(
      (await admin.put('/api/settings', { permissions: { roles: { Reader: { permissions: ['viewReports'] } } } }))
        .status,
      200
    )
    const reader = await makeUser(server, admin, 'Reader', 'Rita Reader')
    assert.equal((await request(reader.api, { dataset: 'tasks', format: 'csv' })).status, 403)
    assert.equal((await request(reader.api, { dataset: 'tasks', format: 'csv', preview: true })).status, 403)
    assert.equal((await reader.api.get('/api/exports/datasets')).body.datasets.length, 0)
    assert.equal((await new Api(server.url).post('/api/exports', { dataset: 'tasks', format: 'csv' })).status, 401)
    assert.ok(
      (await viewer.api.get('/api/exports/datasets')).body.datasets.length > 0,
      'the built-in Viewer role may export what it can read'
    )
  })

  test('sensitive datasets need their own permission as well', async () => {
    assert.equal((await request(manager.api, { dataset: 'users', format: 'csv' })).status, 403, 'users: manageUsers')
    assert.equal((await request(manager.api, { dataset: 'audit', format: 'csv' })).status, 403, 'audit: manageSettings')
    assert.equal((await request(admin, { dataset: 'users', format: 'csv' })).status, 200)
    assert.equal((await request(admin, { dataset: 'audit', format: 'csv' })).status, 200)
    const catalogue = (await manager.api.get('/api/exports/datasets')).body.datasets.map((d: any) => d.id)
    assert.ok(catalogue.includes('tasks') && !catalogue.includes('users') && !catalogue.includes('audit'))
  })

  test('per-person activity exports follow the same visibility rule as the screen (GOV-02)', async () => {
    await developer.api.post('/api/activity', { today: 'Wrote the exporter' })
    await manager.api.post('/api/activity', { today: 'Reviewed the exporter' })
    const names = async (api: Api) =>
      JSON.parse((await request(api, { dataset: 'activity-summary', format: 'json' })).text).sections[0].rows.map(
        (row: any) => row.person
      )
    assert.deepEqual(await names(developer.api), ['Dev Dana'], 'a developer exports only their own activity')
    const asManager = await names(manager.api)
    assert.ok(asManager.includes('Dev Dana') && asManager.includes('Mia Manager'), 'a manager sees everyone')
    const log = JSON.parse((await request(developer.api, { dataset: 'activity-log', format: 'json' })).text).sections[0]
      .rows
    assert.ok(log.length > 0 && log.every((row: any) => row.person === 'Dev Dana'), 'and so does the detailed log')
    assert.equal(
      (
        await request(developer.api, {
          dataset: 'activity-log',
          format: 'json',
          scope: { userId: 'person_someone_else' }
        })
      ).status,
      403
    )
  })

  test('the administrator controls which formats exist, and unknown datasets are a clear 404', async () => {
    assert.equal((await admin.put('/api/settings', { exports: { formats: ['csv'] } })).status, 200)
    try {
      assert.equal((await request(manager.api, { dataset: 'tasks', format: 'pdf' })).status, 403)
      assert.equal((await request(manager.api, { dataset: 'tasks', format: 'csv' })).status, 200)
      assert.deepEqual((await manager.api.get('/api/exports/datasets')).body.formats, ['csv'])
    } finally {
      await admin.put('/api/settings', { exports: { formats: ['csv', 'xlsx', 'json', 'pdf', 'print'] } })
    }
    assert.equal((await request(manager.api, { dataset: 'passwords', format: 'csv' })).status, 404)
    assert.equal((await request(manager.api, { dataset: 'tasks', format: 'docx' })).status, 400)
    assert.equal((await request(manager.api, { dataset: 'tasks', format: 'csv', columns: ['nope'] })).status, 400)
  })

  test('no dataset can reveal a credential, whatever columns or filters are asked for', async () => {
    for (const dataset of (await admin.get('/api/exports/datasets')).body.datasets) {
      const all = dataset.columns.map((c: any) => c.key)
      const res = await request(admin, {
        dataset: dataset.id,
        format: 'json',
        columns: all,
        scope: { projectId: project.numericId }
      })
      assert.ok([200, 400].includes(res.status), `${dataset.id}: ${res.status}`)
      assert.doesNotMatch(res.text, /scrypt\$|passwordHash|password_hash/, `${dataset.id} leaked a credential`)
    }
  })
})

describe('what an export contains', () => {
  test('CSV: BOM, CRLF, every cell quoted, formulas neutralised, dates ISO, only the chosen columns in the chosen order', async () => {
    const res = await request(manager.api, {
      dataset: 'tasks',
      format: 'csv',
      columns: ['id', 'title', 'dueDate', 'blocked'],
      scope: { projectId: project.numericId }
    })
    assert.equal(res.status, 200)
    assert.match(String(res.headers.get('content-type')), /text\/csv/)
    assert.match(String(res.headers.get('content-disposition')), /attachment; filename="Tasks\.csv"/)
    const raw = Buffer.from(
      await (
        await fetch(server.url + '/api/exports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: manager.api.cookie },
          body: JSON.stringify({
            dataset: 'tasks',
            format: 'csv',
            columns: ['id', 'title', 'dueDate', 'blocked'],
            scope: { projectId: project.numericId }
          })
        })
      ).arrayBuffer()
    )
    assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 byte-order mark so Excel reads other scripts')
    const lines = res.text.replace(/^\ufeff/, '').split('\r\n')
    assert.equal(lines[0], '"Task ID","Task","Due date","Blocked"')
    assert.equal(lines.length, 4, 'header plus the three tasks of this project (not the other project)')
    assert.ok(
      lines.some(line => line.includes(`"'=HYPERLINK(""http://evil"",""Click"")"`)),
      'the formula is defanged and quotes are doubled'
    )
    assert.ok(
      lines.some(line => /"2031-01-01"/.test(line)),
      'dates are ISO'
    )
    assert.ok(lines.every(line => !line.includes('Other project task')))
  })

  test('JSON: typed values, and every column names the database field it reads', async () => {
    const doc = JSON.parse(
      (await request(manager.api, { dataset: 'tasks', format: 'json', scope: { projectId: project.numericId } })).text
    )
    const table = doc.sections[0]
    assert.equal(doc.document.title, 'Tasks')
    assert.equal(table.rows.length, 3)
    assert.equal(table.columns.find((c: any) => c.key === 'dueDate').source, 'tasks.due_date')
    assert.equal(typeof table.rows[0].title, 'string')
    assert.ok(!('_done' in table.rows[0]), 'internal helper fields never leave the server')
    const blocked = JSON.parse(
      (await request(manager.api, { dataset: 'tasks', format: 'json', columns: ['blocked'] })).text
    ).sections[0].rows[0]
    assert.equal(typeof blocked.blocked, 'boolean')
  })

  test('filters, search and sorting are applied by the server on the database, not on what the screen shows', async () => {
    const rows = async (body: Record<string, unknown>) =>
      JSON.parse(
        (
          await request(manager.api, {
            dataset: 'tasks',
            format: 'json',
            columns: ['id', 'title', 'priority', 'status'],
            ...body
          })
        ).text
      ).sections[0].rows
    assert.deepEqual(
      (await rows({ scope: { projectId: project.numericId, priority: 'High' } })).map((r: any) => r.priority),
      ['High']
    )
    assert.equal(
      (await rows({ scope: { projectId: project.numericId, state: 'overdue' } })).length,
      1,
      'only the open task that is past due'
    )
    assert.equal((await rows({ scope: { projectId: project.numericId, state: 'done' } })).length, 1)
    assert.deepEqual(
      (await rows({ q: 'bold' })).map((r: any) => r.title),
      ['Plain <b>bold</b> & "quoted"'],
      'full-text search'
    )
    const advanced = await rows({
      scope: { projectId: project.numericId },
      filters: [
        { field: 'priority', operator: 'equals', value: 'High' },
        { field: 'priority', operator: 'equals', value: 'Low', join: 'OR' }
      ]
    })
    assert.deepEqual(
      advanced.map((r: any) => r.priority).sort(),
      ['High', 'Low'],
      'the same AND/OR conditions the screen builds'
    )
    const sorted = await rows({ scope: { projectId: project.numericId }, sort: { key: 'title', dir: 'desc' } })
    assert.deepEqual(
      sorted.map((r: any) => r.title),
      [...sorted.map((r: any) => r.title)].sort((a, b) => b.localeCompare(a))
    )
    const managerPerson = (await admin.get('/api/bootstrap')).body.people.find((p: any) => p.name === 'Mia Manager').id
    const assignedToManager = (await admin.get('/api/bootstrap')).body.tasks.filter(
      (t: any) => t.assigneeId === managerPerson
    ).length
    assert.equal(
      (await rows({ scope: { assignee: 'me' } })).length,
      assignedToManager,
      '"me" is the person making the request'
    )
    assert.equal((await rows({ scope: { assignee: 'none' } })).length, 0)
    assert.equal((await rows({ scope: { projectId: project.numericId, assignee: devPerson } })).length, 1)
  })

  test('the preview says how many rows an export will contain and shows a sample, without producing a file', async () => {
    const res = await request(manager.api, {
      dataset: 'tasks',
      format: 'csv',
      preview: true,
      scope: { projectId: project.numericId },
      filters: [{ field: 'priority', operator: 'notEquals', value: 'Low' }]
    })
    assert.equal(res.status, 200)
    assert.match(String(res.headers.get('content-type')), /json/)
    assert.equal(res.body.rows, 2)
    assert.ok(res.body.sample.length <= 5 && res.body.sample[0].title)
    assert.deepEqual(res.body.filters.length, 1)
    assert.equal(
      auditRows(server, 'data.exported').filter(e => e.detail.format === 'csv' && e.detail.rows === 2).length,
      0,
      'a preview is not an export'
    )
  })

  test('grouping and totals: the project report groups every task by workflow status', async () => {
    const doc = JSON.parse(
      (
        await request(manager.api, {
          dataset: 'project-report',
          format: 'json',
          scope: { projectId: project.numericId }
        })
      ).text
    )
    assert.equal(doc.document.subtitle.startsWith('PAY'), true)
    const kinds = doc.sections.map((s: any) => s.kind)
    assert.deepEqual(kinds.slice(0, 3), ['summary', 'bars', 'bars'])
    const tasks = doc.sections.find((s: any) => s.id === 'tasks')
    assert.equal(tasks.rows.length, 3, 'all tasks of the project')
    const order = tasks.rows.map((r: any) => r.status)
    assert.deepEqual(
      order,
      [...order].sort(
        (a, b) =>
          ['To do', 'In progress', 'Review', 'Testing', 'Done'].indexOf(a) -
          ['To do', 'In progress', 'Review', 'Testing', 'Done'].indexOf(b)
      )
    )
    const summary = doc.sections[0].items
    assert.equal(summary.find((i: any) => i.label === 'Open tasks').value, 2)
    assert.equal(summary.find((i: any) => i.label === 'Overdue').value, 1)
  })

  test('every dataset can be produced in every format', async () => {
    const catalogue = (await admin.get('/api/exports/datasets')).body
    for (const dataset of catalogue.datasets)
      for (const format of catalogue.formats) {
        const res = await request(admin, { dataset: dataset.id, format, scope: { projectId: project.numericId } })
        assert.equal(res.status, 200, `${dataset.id} as ${format}: ${res.text.slice(0, 120)}`)
      }
  })

  test('exports are recorded in the audit trail with what, how many rows and how many columns', async () => {
    await request(manager.api, { dataset: 'projects', format: 'xlsx', columns: ['name', 'code', 'health'] })
    await sleep(50)
    const entry = auditRows(server, 'data.exported').at(-1)!
    assert.equal(entry.detail.dataset, 'projects')
    assert.ok(entry, 'recorded before the file was handed over')
    assert.equal(entry.detail.format, 'xlsx')
    assert.equal(entry.detail.columns, 3)
    assert.equal(entry.detail.rows, 2)
    assert.equal(entry.actor_id.length > 0, true)
  })
})

describe('spreadsheet (xlsx)', () => {
  const fetchBinary = async (body: Record<string, unknown>) =>
    Buffer.from(
      await (
        await fetch(server.url + '/api/exports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: manager.api.cookie },
          body: JSON.stringify(body)
        })
      ).arrayBuffer()
    )

  test('a real workbook: well-formed XML parts, styles, frozen header, auto-filter, real dates and numbers, inline text', async () => {
    const zip = unzipSync(
      await fetchBinary({ dataset: 'tasks', format: 'xlsx', scope: { projectId: project.numericId } })
    )
    for (const part of [
      '[Content_Types].xml',
      'xl/workbook.xml',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'docProps/core.xml'
    ])
      assert.ok(zip[part], `${part} is in the package`)
    for (const [name, data] of Object.entries(zip)) new JSDOM(strFromU8(data), { contentType: 'text/xml' }) // throws on malformed XML
    const sheet = strFromU8(zip['xl/worksheets/sheet1.xml'])
    assert.match(sheet, /<pane ySplit="\d+"[^>]*state="frozen"/, 'the header row is frozen')
    assert.match(sheet, /<autoFilter ref="A\d+:[A-Z]+\d+"\/>/)
    assert.match(sheet, /<pageSetup[^>]*orientation="landscape"[^>]*fitToWidth="1"/)
    assert.match(
      sheet,
      /<c r="G\d+" s="\d+"><v>\d{5}<\/v><\/c>/,
      'due dates are Excel serial numbers, so sorting and filtering by date work'
    )
    assert.doesNotMatch(sheet, /<f>/, 'no cell contains a formula')
    assert.match(
      sheet,
      /t="inlineStr"[^>]*><is><t[^>]*>=HYPERLINK\(&quot;http:\/\/evil&quot;,&quot;Click&quot;\)<\/t>/,
      'formula-looking text is stored as text'
    )
    const workbook = strFromU8(zip['xl/workbook.xml'])
    assert.match(workbook, /_xlnm\._FilterDatabase/)
    assert.match(workbook, /_xlnm\.Print_Titles/)
    assert.match(strFromU8(zip['xl/styles.xml']), /<fill><patternFill patternType="solid">/, 'tone fills exist')
  })

  test('control characters cannot corrupt the workbook, and right-to-left languages flip the sheet', async () => {
    await manager.api.post('/api/tasks', { projectId: project.numericId, title: `bell\u0007 and escape\u001b ok` })
    const ar = unzipSync(
      await fetchBinary({ dataset: 'tasks', format: 'xlsx', language: 'ar', scope: { projectId: project.numericId } })
    )
    const sheet = strFromU8(ar['xl/worksheets/sheet1.xml'])
    assert.match(sheet, /rightToLeft="1"/)
    assert.match(sheet, /bell and escape ok/)
    new JSDOM(sheet, { contentType: 'text/xml' })
    await manager.api.delete(
      `/api/tasks/${(await manager.api.get(`/api/projects/${project.numericId}/tasks?q=escape`)).body.rows[0].numericId}`
    )
  })

  test('a document with a summary and several tables becomes several sheets', async () => {
    const zip = unzipSync(
      await fetchBinary({ dataset: 'project-report', format: 'xlsx', scope: { projectId: project.numericId } })
    )
    const sheets = Object.keys(zip).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    assert.ok(sheets.length >= 3, `${sheets.length} sheets`)
    assert.match(
      strFromU8(zip['xl/worksheets/sheet1.xml']),
      /dataBar/,
      'the status bars are data bars in the summary sheet'
    )
  })
})

describe('PDF', () => {
  const pdf = async (body: Record<string, unknown>) => {
    const res = await fetch(server.url + '/api/exports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: manager.api.cookie },
      body: JSON.stringify({ format: 'pdf', ...body })
    })
    return { res, bytes: Buffer.from(await res.arrayBuffer()) }
  }

  test('a real PDF with the Unicode font embedded in both weights and no fallback warning', async () => {
    const { res, bytes } = await pdf({ dataset: 'tasks', scope: { projectId: project.numericId } })
    assert.equal(res.status, 200)
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    assert.ok(bytes.length > 20_000, 'the embedded font makes the file substantial')
    assert.equal(res.headers.get('x-atlas-basic-font'), null)
    const text = bytes.toString('latin1')
    assert.ok((text.match(/\/Type\s*\/Font\b/g) || []).length >= 2, 'both weights are registered')
  })

  test('long tables flow over several pages with the header repeated', async () => {
    const many = (await manager.api.post('/api/projects', { name: 'Many', code: 'MNY' })).body
    server.db.transaction(() => {
      for (let i = 0; i < 160; i++)
        server.db.run(
          "INSERT INTO tasks(key, title, project_id, status, created_at, priority) VALUES (?, ?, ?, 'To do', '2026-01-01', 'Medium')",
          [`MNY-${i}`, `Task number ${i}`, many.numericId]
        )
    })
    const { bytes } = await pdf({ dataset: 'tasks', scope: { projectId: many.numericId }, orientation: 'portrait' })
    const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length
    assert.ok(pages >= 4, `${pages} pages`)
  })

  test('PDF and print refuse absurd sizes with a clear message, while the data formats still work', async () => {
    const big = (await manager.api.post('/api/projects', { name: 'Big', code: 'BIG' })).body
    server.db.transaction(() => {
      for (let i = 0; i < 5100; i++)
        server.db.run(
          "INSERT INTO tasks(key, title, project_id, status, created_at) VALUES (?, ?, ?, 'To do', '2026-01-01')",
          [`BIG-${i}`, `Item ${i}`, big.numericId]
        )
    })
    const { res, bytes } = await pdf({ dataset: 'tasks', scope: { projectId: big.numericId } })
    assert.equal(res.status, 413)
    const body = JSON.parse(bytes.toString())
    assert.equal(body.code, 'TOO_MANY_ROWS')
    assert.match(body.error, /5,000/)
    assert.equal(
      (await request(manager.api, { dataset: 'tasks', format: 'print', scope: { projectId: big.numericId } })).status,
      413
    )
    assert.equal(
      (await request(manager.api, { dataset: 'tasks', format: 'csv', scope: { projectId: big.numericId } })).status,
      200
    )
  })
})

describe('PDF fonts (MIN-03)', () => {
  test('without the font files a PDF is still produced, the response says so, and the next export retries', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-nofonts-'))
    resetFontCache() // a fresh process would have nothing cached
    const bare = await launch({ env: { ATLAS_ROOT: home, ATLAS_STATIC_DIR: home } })
    try {
      const api = await setupAdmin(bare)
      await api.post('/api/projects', { name: 'Fonts', code: 'FNT' })
      const ask = async () => {
        const res = await fetch(bare.url + '/api/exports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: api.cookie },
          body: JSON.stringify({ dataset: 'projects', format: 'pdf' })
        })
        return { res, bytes: Buffer.from(await res.arrayBuffer()) }
      }
      const first = await ask()
      assert.equal(first.res.status, 200)
      assert.equal(first.bytes.subarray(0, 5).toString(), '%PDF-')
      assert.equal(
        first.res.headers.get('x-atlas-basic-font'),
        '1',
        'the caller is told that Arabic, Persian and Hebrew may not display'
      )
      assert.ok(first.bytes.length < 30_000, 'no Unicode font embedded')
      fs.mkdirSync(path.join(home, 'public', 'fonts'), { recursive: true })
      for (const file of ['AtlasSans-Regular.ttf', 'AtlasSans-Bold.ttf'])
        fs.copyFileSync(
          path.join(import.meta.dirname, '..', '..', 'public', 'fonts', file),
          path.join(home, 'public', 'fonts', file)
        )
      const second = await ask()
      assert.equal(second.res.headers.get('x-atlas-basic-font'), null, 'the fonts were found this time')
      assert.ok(second.bytes.length > 100_000)
    } finally {
      await bare.cleanup()
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('the print document', () => {
  const printed = async (body: Record<string, unknown> = {}) =>
    request(manager.api, { dataset: 'tasks', format: 'print', scope: { projectId: project.numericId }, ...body })

  test('is a standalone page built from the database: a table, a print stylesheet, no script, and none of the application shell', async () => {
    const res = await printed()
    assert.equal(res.status, 200)
    assert.match(String(res.headers.get('content-type')), /text\/html/)
    assert.match(String(res.headers.get('content-disposition')), /^inline/)
    const dom = new JSDOM(res.text)
    const doc = dom.window.document
    assert.equal(doc.querySelectorAll('tbody tr').length, 3)
    assert.ok(doc.querySelector('thead th[scope=col]'), 'a real table header (repeated on every printed page)')
    assert.equal(doc.querySelectorAll('script').length, 0, 'a print page runs no script')
    assert.match(res.text, /@page\{size:A4 landscape;margin:14mm/)
    assert.match(res.text, /print-color-adjust:exact/)
    assert.equal(doc.querySelector('#root, .sidebar, nav'), null, 'nothing of the interface is in it')
    assert.equal(doc.documentElement.getAttribute('dir'), 'ltr')
  })

  test('escapes every value: markup typed into a task cannot become markup in the print page', async () => {
    const res = await printed()
    assert.ok(!res.text.includes('<b>bold</b>'))
    assert.ok(res.text.includes('Plain &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;'))
    const evil = (
      await manager.api.post('/api/tasks', {
        projectId: project.numericId,
        title: '</style><script>alert(1)</script><img src=x onerror=alert(2)>'
      })
    ).body
    const page = await printed({ scope: { projectId: project.numericId }, title: '</title><script>alert(3)</script>' })
    assert.equal(new JSDOM(page.text).window.document.querySelectorAll('script, img').length, 0)
    assert.ok(!/<script/i.test(page.text))
    await manager.api.delete(`/api/tasks/${evil.numericId}`)
  })

  test('is served with a policy that lets it style itself and use our fonts, and nothing else', async () => {
    const csp = String((await printed()).headers.get('content-security-policy'))
    assert.match(csp, /default-src 'none'/)
    assert.match(csp, /style-src 'unsafe-inline'/)
    assert.doesNotMatch(csp, /script-src/)
    assert.match(csp, /frame-ancestors 'self'/)
  })

  test("follows the workspace: language and direction, the administrator's footer and template, orientation and margins", async () => {
    assert.equal(
      (
        await admin.put('/api/settings', {
          reports: { defaultTemplate: 'compact', branding: { footerText: 'Confidential · ACME' } },
          exports: { pdf: { orientation: 'portrait', margins: 'wide' } }
        })
      ).status,
      200
    )
    try {
      const res = await printed()
      assert.match(res.text, /data-template="compact"/)
      assert.match(res.text, /Confidential · ACME/)
      assert.match(res.text, /@page\{size:A4 portrait;margin:20mm/)
      const ar = await printed({ language: 'ar', template: 'executive', orientation: 'landscape', margin: 10 })
      const doc = new JSDOM(ar.text).window.document
      assert.equal(doc.documentElement.getAttribute('dir'), 'rtl')
      assert.equal(doc.documentElement.getAttribute('lang'), 'ar')
      assert.equal(doc.querySelector('thead th')?.textContent, 'معرّف المهمة', 'column titles are translated')
      assert.match(ar.text, /data-template="executive"/)
      assert.match(ar.text, /margin:10mm/)
    } finally {
      await admin.put('/api/settings', {
        reports: { defaultTemplate: 'executive', branding: { footerText: '' } },
        exports: { pdf: { orientation: 'landscape', margins: 'standard' } }
      })
    }
  })

  test('the filters that narrowed a report are printed on it', async () => {
    const res = await printed({ filters: [{ field: 'priority', operator: 'equals', value: 'High' }] })
    const doc = new JSDOM(res.text).window.document
    assert.match(doc.querySelector('.filters')?.textContent || '', /Priority equals “High”/)
    assert.equal(doc.querySelectorAll('tbody tr').length, 1)
  })
})
