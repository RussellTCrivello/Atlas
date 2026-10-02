// Creating and configuring a database connection: file permissions, pragmas, the schema, and the initial settings row.
import fs from 'node:fs'
import { compactSettingsForStorage, normalizeSettings } from '../../shared/settings'
import { Database } from './driver'
import { migrate } from './migrator'
import { APPLICATION_ID, type Migration } from './migrations'

/**
 * Connection settings, applied every time a database is opened for writing.
 *  - WAL: readers (the command line, backups) never block the writer, and a crash cannot leave a half-written page.
 *  - synchronous=FULL: a committed change has reached the disk when the response is sent (same promise as the old
 *    write-temp-file-then-rename scheme).
 *  - foreign_keys: referential integrity is enforced by the database, not only by the application.
 *  - secure_delete: deleted rows are overwritten, so erased personal data does not linger in free pages.
 */
export function configureConnection(db: Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA secure_delete = ON;
    PRAGMA trusted_schema = OFF;
    PRAGMA temp_store = MEMORY;
    PRAGMA journal_size_limit = 67108864;
  `)
}

function touchPrivate(file: string) {
  fs.closeSync(fs.openSync(file, 'a', 0o600))
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    /* not supported on this platform/filesystem */
  }
}

export function seedSettings(db: Database, config: { defaultTimezone: string }) {
  const document = JSON.stringify(
    compactSettingsForStorage(normalizeSettings({}, { timezone: config.defaultTimezone }))
  )
  db.run('INSERT OR IGNORE INTO settings(id, document, updated_at) VALUES (1, ?, ?)', [
    document,
    new Date().toISOString()
  ])
}

/**
 * Bring the stored settings to the current shape (missing branches, out-of-range values, unknown time zones): cheap,
 * idempotent, and it never invents data. Runs at start-up, so a damaged or older settings document cannot break a request.
 */
export function normalizeStoredSettings(db: Database, config: { defaultTimezone: string }) {
  const row = db.get<{ document: string }>('SELECT document FROM settings WHERE id = 1')
  if (!row) return seedSettings(db, config)
  let stored: unknown
  try {
    stored = JSON.parse(row.document)
  } catch {
    stored = {}
  }
  const next = compactSettingsForStorage(normalizeSettings(stored, { timezone: config.defaultTimezone }))
  if (JSON.stringify(next) !== JSON.stringify(stored))
    db.transaction(() =>
      db.run('UPDATE settings SET document = ?, updated_at = ? WHERE id = 1', [
        JSON.stringify(next),
        new Date().toISOString()
      ])
    )
}

/** Create a brand-new, empty Atlas database at `file` (private to its owner), fully migrated and ready to use. */
export function createDatabaseFile(
  file: string,
  config: { defaultTimezone: string },
  migrations?: readonly Migration[]
): Database {
  touchPrivate(file)
  const db = new Database(file)
  try {
    configureConnection(db)
    db.exec(`PRAGMA application_id = ${APPLICATION_ID}`)
    migrate(db, migrations)
    seedSettings(db, config)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
