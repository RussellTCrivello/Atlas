// Working with many tasks at once, through the real HTTP API against a real database: "select all matching", bulk actions with
// partial success, undo of a delete, duplicates, tags, and exporting a selection. Every positive behaviour has its negative
// next to it: what must NOT happen to records outside the selection, to people without the permission, to bad input.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { auditRows, ledgerFor } from '../helpers/db'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let developer: Awaited<ReturnType<typeof makeUser>>
let viewer: Awaited<ReturnType<typeof makeUser>>
let project: any
let other: any
let devPerson: string
let managerPerson: string

const taskOf = async (id: number) => (await admin.get(`/api/tasks/${id}`)).body.task
const make = async (body: Record<string, unknown> = {}, api: Api = manager.api) => {
  const res = await api.post('/api/tasks', { projectId: project.numericId, title: 'Task', ...body })
  assert.equal(res.status, 200, res.text)
  return res.body
}
const makeMany = async (count: number, body: Record<string, unknown> = {}) => {
  const out: any[] = []
  for (let i = 0; i < count; i++) out.push(await make({ title: `Bulk ${i}`, ...body }))
  return out
}
const idsOf = (rows: any[]) => rows.map(row => row.numericId)

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
  other = (await manager.api.post('/api/projects', { name: 'Search', code: 'SRC' })).body
})
after(() => server.cleanup())

describe('select all matching: the ids endpoint', () => {
  test('returns exactly the ids that match, not just one page, in display order', async () => {
    const mine = await makeMany(7, { title: 'Ids probe', priority: 'High' })
    await makeMany(3, { title: 'Ids noise', priority: 'Low' })
    const res = await admin.get(`/api/tasks/ids?q=${encodeURIComponent('Ids probe')}&pageSize=2&sort=key&dir=asc`)
    assert.equal(res.status, 200)
    assert.equal(res.body.total, 7)
    assert.equal(res.body.truncated, false)
    assert.deepEqual(res.body.ids, idsOf(mine), 'all seven, although the page size says 2, in key order')
    const filtered = await admin.get('/api/tasks/ids?priority=Low&project=' + project.numericId)
    assert.ok(filtered.body.ids.length >= 3)
    for (const id of filtered.body.ids) assert.equal((await taskOf(id)).priority, 'Low')
  })

  test('is not mistaken for a task called "ids", needs sign-in, and rejects malformed filters', async () => {
    assert.equal((await new Api(server.url).get('/api/tasks/ids')).status, 401)
    assert.equal((await admin.get('/api/tasks/ids?where=not-json')).status, 400)
    assert.equal((await admin.get('/api/tasks/ids?where=' + encodeURIComponent('[{"field":1}]'))).status, 400)
    assert.equal((await admin.get('/api/tasks/ids?project=abc')).status, 400)
    assert.equal((await admin.get('/api/tasks/abc')).status, 404, 'a task id that is not a number is simply not found')
  })

  test('the advanced filter combines with AND and OR the way the screen shows it (AND binds tighter)', async () => {
    const a = await make({ title: 'Adv alpha', priority: 'High', status: 'In progress' })
    const b = await make({ title: 'Adv beta', priority: 'Low', status: 'In progress' })
    const c = await make({ title: 'Adv gamma', priority: 'High', status: 'To do' })
    const where = (conditions: unknown[]) =>
      admin.get(`/api/tasks/ids?sort=key&where=${encodeURIComponent(JSON.stringify(conditions))}`)
    // title contains "Adv" AND priority = High  OR  title = "Adv beta"   ->   (Adv AND High) OR beta
    const res = await where([
      { field: 'title', operator: 'contains', value: 'Adv' },
      { join: 'AND', field: 'priority', operator: 'equals', value: 'High' },
      { join: 'OR', field: 'title', operator: 'equals', value: 'Adv beta' }
    ])
    assert.deepEqual(res.body.ids, [a.numericId, b.numericId, c.numericId])
    const narrower = await where([
      { field: 'title', operator: 'contains', value: 'Adv' },
      { join: 'AND', field: 'status', operator: 'equals', value: 'In progress' },
      { join: 'AND', field: 'priority', operator: 'equals', value: 'High' }
    ])
    assert.deepEqual(narrower.body.ids, [a.numericId])
    const empty = await where([{ field: 'title', operator: 'isEmpty', value: '' }])
    assert.equal(empty.body.total, 0)
  })

  test('a column filter narrows the whole result, even when the advanced filter itself uses OR', async () => {
    const high = await make({ title: 'Colf one', priority: 'High' })
    await make({ title: 'Colf two', priority: 'Low' })
    const get = (where: unknown[], cf: unknown[]) =>
      admin.get(
        `/api/tasks/ids?sort=key&where=${encodeURIComponent(JSON.stringify(where))}&cf=${encodeURIComponent(JSON.stringify(cf))}`
      )
    const where = [
      { field: 'title', operator: 'contains', value: 'Colf' },
      { join: 'OR', field: 'title', operator: 'equals', value: 'No such title' }
    ]
    const res = await get(where, [{ field: 'priority', operator: 'equals', value: 'High' }])
    assert.deepEqual(res.body.ids, [high.numericId], 'only the High one: the column filter is not absorbed into the OR')
    const two = await get(where, [
      { field: 'priority', operator: 'equals', value: 'High' },
      { field: 'title', operator: 'contains', value: 'two' }
    ])
    assert.equal(two.body.total, 0, 'several column filters must all hold')
    assert.equal((await admin.get('/api/tasks/ids?cf=nope')).status, 400)
  })

  test('a condition cannot name a column, only a known field; values are never SQL', async () => {
    const before = (await admin.get('/api/tasks/ids')).body.total
    const injected = await admin.get(
      '/api/tasks/ids?where=' +
        encodeURIComponent(JSON.stringify([{ field: 'title); DROP TABLE tasks; --', operator: 'equals', value: 'x' }]))
    )
    assert.equal(injected.status, 200)
    assert.equal(injected.body.total, before, 'an unknown field is ignored rather than interpolated')
    const value = await admin.get(
      '/api/tasks/ids?where=' +
        encodeURIComponent(JSON.stringify([{ field: 'title', operator: 'equals', value: "x' OR '1'='1" }]))
    )
    assert.equal(value.body.total, 0, 'a quote in a value stays a quote')
    assert.ok((await admin.get('/api/tasks/ids')).body.total >= before, 'and the table is still there')
    assert.equal((await admin.get('/api/tasks/ids?sort=' + encodeURIComponent('title; DROP TABLE tasks'))).status, 200)
  })

  test('multi-column sort: the first column wins, later ones break ties, the id keeps pages stable', async () => {
    const rows = [
      await make({ title: 'Sorted B', priority: 'High', dueDate: '2030-01-02' }),
      await make({ title: 'Sorted A', priority: 'High', dueDate: '2030-01-03' }),
      await make({ title: 'Sorted C', priority: 'Low', dueDate: '2030-01-01' })
    ]
    const res = await admin.get(`/api/tasks?q=Sorted&sort=${encodeURIComponent('priority:asc,title:desc')}&pageSize=10`)
    assert.deepEqual(
      res.body.rows.map((row: any) => row.title),
      ['Sorted B', 'Sorted A', 'Sorted C'],
      'High before Low, and within High the title descending'
    )
    const byDue = await admin.get('/api/tasks?q=Sorted&sort=due:asc&pageSize=10')
    assert.deepEqual(idsOf(byDue.body.rows), [rows[2].numericId, rows[0].numericId, rows[1].numericId])
  })

  test('refuses a set too large to act on safely instead of returning a partial list', async () => {
    const { repos } = server.container
    const base = repos.tasks.nextId()
    server.db.transaction(() => {
      for (let i = 0; i < 10_001; i++)
        repos.tasks.insert({
          id: base + i,
          key: `PAY-${base + i}`,
          title: `Mass ${i}`,
          projectId: other.numericId,
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
    const res = await admin.get('/api/tasks/ids?q=Mass')
    assert.equal(res.body.total, 10_001)
    assert.equal(res.body.truncated, true)
    assert.deepEqual(res.body.ids, [], 'no partial list that would look like the whole')
    const within = await admin.get('/api/tasks/ids?q=Mass&project=' + other.numericId + '&scope=done')
    assert.equal(within.body.truncated, false)
    server.db.transaction(() => server.db.run("DELETE FROM tasks WHERE title LIKE 'Mass %'"))
  })
})

describe('bulk actions', () => {
  test('changing the status of a selection changes those tasks, says how many, and leaves the others alone', async () => {
    const picked = await makeMany(5, { title: 'Pick me' })
    const bystander = await make({ title: 'Do not touch' })
    const res = await manager.api.post('/api/tasks/bulk', {
      action: 'status',
      ids: idsOf(picked),
      status: 'In progress'
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.requested, 5)
    assert.equal(res.body.succeeded, 5)
    assert.deepEqual(res.body.failed, [])
    for (const task of picked) assert.equal((await taskOf(task.numericId)).status, 'In progress')
    assert.equal((await taskOf(bystander.numericId)).status, 'To do', 'a task outside the selection is untouched')
    assert.ok(
      ledgerFor(server, picked[0].numericId).some(row => row.action === 'Moved task'),
      'each task has its history'
    )
  })

  test('a bulk action leaves one audit entry that states its scope, not one entry per task', async () => {
    const picked = await makeMany(4, { title: 'Audited bulk' })
    const before = auditRows(server).length
    await manager.api.post('/api/tasks/bulk', { action: 'edit', ids: idsOf(picked), priority: 'High' })
    const added = auditRows(server).slice(before)
    assert.equal(added.length, 1)
    assert.equal(added[0].action, 'task.bulk.edit')
    assert.equal(added[0].detail.requested, 4)
    assert.equal(added[0].detail.succeeded, 4)
    assert.equal(added[0].detail.priority, 'High')
    assert.equal(added[0].actor_id, manager.user.id)
  })

  test('one task that cannot be changed is reported with its name and the reason; the rest still change', async () => {
    const mine = await make({ title: 'Dana owns this', assigneeId: devPerson })
    const theirs = await make({ title: 'Mia owns this', assigneeId: managerPerson })
    const res = await developer.api.post('/api/tasks/bulk', {
      action: 'edit',
      ids: [mine.numericId, theirs.numericId, 999_999_999],
      priority: 'High'
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.requested, 3)
    assert.equal(res.body.succeeded, 1)
    assert.equal(res.body.failed.length, 2)
    const names = res.body.failed.map((f: any) => f.label)
    assert.ok(
      names.some((label: string) => label.includes('Mia owns this')),
      'the report names the task'
    )
    assert.ok(
      res.body.failed.some((f: any) => /re-planned|Ask a manager/i.test(f.reason)),
      'and says why'
    )
    assert.ok(res.body.failed.some((f: any) => /not found/i.test(f.reason)))
    assert.equal((await taskOf(mine.numericId)).priority, 'High')
    assert.equal((await taskOf(theirs.numericId)).priority, 'Medium', 'the refused task is exactly as it was')
  })

  test('a person who may not delete tasks cannot delete them in bulk, and nothing is deleted', async () => {
    const picked = await makeMany(3, { title: 'Protected' })
    const res = await developer.api.post('/api/tasks/bulk', { action: 'delete', ids: idsOf(picked) })
    assert.equal(res.status, 403)
    for (const task of picked) assert.equal((await admin.get(`/api/tasks/${task.numericId}`)).status, 200)
    assert.equal((await viewer.api.post('/api/tasks/bulk', { action: 'status', ids: [1], status: 'Done' })).status, 403)
    assert.equal((await new Api(server.url).post('/api/tasks/bulk', { action: 'status', ids: [1] })).status, 401)
  })

  test('the request itself is bounded and validated before anything changes', async () => {
    const post = (body: unknown) => manager.api.post('/api/tasks/bulk', body)
    assert.equal((await post({ action: 'status', ids: [], status: 'Done' })).status, 400, 'nothing selected')
    assert.equal(
      (await post({ action: 'status', ids: Array.from({ length: 501 }, (_, i) => i + 1), status: 'Done' })).status,
      400
    )
    assert.equal((await post({ action: 'explode', ids: [1] })).status, 400)
    assert.equal((await post({ action: 'status', ids: [1] })).status, 400, 'a status change needs a status')
    assert.equal((await post({ action: 'edit', ids: [1] })).status, 400, 'an edit that changes nothing is refused')
    assert.equal((await post({ action: 'edit', ids: [1], priority: 'Urgent' })).status, 400)
    const t = await make({ title: 'Unknown status' })
    const res = await post({ action: 'status', ids: [t.numericId], status: 'Nope' })
    assert.equal(res.status, 200)
    assert.equal(res.body.succeeded, 0)
    assert.match(res.body.failed[0].reason, /Unknown status/)
  })

  test('a task listed twice is processed once and counted once', async () => {
    const t = await make({ title: 'Twice' })
    const res = await manager.api.post('/api/tasks/bulk', {
      action: 'status',
      ids: [t.numericId, String(t.numericId), t.numericId],
      status: 'Done'
    })
    assert.equal(res.body.requested, 1)
    assert.equal(res.body.succeeded, 1)
  })

  test('assigning a selection moves it to that person; an unknown person is a per-task report, not a crash', async () => {
    const picked = await makeMany(3, { title: 'Reassign' })
    const ok = await manager.api.post('/api/tasks/bulk', {
      action: 'assign',
      ids: idsOf(picked),
      assigneeId: devPerson
    })
    assert.equal(ok.body.succeeded, 3)
    for (const task of picked) assert.equal((await taskOf(task.numericId)).assigneeId, devPerson)
    const bad = await manager.api.post('/api/tasks/bulk', {
      action: 'assign',
      ids: idsOf(picked),
      assigneeId: 'person_nobody'
    })
    assert.equal(bad.body.succeeded, 0)
    assert.equal(bad.body.failed.length, 3)
    assert.equal((await taskOf(picked[0].numericId)).assigneeId, devPerson, 'and nothing was half-applied')
  })

  test('tag and untag add and remove labels on the selection only; tags are created on the way, ignoring case', async () => {
    const picked = await makeMany(3, { title: 'Taggable' })
    const bystander = await make({ title: 'Untagged bystander' })
    await manager.api.post('/api/tasks/bulk', { action: 'tag', ids: idsOf(picked), tags: ['Urgent', 'backend'] })
    const respelled = await manager.api.post('/api/tasks/bulk', {
      action: 'tag',
      ids: [picked[0].numericId],
      tags: ['URGENT']
    })
    assert.equal(respelled.body.succeeded, 1, 'another spelling of an existing tag is that tag, not a conflict')
    assert.deepEqual(respelled.body.failed, [])
    // A task that does not carry the tag yet, tagged with another spelling: the existing tag is reused as it was first written.
    const fresh = await make({ title: 'Taggable fresh' })
    const reuse = await manager.api.post('/api/tasks/bulk', { action: 'tag', ids: [fresh.numericId], tags: ['uRgEnT'] })
    assert.equal(reuse.body.succeeded, 1, JSON.stringify(reuse.body.failed))
    assert.deepEqual(
      (await taskOf(fresh.numericId)).tags.map((t: any) => t.name),
      ['Urgent']
    )
    for (const task of picked)
      assert.deepEqual((await taskOf(task.numericId)).tags.map((t: any) => t.name).sort(), ['Urgent', 'backend'])
    assert.deepEqual((await taskOf(bystander.numericId)).tags, [])
    const tags = (await admin.get('/api/tags')).body.tags
    assert.equal(tags.filter((t: any) => t.name.toLowerCase() === 'urgent').length, 1, 'one tag, not one per spelling')
    await manager.api.post('/api/tasks/bulk', {
      action: 'untag',
      ids: [picked[0].numericId, picked[1].numericId],
      tags: ['urgent']
    })
    assert.deepEqual(
      (await taskOf(picked[0].numericId)).tags.map((t: any) => t.name),
      ['backend']
    )
    assert.deepEqual(
      (await taskOf(picked[2].numericId)).tags.map((t: any) => t.name).sort(),
      ['Urgent', 'backend'],
      'outside the untag selection'
    )
    const filtered = await admin.get(`/api/tasks/ids?tag=${tags.find((t: any) => t.name === 'Urgent').id}&q=Taggable`)
    assert.equal(filtered.body.total, 2, 'filtering by tag finds the two tasks still carrying it (the third lost it)')
  })

  test('bulk edit can move tasks to another project, and refuses a project that does not exist', async () => {
    const picked = await makeMany(2, { title: 'Movable' })
    const moved = await manager.api.post('/api/tasks/bulk', {
      action: 'edit',
      ids: idsOf(picked),
      projectId: other.numericId
    })
    assert.equal(moved.body.succeeded, 2)
    assert.equal((await taskOf(picked[0].numericId)).projectId, other.numericId)
    const missing = await manager.api.post('/api/tasks/bulk', { action: 'edit', ids: idsOf(picked), projectId: 424242 })
    assert.equal(missing.body.succeeded, 0)
    assert.match(missing.body.failed[0].reason, /project/i)
  })

  test('a large selection (500 tasks) is handled in one request', async () => {
    const { repos } = server.container
    const base = repos.tasks.nextId()
    server.db.transaction(() => {
      for (let i = 0; i < 500; i++)
        repos.tasks.insert({
          id: base + i,
          key: `PAY-${base + i}`,
          title: `Five hundred ${i}`,
          projectId: project.numericId,
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
    const ids = Array.from({ length: 500 }, (_, i) => base + i)
    const started = Date.now()
    const res = await manager.api.post('/api/tasks/bulk', { action: 'status', ids, status: 'In progress' })
    assert.equal(res.body.succeeded, 500)
    assert.ok(Date.now() - started < 20_000, 'and quickly enough to be interactive')
    assert.equal(
      (await admin.get('/api/tasks/ids?q=' + encodeURIComponent('Five hundred') + '&status=In progress')).body.total,
      500
    )
  })
})

describe('deleting and undoing', () => {
  test('deleting one task returns an undo token; undoing brings back the same task, tags and history', async () => {
    const t = await make({ title: 'Delete then undo', tags: ['keepme'] })
    const id = t.numericId
    const gone = await manager.api.delete(`/api/tasks/${id}`)
    assert.equal(gone.status, 200)
    assert.ok(gone.body.batch, 'the response carries what is needed to undo')
    assert.equal((await admin.get(`/api/tasks/${id}`)).status, 404)
    const back = await manager.api.post('/api/tasks/restore', { batch: gone.body.batch })
    assert.equal(back.status, 200)
    assert.equal(back.body.succeeded, 1)
    const restored = await taskOf(id)
    assert.equal(restored.title, 'Delete then undo')
    assert.equal(restored.id, t.id, 'the same task number, so links and alerts still point at it')
    assert.deepEqual(
      restored.tags.map((x: any) => x.name),
      ['keepme']
    )
    assert.ok(ledgerFor(server, id).some(row => row.action === 'Restored task'))
    assert.equal(auditRows(server, 'task.restored').at(-1)!.detail.restored, 1)
  })

  test('a bulk delete is one undo; the second undo finds nothing; people without manageTasks cannot undo', async () => {
    const picked = await makeMany(4, { title: 'Bulk delete' })
    const res = await manager.api.post('/api/tasks/bulk', { action: 'delete', ids: idsOf(picked) })
    assert.equal(res.body.succeeded, 4)
    assert.ok(res.body.batch)
    assert.equal((await developer.api.post('/api/tasks/restore', { batch: res.body.batch })).status, 403)
    const undo = await manager.api.post('/api/tasks/restore', { batch: res.body.batch })
    assert.equal(undo.body.succeeded, 4)
    for (const task of picked) assert.equal((await admin.get(`/api/tasks/${task.numericId}`)).status, 200)
    const again = await manager.api.post('/api/tasks/restore', { batch: res.body.batch })
    assert.equal(again.status, 404, 'there is nothing left to restore')
    assert.equal((await manager.api.post('/api/tasks/restore', { batch: 'trash_unknown' })).status, 404)
  })

  test('alerts about a deleted task are linked back to it when the delete is undone', async () => {
    const t = await make({ title: 'Has an alert' })
    const alert = (await manager.api.post('/api/alerts', { title: 'Watch this', taskId: t.numericId })).body
    const gone = await manager.api.delete(`/api/tasks/${t.numericId}`)
    const during = (await admin.get('/api/bootstrap')).body.alerts.find((a: any) => a.id === alert.id)
    assert.ok(!during?.taskId, 'while deleted, the alert refers to nothing')
    await manager.api.post('/api/tasks/restore', { batch: gone.body.batch })
    const after = (await admin.get('/api/bootstrap')).body.alerts.find((a: any) => a.id === alert.id)
    assert.equal(String(after.taskId), String(t.numericId))
  })

  test('a task whose project was deleted meanwhile is reported, not restored into nothing', async () => {
    const doomed = (await manager.api.post('/api/projects', { name: 'Doomed', code: 'DOOM' })).body
    const t = await make({ title: 'Orphan to be', projectId: doomed.numericId })
    const gone = await manager.api.delete(`/api/tasks/${t.numericId}`)
    assert.equal((await manager.api.delete(`/api/projects/${doomed.numericId}`)).status, 200)
    const undo = await manager.api.post('/api/tasks/restore', { batch: gone.body.batch })
    assert.equal(undo.body.succeeded, 0)
    assert.match(undo.body.failed[0].reason, /project no longer exists/)
  })

  test('the trash is emptied after 30 days: housekeeping removes the copy and the undo is gone', async () => {
    const t = await make({ title: 'Too old to undo' })
    const gone = await manager.api.delete(`/api/tasks/${t.numericId}`)
    const old = new Date(Date.now() - 31 * 86400000).toISOString()
    server.db.transaction(() =>
      server.db.run('UPDATE task_trash SET deleted_at = ? WHERE batch = ?', [old, gone.body.batch])
    )
    const purged = server.container.maintenance.purgeTrash()
    assert.ok(purged >= 1)
    assert.equal((await manager.api.post('/api/tasks/restore', { batch: gone.body.batch })).status, 404)
    const recent = await make({ title: 'Recent enough' })
    const kept = await manager.api.delete(`/api/tasks/${recent.numericId}`)
    server.container.maintenance.purgeTrash()
    assert.equal(
      (await manager.api.post('/api/tasks/restore', { batch: kept.body.batch })).status,
      200,
      'a recent delete survives housekeeping'
    )
  })
})

describe('one record: view, duplicate', () => {
  test('the record view returns the task with its tags, project and history', async () => {
    const t = await make({ title: 'Look at me', tags: ['x'] })
    await manager.api.patch(`/api/tasks/${t.numericId}/status`, { status: 'In progress' })
    const res = await viewer.api.get(`/api/tasks/${t.numericId}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.task.title, 'Look at me')
    assert.equal(res.body.project.code, 'PAY')
    assert.deepEqual(
      res.body.task.tags.map((x: any) => x.name),
      ['x']
    )
    assert.ok(res.body.history.length >= 2, 'created and moved')
    assert.equal((await viewer.api.get('/api/tasks/987654321')).status, 404)
  })

  test('a duplicate keeps the plan and the tags, starts again at the first status, and is a new task', async () => {
    const t = await make({
      title: 'Original',
      priority: 'High',
      assigneeId: devPerson,
      tags: ['a', 'b'],
      dueDate: '2031-05-05',
      blocked: true
    })
    await manager.api.patch(`/api/tasks/${t.numericId}/status`, { status: 'Done' })
    const res = await manager.api.post(`/api/tasks/${t.numericId}/duplicate`)
    assert.equal(res.status, 200)
    const copy = res.body
    assert.notEqual(copy.numericId, t.numericId)
    assert.notEqual(copy.id, t.id)
    assert.equal(copy.title, 'Copy of Original')
    assert.equal(copy.priority, 'High')
    assert.equal(copy.assigneeId, devPerson)
    assert.equal(copy.dueDate, '2031-05-05')
    assert.equal(copy.status, 'To do', 'back at the first status')
    assert.equal(copy.blocked, false)
    assert.ok(!copy.completedAt)
    assert.deepEqual(copy.tags.map((x: any) => x.name).sort(), ['a', 'b'])
    assert.equal((await taskOf(t.numericId)).status, 'Done', 'the original is untouched')
    assert.equal(auditRows(server, 'task.duplicated').at(-1)!.detail.from, t.numericId)
    assert.equal((await manager.api.post('/api/tasks/987654321/duplicate')).status, 404)
    assert.equal((await viewer.api.post(`/api/tasks/${t.numericId}/duplicate`)).status, 403)
  })
})

describe('tags', () => {
  test('anyone who writes tasks can create a tag; names are unique ignoring case; viewers cannot', async () => {
    const created = await developer.api.post('/api/tags', { name: 'Release 2', color: 'green' })
    assert.equal(created.status, 200)
    assert.equal(created.body.tasks, 0)
    assert.equal((await developer.api.post('/api/tags', { name: 'release 2' })).status, 409)
    assert.equal((await viewer.api.post('/api/tags', { name: 'Nope' })).status, 403)
    assert.equal((await developer.api.post('/api/tags', { name: '' })).status, 400)
    assert.equal((await developer.api.post('/api/tags', { name: 'x'.repeat(41) })).status, 400)
    assert.equal((await developer.api.post('/api/tags', { name: 'Bad colour', color: 'plaid' })).status, 400)
    assert.equal((await viewer.api.get('/api/tags')).status, 200, 'everybody can read the list')
  })

  test('renaming and deleting a tag changes every task that carries it, so it needs manageTasks', async () => {
    const tag = (await manager.api.post('/api/tags', { name: 'Temp tag' })).body
    const picked = await makeMany(2, { title: 'Carries a tag' })
    await manager.api.post('/api/tasks/bulk', { action: 'tag', ids: idsOf(picked), tags: ['Temp tag'] })
    assert.equal((await developer.api.patch(`/api/tags/${tag.id}`, { name: 'Hijack' })).status, 403)
    assert.equal((await developer.api.delete(`/api/tags/${tag.id}`)).status, 403)
    const renamed = await manager.api.patch(`/api/tags/${tag.id}`, { name: 'Renamed tag' })
    assert.equal(renamed.body.name, 'Renamed tag')
    assert.equal(renamed.body.tasks, 2)
    assert.deepEqual(
      (await taskOf(picked[0].numericId)).tags.map((x: any) => x.name),
      ['Renamed tag']
    )
    assert.equal(
      (await manager.api.patch(`/api/tags/${tag.id}`, { name: 'release 2' })).status,
      409,
      "cannot take another tag's name"
    )
    const removed = await manager.api.delete(`/api/tags/${tag.id}`)
    assert.equal(removed.body.removedFrom, 2)
    assert.deepEqual((await taskOf(picked[0].numericId)).tags, [], 'gone from the tasks')
    assert.equal(
      (await admin.get(`/api/tasks/${picked[0].numericId}`)).status,
      200,
      'the tasks themselves are untouched'
    )
    assert.equal((await manager.api.delete(`/api/tags/${tag.id}`)).status, 404)
  })
})

describe('exporting a selection', () => {
  const csv = (res: { text: string }) =>
    res.text
      .replace(/^\ufeff/, '')
      .trim()
      .split(/\r?\n/)
      .slice(1)
  test('only the selected tasks are exported, and never more than were selected', async () => {
    const picked = await makeMany(6, { title: 'Export pick' })
    const chosen = picked.slice(1, 4)
    const res = await manager.api.post('/api/exports', {
      dataset: 'tasks',
      format: 'csv',
      columns: ['id', 'title'],
      ids: idsOf(chosen)
    })
    assert.equal(res.status, 200)
    const rows = csv(res)
    assert.equal(rows.length, 3)
    for (const task of chosen)
      assert.ok(
        rows.some(row => row.includes(task.id)),
        `${task.id} is in the file`
      )
    assert.ok(!rows.some(row => row.includes(picked[0].id)), 'a task outside the selection is not')
    const both = await manager.api.post('/api/exports', {
      dataset: 'tasks',
      format: 'csv',
      columns: ['id'],
      ids: idsOf(picked),
      filters: [{ field: 'id', operator: 'equals', value: picked[0].id }]
    })
    assert.equal(csv(both).length, 1, 'a selection and a filter intersect')
  })

  test('selected rows can be exported from projects, people, milestones and alerts too', async () => {
    const people = (await admin.get('/api/bootstrap')).body.people
    const one = await manager.api.post('/api/exports', {
      dataset: 'people',
      format: 'csv',
      columns: ['name'],
      ids: [people[0].id]
    })
    assert.equal(csv(one).length, 1)
    const proj = await manager.api.post('/api/exports', {
      dataset: 'projects',
      format: 'csv',
      columns: ['name'],
      ids: [other.numericId]
    })
    assert.deepEqual(
      csv(proj).map(row => row.replace(/"/g, '')),
      ['Search']
    )
  })

  test('a dataset that cannot honour a selection refuses it rather than exporting everything', async () => {
    // These are summaries and reports, not lists of individual records: a selection of rows means nothing for them.
    for (const dataset of ['report', 'project-report', 'workspace-summary', 'activity-summary', 'activity-log']) {
      const res = await manager.api.post('/api/exports', { dataset, format: 'csv', ids: [1, 2] })
      assert.equal(res.status, 400, `${dataset} must refuse a selection, got ${res.status}`)
      assert.match(res.body.error || res.text, /selection/i)
    }
    assert.equal(
      (await manager.api.post('/api/exports', { dataset: 'tasks', format: 'csv', ids: [] })).status,
      400,
      'an empty selection is not "everything"'
    )
  })

  test('a printout or file built from a selection says so, and how many rows it holds', async () => {
    const picked = await makeMany(3, { title: 'Scope stated' })
    const res = await manager.api.post('/api/exports', {
      dataset: 'tasks',
      format: 'json',
      columns: ['id'],
      ids: idsOf(picked.slice(0, 2))
    })
    assert.equal(res.status, 200)
    assert.match(JSON.stringify(res.body.filters ?? res.body), /Selected records: 2/)
  })

  test('a "filtered" export built from the grid query holds exactly the rows the list shows, in the same order', async () => {
    const make1 = (title: string, priority: string, status: string, tags: string[]) =>
      make({ title, priority, status, tags })
    await make1('Gridx a', 'High', 'To do', ['gx'])
    await make1('Gridx b', 'High', 'In progress', ['gx'])
    await make1('Gridx c', 'Low', 'To do', ['gx'])
    await make1('Gridx d', 'High', 'Done', ['gx'])
    await make1('Gridx e', 'High', 'To do', [])
    const query = new URLSearchParams({
      status: 'In progress,To do',
      priority: 'High',
      cf: JSON.stringify([{ field: 'title', operator: 'contains', value: 'Gridx' }]),
      where: JSON.stringify([{ field: 'tags', operator: 'contains', value: 'gx' }]),
      sort: 'title:desc'
    })
    const list = await admin.get(`/api/tasks?${query}&pageSize=200`)
    assert.deepEqual(
      list.body.rows.map((row: any) => row.title),
      ['Gridx b', 'Gridx a'],
      'the list itself applies all of it'
    )
    const file = await manager.api.post('/api/exports', {
      dataset: 'tasks',
      format: 'csv',
      columns: ['id'],
      grid: query.toString()
    })
    assert.equal(file.status, 200)
    assert.deepEqual(
      csv(file).map(row => row.replace(/"/g, '')),
      list.body.rows.map((row: any) => row.id),
      'the export holds the same tasks in the same order'
    )
    const count = await manager.api.post('/api/exports', {
      dataset: 'tasks',
      format: 'csv',
      columns: ['id'],
      grid: query.toString(),
      preview: true
    })
    assert.equal(count.body.rows, list.body.total)
  })

  test('the grid query cannot widen an export, and a bad one is refused', async () => {
    const mine = await make({ title: 'Grid scoped', projectId: other.numericId })
    await make({ title: 'Grid scoped elsewhere', projectId: project.numericId })
    const inProject = await manager.api.post('/api/exports', {
      dataset: 'tasks',
      format: 'csv',
      columns: ['id'],
      scope: { projectId: other.numericId },
      grid: new URLSearchParams({ q: 'Grid scoped' }).toString()
    })
    assert.deepEqual(
      csv(inProject).map(row => row.replace(/"/g, '')),
      [mine.id],
      'the project in scope still applies'
    )
    assert.equal(
      (await manager.api.post('/api/exports', { dataset: 'tasks', format: 'csv', grid: 'where=not-json' })).status,
      400
    )
    assert.equal(
      (await manager.api.post('/api/exports', { dataset: 'tasks', format: 'csv', grid: 'x'.repeat(13_000) })).status,
      400
    )
  })

  test('tags are an export column, hidden unless chosen', async () => {
    const t = await make({ title: 'Tagged export', tags: ['exportme'] })
    const catalogue = (await manager.api.get('/api/exports/datasets')).body.datasets.find((d: any) => d.id === 'tasks')
    const column = catalogue.columns.find((c: any) => c.key === 'tags')
    assert.ok(column, 'the column exists')
    assert.equal(column.defaultVisible, false)
    const res = await manager.api.post('/api/exports', {
      dataset: 'tasks',
      format: 'csv',
      columns: ['id', 'tags'],
      ids: [t.numericId]
    })
    assert.match(res.text, /exportme/)
  })
})
