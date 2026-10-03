import assert from 'node:assert/strict'
import { openSqliteDatabase } from '../database/connection.js'
import { UserPreferencesRepository } from '../database/user-preferences-repository.js'
import { registerPreferencesRoutes } from './preferences.routes.js'

const db = openSqliteDatabase(':memory:')
db.exec(`INSERT INTO users (
  id, id_type, ordinal, name, email, password_hash, role, person_id, avatar_color, active, created_at,
  sample, attributes_json, present_json, field_states_json, row_hash
) VALUES (
  'user-1', 'string', 0, 'Avery Example', 'avery@example.test', 'hash', 'Developer', NULL, 'purple', 1,
  '2026-10-02T00:00:00.000Z', 0, '{}', '{}', '{}', 'row-hash'
)`)
const repository = new UserPreferencesRepository(db)
const localization = {
  userLanguagePreference: true,
  activeLanguages: ['en', 'ar', 'fa'],
  languagePackages: [
    { code: 'en', enabled: true }, { code: 'ar', enabled: true },
    { code: 'fa', enabled: true }, { code: 'he', enabled: false }
  ]
}
const handlers = {}
const app = {
  get: (path, _auth, handler) => { handlers[`GET ${path}`] = handler },
  put: (path, _auth, handler) => { handlers[`PUT ${path}`] = handler }
}
const sendError = (res, status, message) => res.status(status).json({ error: message })
registerPreferencesRoutes(app, {
  store: { settings: { localization } },
  requireUser: (_req, _res, next) => next(),
  sendError,
  userPreferencesRepository: repository
})

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

let res = response()
handlers['GET /api/preferences']({ user: { id: 'user-1' } }, res)
assert.deepEqual(res.body, { filters: {}, language: '' })

res = response()
handlers['PUT /api/preferences']({ user: { id: 'user-1' }, body: { filters: { tasks: [] }, language: 'ar' } }, res)
assert.equal(res.statusCode, 200)
assert.deepEqual(res.body, { filters: { tasks: [] }, language: 'ar' })
assert.deepEqual(repository.getPreferences('user-1'), res.body)

res = response()
handlers['PUT /api/preferences']({ user: { id: 'user-1' }, body: { language: 'fa' } }, res)
assert.deepEqual(res.body, { filters: { tasks: [] }, language: 'fa' }, 'updating language preserves SQL-saved filters')

res = response()
handlers['PUT /api/preferences']({ user: { id: 'user-1' }, body: { language: 'he' } }, res)
assert.equal(res.statusCode, 400, 'disabled language packages cannot be selected')

res = response()
handlers['PUT /api/preferences']({ user: { id: 'user-1' }, body: { language: 'not-a-locale' } }, res)
assert.equal(res.statusCode, 400)

res = response()
handlers['PUT /api/preferences']({ user: { id: 'user-1' }, body: { filters: { tasks: [{ field: 'status', operator: 'unknown', value: 'Done' }] } } }, res)
assert.equal(res.statusCode, 400)

res = response()
handlers['PUT /api/preferences']({ user: { id: 'user-1' }, body: { role: 'Administrator' } }, res)
assert.equal(res.statusCode, 400, 'user preferences cannot mutate account authorization')

db.close()
console.log('SQL user language preferences, enabled-language validation, and saved-filter compatibility tests passed')
