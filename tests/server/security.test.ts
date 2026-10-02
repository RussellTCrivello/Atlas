import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { auditRows } from '../helpers/db'
import { raw } from '../helpers/raw'
import { Api, PASSWORD, type TestServer, launch, makeUser, setupAdmin, sleep } from '../helpers/server'

describe('HTTP hardening (SEC-10, MIN-02)', () => {
  let server: TestServer
  let admin: Api
  before(async () => {
    server = await launch()
    admin = await setupAdmin(server)
  })
  after(() => server.cleanup())

  test('every response carries the security headers and no X-Powered-By', async () => {
    const res = await new Api(server.url).get('/api/health')
    assert.equal(res.headers.get('x-powered-by'), null)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN')
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin')
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.match(String(res.headers.get('content-security-policy')), /default-src 'self'/)
    assert.match(String(res.headers.get('content-security-policy')), /frame-ancestors 'self'/)
    assert.doesNotMatch(String(res.headers.get('content-security-policy')), /script-src[^;]*unsafe-inline/)
    assert.ok(res.headers.get('x-request-id'))
  })

  test('a foreign Host header is rejected (DNS-rebinding defence); localhost names are accepted', async () => {
    const evil = await raw(`${server.url}/api/health`, { headers: { Host: 'evil.example.com' } })
    assert.equal(evil.status, 403)
    assert.equal(evil.json.code, 'HOST_NOT_ALLOWED')
    const local = await raw(`${server.url}/api/health`, { headers: { Host: `localhost:${server.port}` } })
    assert.equal(local.status, 200)
  })

  test('ATLAS_ALLOWED_HOSTS narrows the allowed names', async () => {
    const narrow = await launch({ env: { ATLAS_ALLOWED_HOSTS: 'atlas.internal' } })
    try {
      assert.equal((await raw(`${narrow.url}/api/health`, { headers: { Host: 'atlas.internal' } })).status, 200)
      assert.equal((await raw(`${narrow.url}/api/health`)).status, 403)
    } finally {
      await narrow.cleanup()
    }
  })

  test('cross-origin writes are blocked; same-origin and header-less clients work', async () => {
    const body = JSON.stringify({ email: 'admin@example.com', password: 'wrong-password' })
    const headers = { 'Content-Type': 'application/json', Host: `127.0.0.1:${server.port}` }
    const cross = await raw(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { ...headers, Origin: 'https://evil.example' },
      body
    })
    assert.equal(cross.status, 403)
    assert.equal(cross.json.code, 'CROSS_ORIGIN')
    const nul = await raw(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { ...headers, Origin: 'null' },
      body
    })
    assert.equal(nul.status, 403)
    const same = await raw(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: { ...headers, Origin: `http://127.0.0.1:${server.port}` },
      body
    })
    assert.equal(same.status, 401) // reached the handler
  })

  test('unknown API routes and malformed bodies get JSON answers, never HTML or a stack trace', async () => {
    const missing = await admin.get('/api/does-not-exist')
    assert.equal(missing.status, 404)
    assert.equal(missing.body.code, 'NOT_FOUND')
    const badJson = await new Api(server.url).request('POST', '/api/auth/login', '{"email": ')
    assert.equal(badJson.status, 400)
    assert.equal(badJson.body.code, 'BAD_JSON')
    const huge = await admin.request('PUT', '/api/settings', JSON.stringify({ pad: 'x'.repeat(2 * 1024 * 1024) }))
    assert.equal(huge.status, 413)
    assert.equal(huge.body.code, 'PAYLOAD_TOO_LARGE')
    assert.doesNotMatch(huge.text, /at .*node_modules/)
  })

  test('responses are compressed', async () => {
    const res = await fetch(`${server.url}/api/bootstrap`, {
      headers: { Cookie: admin.cookie, 'Accept-Encoding': 'gzip' }
    })
    assert.equal(res.headers.get('content-encoding'), 'gzip')
  })

  test('/api/runtime-config discloses storage details to administrators only (MIN-04)', async () => {
    const anon = await new Api(server.url).get('/api/runtime-config')
    assert.equal(anon.body.database, undefined)
    const viewer = await makeUser(server, admin, 'Viewer', 'Rt Viewer')
    assert.equal((await viewer.api.get('/api/runtime-config')).body.database, undefined)
    assert.ok((await admin.get('/api/runtime-config')).body.database.fileName)
  })
})

describe('authorization and data exposure (SEC-07)', () => {
  let server: TestServer
  let admin: Api
  let manager: Awaited<ReturnType<typeof makeUser>>
  let developer: Awaited<ReturnType<typeof makeUser>>
  let viewer: Awaited<ReturnType<typeof makeUser>>
  before(async () => {
    server = await launch()
    admin = await setupAdmin(server)
    manager = await makeUser(server, admin, 'Manager', 'Mia Manager')
    developer = await makeUser(server, admin, 'Developer', 'Dev Dana')
    viewer = await makeUser(server, admin, 'Viewer', 'Vic Viewer')
  })
  after(() => server.cleanup())

  test('the bootstrap payload is scoped by role: no account directory, no security settings for non-admins', async () => {
    const adminBoot = (await admin.get('/api/bootstrap')).body
    assert.ok(adminBoot.users.length >= 4)
    for (const branch of ['security', 'audit', 'permissions', 'integrations', 'storage'])
      assert.ok(adminBoot.settings[branch], `admin sees ${branch}`)
    for (const who of [manager, developer, viewer]) {
      const boot = (await who.api.get('/api/bootstrap')).body
      assert.deepEqual(boot.users, [], 'users list is empty')
      for (const branch of ['security', 'audit', 'permissions', 'integrations', 'storage'])
        assert.equal(boot.settings[branch], undefined, `${branch} hidden`)
      assert.ok(
        boot.settings.workspace && boot.settings.interface && boot.settings.workflows,
        'render-critical settings present'
      )
      assert.equal(boot.settings.workspace.organization, undefined)
      assert.ok(!JSON.stringify(boot).includes('passwordHash'))
    }
    assert.equal((await viewer.api.get('/api/users')).status, 403)
  })

  test('no endpoint ever returns password hashes', async () => {
    for (const route of ['/api/bootstrap', '/api/users', '/api/system', '/api/settings/export', '/api/audit']) {
      const res = await admin.get(route)
      assert.equal(res.status, 200, route)
      assert.doesNotMatch(res.text, /scrypt\$/, route)
    }
  })

  test('runtime missing-translation reports need a session and are never persisted', async () => {
    assert.equal((await new Api(server.url).post('/api/i18n/missing', { key: 'x.y' })).status, 401)
    const before = server.container.ctx.revision
    for (let i = 0; i < 300; i++)
      assert.equal(
        (await viewer.api.post('/api/i18n/missing', { key: `spam.key.${i}`, fallback: 'x'.repeat(250) })).status,
        200
      )
    assert.equal(server.container.ctx.revision, before, 'nothing was written to the database')
    assert.equal(server.db.scalar("SELECT count(*) FROM audit_log WHERE detail LIKE '%spam.key%'"), 0)
    const keys = (await admin.get('/api/i18n/missing')).body.keys
    assert.ok(keys.length <= 200, 'bounded')
    assert.equal((await viewer.api.get('/api/i18n/missing')).status, 403)
    assert.equal(
      (await admin.put('/api/settings', { workspace: { name: 'Still saves' } })).status,
      200,
      'settings can still be saved (no 413)'
    )
  })

  test('activity updates are attributed to the signed-in person; posting for others needs people management', async () => {
    const people = (await admin.get('/api/bootstrap')).body.people
    const manPerson = people.find((p: any) => p.name === 'Mia Manager').id
    const devPerson = people.find((p: any) => p.name === 'Dev Dana').id
    const forged = await developer.api.post('/api/activity', {
      personId: manPerson,
      today: 'I definitely worked a lot'
    })
    assert.equal(forged.status, 403)
    const own = await developer.api.post('/api/activity', { today: 'Wrote tests' })
    assert.equal(own.status, 200)
    assert.equal(own.body.personId, devPerson)
    const onBehalf = await manager.api.post('/api/activity', {
      personId: devPerson,
      today: 'Stand-up notes taken for Dana'
    })
    assert.equal(onBehalf.status, 200)
    assert.equal((await developer.api.post('/api/activity', {})).status, 400, 'an empty update is rejected')
  })

  test('exportData is enforced and audited at the moment of export', async () => {
    const ok = await viewer.api.post('/api/exports/audit', { page: 'tasks', format: 'csv', rows: 12, columns: 4 })
    assert.equal(ok.status, 200)
    const role = await admin.put('/api/settings', {
      permissions: { roles: { Auditor: { permissions: ['viewReports'] } } }
    })
    assert.equal(role.status, 200)
    const auditor = await makeUser(server, admin, 'Auditor', 'Ada Auditor')
    assert.equal(
      (await auditor.api.post('/api/exports/audit', { page: 'tasks', format: 'csv', rows: 1, columns: 1 })).status,
      403
    )
    await sleep(2300)
    assert.ok(auditRows(server, 'data.exported').some(e => e.detail.rows === 12))
    assert.ok(auditRows(server, 'access.denied').length > 0)
  })

  test('per-person activity analytics are limited to managers unless the workspace opts in (GOV-02)', async () => {
    const people = (await admin.get('/api/bootstrap')).body.people
    const manPerson = people.find((p: any) => p.name === 'Mia Manager').id
    const devPerson = people.find((p: any) => p.name === 'Dev Dana').id
    const peek = await developer.api.get(`/api/reports/activity/weekly?userId=${manPerson}`)
    assert.equal(peek.status, 403)
    // VAL-03: an id that does not exist is a 404 for people who may look, and gives restricted callers nothing to probe
    assert.equal((await manager.api.get('/api/reports/activity/weekly?userId=person_nope')).status, 404)
    assert.equal((await developer.api.get('/api/reports/activity/weekly?userId=person_nope')).status, 403)
    assert.equal((await manager.api.get('/api/reports/activity/bogus?userId=all')).status, 400)
    assert.equal((await manager.api.get('/api/reports/bogus')).status, 400)
    const mine = await developer.api.get('/api/reports/activity/weekly?userId=all')
    assert.equal(mine.status, 200)
    assert.equal(mine.body.restricted, true)
    assert.ok(mine.body.rows.every((r: any) => r.personId === devPerson))
    const all = await manager.api.get('/api/reports/activity/weekly?userId=all')
    assert.equal(all.body.restricted, false)
    assert.equal((await admin.put('/api/settings', { reports: { activityVisibility: 'everyone' } })).status, 200)
    assert.equal((await developer.api.get(`/api/reports/activity/weekly?userId=${manPerson}`)).status, 200)
    assert.equal((await admin.put('/api/settings', { reports: { activityVisibility: 'managers' } })).status, 200)
  })
})

describe('user administration guards (SEC-06, VAL-01, MIN-05)', () => {
  let server: TestServer
  let admin: Api
  before(async () => {
    server = await launch()
    admin = await setupAdmin(server)
  })
  after(() => server.cleanup())

  test('the last active administrator cannot be demoted, disabled or deleted', async () => {
    const me = (await admin.get('/api/auth/me')).body.user
    assert.equal((await admin.put(`/api/users/${me.id}`, { role: 'Viewer' })).status, 400)
    assert.equal((await admin.put(`/api/users/${me.id}`, { active: false })).status, 400)
    assert.equal((await admin.delete(`/api/users/${me.id}`)).status, 400)
    const second = await makeUser(server, admin, 'Administrator', 'Second Admin')
    assert.equal(
      (await admin.put(`/api/users/${me.id}`, { role: 'Viewer' })).status,
      200,
      'allowed once another administrator exists'
    )
    // now the second one is the only one
    assert.equal((await second.api.put(`/api/users/${second.user.id}`, { role: 'Viewer' })).status, 400)
    assert.equal((await second.api.put(`/api/users/${me.id}`, { role: 'Administrator' })).status, 200)
  })

  test('duplicate emails are refused on update and on create, case-insensitively (SEC-06)', async () => {
    const a = await makeUser(server, admin, 'Viewer', 'Mail A')
    await makeUser(server, admin, 'Viewer', 'Mail B')
    assert.equal((await admin.put(`/api/users/${a.user.id}`, { email: 'MAIL.B@example.com' })).status, 409)
    assert.equal(
      (
        await admin.post('/api/users', {
          name: 'Dup',
          email: ' Mail.A@Example.com ',
          password: PASSWORD,
          role: 'Viewer'
        })
      ).status,
      409
    )
    assert.equal(
      (await new Api(server.url).post('/api/auth/login', { email: 'MAIL.A@example.com', password: PASSWORD })).status,
      200,
      'login is case-insensitive'
    )
  })

  test('one person profile cannot belong to two accounts', async () => {
    const person = (await admin.post('/api/people', { name: 'Shared Person', email: 'shared@example.com' })).body
    assert.equal(
      (
        await admin.post('/api/users', {
          name: 'First',
          email: 'first@example.com',
          password: PASSWORD,
          role: 'Viewer',
          personId: person.id
        })
      ).status,
      200
    )
    assert.equal(
      (
        await admin.post('/api/users', {
          name: 'Second',
          email: 'second@example.com',
          password: PASSWORD,
          role: 'Viewer',
          personId: person.id
        })
      ).status,
      409
    )
    assert.equal(
      (
        await admin.post('/api/users', {
          name: 'Ghost',
          email: 'ghost@example.com',
          password: PASSWORD,
          role: 'Viewer',
          personId: 'person_missing'
        })
      ).status,
      400
    )
  })

  test('role names that exist on Object.prototype are not roles (VAL-01 / MIN-05)', async () => {
    for (const role of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(
        (await admin.post('/api/users', { name: 'Proto', email: `${role}@example.com`, password: PASSWORD, role }))
          .status,
        400,
        role
      )
    }
    const res = await admin.put('/api/settings', {
      permissions: { roles: { constructor: { permissions: ['viewReports'] } } }
    })
    assert.equal(res.status, 400)
  })

  test('nobody can grant or modify a role that outranks their own', async () => {
    assert.equal(
      (
        await admin.put('/api/settings', {
          permissions: { roles: { Lead: { permissions: ['manageUsers', 'viewReports'] } } }
        })
      ).status,
      200
    )
    const lead = await makeUser(server, admin, 'Lead', 'Lee Lead')
    const grant = await lead.api.post('/api/users', {
      name: 'Sneaky',
      email: 'sneaky@example.com',
      password: PASSWORD,
      role: 'Administrator'
    })
    assert.equal(grant.status, 403)
    const adminUser = (await admin.get('/api/users')).body.find((u: any) => u.role === 'Administrator')
    assert.equal((await lead.api.put(`/api/users/${adminUser.id}`, { password: 'Hijack-Attempt-99' })).status, 403)
    assert.equal((await lead.api.delete(`/api/users/${adminUser.id}`)).status, 403)
    assert.equal(
      (
        await lead.api.post('/api/users', {
          name: 'Okay',
          email: 'okay@example.com',
          password: PASSWORD,
          role: 'Viewer'
        })
      ).status,
      200
    )
  })

  test("an administrator-set password ends the target's sessions", async () => {
    const victim = await makeUser(server, admin, 'Developer', 'Reset Me')
    assert.equal((await victim.api.get('/api/auth/me')).status, 200)
    assert.equal((await admin.put(`/api/users/${victim.user.id}`, { password: 'Brand-New-Passphrase-5' })).status, 200)
    assert.equal((await victim.api.get('/api/auth/me')).status, 401)
  })

  test('the role/permission registry cannot be edited into an admin lock-out', async () => {
    const res = await admin.put('/api/settings', {
      permissions: { roles: { Administrator: { permissions: ['viewReports'] } } }
    })
    assert.equal(res.status, 200)
    const roles = (await admin.get('/api/bootstrap')).body.settings.permissions.roles
    assert.ok(roles.Administrator.permissions.includes('manageSettings'))
    assert.ok(roles.Administrator.permissions.includes('manageUsers'))
    assert.equal(roles.Administrator.rank, 4)
    assert.equal(roles.Viewer.rank, 1)
  })
})
