import assert from 'node:assert/strict'
import { registerProfileRoutes } from './profile.routes.js'

const store = {
  users: [{ id: 'user-1', name: 'Avery Example', email: 'avery@example.test', role: 'Developer', personId: 'person-1', avatarColor: 'purple', active: true }],
  people: [{ id: 'person-1', name: 'Avery Example', email: 'avery@example.test', color: 'purple', teamId: 'team-1' }]
}
const auditRows = []
const persistenceReasons = []
const handlers = {}
const app = {
  get: (path, _auth, handler) => { handlers[`GET ${path}`] = handler },
  put: (path, _auth, handler) => { handlers[`PUT ${path}`] = handler }
}
const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this },
  json(body) { this.body = body; return this }
})
const sendError = (res, status, message) => res.status(status).json({ error: message })
registerProfileRoutes(app, {
  store,
  requireUser: (_req, _res, next) => next(),
  sendError,
  publicAccessUser: user => ({ id: user.id, name: user.name, email: user.email, role: user.role, personId: user.personId, avatarColor: user.avatarColor }),
  validText: (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max,
  personById: id => store.people.find(person => String(person.id) === String(id)),
  auditLog: (...args) => auditRows.push(args),
  persist: ({ reason }) => persistenceReasons.push(reason)
})

let res = response()
handlers['GET /api/profile']({ user: store.users[0] }, res)
assert.equal(res.body.user.email, 'avery@example.test')
assert.equal(Object.hasOwn(res.body.user, 'passwordHash'), false)

res = response()
handlers['PUT /api/profile']({ user: store.users[0], body: { name: 'Avery Chen', avatarColor: 'teal' } }, res)
assert.equal(res.statusCode, 200)
assert.equal(res.body.user.name, 'Avery Chen')
assert.equal(store.people[0].name, 'Avery Chen', 'profile names stay aligned with the linked workspace person')
assert.equal(store.people[0].color, 'teal')
assert.deepEqual(persistenceReasons, ['user-profile'])
assert.equal(auditRows[0][0], 'user.profile.updated')

res = response()
handlers['PUT /api/profile']({ user: store.users[0], body: { role: 'Administrator' } }, res)
assert.equal(res.statusCode, 400, 'self-service profile updates cannot change authorization fields')
assert.equal(store.users[0].role, 'Developer')

res = response()
handlers['PUT /api/profile']({ user: store.users[0], body: { avatarColor: 'injected-class' } }, res)
assert.equal(res.statusCode, 400, 'avatar classes are constrained to the built-in palette')

console.log('Self-service profile API, linked-person consistency, and field authorization tests passed')
