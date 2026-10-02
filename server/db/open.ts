// Opening the database at start-up, with the same promise the JSON store made: fail closed. A database that is
// unreadable, newer than this build, or missing while backups exist stops the server with instructions; it is never
// silently replaced by an empty workspace (which would reopen first-run setup to anyone who can reach the port).
import fs from 'node:fs'
import path from 'node:path'
import type { AtlasConfig } from '../config'
import type { Snapshot } from '../domain/types'
import { ensurePrivateDir } from '../fsutil'
import { BACKUP_DIR, DB_FILE, LEGACY_STORE_FILE, createBackup, listBackupsIn } from './backup'
import { configureConnection, createDatabaseFile, normalizeStoredSettings } from './create'
import { Database, classifySqlError } from './driver'
import { StoreCorruptError, StoreMissingError } from './errors'
import { migrateLegacyStore, type LegacyMigration } from './legacy-import'
import { acquireLock } from './lock'
import { inspectMigrations, migrate } from './migrator'
import { APPLICATION_ID, type Migration } from './migrations'
import { writeSnapshot } from './snapshot'

export interface OpenDatabaseOptions {
  /** Take the exclusive data-directory lock (the server and every command that writes). Default true. */
  lock?: boolean
  /** Create a fresh database even though backups exist (explicit re-initialisation). */
  allowFresh?: boolean
  /** Contents to create a new database with (defaults to an empty, unconfigured workspace). */
  initial?: () => Snapshot
  /** The schema history to apply (tests inject a longer one to exercise upgrades). */
  migrations?: readonly Migration[]
}

export interface OpenedDatabase {
  db: Database
  file: string
  release: (() => void) | null
  created: boolean
  migrated: number[]
  legacy: LegacyMigration | null
}

export function databasePath(config: Pick<AtlasConfig, 'dataDir'>): string {
  return path.join(config.dataDir, DB_FILE)
}

const looksCorrupt = (error: unknown) =>
  classifySqlError(error) === 'corrupt' ||
  /not a database|malformed|disk image/i.test(String((error as Error)?.message))

export function openDatabase(config: AtlasConfig, options: OpenDatabaseOptions = {}): OpenedDatabase {
  ensurePrivateDir(config.dataDir)
  ensurePrivateDir(path.join(config.dataDir, BACKUP_DIR))
  const release = options.lock === false ? null : acquireLock(config.dataDir)
  try {
    return open(config, options, release)
  } catch (error) {
    release?.()
    throw error
  }
}

function open(config: AtlasConfig, options: OpenDatabaseOptions, release: (() => void) | null): OpenedDatabase {
  const file = databasePath(config)
  const legacyFile = path.join(config.dataDir, LEGACY_STORE_FILE)
  let created = false
  let legacy: LegacyMigration | null = null
  // A zero-byte file is what an interrupted first start leaves behind; it holds nothing worth protecting.
  if (fs.existsSync(file) && fs.statSync(file).size === 0) fs.rmSync(file, { force: true })

  if (!fs.existsSync(file)) {
    const backups = listBackupsIn(config.dataDir)
    if (fs.existsSync(legacyFile)) {
      legacy = migrateLegacyStore(config)
    } else {
      if (backups.length && !options.allowFresh)
        throw new StoreMissingError(
          `No database at ${file}, but ${backups.length} backup(s) exist in ${path.join(config.dataDir, BACKUP_DIR)}. ` +
            'Starting empty would reopen first-run setup. Restore the newest backup (npm run restore:data -- latest) ' +
            'or, if you really want an empty workspace, run npm run init:production.',
          backups
        )
      const fresh = createDatabaseFile(file, config, options.migrations)
      try {
        if (options.initial) writeSnapshot(fresh, options.initial(), config)
      } catch (error) {
        fresh.close()
        for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true })
        throw error
      }
      created = true
      return { db: fresh, file, release, created, migrated: [], legacy }
    }
  }

  let db: Database | null = null
  try {
    try {
      db = new Database(file)
      configureConnection(db)
      if (Number(db.pragma('application_id')) !== APPLICATION_ID)
        throw new StoreCorruptError(`${file} is not an Atlas database`, file, listBackupsIn(config.dataDir))
      const check = String(db.pragma('quick_check'))
      if (check !== 'ok')
        throw new StoreCorruptError(
          `${file} failed its integrity check (${check})`,
          file,
          listBackupsIn(config.dataDir)
        )
    } catch (error) {
      if (error instanceof StoreCorruptError) throw error
      if (looksCorrupt(error))
        throw new StoreCorruptError(
          `${file} cannot be read as a database (${(error as Error).message})`,
          file,
          listBackupsIn(config.dataDir)
        )
      throw error
    }
    const state = inspectMigrations(db, file, options.migrations)
    let migrated: number[] = []
    if (state.pending.length) {
      // Keep an untouched snapshot from before the schema changes; the migration is refused if it cannot be made.
      createBackup(config, db, 'pre-migration', { required: true })
      migrated = migrate(db, options.migrations)
    }
    normalizeStoredSettings(db, config)
    return { db, file, release, created, migrated, legacy }
  } catch (error) {
    db?.close()
    throw error
  }
}

/** A read-only connection for commands that must work while the server runs (check, list, backup) or on a damaged store. */
export function openReadOnly(config: Pick<AtlasConfig, 'dataDir'>): Database | null {
  const file = databasePath(config)
  if (!fs.existsSync(file)) return null
  return new Database(file, { readOnly: true })
}
