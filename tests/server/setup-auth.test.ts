import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { Api, PASSWORD, SETUP_TOKEN, type TestServer, launch, makeUser, setupAdmin, sleep } from '../helpers/server'
import { LoginThrottle, SessionManager, validatePassword, hashPassword, verifyPassword } from '../../server/auth'

describe('first-run setup (SEC-01)', () => {
  let server: TestServer
  before(async () => {
    server = await launch()
  })
  after(() => server.cleanup())

  test('setup status advertises a token and no demo credentials in production', async () => {
    const res = await new Api(server.url).get('/api/setup/status')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { configured: false, tokenRequired: true, demoAllowed: false, demo: null })
  })

  test('setup is refused without the one-time token, or with a wrong one', async () => {
    const api = new Api(server.url)
    const body = { name: 'Eve', email: 'eve@example.com', password: PASSWORD }
    assert.equal((await api.post('/api/setup', body)).status, 403)
    const wrong = await api.post('/api/setup', { ...body, token: 'not-the-token' })
    assert.equal(wrong.status, 403)
    assert.equal(wrong.body.code, 'SETUP_TOKEN_REQUIRED')
    assert.equal((await api.get('/api/setup/status')).body.configured, false)
  })

  test('a weak or common password is rejected', async () => {
    const api = new Api(server.url)
    for (const password of ['short', 'password123', '12345678', 'aaaaaaaaaa']) {
      const res = await api.post('/api/setup', { name: 'Ann', email: 'ann@example.com', password, token: SETUP_TOKEN })
      assert.equal(res.status, 400, `password ${password}`)
    }
  })

  test('an invalid timezone or malformed email is a 400, not a stored time bomb', async () => {
    const api = new Api(server.url)
    const badTz = await api.post('/api/setup', {
      name: 'Ann',
      email: 'ann@example.com',
      password: PASSWORD,
      token: SETUP_TOKEN,
      settings: { workspace: { defaultTimezone: 'Mars/Olympus' } }
    })
    assert.equal(badTz.status, 400)
    const badMail = await api.post('/api/setup', {
      name: 'Ann',
      email: 'not-an-email',
      password: PASSWORD,
      token: SETUP_TOKEN
    })
    assert.equal(badMail.status, 400)
  })

  test('with the token, setup completes and signs the administrator in', async () => {
    const admin = await setupAdmin(server)
    const me = await admin.get('/api/auth/me')
    assert.equal(me.status, 200)
    assert.equal(me.body.user.role, 'Administrator')
    assert.ok(me.body.user.permissions.includes('manageSettings'))
    assert.equal((await new Api(server.url).get('/api/setup/status')).body.configured, true)
  })

  test('a configured workspace can never be taken over or wiped through /api/setup', async () => {
    const admin = new Api(server.url)
    assert.equal((await admin.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })).status, 200)
    const project = await admin.post('/api/projects', { name: 'Keep me', code: 'KEEP' })
    assert.equal(project.status, 200)
    const attacker = new Api(server.url)
    const res = await attacker.post('/api/setup', {
      name: 'Mallory',
      email: 'mallory@example.com',
      password: PASSWORD,
      token: SETUP_TOKEN
    })
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'ALREADY_CONFIGURED')
    // original administrator and data are intact
    assert.equal(
      (await new Api(server.url).post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })).status,
      200
    )
    assert.equal(
      (await new Api(server.url).post('/api/auth/login', { email: 'mallory@example.com', password: PASSWORD })).status,
      401
    )
    const boot = await admin.get('/api/bootstrap')
    assert.ok(boot.body.projects.some((p: any) => p.code === 'KEEP'))
  })
})

describe('sessions (SEC-05)', () => {
  let server: TestServer
  let admin: Api
  before(async () => {
    server = await launch()
    admin = await setupAdmin(server)
  })
  after(() => server.cleanup())

  test('the cookie is HttpOnly, SameSite=Lax, scoped to /, lasts sessionDays and carries a 256-bit token', async () => {
    const api = new Api(server.url)
    const res = await api.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
    const cookie = res.headers.getSetCookie()[0]
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Lax/i)
    assert.match(cookie, /Path=\//)
    assert.match(cookie, new RegExp(`Max-Age=${14 * 86400}`))
    assert.ok(api.cookie.split('=')[1].length >= 43)
    assert.doesNotMatch(cookie, /Secure/i)
  })

  test('a logged-out cookie is rejected by the server, not just cleared in the browser', async () => {
    const api = new Api(server.url)
    await api.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
    const stolen = api.cookie
    assert.equal((await api.get('/api/auth/me')).status, 200)
    await api.post('/api/auth/logout')
    const replay = new Api(server.url)
    replay.cookie = stolen
    assert.equal((await replay.get('/api/auth/me')).status, 401)
  })

  test('each sign-in gets a fresh token (no session fixation)', async () => {
    const api = new Api(server.url)
    await api.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
    const first = api.cookie
    await api.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
    assert.notEqual(api.cookie, first)
    const old = new Api(server.url)
    old.cookie = first
    assert.equal((await old.get('/api/auth/me')).status, 401)
  })

  test('sessions survive a server restart', async () => {
    const api = new Api(server.url)
    await api.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
    const cookie = api.cookie
    await sleep(450) // let the debounced session file write happen
    server = await server.restart()
    admin.base = server.url // same persisted session, new port
    const again = new Api(server.url)
    again.cookie = cookie
    assert.equal((await again.get('/api/auth/me')).status, 200)
  })

  test('Secure is set when configured', async () => {
    const secure = await launch({ env: { ATLAS_COOKIE_SECURE: 'true' } })
    try {
      const api = await setupAdmin(secure)
      const res = await new Api(secure.url).post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
      assert.match(res.headers.getSetCookie()[0], /Secure/i)
      assert.ok(api)
    } finally {
      await secure.cleanup()
    }
  })

  test('sessions expire after sessionDays (SessionManager)', async () => {
    const manager = new SessionManager(null)
    const token = manager.create('u1')
    assert.ok(manager.resolve(token, 60_000))
    await sleep(15)
    assert.equal(manager.resolve(token, 5), null)
    assert.equal(manager.resolve(token, 60_000), null, 'an expired session is deleted, not merely ignored')
  })

  test('only the SHA-256 of a token is persisted', async () => {
    const dir = fs.mkdtempSync(path.join(server.dataDir, 'sess-'))
    const file = path.join(dir, 'sessions.json')
    const manager = new SessionManager(file)
    const token = manager.create('u1')
    manager.flush()
    const text = fs.readFileSync(file, 'utf8')
    assert.ok(!text.includes(token))
    assert.ok(text.includes('"userId":"u1"'))
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600')
  })

  test('changing the password signs out other sessions but not this one, and the old password stops working', async () => {
    const user = await makeUser(server, admin, 'Manager', 'Pw Changer')
    const second = new Api(server.url)
    await second.post('/api/auth/login', { email: user.email, password: PASSWORD })
    const res = await user.api.post('/api/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'Another-Passphrase-77'
    })
    assert.equal(res.status, 200)
    assert.equal(res.body.signedOutElsewhere, 1)
    assert.equal((await user.api.get('/api/auth/me')).status, 200)
    assert.equal((await second.get('/api/auth/me')).status, 401)
    assert.equal(
      (await new Api(server.url).post('/api/auth/login', { email: user.email, password: PASSWORD })).status,
      401
    )
    assert.equal(
      (await new Api(server.url).post('/api/auth/login', { email: user.email, password: 'Another-Passphrase-77' }))
        .status,
      200
    )
  })

  test('a wrong current password is refused', async () => {
    const user = await makeUser(server, admin, 'Viewer', 'Pw Wrong')
    const res = await user.api.post('/api/auth/password', {
      currentPassword: 'nope-nope-nope',
      newPassword: 'Brand-New-Secret-12'
    })
    assert.equal(res.status, 400)
  })

  test('accounts created with an administrator-chosen password must change it before doing anything else (SEC-06)', async () => {
    const created = await admin.post('/api/users', {
      name: 'Fresh Hire',
      email: 'fresh@example.com',
      password: PASSWORD,
      role: 'Viewer'
    })
    assert.equal(created.status, 200)
    const hire = new Api(server.url)
    assert.equal((await hire.post('/api/auth/login', { email: 'fresh@example.com', password: PASSWORD })).status, 200)
    const blocked = await hire.get('/api/bootstrap')
    assert.equal(blocked.status, 403)
    assert.equal(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED')
    assert.equal((await hire.get('/api/auth/me')).body.user.mustChangePassword, true)
    assert.equal(
      (await hire.post('/api/auth/password', { currentPassword: PASSWORD, newPassword: 'My-Own-Passphrase-31' }))
        .status,
      200
    )
    assert.equal((await hire.get('/api/bootstrap')).status, 200)
  })

  test('disabling an account ends its sessions immediately', async () => {
    const user = await makeUser(server, admin, 'Developer', 'To Disable')
    assert.equal((await user.api.get('/api/auth/me')).status, 200)
    const off = await admin.put(`/api/users/${user.user.id}`, { active: false })
    assert.equal(off.status, 200)
    assert.equal((await user.api.get('/api/auth/me')).status, 401)
  })
})

describe('login throttling (SEC-04)', () => {
  let server: TestServer
  before(async () => {
    server = await launch()
    await setupAdmin(server)
  })
  after(() => server.cleanup())

  test('five bad passwords lock the account for a while, even against the right password', async () => {
    const api = new Api(server.url)
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await api.post('/api/auth/login', { email: 'admin@example.com', password: `wrong-${i}-wrong` })).status,
        401
      )
    const locked = await api.post('/api/auth/login', { email: 'admin@example.com', password: PASSWORD })
    assert.equal(locked.status, 429)
    assert.ok(Number(locked.headers.get('retry-after')) > 0)
    assert.equal(locked.body.code, 'RATE_LIMITED')
  })

  test('failed sign-ins are recorded in the audit trail (SEC-13)', async () => {
    await sleep(2300) // audit events for failures are batched
    const admin = new Api(server.url)
    // the account is locked, so use a fresh server session created through another path
    const audit = server.db.state.auditLogs.filter(entry => entry.action === 'auth.login.failed')
    assert.ok(audit.length >= 5)
    assert.ok(audit[0].ip)
    assert.ok(admin)
  })

  test('hashing is off the event loop: the server stays responsive while logins are being verified', async () => {
    const api = new Api(server.url)
    const flood = Array.from({ length: 6 }, (_, i) =>
      api.post('/api/auth/login', { email: `nobody${i}@example.com`, password: 'x'.repeat(12) })
    )
    await sleep(30)
    const t0 = performance.now()
    const health = await new Api(server.url).get('/api/health')
    const elapsed = performance.now() - t0
    assert.equal(health.status, 200)
    assert.ok(elapsed < 400, `health took ${elapsed.toFixed(0)}ms while hashing`)
    const results = await Promise.all(flood)
    assert.ok(results.every(r => r.status === 401))
  })

  test('LoginThrottle: per-address limit and exponential account lock', () => {
    const throttle = new LoginThrottle({
      ipLimit: 3,
      ipWindowMs: 1000,
      freeAttempts: 2,
      maxLockMs: 60_000,
      maxEntries: 5
    })
    const now = 1_000_000
    for (let i = 0; i < 3; i++) {
      assert.equal(throttle.check('1.1.1.1', 'a', now).allowed, true)
      throttle.attempt('1.1.1.1', now)
    }
    assert.equal(throttle.check('1.1.1.1', 'b', now).allowed, false)
    assert.equal(throttle.check('2.2.2.2', 'b', now).allowed, true)
    assert.equal(throttle.check('1.1.1.1', 'b', now + 1500).allowed, true, 'window resets')
    throttle.failure('acct', now)
    assert.equal(throttle.check('x', 'acct', now).allowed, true)
    throttle.failure('acct', now)
    assert.equal(throttle.check('x', 'acct', now).retryAfterSeconds, 15)
    throttle.failure('acct', now + 16_000)
    assert.equal(throttle.check('x', 'acct', now + 16_000).retryAfterSeconds, 30)
    throttle.success('acct')
    assert.equal(throttle.check('x', 'acct', now + 16_000).allowed, true)
  })
})

describe('password hashing and policy', () => {
  test('hashes carry their parameters, verify, and legacy hashes upgrade', async () => {
    const hash = await hashPassword('Some-Long-Passphrase-1')
    assert.match(hash, /^scrypt\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$/)
    assert.deepEqual(await verifyPassword('Some-Long-Passphrase-1', hash), { ok: true, needsRehash: false })
    assert.equal((await verifyPassword('wrong', hash)).ok, false)
    // legacy format written by v1.0: scrypt$<salt>$<key> with node's default cost
    const { scryptSync } = await import('node:crypto')
    const salt = 'abcdef0123456789abcdef0123456789'
    const legacy = `scrypt$${salt}$${scryptSync('legacy-pass-123', salt, 64).toString('hex')}`
    assert.deepEqual(await verifyPassword('legacy-pass-123', legacy), { ok: true, needsRehash: true })
    assert.equal((await verifyPassword('legacy-pass-124', legacy)).ok, false)
  })

  test('policy: length, maximum, common passwords, own email', () => {
    assert.match(String(validatePassword('short')), /at least 8/)
    assert.match(String(validatePassword('x'.repeat(200))), /at most 128/)
    assert.match(String(validatePassword('password123')), /too common/)
    assert.match(String(validatePassword('jane.doe-2026!x', { email: 'jane.doe@example.com' })), /email/)
    assert.equal(validatePassword('correct horse battery'), null)
    assert.match(String(validatePassword('abcdefgh', { minLength: 12 })), /at least 12/)
  })
})
