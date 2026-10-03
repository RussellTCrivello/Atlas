// Applies schema migrations in order, each in its own transaction, and records them in `schema_migrations`.
// PRAGMA user_version mirrors the newest applied version so `sqlite3 atlas.db "PRAGMA user_version"` answers at a glance.
import { SchemaMismatchError, StoreTooNewError } from './errors'
import type { Database } from './driver'
import { MIGRATIONS, type Migration } from './migrations'
import { sha256 } from '../util'

const checksum = (migration: Migration) => sha256(migration.sql)

export interface MigrationState {
  current: number
  pending: Migration[]
}

function ensureHistoryTable(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT`)
}

/** What has been applied and what is still to do. Throws when the database is newer than this build or has drifted. */
export function inspectMigrations(
  db: Database,
  file = db.file,
  migrations: readonly Migration[] = MIGRATIONS
): MigrationState {
  ensureHistoryTable(db)
  const applied = db.all<{ version: number; name: string; checksum: string }>(
    'SELECT version, name, checksum FROM schema_migrations ORDER BY version'
  )
  const known = new Map(migrations.map(migration => [migration.version, migration]))
  const newest = Math.max(0, ...applied.map(row => row.version))
  const newestKnown = migrations[migrations.length - 1].version
  if (newest > newestKnown)
    throw new StoreTooNewError(
      `${file} uses database schema ${newest}; this build understands up to ${newestKnown}. Upgrade Atlas, or restore an older backup.`
    )
  for (const row of applied) {
    const migration = known.get(row.version)
    if (migration && row.checksum !== checksum(migration))
      throw new SchemaMismatchError(
        `Migration ${row.version} (${row.name}) in ${file} does not match this build of Atlas. The database was created by a modified or different version; restore a backup or reinstall the matching release.`
      )
  }
  const done = new Set(applied.map(row => row.version))
  return { current: newest, pending: migrations.filter(migration => !done.has(migration.version)) }
}

/** Apply every pending migration. Returns the versions applied. */
export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): number[] {
  const { pending } = inspectMigrations(db, db.file, migrations)
  const applied: number[] = []
  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.sql)
      db.run('INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)', [
        migration.version,
        migration.name,
        checksum(migration),
        new Date().toISOString()
      ])
    })
    db.exec(`PRAGMA user_version = ${Number(migration.version)}`)
    applied.push(migration.version)
  }
  return applied
}
