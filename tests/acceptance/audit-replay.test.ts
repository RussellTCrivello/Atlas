// Replays the reproductions from docs/AUDIT_REPORT_2026-10-02.md (Appendix A and the P0/P1 findings) against the BUILT
// bundle, as a black-box client: a real process, real HTTP and the real command line. Every test names the finding it
// closes. The in-process suites cover the same behaviour in more depth; this file proves that it survives bundling,
// start-up and a separate process. Run it with `npm run build && npm run test:acceptance`.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { before, describe, test } from 'node:test'
import type { RunningServer } from '../../server/index'
import { type Running, root, runCli, skip, start, tmp } from '../helpers/bundle'
import { openDirect } from '../helpers/db'
import { raw } from '../helpers/raw'
import { Api, PASSWORD, SETUP_TOKEN, makeUser, setupAdmin, sleep } from '../helpers/server'

/** The shared helpers only need the base URL of the server. */
const target = (running: Running) => ({ url: running.base, port: running.port }) as unknown as RunningServer
type Member = Awaited<ReturnType<typeof makeUser>>

const keysOf = (value: unknown, found = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach(item => keysOf(item, found))
  else if (value && typeof value === 'object')
    for (const [key, inner] of Object.entries(value)) {
      found.add(key)
      keysOf(inner, found)
    }
  return found
}

describe('audit replay against the production bundle', { skip }, () => {
  let dir: string
  let server: Running
  let admin: Api
  let manager: Member
  let developer: Member
  let viewer: Member
  let project: any
  let people: any[]
  const person = (name: string) => people.find(p => p.name === name).id as string

  before(async () => {
    dir = tmp('replay')
    server = await start(dir)
    admin = await setupAdmin(target(server))
    manager = await makeUser(target(server), admin, 'Manager', 'Mia Manager')
    developer = await makeUser(target(server), admin, 'Developer', 'Dev Dana')
    viewer = await makeUser(target(server), admin, 'Viewer', 'Vic Viewer')
    project = (await manager.api.post('/api/projects', { name: 'Payments', code: 'PAY' })).body
    people = (await admin.get('/api/bootstrap')).body.people
  })

  // ---- P0 ------------------------------------------------------------------------------------------------------------
  test('SEC-01 · a configured workspace cannot be re-initialised or taken over, with or without the setup token', async () => {
    const mallory = { name: 'Mallory', email: 'm@evil.test', password: 'Passw0rd!!' }
    const noToken = await new Api(server.base).post('/api/setup', mallory)
    assert.ok([403, 409].includes(noToken.status), `no token: ${noToken.status}`)
    const withToken = await new Api(server.base).post('/api/setup', { ...mallory, token: SETUP_TOKEN })
    assert.equal(withToken.status, 409)
    assert.equal(
      (await new Api(server.base).post('/api/auth/login', { email: 'm@evil.test', password: mallory.password })).status,
      401
    )
    assert.equal((await admin.get('/api/auth/me')).status, 200, 'the original administrator is still signed in')
    assert.ok((await admin.get('/api/bootstrap')).body.projects.some((p: any) => p.code === 'PAY'))
  })

  test('SEC-02 · only the web build is reachable: no store, no source, no config, no lock file', async () => {
    const leaks = /schemaVersion|passwordHash|scrypt\$|createApp|"name":\s*"atlas-workspace"|ATLAS_SETUP_TOKEN|"pid"/
    const routes = [
      '/data/atlas.db',
      '/atlas.db',
      '/atlas.db-wal',
      '/atlas-store.json',
      '/sessions.json',
      '/atlas.lock',
      '/backups/',
      '/app.tsx',
      '/package.json',
      '/electron/main.cjs',
      '/server/security/passwords.ts',
      '/shared/password.ts',
      '/dist-desktop/app.mjs',
      '/tests/helpers/server.ts',
      '/.git/config',
      '/.env'
    ]
    for (const route of routes) {
      const res = await raw(server.base + route)
      assert.ok([200, 404].includes(res.status), `${route}: ${res.status}`)
      assert.doesNotMatch(res.text, leaks, `${route} must not disclose anything`)
      if (res.status === 200)
        assert.match(String(res.headers['content-type']), /html/, `${route} is only the app shell`)
    }
  })

  test('SEC-03 · anonymous translation reports are refused; a signed-in user cannot grow the store through them', async () => {
    const revision = async () => (await admin.get('/api/revision')).body.revision
    const before = await revision()
    const anonymous = new Api(server.base)
    for (let i = 0; i < 20; i++)
      assert.equal(
        (
          await anonymous.post('/api/i18n/missing', {
            key: `junk.${i}`,
            language: `x${i}`,
            fallback: 'A'.repeat(20000)
          })
        ).status,
        401
      )
    for (let i = 0; i < 40; i++)
      await viewer.api.post('/api/i18n/missing', { key: `spam.${i}`, fallback: 'B'.repeat(2000) })
    assert.equal(await revision(), before, 'nothing was written to the database')
    assert.equal((await admin.put('/api/settings', { workspace: { name: 'Still saves' } })).status, 200)
  })

  // ---- P1: security ----------------------------------------------------------------------------------------------------
  test('SEC-10 · hardened headers, Host and Origin checks, JSON errors (MIN-02)', async () => {
    const res = await new Api(server.base).get('/api/health')
    assert.equal(res.headers.get('x-powered-by'), null)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    const csp = String(res.headers.get('content-security-policy'))
    assert.match(csp, /default-src 'self'/)
    assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/)
    const evil = await raw(`${server.base}/api/health`, { headers: { Host: 'evil.example.com' } })
    assert.equal(evil.status, 403)
    assert.equal(evil.json.code, 'HOST_NOT_ALLOWED')
    const cross = await raw(`${server.base}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: `127.0.0.1:${server.port}`,
        Origin: 'https://evil.example'
      },
      body: JSON.stringify({ email: 'x@example.com', password: 'wrong-password' })
    })
    assert.equal(cross.status, 403)
    assert.equal(cross.json.code, 'CROSS_ORIGIN')
    const missing = await admin.put('/api/alerts/al1', {})
    assert.equal(missing.status, 404, 'the documented-but-absent route is a JSON 404, not 200 + HTML')
    assert.equal(missing.body.code, 'NOT_FOUND')
    const malformed = await new Api(server.base).request('POST', '/api/auth/login', '{"email": ')
    assert.equal(malformed.status, 400)
    assert.equal(malformed.body.code, 'BAD_JSON')
  })

  test('SEC-06 · the last administrator cannot be removed, and e-mail addresses stay unique', async () => {
    const me = (await admin.get('/api/auth/me')).body.user
    assert.equal((await admin.put(`/api/users/${me.id}`, { role: 'Viewer' })).status, 400)
    assert.equal((await admin.put(`/api/users/${me.id}`, { active: false })).status, 400)
    assert.equal((await admin.delete(`/api/users/${me.id}`)).status, 400)
    assert.equal((await admin.get('/api/system')).status, 200, 'administration still works')
    assert.equal((await admin.put(`/api/users/${manager.user.id}`, { email: 'ADMIN@example.com' })).status, 409)
    assert.equal(
      (await new Api(server.base).post('/api/auth/login', { email: manager.email, password: PASSWORD })).status,
      200
    )
  })

  test('SEC-07 · roles see and change only what they should', async () => {
    const boot = (await viewer.api.get('/api/bootstrap')).body
    assert.deepEqual(boot.users, [], 'no account directory for a Viewer')
    for (const branch of ['security', 'integrations', 'permissions', 'audit', 'storage'])
      assert.equal(boot.settings[branch], undefined, `${branch} is not sent to a Viewer`)
    assert.ok(!JSON.stringify(boot).includes('passwordHash'))
    assert.equal((await viewer.api.get('/api/users')).status, 403)
    const task = (
      await manager.api.post('/api/tasks', {
        title: 'Manager owned',
        projectId: project.numericId,
        assigneeId: person('Mia Manager'),
        priority: 'High'
      })
    ).body
    const hijack = await developer.api.put(`/api/tasks/${task.numericId}`, {
      title: 'Hijacked',
      assigneeId: person('Dev Dana'),
      dueDate: '2030-01-01'
    })
    assert.equal(hijack.status, 403, 'a Developer cannot re-plan a manager-owned task')
    const forged = await developer.api.post('/api/activity', {
      personId: person('Mia Manager'),
      today: 'Shipped the fix'
    })
    assert.equal(forged.status, 403, 'nor post an update on a colleague’s behalf')
    const own = await developer.api.post('/api/activity', { today: 'Wrote tests' })
    assert.equal(own.body.personId, person('Dev Dana'))
    assert.equal((await developer.api.get(`/api/reports/activity/weekly?userId=${person('Mia Manager')}`)).status, 403)
  })

  test('SEC-04 · guessing is throttled, failures are audited and the server stays responsive while passwords are checked', async () => {
    const dedicated = await start(tmp('throttle'))
    const owner = await setupAdmin(target(dedicated))
    const victim = await makeUser(target(dedicated), owner, 'Viewer', 'Locky')
    const attacker = new Api(dedicated.base)
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await attacker.post('/api/auth/login', { email: victim.email, password: `wrong-${i}-guess` })).status,
        401
      )
    const locked = await attacker.post('/api/auth/login', { email: victim.email, password: PASSWORD })
    assert.equal(locked.status, 429, 'even the right password is refused during the lock')
    assert.ok(Number(locked.headers.get('retry-after')) > 0)
    const flood = Array.from({ length: 12 }, (_, i) =>
      new Api(dedicated.base).post('/api/auth/login', { email: `nobody${i}@example.com`, password: 'x'.repeat(14) })
    )
    await sleep(30)
    const t0 = performance.now()
    assert.equal((await new Api(dedicated.base).get('/api/health')).status, 200)
    const elapsed = performance.now() - t0
    assert.ok(elapsed < 1000, `/api/health took ${elapsed.toFixed(0)} ms during a login flood (was ≈ 5 s)`)
    await Promise.all(flood)
    let audit: any
    for (let attempt = 0; attempt < 15; attempt++) {
      audit = (await owner.get('/api/audit')).body // failed sign-ins are written to the audit trail in batches
      if (audit.rows.filter((row: any) => row.action === 'auth.login.failed').length >= 5) break
      await sleep(300)
    }
    assert.ok(audit.rows.filter((row: any) => row.action === 'auth.login.failed').length >= 5, 'failures are audited')
    assert.equal(audit.chain.ok, true, 'the audit hash chain verifies')
  })

  test('SEC-05 · sessions are 256-bit, survive a restart, and end when the password is reset', async () => {
    const sessionsDir = tmp('sessions')
    const first = await start(sessionsDir)
    const owner = await setupAdmin(target(first))
    const user = await makeUser(target(first), owner, 'Developer', 'Sam Session')
    const login = await new Api(first.base).post('/api/auth/login', { email: user.email, password: PASSWORD })
    const cookie = login.headers.getSetCookie()[0]
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Lax/i)
    const token = cookie.split(';')[0].split('=')[1]
    assert.ok(token.length >= 43, `a ${token.length}-character token (256 bits needs 43)`)
    assert.equal(await first.stop('SIGTERM'), 0)
    const second = await start(sessionsDir)
    const returning = new Api(second.base)
    returning.cookie = `atlas_sid=${token}`
    assert.equal((await returning.get('/api/auth/me')).status, 200, 'the session survived the restart')
    const admin2 = new Api(second.base)
    await admin2.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
    const reset = await admin2.put(`/api/users/${user.user.id}`, { password: 'Another-Passw0rd-42' })
    assert.equal(reset.status, 200, reset.text)
    assert.equal((await returning.get('/api/auth/me')).status, 401, 'a password reset ends the old session')
  })

  test('SEC-09 · demo accounts never appear in production, even with the opt-in flag set', async () => {
    const demoDir = tmp('demo')
    const flagged = await start(demoDir, { env: { ATLAS_ALLOW_DEMO_DATA: 'true' } })
    const status = await new Api(flagged.base).get('/api/setup/status')
    assert.equal(status.body.demoAllowed, false)
    assert.equal(status.body.demo, null)
    assert.doesNotMatch(status.text, /atlas-demo|"password"/)
    assert.match(flagged.logs(), /ATLAS_ALLOW_DEMO_DATA/, 'the flag is reported as ignored')
    await flagged.stop()
    const reset = runCli(demoDir, ['--reset-data'], { ATLAS_ALLOW_DEMO_DATA: 'true' })
    assert.equal(reset.status, 1)
    assert.match(reset.stderr, /Refusing to load demo data/)
    const store = openDirect(demoDir, true)
    try {
      assert.equal(
        store.get("SELECT value FROM meta WHERE key = 'configured'")?.value,
        '0',
        'the workspace is still waiting for first-run setup'
      )
      assert.equal(store.scalar('SELECT count(*) FROM users'), 0, 'no demo accounts were written')
    } finally {
      store.close()
    }
  })

  // ---- P1: data ------------------------------------------------------------------------------------------------------------
  test('VAL-01 · poison values are refused with 400 and the workspace keeps loading for everyone', async () => {
    const date = await developer.api.post('/api/tasks', { title: 'x', projectId: project.numericId, dueDate: 'nope' })
    assert.equal(date.status, 400, date.text)
    const zone = await admin.put('/api/settings', { workspace: { defaultTimezone: 'Europe/Amsterdm' } })
    assert.equal(zone.status, 400, zone.text)
    assert.equal((await admin.put(`/api/users/${viewer.user.id}`, { email: 12345 })).status, 400)
    for (const role of ['constructor', 'toString', '__proto__'])
      assert.equal(
        (await admin.post('/api/users', { name: 'Proto', email: `${role}@example.com`, password: PASSWORD, role }))
          .status,
        400,
        role
      )
    for (const who of [admin, manager.api, viewer.api]) assert.equal((await who.get('/api/bootstrap')).status, 200)
    assert.equal((await manager.api.get('/api/reports/weekly')).status, 200)
  })

  test('VAL-03 / VAL-04 · alert patches fail closed, and unknown report parameters are errors', async () => {
    const alert = (await manager.api.post('/api/alerts', { title: 'Check the build', projectId: project.numericId }))
      .body
    assert.equal((await viewer.api.patch(`/api/alerts/${alert.id}`, {})).status, 403, 'a Viewer with an empty body')
    assert.equal((await viewer.api.patch(`/api/alerts/${alert.id}`, { resolved: true })).status, 403)
    assert.equal((await manager.api.patch(`/api/alerts/${alert.id}`, {})).status, 400, 'nothing to update')
    assert.equal((await manager.api.get('/api/reports/activity/weekly?userId=person_nope')).status, 404)
    assert.equal((await manager.api.get('/api/reports/bogus')).status, 400)
    assert.equal((await manager.api.get('/api/reports/activity/bogus')).status, 400)
  })

  test('DATA-03 · a mistyped ATLAS_BACKUP_RETENTION no longer deletes the backups, and the command says so', async () => {
    const count = () =>
      runCli(dir, ['--list-backups'])
        .stdout.split('\n')
        .filter(line => /\.db$/.test(line)).length
    const before = count()
    for (let i = 0; i < 2; i++) {
      const made = runCli(dir, ['--backup-data'], { ATLAS_BACKUP_RETENTION: 'abc' })
      assert.equal(made.status, 0, made.stderr)
      assert.match(made.stdout, /Created backup/)
      assert.match(made.stderr, /ATLAS_BACKUP_RETENTION/, 'the invalid value is reported')
    }
    assert.ok(count() >= before + 2, `${count()} backups remain (had ${before})`)
  })

  test('DATA-04 / REP-01 · no invented effort, and delivery rates stay between 0 and 100 %', async () => {
    const today = (await admin.get('/api/bootstrap')).body.today
    const assigneeId = person('Dev Dana')
    const make = async (extra: Record<string, unknown>) => {
      const res = await manager.api.post('/api/tasks', {
        title: 'T',
        projectId: project.numericId,
        assigneeId,
        ...extra
      })
      assert.equal(res.status, 200, res.text)
      return res.body
    }
    const mover = await make({ title: 'Dragged around' })
    for (const status of ['In progress', 'Review', 'In progress', 'Review', 'In progress', 'Review'])
      assert.equal((await developer.api.patch(`/api/tasks/${mover.numericId}/status`, { status })).status, 200, status)
    await make({ dueDate: today })
    for (let i = 0; i < 5; i++) await make({ dueDate: today, status: 'Done' })
    const activity = (await manager.api.get('/api/reports/activity/weekly?userId=all')).body
    const keys = [...keysOf(activity)]
    assert.deepEqual(
      keys.filter(key => /minute|effort/i.test(key)),
      [],
      'no minutes or effort anywhere in the activity report'
    )
    const report = (await manager.api.get('/api/reports/weekly')).body
    for (const bucket of report.series) {
      if (bucket.rate !== null) assert.ok(bucket.rate >= 0 && bucket.rate <= 100, `${bucket.key}: ${bucket.rate}`)
      assert.ok(bucket.delivered <= bucket.planned, `${bucket.key} delivered ${bucket.delivered} of ${bucket.planned}`)
    }
    assert.ok(report.definitions.deliveryRate, 'the metric is defined where it is shown')
  })

  // ---- build and launch --------------------------------------------------------------------------------------------------------
  test('BUILD-02 · the documented launchers work: `npm start` (scripts/start.mjs) and the operations scripts (scripts/ops.mjs)', async () => {
    const launcherDir = tmp('launcher')
    const launched = await start(launcherDir, { script: path.join(root, 'scripts', 'start.mjs') })
    try {
      assert.match(launched.logs(), /one-time setup token/)
      assert.equal((await fetch(launched.base)).status, 200)
      await setupAdmin(target(launched))
    } finally {
      await launched.stop()
    }
    const ops = spawnSync(process.execPath, [path.join(root, 'scripts', 'ops.mjs'), '--check-data'], {
      env: { ...process.env, NODE_ENV: 'production', ATLAS_DATA_DIR: launcherDir },
      encoding: 'utf8',
      timeout: 60_000,
      killSignal: 'SIGKILL'
    })
    assert.equal(ops.status, 0, ops.stdout + ops.stderr)
    assert.match(ops.stdout, /OK/)
  })
})
