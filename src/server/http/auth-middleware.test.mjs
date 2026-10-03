import assert from 'node:assert/strict'
import { createAuthMiddleware } from './auth-middleware.js'

const user = { id: 'user-1', role: 'Developer', active: true }
const sessions = new Map([['valid-session', { userId: user.id, expiresAt: Date.now() + 60_000 }], ['expired-session', { userId: user.id, expiresAt: Date.now() - 1 }]])
const errors = []
const middleware = createAuthMiddleware({
  getStore: () => ({ users: [user] }),
  sessions,
  can: () => true,
  invalidateUserSessions: () => {},
  sendError: (res, status, message) => { errors.push({ status, message }); return res.status(status).json({ error: message }) }
})
function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } } }

let continued = false
let res = response()
middleware.requireUser({ cookies: {} }, res, () => { continued = true })
assert.equal(res.statusCode, 401)
assert.equal(res.body.error, 'Sign in to continue')
assert.equal(continued, false, 'the ordinary signed-out probe ends at the login boundary')

res = response()
middleware.requireUser({ cookies: { atlas_sid: 'valid-session' } }, res, () => { continued = true })
assert.equal(res.statusCode, 200)
assert.equal(continued, true)

res = response()
middleware.requireUser({ cookies: { atlas_sid: 'expired-session' } }, res, () => { throw new Error('Expired sessions must not continue') })
assert.equal(res.statusCode, 401)
assert.equal(sessions.has('expired-session'), false)
assert.equal(errors.length, 2)

let optionalContinued = false
let optionalRequest = { cookies: {} }
res = response()
middleware.optionalUser(optionalRequest, res, () => { optionalContinued = true })
assert.equal(res.statusCode, 200)
assert.equal(optionalContinued, true)
assert.equal(optionalRequest.user, null)

optionalRequest = { cookies: { atlas_sid: 'valid-session' } }
res = response()
middleware.optionalUser(optionalRequest, res, () => { optionalContinued = true })
assert.equal(res.statusCode, 200)
assert.equal(optionalRequest.user, user)

optionalRequest = { cookies: { atlas_sid: 'expired-session' } }
res = response()
middleware.optionalUser(optionalRequest, res, () => { optionalContinued = true })
assert.equal(res.statusCode, 200)
assert.equal(optionalRequest.user, null)
assert.equal(sessions.has('expired-session'), false)

console.log('Signed-out status probe returns 200 without changing protected /api/auth/me 401 behavior')
