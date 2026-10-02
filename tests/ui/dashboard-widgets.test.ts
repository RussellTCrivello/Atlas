// REP-03: widgets that used to present arbitrary numbers as analytics now show what they claim to show.
// The real client bundle runs in jsdom against a real server; jsdom does not cover layout or CSS.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { bucketFor } from '../../server/reports'
import { addDays } from '../../server/util'
import { Api, type TestServer, launch, makeUser, setupAdmin } from '../helpers/server'
import { type BootedUI, bootUI, textOf } from '../helpers/ui'

let server: TestServer
let admin: Api
let manager: Awaited<ReturnType<typeof makeUser>>
let dev: Awaited<ReturnType<typeof makeUser>>
const uis: BootedUI[] = []

async function open(api: Api, hash: string, ready: () => string) {
  const ui = await bootUI({ base: server.url, cookie: api.cookie, hash })
  uis.push(ui)
  await ui.waitFor(() => textOf(ui.doc.body).includes(ready()))
  return ui
}

before(async () => {
  server = await launch()
  admin = await setupAdmin(server)
  manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
  dev = await makeUser(server, admin, 'Developer', 'Dev Dana')

  // Daily updates: Ann 3, Cy 2, Bob 1 this week; "Old Timer" 6 but all in the previous week; Zed none.
  const person = async (name: string) => (await manager.api.post('/api/people', { name })).body.id as string
  const [ann, bob, cy, oldTimer] = await Promise.all(['Ann Alpha', 'Bob Beta', 'Cy Gamma', 'Old Timer'].map(person))
  await person('Zed Zero')
  const today = (await admin.get('/api/bootstrap')).body.today as string
  const lastWeek = addDays(bucketFor('weekly', today, server.db.state.settings), -3)
  let n = 0
  const entry = (personId: string, date: string) => ({
    id: `activity_fixture_${++n}`,
    personId,
    date,
    time: '09:00',
    yesterday: '',
    today: `Fixture update ${n}`,
    blocked: '',
    upcoming: '',
    status: 'On track'
  })
  server.db.commit(
    state => {
      for (const [personId, count, date] of [
        [ann, 3, today],
        [cy, 2, today],
        [bob, 1, today],
        [oldTimer, 6, lastWeek]
      ] as const)
        for (let i = 0; i < count; i++) state.activities.push(entry(personId, date))
    },
    { reason: 'test-fixture' }
  )

  // Milestones: eight open ones inserted out of order plus two finished ones with the earliest dates.
  const project = (await manager.api.post('/api/projects', { name: 'Roadmap', code: 'MAP' })).body
  const milestones: [string, string, string][] = [
    ['M-may', '2031-05-20', 'Upcoming'],
    ['M-mar15', '2031-03-15', 'At risk'],
    ['M-apr', '2031-04-01', 'Upcoming'],
    ['M-mar02', '2031-03-02', 'Upcoming'],
    ['M-jun', '2031-06-30', 'Upcoming'],
    ['M-jul', '2031-07-04', 'Upcoming'],
    ['M-feb', '2031-02-11', 'Upcoming'],
    ['M-sep', '2031-09-09', 'Upcoming'],
    ['M-done1', '2031-01-05', 'Complete'],
    ['M-done2', '2031-01-10', 'Complete']
  ]
  for (const [name, dueDate, status] of milestones)
    assert.equal(
      (await manager.api.post('/api/milestones', { name, dueDate, status, projectId: project.numericId })).status,
      200,
      name
    )
})
after(async () => {
  uis.forEach(ui => ui.close())
  await server.cleanup()
})

describe('"Most active this week" ranks this week\'s updates (REP-03)', () => {
  const rows = (ui: BootedUI) =>
    [...ui.doc.querySelectorAll('.contributor-card .contributor-row')].map(
      row => `${textOf(row.querySelector('strong'))} ${textOf(row.lastElementChild)}`
    )

  test('a manager sees the people with the most updates this week, highest first, and nobody with none', async () => {
    const ui = await open(manager.api, '/activity', () => 'Most active this week')
    assert.deepEqual(rows(ui), ['Ann Alpha 3 updates', 'Cy Gamma 2 updates', 'Bob Beta 1 updates'])
    assert.ok(!textOf(ui.doc.body).includes('No updates logged this week yet'))
  })

  test('people who may only see their own activity do not get a ranking of colleagues', async () => {
    const ui = await open(dev.api, '/activity', () => 'Daily updates become operational intelligence')
    assert.equal(ui.doc.querySelector('.contributor-card'), null)
    const notice = textOf(ui.doc.querySelector('.page-content > [role="note"]'))
    assert.match(notice, /Daily updates are visible to everyone in this workspace\./)
    assert.match(notice, /limited to managers and administrators; everyone can see their own/, 'GOV-02 transparency')
  })

  test('the workspace can opt in, and then everyone sees the ranking', async () => {
    assert.equal((await admin.put('/api/settings', { reports: { activityVisibility: 'everyone' } })).status, 200)
    try {
      const ui = await open(dev.api, '/activity', () => 'Most active this week')
      assert.deepEqual(rows(ui), ['Ann Alpha 3 updates', 'Cy Gamma 2 updates', 'Bob Beta 1 updates'])
      assert.match(
        textOf(ui.doc.querySelector('.page-content > [role="note"]')),
        /activity reports are visible to everyone in this workspace/,
        'the notice follows the setting'
      )
    } finally {
      await admin.put('/api/settings', { reports: { activityVisibility: 'managers' } })
    }
  })
})

describe('the milestone list is ordered and complete (REP-03, MIN-05)', () => {
  const names = (ui: BootedUI) => [...ui.doc.querySelectorAll('.milestone-row .milestone-copy strong')].map(textOf)

  test('open milestones come first by due date; finished ones follow; nothing is silently dropped', async () => {
    const ui = await open(manager.api, '/projects', () => 'Upcoming milestones')
    assert.deepEqual(names(ui), ['M-feb', 'M-mar02', 'M-mar15', 'M-apr', 'M-may', 'M-jun', 'M-jul', 'M-sep'])
    const more = ui.doc.querySelector('.milestone-list ~ .show-more') as HTMLElement
    assert.ok(more, 'a control reveals the rest')
    assert.match(textOf(more), /Show 2 more \(2 left\)/)
    ui.click('.show-more', 'Show 2 more')
    await ui.settle(100)
    assert.deepEqual(names(ui).slice(8), ['M-done1', 'M-done2'])
    assert.equal(ui.doc.querySelector('.milestone-list ~ .show-more'), null, 'nothing left to reveal')
  })

  test('the date tile shows a month name, not a bare number', async () => {
    const ui = await open(manager.api, '/projects', () => 'Upcoming milestones')
    const tile = ui.doc.querySelector('.milestone-row .milestone-date')!
    assert.equal(textOf(tile.querySelector('strong')), '11')
    assert.equal(textOf(tile.querySelector('span')), 'Feb')
  })
})

describe('"Planned capacity" says what it is (REP-03)', () => {
  test('the People page labels the figure as a manual plan, not a measurement', async () => {
    const ui = await open(admin, '/people', () => 'Avg. planned capacity')
    const text = textOf(ui.doc.body)
    assert.match(text, /Planned capacity is entered by hand on each profile; it is not calculated from assigned work/)
    assert.ok(ui.doc.querySelectorAll('.person-card .capacity span').length > 0)
    assert.ok([...ui.doc.querySelectorAll('.person-card .capacity span')].every(el => textOf(el) !== 'Capacity'))
  })
})
