import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { openSqliteDatabase } from './connection.js'
import { migrateDatabase } from './schema.js'
import { UserPreferencesRepository } from './user-preferences-repository.js'

const db = openSqliteDatabase(':memory:')
const schemaVersion = Number(db.prepare('PRAGMA user_version').get().user_version)
assert.equal(schemaVersion, 5, 'fresh databases include the per-user language preference migration')
assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('user_preferences') WHERE name = 'language_code'").get())

db.exec(`INSERT INTO users (
  id, id_type, ordinal, name, email, password_hash, role, person_id, avatar_color, active, created_at,
  sample, attributes_json, present_json, field_states_json, row_hash
) VALUES (
  'user-1', 'string', 0, 'Avery Example', 'avery@example.test', 'hash', 'Developer', NULL, 'purple', 1,
  '2026-10-02T00:00:00.000Z', 0, '{}', '{}', '{}', 'row-hash'
)`)

const repository = new UserPreferencesRepository(db)
assert.deepEqual(repository.getPreferences('user-1'), { filters: {}, language: '' })
assert.deepEqual(repository.savePreferences('user-1', { filters: { tasks: [] }, language: 'ar' }), { filters: { tasks: [] }, language: 'ar' })
assert.deepEqual(repository.savePreferences('user-1', { language: 'fa' }), { filters: { tasks: [] }, language: 'fa' }, 'partial preference writes preserve the other SQL field')
assert.deepEqual(repository.savePreferences('user-1', { filters: {} }), { filters: {}, language: 'fa' }, 'saved-filter writes preserve the language')

db.close()

const legacyDb = new DatabaseSync(':memory:')
legacyDb.exec(`
  CREATE TABLE schema_migrations(version INTEGER NOT NULL PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
  CREATE TABLE users(id TEXT NOT NULL PRIMARY KEY) STRICT;
  CREATE TABLE user_preferences (
    user_id TEXT NOT NULL PRIMARY KEY,
    filters_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(filters_json)),
    updated_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
  ) STRICT;
  INSERT INTO users(id) VALUES('legacy-user');
  INSERT INTO user_preferences(user_id, filters_json, updated_at) VALUES('legacy-user', '{"projects":[]}', '2026-09-01T00:00:00.000Z');
  PRAGMA user_version = 4;
`)
migrateDatabase(legacyDb)
assert.equal(Number(legacyDb.prepare('PRAGMA user_version').get().user_version), 5)
const migratedRow = legacyDb.prepare('SELECT filters_json, language_code FROM user_preferences WHERE user_id = ?').get('legacy-user')
assert.equal(migratedRow.filters_json, '{"projects":[]}')
assert.equal(migratedRow.language_code, '', 'schema upgrade preserves old filters and uses the workspace default for existing accounts')
legacyDb.close()
console.log('SQL user-preferences schema migration and round-trip checks passed')
