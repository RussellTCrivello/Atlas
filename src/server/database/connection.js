import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrateDatabase } from './schema.js'

export function ensurePrivateDataDirectory(dataDirectory) {
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dataDirectory, 0o700) } catch {}
  }
}

export function openSqliteDatabase(databasePath, { dataDirectory = path.dirname(databasePath) } = {}) {
  if (databasePath !== ':memory:') {
    ensurePrivateDataDirectory(dataDirectory)
    if (path.resolve(path.dirname(databasePath)) !== path.resolve(dataDirectory)) ensurePrivateDataDirectory(path.dirname(databasePath))
  }
  const existed = databasePath !== ':memory:' && fs.existsSync(databasePath)
  const db = new DatabaseSync(databasePath)
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = FULL')
    db.exec('PRAGMA temp_store = MEMORY')
    db.exec('PRAGMA trusted_schema = OFF')
    migrateDatabase(db)
    if (!existed && process.platform !== 'win32') {
      try { fs.chmodSync(databasePath, 0o600) } catch {}
    }
    return db
  } catch (error) {
    try { db.close() } catch {}
    throw error
  }
}
