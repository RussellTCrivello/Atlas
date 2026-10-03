// CSV import, saved views, and bulk changes and copies of projects, people, milestones and alerts. Same approach as
// records-tasks.test.ts: a real server and database, and for each behaviour the case that must be refused.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { auditRows, listBackups, ledgerFor } from '../helpers/db'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let developer: Awaited<ReturnType<typeof makeUser>>
let viewer: Awaited<ReturnType<typeof makeUser>>
let project: any
let devPerson: string
let managerPerson: string

const taskCount = () => server.db.scalar('SELECT count(*) FROM tasks') as number
const importCsv = (csv: string, extra: Record<string, unknown> = {}, api: Api = manager.api) =>
  api.post('/api/tasks/import', { csv, ...extra })

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  developer = await makeUser(server, admin, 'Developer', 'Dev Dana')
  viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
  const boot = (await admin.get('/api/bootstrap')).body
  devPerson = boot.people.find((p: any) => p.name === 'Dev Dana').id
  managerPerson = boot.people.find((p: any) => p.name === 'Mia Manager').id
  project = (await manager.api.post('/api/projects', { name: 'Payments', code: 'PAY' })).body
})
after(() => server.cleanup())

describe('importing tasks from CSV', () => {
  const GOOD = [
    'Title,Project,Owner,Priority,Status,Due date,Blocked,Tags',
    'Write the spec,PAY,Dev Dana,High,In progress,2031-02-03,no,"docs, planning"',
    'Review the spec,Payments,dev.dana@example.com,low,to do,2031-02-04,yes,docs',
    'No owner no date,PAY,,,,,,'
  ].join('\n')

  test('a dry run reports what would happen and creates nothing', async () => {
    const before = taskCount()
    const res = await importCsv(GOOD, { dryRun: true })
    assert.equal(res.status, 200)
    assert.equal(res.body.dryRun, true)
    assert.equal(res.body.imported, false)
    assert.deepEqual(res.body.totals, { rows: 3, valid: 3, invalid: 0, duplicates: 0, created: 0 })
    assert.equal(taskCount(), before, 'nothing was written')
    const mapped = Object.fromEntries(res.body.columns.map((c: any) => [c.header, c.field]))
    assert.deepEqual(mapped, {
      Title: 'title',
      Project: 'project',
      Owner: 'assignee',
      Priority: 'priority',
      Status: 'status',
      'Due date': 'dueDate',
      Blocked: 'blocked',
      Tags: 'tags'
    })
    assert.equal(res.body.preview[1].assignee, 'dev.dana@example.com')
    assert.equal(res.body.preview[1].status, 'To do', 'the status is shown as it will be stored')
  })

  test('the import creates the tasks, with tags, owners, dates and one audit entry for the whole file', async () => {
    const auditBefore = auditRows(server).length
    const res = await importCsv(GOOD)
    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.imported, true)
    assert.equal(res.body.totals.created, 3)
    const found = (await admin.get('/api/tasks?q=spec&pageSize=50&sort=key')).body.rows
    const first = found.find((t: any) => t.title === 'Write the spec')
    assert.equal(first.priority, 'High')
    assert.equal(first.status, 'In progress')
    assert.equal(first.assigneeId, devPerson)
    assert.equal(first.dueDate, '2031-02-03')
    assert.deepEqual(first.tags.map((t: any) => t.name).sort(), ['docs', 'planning'])
    const second = found.find((t: any) => t.title === 'Review the spec')
    assert.equal(second.priority, 'Low')
    assert.equal(second.blocked, true)
    assert.equal(second.assigneeId, devPerson, 'matched by email address')
    const bare = (await admin.get('/api/tasks?q=owner&pageSize=50')).body.rows.find(
      (t: any) => t.title === 'No owner no date'
    )
    assert.equal(bare.assigneeId, '', 'an empty owner cell means nobody, not the person importing')
    assert.equal(bare.dueDate, '')
    const entries = auditRows(server).slice(auditBefore)
    assert.deepEqual(
      entries.map(e => e.action),
      ['task.imported'],
      'one entry for the file, not one per row'
    )
    assert.equal(entries[0].detail.created, 3)
    assert.ok(
      ledgerFor(server, first.numericId).some(row => row.action === 'Created task'),
      'each task still has its history'
    )
  })

  test('an invalid row stops the whole import and names the row, the field and the problem', async () => {
    const before = taskCount()
    const csv = [
      'Title,Project,Priority,Due date,Status',
      'Fine,PAY,High,2031-01-01,To do',
      'Bad,PAY,Urgent,31/12/2031,Limbo',
      ',PAY,,,',
      'Lost,NOPE,,,'
    ].join('\n')
    const res = await importCsv(csv)
    assert.equal(res.status, 422)
    assert.equal(res.body.code, 'IMPORT_INVALID')
    assert.equal(taskCount(), before, 'the valid row was NOT imported either: no half imports')
    const problems = res.body.details.problems
    const find = (row: number, field: string) => problems.find((p: any) => p.row === row && p.field === field)
    assert.match(find(3, 'priority').message, /not a priority/)
    assert.match(find(3, 'dueDate').message, /YYYY-MM-DD/)
    assert.match(find(3, 'status').message, /not a status/)
    assert.match(find(4, 'title').message, /empty/)
    assert.match(find(5, 'project').message, /no project "NOPE"/i)
    assert.equal(res.body.details.totals.invalid, 3)
    assert.equal(res.body.details.totals.valid, 1)
  })

  test('skipping invalid rows imports the valid ones and still reports the rest', async () => {
    const csv = ['Title,Project,Priority', 'Skip test good,PAY,High', 'Skip test bad,PAY,Whenever'].join('\n')
    const before = taskCount()
    const res = await importCsv(csv, { skipInvalid: true })
    assert.equal(res.status, 200)
    assert.equal(res.body.totals.created, 1)
    assert.equal(res.body.totals.invalid, 1)
    assert.equal(res.body.problems.length, 1)
    assert.equal(taskCount(), before + 1)
  })

  test('rows that already exist are skipped by default, created on request, and repeats inside the file count too', async () => {
    const csv = ['Title,Project', 'Dup alpha,PAY', 'Dup alpha,PAY', 'Dup beta,PAY'].join('\n')
    const first = await importCsv(csv)
    assert.equal(first.body.totals.created, 2, 'the repeat inside the file is skipped')
    assert.equal(first.body.totals.duplicates, 1)
    const again = await importCsv(csv, { dryRun: true })
    assert.equal(again.body.totals.duplicates, 3, 'everything is already there')
    assert.equal(again.body.preview[0].outcome, 'duplicate')
    const nothing = await importCsv(csv)
    assert.equal(nothing.status, 422)
    assert.equal(nothing.body.code, 'IMPORT_EMPTY')
    const forced = await importCsv(csv, { duplicates: 'create' })
    assert.equal(forced.body.totals.created, 3)
    assert.equal((await admin.get('/api/tasks?q=Dup+alpha&pageSize=50')).body.total, 3)
  })

  test('columns can be mapped by hand, ignored, and a mapping that collides is refused', async () => {
    const csv = ['What,Where,Notes', 'Mapped by hand,PAY,ignored text'].join('\n')
    const lost = await importCsv(csv, { dryRun: true })
    assert.equal(lost.status, 400, 'no column is recognisably the title')
    const ok = await importCsv(csv, { mapping: { What: 'title', Where: 'project', Notes: 'ignore' } })
    assert.equal(ok.status, 200, ok.text)
    assert.equal((await admin.get('/api/tasks?q=Mapped+by+hand')).body.total, 1)
    const clash = await importCsv(csv, { mapping: { What: 'title', Where: 'title' }, dryRun: true })
    assert.equal(clash.status, 400)
    assert.match(clash.body.error, /same field/)
  })

  test('a default project fills in rows without one, and an unknown default is refused', async () => {
    const res = await importCsv('Title\nDefault project task', { projectId: project.numericId })
    assert.equal(res.status, 200, res.text)
    const row = (await admin.get('/api/tasks?q=Default+project+task')).body.rows[0]
    assert.equal(row.projectId, project.numericId)
    assert.equal((await importCsv('Title\nx', { projectId: 987654 })).status, 400)
    assert.equal((await importCsv('Title\nx')).status, 400, 'no project column and no default: nowhere to put it')
  })

  test('files from a spreadsheet program import: byte-order mark, semicolons, quoted line breaks, Windows line ends', async () => {
    const csv = '\ufeffTitle;Project;Tags\r\n"Line one\nline two";PAY;"a;b"\r\nPlain;PAY;\r\n'
    const res = await importCsv(csv)
    assert.equal(res.status, 200, res.text)
    assert.equal(res.body.delimiter, ';')
    const rows = (await admin.get('/api/tasks?q=Plain&pageSize=5')).body.rows
    assert.equal(rows.length, 1)
    const multi = (await admin.get('/api/tasks?pageSize=200&q=line')).body.rows.find((t: any) =>
      t.title.includes('Line one')
    )
    assert.equal(multi.title, 'Line one\nline two')
    assert.deepEqual(
      multi.tags.map((t: any) => t.name),
      ['a', 'b']
    )
    assert.equal((await importCsv('Title,Project\n"Never closed,PAY')).status, 400)
    assert.equal((await importCsv('')).status, 400)
  })

  test('what Atlas exports can be imported again (the export columns map by name)', async () => {
    const out = await manager.api.post('/api/exports', {
      dataset: 'tasks',
      format: 'csv',
      columns: ['title', 'project', 'status', 'priority', 'assignee', 'dueDate', 'blocked', 'tags'],
      q: 'Write the spec'
    })
    assert.equal(out.status, 200)
    const dry = await importCsv(out.text, { dryRun: true, duplicates: 'create' })
    assert.equal(dry.status, 200, dry.text)
    assert.equal(dry.body.totals.invalid, 0, JSON.stringify(dry.body.problems))
    const fields = dry.body.columns.map((c: any) => c.field)
    assert.ok(
      ['title', 'project', 'status', 'priority', 'assignee', 'dueDate', 'blocked', 'tags'].every(f =>
        fields.includes(f)
      )
    )
  })

  test('the import needs permission, sign-in, and sensible limits', async () => {
    const before = taskCount()
    assert.equal((await importCsv(GOOD, {}, viewer.api)).status, 403)
    assert.equal((await importCsv(GOOD, {}, new Api(server.url))).status, 401)
    assert.equal(
      (await importCsv('Title,Project\nImported by a developer,PAY', {}, developer.api)).status,
      200,
      'writing tasks is enough, as for creating one'
    )
    assert.ok(taskCount() > before)
    const huge = 'Title,Project\n' + 'x,PAY\n'.repeat(20_001)
    const tooMany = await importCsv(huge)
    assert.equal(tooMany.status, 400)
    assert.match(tooMany.body.error, /more than 20,000 rows/)
  })

  test('a file bigger than the normal 1 MB limit is accepted here only, and only after sign-in', async () => {
    const rows = Array.from(
      { length: 30_000 },
      (_, i) => `Big file task number ${i} with a reasonably long descriptive title,PAY`
    )
    const csv = ['Title,Project', ...rows.slice(0, 16_000)].join('\n')
    assert.ok(csv.length > 1_100_000)
    const ok = await importCsv(csv, { dryRun: true })
    assert.equal(ok.status, 200, ok.text.slice(0, 200))
    assert.equal(ok.body.totals.rows, 16_000)
    // the same size anywhere else is still refused, and an anonymous request never gets its body parsed at all
    const elsewhere = await manager.api.post('/api/tasks', {
      projectId: project.numericId,
      title: 'x'.repeat(1_200_000)
    })
    assert.equal(elsewhere.status, 413)
    const anonymous = await importCsv(csv, { dryRun: true }, new Api(server.url))
    assert.equal(anonymous.status, 401)
  })

  test('importing thousands of rows is quick enough to be practical and is one transaction', async () => {
    const csv = [
      'Title,Project,Priority,Tags',
      ...Array.from({ length: 5000 }, (_, i) => `Throughput ${i},PAY,${['High', 'Low', 'Medium'][i % 3]},batch`)
    ].join('\n')
    const revision = server.container.ctx.revision
    const started = Date.now()
    const res = await importCsv(csv)
    const took = Date.now() - started
    assert.equal(res.body.totals.created, 5000)
    assert.ok(took < 30_000, `5,000 rows took ${took} ms`)
    assert.equal(server.container.ctx.revision, revision + 1, 'the data revision moved once, for the file')
    assert.equal((await admin.get('/api/tasks?q=Throughput&pageSize=1')).body.total, 5000)
  })
})

describe('saved views', () => {
  const config = {
    columns: { hidden: ['type'], order: ['title', 'status'] },
    sort: [{ key: 'due', dir: 'asc' }],
    pageSize: 100
  }

  test('a person saves, lists, renames, replaces and deletes their own views', async () => {
    const created = await developer.api.post('/api/views', { scope: 'project-tasks', name: 'My open work', config })
    assert.equal(created.status, 200)
    assert.equal(created.body.mine, true)
    assert.equal(created.body.shared, false)
    assert.deepEqual(created.body.config, config, 'the settings come back exactly as saved')
    const list = (await developer.api.get('/api/views?scope=project-tasks')).body.views
    assert.deepEqual(
      list.map((v: any) => v.name),
      ['My open work']
    )
    const changed = await developer.api.patch(`/api/views/${created.body.id}`, {
      name: 'My work',
      config: { ...config, pageSize: 25 }
    })
    assert.equal(changed.body.name, 'My work')
    assert.equal(changed.body.config.pageSize, 25)
    assert.equal((await developer.api.delete(`/api/views/${created.body.id}`)).status, 200)
    assert.deepEqual((await developer.api.get('/api/views?scope=project-tasks')).body.views, [])
  })

  test('names are unique per person and screen, views are limited per screen, and the settings are bounded', async () => {
    const make = (name: string, scope = 'people') => developer.api.post('/api/views', { scope, name, config: {} })
    assert.equal((await make('One')).status, 200)
    assert.equal((await make('one')).status, 409, 'ignoring case')
    assert.equal((await make('One', 'alerts')).status, 200, 'but the same name on another screen is fine')
    const big = await developer.api.post('/api/views', {
      scope: 'people',
      name: 'Huge',
      config: { blob: 'x'.repeat(25_000) }
    })
    assert.equal(big.status, 400)
    for (const bad of ['', 'UPPER', 'has space', '../etc', 'x'.repeat(61)])
      assert.equal(
        (await developer.api.post('/api/views', { scope: bad, name: 'Bad scope', config: {} })).status,
        400,
        `scope "${bad}"`
      )
    assert.equal((await developer.api.get('/api/views?scope=')).status, 400)
    for (let i = 0; i < 49; i++) assert.equal((await make(`Filler ${i}`)).status, 200)
    const over = await make('One too many')
    assert.equal(over.status, 400)
    assert.match(over.body.error, /At most 50/)
  })

  test('a private view is invisible to everybody else, and cannot be read, changed or deleted by them', async () => {
    const mine = (await manager.api.post('/api/views', { scope: 'milestones', name: 'Manager only', config })).body
    assert.deepEqual((await developer.api.get('/api/views?scope=milestones')).body.views, [])
    assert.equal((await developer.api.patch(`/api/views/${mine.id}`, { name: 'Taken' })).status, 404)
    assert.equal((await developer.api.delete(`/api/views/${mine.id}`)).status, 404)
    assert.equal(
      (await admin.delete(`/api/views/${mine.id}`)).status,
      404,
      'not even an administrator can reach a private view'
    )
    assert.equal((await new Api(server.url).get('/api/views?scope=milestones')).status, 401)
  })

  test('only an administrator can share a view; everybody then sees it, but only its owner changes it', async () => {
    assert.equal(
      (await developer.api.post('/api/views', { scope: 'users', name: 'Try sharing', config, shared: true })).status,
      403
    )
    const shared = (await admin.post('/api/views', { scope: 'users', name: 'Everyone', config, shared: true })).body
    const seen = (await developer.api.get('/api/views?scope=users')).body.views
    assert.equal(seen.length, 1)
    assert.equal(seen[0].mine, false)
    assert.equal(seen[0].shared, true)
    assert.equal(
      (await developer.api.patch(`/api/views/${shared.id}`, { name: 'Mine now' })).status,
      403,
      "it is somebody else's view"
    )
    assert.equal((await developer.api.delete(`/api/views/${shared.id}`)).status, 403)
    assert.equal(auditRows(server, 'view.shared').length >= 1, true, 'sharing is recorded')
    const unshare = await admin.patch(`/api/views/${shared.id}`, { shared: false })
    assert.equal(unshare.body.shared, false)
    assert.deepEqual((await developer.api.get('/api/views?scope=users')).body.views, [])
  })

  test('an administrator can remove a shared view somebody else made', async () => {
    const shared = (await manager.api.post('/api/views', { scope: 'alerts', name: 'Mgr private', config })).body
    assert.equal(
      (await manager.api.patch(`/api/views/${shared.id}`, { shared: true })).status,
      403,
      'a manager cannot share (manageSettings)'
    )
    const adminShared = (
      await admin.post('/api/views', { scope: 'alerts', name: 'Admin shared', config, shared: true })
    ).body
    assert.equal((await manager.api.delete(`/api/views/${adminShared.id}`)).status, 403)
    assert.equal((await admin.delete(`/api/views/${adminShared.id}`)).status, 200)
  })

  test('there is at most one default view per person and screen', async () => {
    const a = (await viewer.api.post('/api/views', { scope: 'projects', name: 'A', config, isDefault: true })).body
    const b = (await viewer.api.post('/api/views', { scope: 'projects', name: 'B', config, isDefault: true })).body
    const list = (await viewer.api.get('/api/views?scope=projects')).body.views
    assert.deepEqual(
      list.filter((v: any) => v.isDefault).map((v: any) => v.id),
      [b.id]
    )
    assert.equal(list.find((v: any) => v.id === a.id).isDefault, false)
  })
})

describe('bulk changes to projects', () => {
  const makeProject = async (name: string, code: string) =>
    (await manager.api.post('/api/projects', { name, code })).body

  test('status, owner and team change on the selection only; the report counts them', async () => {
    const a = await makeProject('Bulk P1', 'BP1')
    const b = await makeProject('Bulk P2', 'BP2')
    const c = await makeProject('Bulk P3', 'BP3')
    const res = await manager.api.post('/api/projects/bulk', {
      action: 'status',
      ids: [a.numericId, b.numericId],
      status: 'At risk'
    })
    assert.equal(res.body.requested, 2)
    assert.equal(res.body.succeeded, 2)
    const boot = (await admin.get('/api/bootstrap')).body.projects
    assert.equal(boot.find((p: any) => p.numericId === a.numericId).status, 'At risk')
    assert.equal(boot.find((p: any) => p.numericId === c.numericId).status, 'On track', 'outside the selection')
    const owner = await manager.api.post('/api/projects/bulk', {
      action: 'owner',
      ids: [a.numericId],
      ownerId: devPerson
    })
    assert.equal(owner.body.succeeded, 1)
    const unknown = await manager.api.post('/api/projects/bulk', {
      action: 'owner',
      ids: [a.numericId, 777777],
      ownerId: 'person_ghost'
    })
    assert.equal(unknown.body.succeeded, 0)
    assert.equal(unknown.body.failed.length, 2)
    assert.equal(auditRows(server, 'project.bulk.status').at(-1)!.detail.succeeded, 2)
  })

  test('deleting projects that still hold tasks needs consent per request; refused ones are reported, others deleted', async () => {
    const empty = await makeProject('Bulk empty', 'BEM')
    const full = await makeProject('Bulk full', 'BFU')
    await manager.api.post('/api/tasks', { projectId: full.numericId, title: 'Inside' })
    const refused = await manager.api.post('/api/projects/bulk', {
      action: 'delete',
      ids: [empty.numericId, full.numericId]
    })
    assert.equal(refused.body.succeeded, 1, 'the empty one goes')
    assert.equal(refused.body.failed.length, 1)
    assert.match(refused.body.failed[0].reason, /still has 1 task/)
    assert.equal((await admin.get(`/api/projects/${full.numericId}`)).status, 200, 'the project with tasks is intact')
    assert.equal((await admin.get(`/api/projects/${empty.numericId}`)).status, 404)
    const before = listBackups(server).length
    const consent = await manager.api.post('/api/projects/bulk', {
      action: 'delete',
      ids: [full.numericId],
      cascade: true
    })
    assert.equal(consent.body.succeeded, 1)
    assert.ok(listBackups(server).length > before, 'a safety snapshot was taken before the destructive step')
    assert.ok(listBackups(server).some(b => b.reason === 'pre-delete-projects'))
    assert.equal(auditRows(server, 'project.bulk.delete').at(-1)!.detail.cascade, true)
  })

  test('only people who manage projects can do any of it', async () => {
    const p = await makeProject('Bulk guarded', 'BGD')
    for (const who of [developer.api, viewer.api])
      assert.equal(
        (await who.post('/api/projects/bulk', { action: 'status', ids: [p.numericId], status: 'At risk' })).status,
        403
      )
    assert.equal((await developer.api.post(`/api/projects/${p.numericId}/duplicate`)).status, 403)
    assert.equal(
      (await manager.api.post('/api/projects/bulk', { action: 'status', ids: [p.numericId], status: 'Imaginary' }))
        .status,
      400
    )
  })

  test('a duplicate keeps the plan and the milestones (reset to upcoming), and brings the tasks only on request', async () => {
    const src = await makeProject('Template', 'TPL')
    await manager.api.post('/api/milestones', {
      name: 'Kick-off',
      projectId: src.numericId,
      dueDate: '2031-01-01',
      status: 'Complete'
    })
    for (const title of ['T1', 'T2', 'T3'])
      await manager.api.post('/api/tasks', {
        projectId: src.numericId,
        title,
        status: title === 'T3' ? 'Done' : 'In progress',
        tags: ['tpl'],
        priority: 'High'
      })
    const bare = await manager.api.post(`/api/projects/${src.numericId}/duplicate`, {})
    assert.equal(bare.status, 200, bare.text)
    assert.equal(bare.body.name, 'Copy of Template')
    assert.notEqual(bare.body.code, 'TPL')
    assert.equal((await admin.get(`/api/projects/${bare.body.numericId}/tasks`)).body.total, 0, 'no tasks unless asked')
    assert.equal(
      (await admin.get(`/api/projects/${bare.body.numericId}`)).body.project.milestoneRows[0].status,
      'Upcoming'
    )
    const full = await manager.api.post(`/api/projects/${src.numericId}/duplicate`, { withTasks: true })
    const copied = (await admin.get(`/api/projects/${full.body.numericId}/tasks?sort=key`)).body
    assert.equal(copied.total, 3)
    assert.ok(copied.rows.every((t: any) => t.status === 'To do' && t.priority === 'High' && t.tags[0].name === 'tpl'))
    assert.equal(
      (await admin.get(`/api/projects/${src.numericId}/tasks?scope=done`)).body.total,
      1,
      'the original keeps its finished task'
    )
    assert.equal(auditRows(server, 'project.duplicated').at(-1)!.detail.tasks, 3)
    assert.equal((await manager.api.post('/api/projects/987654/duplicate', {})).status, 404)
  })

  test('copying a project with too many tasks is refused with a number, not attempted', async () => {
    const big = await makeProject('Too big to copy', 'BIG')
    const { repos } = server.container
    const base = repos.tasks.nextId()
    server.db.transaction(() => {
      for (let i = 0; i < 2001; i++)
        repos.tasks.insert({
          id: base + i,
          key: `BIG-${base + i}`,
          title: `Filler ${i}`,
          projectId: big.numericId,
          assigneeId: '',
          priority: 'Low',
          dueDate: '',
          status: 'To do',
          type: 'Development',
          blocked: false,
          customFields: {},
          createdAt: '2030-01-01',
          sample: false
        } as any)
    })
    const res = await manager.api.post(`/api/projects/${big.numericId}/duplicate`, { withTasks: true })
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'TOO_MANY_TO_COPY')
    assert.equal(res.body.details.tasks, 2001)
    assert.equal(
      (await manager.api.post(`/api/projects/${big.numericId}/duplicate`, {})).status,
      200,
      'without tasks it is fine'
    )
  })
})

describe('bulk changes to people, milestones and alerts', () => {
  test('moving people to a team and deleting them; a person with a sign-in account is reported, not deleted', async () => {
    const team = (await manager.api.post('/api/teams', { name: 'Platform' })).body
    const p1 = (await manager.api.post('/api/people', { name: 'Bulk One' })).body
    const p2 = (await manager.api.post('/api/people', { name: 'Bulk Two' })).body
    const moved = await manager.api.post('/api/people/bulk', { action: 'team', ids: [p1.id, p2.id], teamId: team.id })
    assert.equal(moved.body.succeeded, 2)
    const boot = (await admin.get('/api/bootstrap')).body.people
    assert.equal(boot.find((p: any) => p.id === p1.id).teamId, team.id)
    assert.equal(
      (await manager.api.post('/api/people/bulk', { action: 'team', ids: [p1.id], teamId: 'team_none' })).body
        .succeeded,
      0
    )
    const removal = await manager.api.post('/api/people/bulk', { action: 'delete', ids: [p1.id, p2.id, devPerson] })
    assert.equal(removal.body.succeeded, 2)
    assert.equal(removal.body.failed.length, 1)
    assert.match(removal.body.failed[0].reason, /sign-in account/)
    assert.ok(
      (await admin.get('/api/bootstrap')).body.people.some((p: any) => p.id === devPerson),
      'the person with an account is still there'
    )
    assert.equal((await developer.api.post('/api/people/bulk', { action: 'delete', ids: [p1.id] })).status, 403)
  })

  test('a copy of a person starts without the email address', async () => {
    const copy = await manager.api.post(`/api/people/${managerPerson}/duplicate`)
    assert.equal(copy.status, 200)
    assert.equal(copy.body.name, 'Copy of Mia Manager')
    assert.equal(copy.body.email, '', 'an address identifies one person')
    assert.notEqual(copy.body.id, managerPerson)
    assert.equal((await manager.api.post('/api/people/person_ghost/duplicate')).status, 404)
  })

  test('milestones: status and delete for a selection, and a copy that starts as upcoming', async () => {
    const make = async (name: string) =>
      (await manager.api.post('/api/milestones', { name, projectId: project.numericId, dueDate: '2031-06-01' })).body
    const [m1, m2, m3] = [await make('MS one'), await make('MS two'), await make('MS three')]
    const done = await manager.api.post('/api/milestones/bulk', {
      action: 'status',
      ids: [m1.id, m2.id],
      status: 'Complete'
    })
    assert.equal(done.body.succeeded, 2)
    const list = (await admin.get('/api/bootstrap')).body.projects.flatMap((p: any) => p.milestoneRows)
    assert.equal(list.find((m: any) => m.id === m1.id).status, 'Complete')
    assert.equal(list.find((m: any) => m.id === m3.id).status, 'Upcoming')
    const copy = await manager.api.post(`/api/milestones/${m1.id}/duplicate`)
    assert.equal(copy.body.status, 'Upcoming')
    assert.equal(copy.body.name, 'Copy of MS one')
    const removed = await manager.api.post('/api/milestones/bulk', {
      action: 'delete',
      ids: [m1.id, m2.id, 'milestone_ghost']
    })
    assert.equal(removed.body.succeeded, 2)
    assert.equal(removed.body.failed.length, 1)
    assert.equal((await developer.api.post('/api/milestones/bulk', { action: 'delete', ids: [m3.id] })).status, 403)
  })

  test('alerts: anyone who writes tasks can resolve and reopen a selection; deleting needs alert management', async () => {
    const make = async (title: string) => (await manager.api.post('/api/alerts', { title })).body
    const [a, b] = [await make('Alert A'), await make('Alert B')]
    const resolved = await developer.api.post('/api/alerts/bulk', { action: 'resolve', ids: [a.id, b.id] })
    assert.equal(resolved.status, 200)
    assert.equal(resolved.body.succeeded, 2)
    const read = () => admin.get('/api/bootstrap').then(r => r.body.alerts)
    assert.ok((await read()).filter((x: any) => [a.id, b.id].includes(x.id)).every((x: any) => x.resolved))
    await developer.api.post('/api/alerts/bulk', { action: 'reopen', ids: [a.id] })
    assert.equal((await read()).find((x: any) => x.id === a.id).resolved, false)
    assert.equal((await read()).find((x: any) => x.id === b.id).resolved, true, 'only the selection reopened')
    assert.equal((await developer.api.post('/api/alerts/bulk', { action: 'delete', ids: [a.id] })).status, 403)
    assert.ok(
      (await read()).some((x: any) => x.id === a.id),
      'and the refused delete deleted nothing'
    )
    assert.equal((await viewer.api.post('/api/alerts/bulk', { action: 'resolve', ids: [a.id] })).status, 403)
    const copy = await manager.api.post(`/api/alerts/${b.id}/duplicate`)
    assert.equal(copy.body.resolved, false, 'a copy of a resolved alert is open again')
    assert.equal((await developer.api.post(`/api/alerts/${b.id}/duplicate`)).status, 403)
    const gone = await manager.api.post('/api/alerts/bulk', { action: 'delete', ids: [a.id, b.id] })
    assert.equal(gone.body.succeeded, 2)
  })
})
