import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { bucketFor } from '../../server/reports'
import { addDays } from '../../server/util'
import { Api, type TestServer, launch, makeUser, setupAdmin, sleep } from '../helpers/server'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let developer: Awaited<ReturnType<typeof makeUser>>
let viewer: Awaited<ReturnType<typeof makeUser>>
let project: any
let managerPerson: string
let devPerson: string

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  developer = await makeUser(server, admin, 'Developer', 'Dev Dana')
  viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
  const people = (await admin.get('/api/bootstrap')).body.people
  managerPerson = people.find((p: any) => p.name === 'Mia Manager').id
  devPerson = people.find((p: any) => p.name === 'Dev Dana').id
  project = (await manager.api.post('/api/projects', { name: 'Payments', code: 'PAY' })).body
})
after(() => server.cleanup())

const boot = async (api = admin) => (await api.get('/api/bootstrap')).body
const makeTask = async (extra: Record<string, unknown> = {}, api = manager.api) => {
  const res = await api.post('/api/tasks', {
    title: 'A task',
    projectId: project.numericId,
    assigneeId: devPerson,
    ...extra
  })
  assert.equal(res.status, 200, res.text)
  return res.body
}

describe('input validation (VAL-01)', () => {
  test('tasks: title, project, enums and dates are validated', async () => {
    const bad: [string, Record<string, unknown>][] = [
      ['empty title', { title: '   ' }],
      ['huge title', { title: 'x'.repeat(5000) }],
      ['missing project', { projectId: 999999 }],
      ['non-numeric project', { projectId: 'abc' }],
      ['bad priority', { priority: 'Banana' }],
      ['bad type', { type: 'Magic' }],
      ['impossible date', { dueDate: '2026-02-30' }],
      ['text date', { dueDate: 'tomorrow' }],
      ['unknown status', { status: 'Nope' }],
      ['unknown assignee', { assigneeId: 'person_nobody' }],
      ['bad blocked flag', { blocked: 'yes' }],
      ['bad custom fields', { customFields: { 'bad key!': 1 } }]
    ]
    for (const [label, over] of bad) {
      const res = await manager.api.post('/api/tasks', { title: 'T', projectId: project.numericId, ...over })
      assert.equal(res.status, 400, `${label}: ${res.text}`)
      assert.equal(res.body.code === 'VALIDATION_FAILED' || res.body.code === 'BAD_REQUEST', true, label)
    }
    const stored = (await boot()).tasks.length
    assert.equal(stored, 0, 'nothing was persisted by the rejected requests')
  })

  test('projects, people, teams, milestones, alerts reject nonsense', async () => {
    assert.equal((await manager.api.post('/api/projects', { name: '' })).status, 400)
    assert.equal((await manager.api.post('/api/projects', { name: 'X', code: 'bad code!' })).status, 400)
    assert.equal((await manager.api.post('/api/projects', { name: 'X', teamId: 'team_nope' })).status, 400)
    assert.equal((await manager.api.post('/api/projects', { name: 'X', deadline: '31/12/2026' })).status, 400)
    assert.equal((await manager.api.post('/api/people', { name: 'P', email: 'nope' })).status, 400)
    assert.equal((await manager.api.post('/api/people', { name: 'P', capacity: 5000 })).status, 400)
    assert.equal((await manager.api.post('/api/people', { name: 'P', teamId: 'team_nope' })).status, 400)
    assert.equal((await manager.api.post('/api/teams', { name: '' })).status, 400)
    assert.equal((await manager.api.post('/api/milestones', { name: 'M', projectId: 12345 })).status, 400)
    assert.equal((await manager.api.post('/api/alerts', { title: 'A', type: 'wat' })).status, 400)
    assert.equal((await manager.api.post('/api/alerts', { title: 'A', projectId: 12345 })).status, 400)
    assert.equal((await manager.api.post('/api/tasks', { title: 'x' })).status, 400, 'project is required')
  })

  test('project codes are unique, case-insensitively, and generated when omitted', async () => {
    assert.equal((await manager.api.post('/api/projects', { name: 'Dup', code: 'pay' })).status, 409)
    const a = (await manager.api.post('/api/projects', { name: 'Billing Portal' })).body
    const b = (await manager.api.post('/api/projects', { name: 'Billing Portal' })).body
    assert.equal(a.code, 'BIL')
    assert.equal(b.code, 'BIL2')
    assert.equal((await manager.api.put(`/api/projects/${b.numericId}`, { code: 'bil' })).status, 409)
    assert.equal((await manager.api.put(`/api/projects/${b.numericId}`, { code: 'bil2' })).status, 200)
  })

  test('creating a task in a workspace without projects explains what to do', async () => {
    const fresh = await launch()
    try {
      const a = await setupAdmin(fresh)
      const res = await a.post('/api/tasks', { title: 'Orphan', projectId: '' })
      assert.equal(res.status, 400)
      assert.match(res.body.error, /project/i)
    } finally {
      await fresh.cleanup()
    }
  })
})

describe('task semantics', () => {
  test('a status-only edit does not clear the blocked flag (VAL-02)', async () => {
    const task = await makeTask({ blocked: true })
    assert.equal(task.blocked, true)
    const moved = await developer.api.put(`/api/tasks/${task.numericId}`, { status: 'In progress' })
    assert.equal(moved.status, 200)
    assert.equal(moved.body.blocked, true)
    assert.equal(moved.body.status, 'In progress')
    const cleared = await developer.api.put(`/api/tasks/${task.numericId}`, { blocked: false })
    assert.equal(cleared.body.blocked, false)
  })

  test('display keys are frozen: renaming the project code never renames tasks', async () => {
    const p = (await manager.api.post('/api/projects', { name: 'Frozen Keys', code: 'FRZ' })).body
    const task = await makeTask({ projectId: p.numericId })
    assert.match(task.id, /^FRZ-\d{3}$/)
    assert.equal((await manager.api.put(`/api/projects/${p.numericId}`, { code: 'ICE' })).status, 200)
    const after = (await boot()).tasks.find((t: any) => t.numericId === task.numericId)
    assert.equal(after.id, task.id)
  })

  test('completing sets completedAt, re-opening clears it, and both are recorded as events', async () => {
    const task = await makeTask()
    const done = await developer.api.patch(`/api/tasks/${task.numericId}/status`, { status: 'Done' })
    assert.equal(done.body.status, 'Done')
    assert.ok(done.body.completedAt)
    const reopened = await developer.api.patch(`/api/tasks/${task.numericId}/status`, { status: 'Review' })
    assert.equal(reopened.body.completedAt, '')
    const actions = server.db.state.workLogs.filter(row => row.taskId === task.numericId).map(row => row.action)
    assert.deepEqual(actions, ['Created task', 'Completed task', 'Reopened task'])
  })

  test('statuses are validated and advance walks the workflow', async () => {
    const task = await makeTask()
    assert.equal((await developer.api.patch(`/api/tasks/${task.numericId}/status`, { status: 'Bogus' })).status, 400)
    assert.equal((await developer.api.patch(`/api/tasks/${task.numericId}/status`, {})).status, 400)
    const next = await developer.api.patch(`/api/tasks/${task.numericId}/status`, { advance: true })
    assert.equal(next.body.status, 'In progress')
  })

  test('developers move any task but may only re-plan tasks assigned to or created by them (SEC-07c)', async () => {
    const managersTask = await makeTask({ assigneeId: managerPerson, title: 'Manager owned', priority: 'High' })
    const status = await developer.api.put(`/api/tasks/${managersTask.numericId}`, {
      ...managersTask,
      status: 'In progress'
    })
    assert.equal(status.status, 200, 'whole record echoed back with a status change is fine')
    const replan = await developer.api.put(`/api/tasks/${managersTask.numericId}`, {
      title: 'Hijacked',
      assigneeId: devPerson,
      dueDate: '2030-01-01'
    })
    assert.equal(replan.status, 403)
    const current = (await boot()).tasks.find((t: any) => t.numericId === managersTask.numericId)
    assert.equal(current.title, 'Manager owned')
    assert.equal(current.assigneeId, managerPerson)
    const mine = await makeTask({ assigneeId: devPerson, title: 'Dana owned' })
    assert.equal((await developer.api.put(`/api/tasks/${mine.numericId}`, { title: 'Renamed by Dana' })).status, 200)
    assert.equal(
      (await manager.api.put(`/api/tasks/${managersTask.numericId}`, { title: 'Manager may re-plan' })).status,
      200
    )
    assert.equal((await viewer.api.put(`/api/tasks/${mine.numericId}`, { title: 'nope' })).status, 403)
    assert.equal((await developer.api.delete(`/api/tasks/${mine.numericId}`)).status, 403)
  })

  test('workflow transitions are enforced only when the administrator turns enforcement on (VAL-05)', async () => {
    const task = await makeTask()
    assert.equal(
      (await developer.api.patch(`/api/tasks/${task.numericId}/status`, { status: 'Done' })).status,
      200,
      'default: any move is allowed'
    )
    const on = await admin.put('/api/settings', {
      workflows: { task: { ...(await boot()).settings.workflows.task, enforceTransitions: true } }
    })
    assert.equal(on.status, 200)
    const t2 = await makeTask()
    const jump = await developer.api.patch(`/api/tasks/${t2.numericId}/status`, { status: 'Done' })
    assert.equal(jump.status, 409)
    assert.equal(jump.body.code, 'TRANSITION_NOT_ALLOWED')
    assert.equal(
      (await developer.api.patch(`/api/tasks/${t2.numericId}/status`, { status: 'In progress' })).status,
      200
    )
    assert.equal(
      (
        await admin.put('/api/settings', {
          workflows: { task: { ...(await boot()).settings.workflows.task, enforceTransitions: false } }
        })
      ).status,
      200
    )
  })

  test('deleting a task is recorded, keeps history readable and clears alert references', async () => {
    const task = await makeTask({ title: 'Short lived' })
    const alert = (
      await manager.api.post('/api/alerts', { title: 'About it', projectId: project.numericId, taskId: task.numericId })
    ).body
    assert.equal((await manager.api.delete(`/api/tasks/${task.numericId}`)).status, 200)
    assert.equal((await manager.api.delete(`/api/tasks/${task.numericId}`)).status, 404)
    const a = (await boot()).alerts.find((x: any) => x.id === alert.id)
    assert.equal(a.taskId, '')
    const rows = (await manager.api.get('/api/reports/activity/weekly?userId=all')).body.rows.filter(
      (r: any) => r.taskNumericId === task.numericId
    )
    assert.ok(rows.some((r: any) => r.action === 'Deleted task'))
    assert.ok(
      rows.every((r: any) => r.task === 'Short lived'),
      'names come from the ledger snapshot'
    )
  })
})

describe('referential integrity and destructive operations (DATA-05)', () => {
  test('deleting a project with work in it is refused unless explicitly cascaded, and snapshots first', async () => {
    const p = (await manager.api.post('/api/projects', { name: 'Doomed', code: 'DOOM' })).body
    const t = await makeTask({ projectId: p.numericId })
    await manager.api.post('/api/milestones', { name: 'M1', projectId: p.numericId })
    const refused = await manager.api.delete(`/api/projects/${p.numericId}`)
    assert.equal(refused.status, 409)
    assert.equal(refused.body.code, 'HAS_DEPENDENTS')
    assert.equal(refused.body.details.tasks, 1)
    assert.ok(
      (await boot()).tasks.some((x: any) => x.numericId === t.numericId),
      'still there'
    )
    const before = server.db.listBackups().length
    const done = await manager.api.delete(`/api/projects/${p.numericId}?cascade=true`)
    assert.equal(done.status, 200)
    assert.equal(done.body.removed.tasks, 1)
    assert.ok(server.db.listBackups().length > before, 'a pre-delete backup was taken')
    assert.ok(server.db.listBackups().some(b => b.reason === 'pre-delete-project'))
    const empty = (await manager.api.post('/api/projects', { name: 'Empty', code: 'EMPT' })).body
    assert.equal(
      (await manager.api.delete(`/api/projects/${empty.numericId}`)).status,
      200,
      'an empty project needs no confirmation'
    )
  })

  test('deleting a person unassigns their tasks instead of silently re-assigning them to the deleter', async () => {
    const person = (await manager.api.post('/api/people', { name: 'Leaving Larry', email: 'larry@example.com' })).body
    const t = await makeTask({ assigneeId: person.id })
    const res = await manager.api.delete(`/api/people/${person.id}`)
    assert.equal(res.status, 200)
    assert.equal(res.body.unassignedTasks, 1)
    const row = (await boot()).tasks.find((x: any) => x.numericId === t.numericId)
    assert.equal(row.assigneeId, '')
    assert.equal(row.assignee, 'Unassigned')
    assert.equal(
      (await manager.api.delete(`/api/people/${managerPerson}`)).status,
      400,
      'people with accounts are protected'
    )
  })

  test('teams in use cannot be deleted', async () => {
    const team = (await manager.api.post('/api/teams', { name: 'Temp' })).body
    const p = (await manager.api.post('/api/projects', { name: 'Uses team', code: 'UTM', teamId: team.id })).body
    assert.equal((await manager.api.delete(`/api/teams/${team.id}`)).status, 400)
    assert.equal(
      (await manager.api.put(`/api/projects/${p.numericId}`, { teamId: (await boot()).teams[0].id })).status,
      200
    )
    assert.equal((await manager.api.delete(`/api/teams/${team.id}`)).status, 200)
  })

  test('deleting something that does not exist is a 404, not a silent success', async () => {
    for (const route of [
      '/api/tasks/999999',
      '/api/projects/999999',
      '/api/people/nope',
      '/api/teams/nope',
      '/api/milestones/nope',
      '/api/activity/nope',
      '/api/alerts/nope'
    ])
      assert.equal((await manager.api.delete(route)).status, 404, route)
  })
})

describe('ledger and reports are honest (DATA-04, REP-01..03)', () => {
  test('events are attributed to the person who acted, not the assignee, and carry no invented minutes', async () => {
    const task = await makeTask({ assigneeId: devPerson, title: 'Moved by the manager' })
    await manager.api.patch(`/api/tasks/${task.numericId}/status`, { status: 'In progress' })
    const row = server.db.state.workLogs.filter(r => r.taskId === task.numericId).find(r => r.action === 'Moved task')!
    assert.equal(row.personId, managerPerson)
    assert.equal(row.assigneeId, devPerson)
    assert.equal((row as any).minutes, undefined)
    const report = (await manager.api.get('/api/reports/activity/weekly?userId=all')).body
    assert.equal(
      report.rows.some((r: any) => 'minutes' in r),
      false
    )
    assert.equal(
      report.users.some((u: any) => 'minutes' in u),
      false
    )
    assert.equal('minutes' in report.totals, false)
  })

  test('delivery rate is always within 0-100% and defined over one population', async () => {
    const p = (await manager.api.post('/api/projects', { name: 'Rates', code: 'RTE' })).body
    const today = (await boot()).today
    const mk = (n: number, status: string) =>
      makeTask({ projectId: p.numericId, title: `rate ${n}`, dueDate: today, status })
    for (let i = 0; i < 4; i++) await mk(i, 'Done') // 4 delivered on time
    const report = (await manager.api.get('/api/reports/weekly')).body
    for (const bucket of report.series) {
      if (bucket.rate !== null)
        assert.ok(bucket.rate >= 0 && bucket.rate <= 100, `bucket ${bucket.key} rate ${bucket.rate}`)
      assert.ok(bucket.delivered <= bucket.planned)
    }
    assert.ok(report.deliveryRate === null || (report.deliveryRate >= 0 && report.deliveryRate <= 100))
    assert.ok(report.definitions.deliveryRate)
  })

  test('re-opening or deleting a task does not rewrite the past (REP-02)', async () => {
    const task = await makeTask({ title: 'History keeper' })
    await developer.api.patch(`/api/tasks/${task.numericId}/status`, { status: 'Done' })
    const week = async () => (await manager.api.get('/api/reports/weekly')).body.series.at(-1)
    const withCompleted = await week()
    await developer.api.patch(`/api/tasks/${task.numericId}/status`, { status: 'Review' })
    await manager.api.delete(`/api/tasks/${task.numericId}`)
    const afterChanges = await week()
    assert.equal(afterChanges.completed, withCompleted.completed, 'completions recorded in the ledger stay recorded')
  })

  test('completed counts are distinct tasks, not events', async () => {
    const task = await makeTask({ title: 'Ping pong' })
    for (const status of ['Done', 'Review', 'Done', 'Review', 'Done'])
      await developer.api.patch(`/api/tasks/${task.numericId}/status`, { status })
    const report = (await manager.api.get('/api/reports/activity/weekly?userId=all')).body
    const mine = report.users.find((u: any) => u.personId === devPerson)
    const completionRows = report.rows.filter(
      (r: any) => r.taskNumericId === task.numericId && r.action === 'Completed task'
    )
    assert.equal(completionRows.length, 3)
    const totalDistinct = new Set(
      report.rows.filter((r: any) => r.action === 'Completed task').map((r: any) => r.taskNumericId)
    ).size
    assert.equal(report.totals.completedTasks, totalDistinct)
    assert.ok(mine.completedTasks <= mine.tasksTouched)
  })

  test('the blocker count comes from recorded events, not from searching summaries for the word "blocked"', async () => {
    const before = (await manager.api.get('/api/reports/activity/weekly?userId=all')).body.totals.blockers
    await developer.api.post('/api/activity', { today: 'Unblocked the build pipeline and moved on', blocked: '' })
    const afterText = (await manager.api.get('/api/reports/activity/weekly?userId=all')).body.totals.blockers
    assert.equal(afterText, before, 'the word "blocked" in free text is not a blocker')
    await developer.api.post('/api/activity', { today: 'Working', blocked: 'Waiting for credentials' })
    assert.equal((await manager.api.get('/api/reports/activity/weekly?userId=all')).body.totals.blockers, before + 1)
  })

  test('dashboard "my tasks" is the signed-in user\'s own open work', async () => {
    const mine = await makeTask({ assigneeId: devPerson, title: 'Dana only', dueDate: '2020-01-01' })
    const dana = await boot(developer.api)
    assert.ok(dana.dashboard.myTasks.every((t: any) => t.assigneeId === devPerson))
    assert.ok(dana.dashboard.myTasks.some((t: any) => t.numericId === mine.numericId))
    assert.ok(dana.dashboard.stats.myOpenTasks >= 1)
    assert.ok(dana.dashboard.stats.openTasks >= dana.dashboard.stats.myOpenTasks)
  })
})

describe('authorisation fails closed (VAL-04)', () => {
  const auditCount = () => server.db.state.auditLogs.filter(entry => entry.action === 'alert.updated').length

  test('an empty or partial alert patch is no way past authorisation, and a refused request leaves no audit entry', async () => {
    const alert = (await manager.api.post('/api/alerts', { title: 'Check the build', projectId: project.numericId }))
      .body
    const before = auditCount()
    for (const body of [{}, { resolved: true }, { resolved: 'yes' }, { title: 'Renamed by a reader' }])
      assert.equal(
        (await viewer.api.patch(`/api/alerts/${alert.id}`, body)).status,
        403,
        `a Viewer sending ${JSON.stringify(body)}`
      )
    assert.equal(auditCount(), before, 'nothing was recorded as an alert update')
    const denied = () =>
      server.db.state.auditLogs.some(
        entry => entry.action === 'access.denied' && String((entry.detail as any)?.path).includes(alert.id)
      )
    for (let i = 0; i < 20 && !denied(); i++) await sleep(250) // denials are written to the audit trail in batches
    assert.ok(denied(), 'the refusals are audited as denials instead')
  })

  test('people who may write tasks can resolve an alert but not edit it; an empty patch is a 400 for everyone', async () => {
    const alert = (await manager.api.post('/api/alerts', { title: 'Needs a look', projectId: project.numericId })).body
    assert.equal((await developer.api.patch(`/api/alerts/${alert.id}`, { resolved: true })).status, 200)
    assert.equal((await developer.api.patch(`/api/alerts/${alert.id}`, { title: 'Hijacked' })).status, 403)
    assert.equal((await manager.api.patch(`/api/alerts/${alert.id}`, { title: 'Edited by a manager' })).status, 200)
    for (const who of [developer.api, manager.api])
      assert.equal((await who.patch(`/api/alerts/${alert.id}`, {})).status, 400, 'nothing to update')
    assert.equal((await manager.api.patch(`/api/alerts/${alert.id}`, { resolved: 'yes' })).status, 400)
  })
})

describe('malformed stored data cannot take the server down (VAL-01)', () => {
  test('a task with a garbage due date still lists and renders', async () => {
    const task = await makeTask({ title: 'Will be damaged' })
    const stored = server.db.state.tasks.find(t => t.id === task.numericId)!
    stored.dueDate = 'not-a-date'
    const res = await admin.get('/api/bootstrap')
    assert.equal(res.status, 200)
    const row = res.body.tasks.find((t: any) => t.numericId === task.numericId)
    assert.equal(row.due, 'not-a-date')
    assert.equal(row.dueDays, null)
    stored.dueDate = '2030-01-01'
  })
})

describe('dashboard ranking and report windows (REP-03)', () => {
  test('"most active" counts this week\'s daily updates only, is ordered, and is hidden from people who may see only their own', async () => {
    const people = (await admin.get('/api/bootstrap')).body.people
    const ids = Object.fromEntries(people.map((p: any) => [p.name, p.id])) as Record<string, string>
    const today = (await boot()).today as string
    const thisWeek = bucketFor('weekly', today, server.db.state.settings)
    const lastWeek = addDays(thisWeek, -2)
    let n = 0
    const entry = (personId: string, date: string) => ({
      id: `activity_rank_${++n}`,
      personId,
      date,
      time: '10:00',
      yesterday: '',
      today: `Update ${n}`,
      blocked: '',
      upcoming: '',
      status: 'On track'
    })
    // Isolate from the updates other tests in this file posted for real; the original list is restored afterwards.
    const original = server.db.state.activities
    server.db.commit(
      state => {
        state.activities = []
        for (const [name, count, date] of [
          ['Dev Dana', 2, today],
          ['Mia Manager', 4, today],
          ['Vic Viewer', 9, lastWeek] // busiest overall, but not this week
        ] as const)
          for (let i = 0; i < count; i++) state.activities.push(entry(ids[name], date))
      },
      { reason: 'test-fixture' }
    )
    try {
      const ranked = (await boot(manager.api)).dashboard.mostActive
      assert.deepEqual(
        ranked.map((r: any) => [r.name, r.updates]),
        [
          ['Mia Manager', 4],
          ['Dev Dana', 2]
        ]
      )
      assert.ok(ranked.every((r: any) => r.personId && r.color))
      assert.deepEqual((await boot(admin)).dashboard.mostActive, ranked)
      for (const who of [developer.api, viewer.api])
        assert.equal((await boot(who)).dashboard.mostActive, null, 'no ranking of colleagues for this role')
      assert.equal((await admin.put('/api/settings', { reports: { activityVisibility: 'everyone' } })).status, 200)
      assert.deepEqual((await boot(developer.api)).dashboard.mostActive, ranked, 'visible once the workspace opts in')
      assert.equal((await admin.put('/api/settings', { reports: { activityVisibility: 'managers' } })).status, 200)
    } finally {
      server.db.commit(
        state => {
          state.activities = original
        },
        { reason: 'test-fixture' }
      )
      await admin.put('/api/settings', { reports: { activityVisibility: 'managers' } })
    }
  })

  test('the delivery report and the activity report cover the same periods', async () => {
    for (const period of ['daily', 'weekly', 'monthly']) {
      const delivery = (await manager.api.get(`/api/reports/${period}`)).body.series.map((b: any) => b.key)
      const activity = (await manager.api.get(`/api/reports/activity/${period}?userId=all`)).body.series.map(
        (b: any) => b.key
      )
      assert.deepEqual(activity, delivery, period)
    }
  })
})
