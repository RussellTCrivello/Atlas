// Backups of the SQLite database: consistent snapshots (VACUUM INTO), verified after writing, private (0600), pruned per
// kind, and restorable while the server is stopped. Backups written by the earlier JSON store (atlas-store-*.json) are
// still listed and can be restored: they are imported into a fresh database first.
import fs from 'node:fs'
import path from 'node:path'
import type { AtlasConfig } from '../config'
import { ensurePrivateDir } from '../fsutil'
import { HttpError } from '../util'
import { Database } from './driver'
import { StoreCorruptError } from './errors'
import { importLegacyFile } from './legacy-import'
import { APPLICATION_ID, SCHEMA_VERSION } from './migrations'
import { acquireLock } from './lock'

export const DB_FILE = 'atlas.db'
export const LEGACY_STORE_FILE = 'atlas-store.json'
export const BACKUP_DIR = 'backups'

export interface BackupInfo {
  file: string
  path: string
  createdAt: string
  reason: string
  size: number
  /** `sqlite` for current backups, `json` for backups written by Atlas before it moved to SQL. */
  format: 'sqlite' | 'json'
}

const BACKUP_NAME = /^atlas-(?:store-)?(\d{8}T\d{9}Z)-([a-z0-9_-]+)\.(db|json)$/i

const stamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace('.', '') // 20261002T081500123Z
function parseStamp(value: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(value)
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z` : ''
}

export function listBackupsIn(dataDir: string): BackupInfo[] {
  const dir = path.join(dataDir, BACKUP_DIR)
  if (!fs.existsSync(dir)) return []
  const rows: BackupInfo[] = []
  for (const file of fs.readdirSync(dir)) {
    const m = BACKUP_NAME.exec(file)
    if (!m) continue
    let size = 0
    try {
      size = fs.statSync(path.join(dir, file)).size
    } catch {
      continue
    }
    rows.push({
      file,
      path: path.join(dir, file),
      createdAt: parseStamp(m[1]),
      // A trailing -N is only the same-millisecond collision counter, not part of the reason.
      reason: m[2].toLowerCase().replace(/-\d+$/, ''),
      size,
      format: m[3].toLowerCase() === 'db' ? 'sqlite' : 'json'
    })
  }
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.file.localeCompare(a.file))
}

/** Per-kind retention: routine write snapshots and everything else are pruned independently, so a burst of routine snapshots can never evict the ones taken before risky operations. */
export function pruneBackups(dataDir: string, retention: number) {
  const all = listBackupsIn(dataDir)
  const groups = [all.filter(b => b.reason === 'write'), all.filter(b => b.reason !== 'write')]
  for (const group of groups)
    group.slice(retention).forEach(backup => {
      try {
        fs.unlinkSync(backup.path)
      } catch {
        /* ignore */
      }
    })
}

export interface Verification {
  ok: boolean
  error?: string
  schemaVersion?: number
  counts?: Record<string, number>
}

const COUNTED_TABLES = ['users', 'people', 'projects', 'tasks'] as const

/** Open a database file read-only and check it is an Atlas database that is intact and not newer than this build. */
export function verifyDatabaseFile(file: string): Verification {
  let db: Database | null = null
  try {
    db = new Database(file, { readOnly: true })
    if (Number(db.pragma('application_id')) !== APPLICATION_ID) return { ok: false, error: 'not an Atlas database' }
    const check = String(db.pragma('quick_check'))
    if (check !== 'ok') return { ok: false, error: `integrity check failed: ${check}` }
    const schemaVersion = Number(db.pragma('user_version'))
    if (schemaVersion > SCHEMA_VERSION)
      return { ok: false, error: `schema ${schemaVersion} is newer than this build (${SCHEMA_VERSION})`, schemaVersion }
    const counts: Record<string, number> = {}
    for (const table of COUNTED_TABLES) counts[table] = Number(db.scalar(`SELECT count(*) FROM ${table}`) ?? 0)
    return { ok: true, schemaVersion, counts }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  } finally {
    db?.close()
  }
}

function safeReason(reason: string): string {
  return (
    String(reason)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .slice(0, 32) || 'snapshot'
  )
}

function nextBackupPath(dataDir: string, reason: string, extension = 'db'): string {
  const dir = path.join(dataDir, BACKUP_DIR)
  ensurePrivateDir(dir)
  const name = (suffix = '') => path.join(dir, `atlas-${stamp()}-${safeReason(reason)}${suffix}.${extension}`)
  let target = name()
  for (let i = 1; fs.existsSync(target); i++) target = name(`-${i}`)
  return target
}

/**
 * Snapshot a database into backups/. `source` is the live connection (server) or a path (command line, which opens its own
 * read-only connection so it is safe while the server runs). Returns the file, or null when there is nothing to back up.
 */
export function createBackup(
  config: Pick<AtlasConfig, 'dataDir' | 'backupRetention'>,
  source: Database | null,
  reason = 'manual',
  { required = true } = {}
): string | null {
  const file = path.join(config.dataDir, DB_FILE)
  if (!source && !fs.existsSync(file)) return null
  let own: Database | null = null
  try {
    const target = nextBackupPath(config.dataDir, reason)
    const db = source ?? (own = new Database(file, { readOnly: true }))
    db.vacuumInto(target)
    try {
      fs.chmodSync(target, 0o600)
    } catch {
      /* best effort */
    }
    const verdict = verifyDatabaseFile(target)
    if (!verdict.ok) {
      fs.rmSync(target, { force: true })
      throw new Error(`backup verification failed (${verdict.error})`)
    }
    pruneBackups(config.dataDir, config.backupRetention)
    return target
  } catch (error) {
    const message = `Backup (${reason}) failed: ${(error as Error).message}`
    if (required) throw new HttpError(503, `${message}. The operation was not performed.`, 'BACKUP_FAILED')
    console.error(message)
    return null
  } finally {
    own?.close()
  }
}

/** Raw copy of a database file that cannot be opened (kept for forensics before a restore replaces it). */
function copyRaw(config: Pick<AtlasConfig, 'dataDir'>, reason: string): string | null {
  const file = path.join(config.dataDir, DB_FILE)
  if (!fs.existsSync(file)) return null
  const target = nextBackupPath(config.dataDir, reason)
  fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL)
  try {
    fs.chmodSync(target, 0o600)
  } catch {
    /* best effort */
  }
  return target
}

export interface RestoreResult {
  restored: string
  preRestore: string | null
  counts: Record<string, number>
}

/** Replace the live database with a backup. The server must not be running (the lock enforces it). */
export function restoreBackup(config: AtlasConfig, which: string): RestoreResult {
  ensurePrivateDir(config.dataDir)
  const release = acquireLock(config.dataDir)
  const live = path.join(config.dataDir, DB_FILE)
  const staging = path.join(config.dataDir, `.restore-${process.pid}-${Date.now().toString(36)}.db`)
  const cleanup = () => {
    for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(staging + suffix, { force: true })
  }
  try {
    const backups = listBackupsIn(config.dataDir)
    const prepare = (candidate: string): Verification => {
      cleanup()
      if (candidate.toLowerCase().endsWith('.json')) importLegacyFile(config, candidate, staging)
      else fs.copyFileSync(candidate, staging)
      return verifyDatabaseFile(staging)
    }
    let chosen: string | undefined
    let verdict: Verification | undefined
    if (which === 'latest') {
      for (const backup of backups) {
        try {
          const result = prepare(backup.path)
          if (result.ok) {
            chosen = backup.path
            verdict = result
            break
          }
        } catch {
          /* a damaged backup is skipped */
        }
      }
      if (!chosen) throw new Error('No valid backup found to restore.')
    } else {
      chosen = backups.find(b => b.file === which)?.path || (fs.existsSync(which) ? path.resolve(which) : undefined)
      if (!chosen) throw new Error(`Backup "${which}" was not found in ${path.join(config.dataDir, BACKUP_DIR)}.`)
      verdict = prepare(chosen)
      if (!verdict.ok) throw new Error(`Backup failed validation: ${verdict.error}`)
    }
    let preRestore: string | null = null
    if (fs.existsSync(live)) {
      try {
        preRestore = createBackup(config, null, 'pre-restore')
      } catch {
        preRestore = copyRaw(config, 'pre-restore') // the live file is unreadable: keep its bytes as they are
      }
    }
    // The old write-ahead log and shared-memory file belong to the old database and must not be paired with the new one.
    for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(live + suffix, { force: true })
    fs.renameSync(staging, live)
    return { restored: chosen, preRestore, counts: verdict!.counts || {} }
  } finally {
    cleanup()
    release()
  }
}

export { StoreCorruptError }
