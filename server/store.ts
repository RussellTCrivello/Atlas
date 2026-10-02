// The embedded JSON document store: single-writer, crash-safe, and fail-closed.
//
// Guarantees:
//  - Exclusive ownership: a lock file prevents two server processes from writing the same data directory.
//  - Atomic, durable writes: temp file + fsync + rename + directory fsync (see fsutil.ts).
//  - All-or-nothing commits: a mutation that throws, or whose write fails, is rolled back in memory; the client is told.
//  - Fail closed: an unreadable or newer-than-supported store stops the server with recovery instructions; it is never
//    silently replaced by an empty workspace (which would reopen first-run setup to anyone who can reach the port).
//  - Backups: daily, before migrations/restores/destructive operations, and on demand, pruned per kind.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { STORE_SCHEMA_VERSION } from '../shared/settings'
import type { AtlasConfig } from './config'
import { atomicWriteFileSync, ensurePrivateDir } from './fsutil'
import {
  backfillLedger,
  compareVersions,
  emptyState,
  normalizeState,
  pendingMigrations,
  validateStoreState
} from './migrations'
import { pruneAudit } from './audit'
import type { StoreState } from './types'
import { HttpError, sha256 } from './util'

export class StoreLockedError extends Error {
  constructor(
    message: string,
    public info?: LockInfo
  ) {
    super(message)
    this.name = 'StoreLockedError'
  }
}
export class StoreCorruptError extends Error {
  constructor(
    message: string,
    public file: string,
    public backups: BackupInfo[] = []
  ) {
    super(message)
    this.name = 'StoreCorruptError'
  }
}
export class StoreTooNewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StoreTooNewError'
  }
}
export class StoreMissingError extends Error {
  constructor(
    message: string,
    public backups: BackupInfo[]
  ) {
    super(message)
    this.name = 'StoreMissingError'
  }
}

export const STORE_FILE = 'atlas-store.json'
const LOCK_FILE = 'atlas.lock'
const BACKUP_DIR = 'backups'

// ---- locking -------------------------------------------------------------------------------------------------------
export interface LockInfo {
  pid: number
  hostname: string
  startedAt: string
  token: string
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function acquireLock(dataDir: string): () => void {
  const file = path.join(dataDir, LOCK_FILE)
  const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const info: LockInfo = { pid: process.pid, hostname: os.hostname(), startedAt: new Date().toISOString(), token }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600)
      fs.writeFileSync(fd, JSON.stringify(info))
      fs.closeSync(fd)
      let released = false
      const release = () => {
        if (released) return
        released = true
        process.removeListener('exit', release)
        try {
          const current = JSON.parse(fs.readFileSync(file, 'utf8')) as LockInfo
          if (current.token === token) fs.unlinkSync(file)
        } catch {
          /* already gone */
        }
      }
      process.once('exit', release)
      return release
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      let existing: LockInfo | null = null
      try {
        existing = JSON.parse(fs.readFileSync(file, 'utf8'))
      } catch {
        /* unreadable lock: treat as stale */
      }
      const bootTime = Date.now() - os.uptime() * 1000
      const sameHost = !existing || existing.hostname === os.hostname()
      const stale =
        !existing ||
        !Number.isInteger(existing.pid) ||
        (sameHost && (existing.pid !== process.pid ? !processAlive(existing.pid) : false)) ||
        // The machine rebooted after the lock was written: whoever held it is gone (PIDs get reused).
        (sameHost && Date.parse(existing.startedAt) < bootTime - 120_000)
      if (!stale) {
        throw new StoreLockedError(
          `Another Atlas process (pid ${existing!.pid} on ${existing!.hostname}, started ${existing!.startedAt}) is already using ${dataDir}. ` +
            `Stop it first. If you are certain no Atlas process is running, delete ${file}.`,
          existing!
        )
      }
      try {
        fs.unlinkSync(file)
      } catch {
        /* lost a race; retry */
      }
    }
  }
  throw new StoreLockedError(`Could not acquire the lock file ${file}.`)
}

// ---- backups -------------------------------------------------------------------------------------------------------
export interface BackupInfo {
  file: string
  path: string
  createdAt: string
  reason: string
  size: number
}
const BACKUP_NAME = /^atlas-store-(\d{8}T\d{9}Z)-([a-z0-9_-]+)\.json$/i

function backupTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, '').replace('.', '') // 20261002T081500123Z
}
function parseBackupTimestamp(stamp: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/.exec(stamp)
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
    // A trailing -N is only the same-millisecond collision counter, not part of the reason.
    rows.push({
      file,
      path: path.join(dir, file),
      createdAt: parseBackupTimestamp(m[1]),
      reason: m[2].toLowerCase().replace(/-\d+$/, ''),
      size
    })
  }
  return rows.sort((a, b) => b.file.localeCompare(a.file))
}

/** Parse + schema-check a candidate store file. Returns the normalised state or throws with a reason. */
export function readStoreFile(
  file: string,
  config: Pick<AtlasConfig, 'defaultTimezone'>
): { state: StoreState; migrated: boolean; raw: any } {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new StoreCorruptError(`Cannot read ${file}: ${(error as Error).message}`, file)
  }
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new StoreCorruptError(`${file} is not valid JSON (${(error as Error).message})`, file)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new StoreCorruptError(`${file} does not contain a store object`, file)
  const version = String(raw.meta?.schemaVersion || '0.0.0')
  if (compareVersions(version, STORE_SCHEMA_VERSION) > 0)
    throw new StoreTooNewError(
      `${file} was written by a newer Atlas (schema ${version}; this build understands up to ${STORE_SCHEMA_VERSION}). Upgrade Atlas, or restore an older backup.`
    )
  const migrations = pendingMigrations(version)
  migrations.forEach(migration => migration.up(raw, config))
  const state = normalizeState(raw, config)
  if (migrations.length) backfillLedger(state)
  return { state, migrated: migrations.length > 0, raw }
}

// ---- the store -----------------------------------------------------------------------------------------------------
export interface CommitOptions {
  reason?: string
  /** Take a snapshot of the current file first and fail the commit if that snapshot cannot be made. */
  backupFirst?: string
}

export interface OpenOptions {
  lock?: boolean
  /** State to create when no store file exists (defaults to an empty, unconfigured workspace). */
  initial?: () => StoreState
  /** Allow creating a fresh store even though backups exist (explicit re-initialisation). */
  allowFresh?: boolean
}

export class DocumentStore {
  state!: StoreState
  readonly file: string
  readonly backupDir: string
  lastPersistedAt: string | null = null
  lastPersistError: string | null = null
  startedAt = new Date().toISOString()
  private lastJson = ''
  private closed = false
  private lastDailyBackup = 0
  private maintenanceTimer: NodeJS.Timeout | null = null
  private cache = new Map<string, { writeCount: number; value: unknown }>()

  private constructor(
    readonly config: AtlasConfig,
    private release: (() => void) | null
  ) {
    this.file = path.join(config.dataDir, STORE_FILE)
    this.backupDir = path.join(config.dataDir, BACKUP_DIR)
  }

  static open(config: AtlasConfig, options: OpenOptions = {}): DocumentStore {
    ensurePrivateDir(config.dataDir)
    ensurePrivateDir(path.join(config.dataDir, BACKUP_DIR))
    const release = options.lock === false ? null : acquireLock(config.dataDir)
    const store = new DocumentStore(config, release)
    try {
      store.load(options)
    } catch (error) {
      release?.()
      throw error
    }
    return store
  }

  private load(options: OpenOptions) {
    const backups = this.listBackups()
    this.lastDailyBackup = Math.max(
      0,
      ...backups.filter(b => b.reason === 'daily').map(b => Date.parse(b.createdAt) || 0)
    )
    if (!fs.existsSync(this.file)) {
      if (backups.length && !options.allowFresh)
        throw new StoreMissingError(
          `No store file at ${this.file}, but ${backups.length} backup(s) exist in ${this.backupDir}. ` +
            'Starting empty would reopen first-run setup. Restore the newest backup (npm run restore:data -- --latest) ' +
            'or, if you really want an empty workspace, run npm run init:production.',
          backups
        )
      this.state = options.initial ? options.initial() : emptyState(this.config)
      this.lastJson = ''
      this.persist({ reason: 'init' })
      return
    }
    let loaded
    try {
      loaded = readStoreFile(this.file, this.config)
    } catch (error) {
      if (error instanceof StoreCorruptError) throw new StoreCorruptError(error.message, this.file, backups)
      throw error
    }
    if (loaded.migrated) {
      // Keep an untouched copy of the pre-migration file before rewriting it in the new shape.
      this.createBackup('pre-migration', { required: true })
    }
    const before = JSON.stringify(loaded.raw)
    this.state = loaded.state
    const after = JSON.stringify(this.state)
    this.lastJson = ''
    if (loaded.migrated || before !== after) this.persist({ reason: loaded.migrated ? 'migration' : 'normalize' })
    else this.lastJson = JSON.stringify(this.state, null, 2)
    pruneAudit(this.state)
  }

  /** Start periodic housekeeping (audit/work-log retention, daily backup). Call once from the server entry point. */
  startMaintenance() {
    if (this.maintenanceTimer) return
    const tick = () => {
      try {
        this.maintain()
      } catch (error) {
        console.error('Store maintenance failed:', (error as Error).message)
      }
    }
    this.maintenanceTimer = setInterval(tick, 6 * 60 * 60 * 1000)
    this.maintenanceTimer.unref?.()
    tick()
  }

  maintain() {
    this.maybeDailyBackup()
    const state = this.state
    const auditCutoff = Date.now() - Number(state.settings?.audit?.retentionDays || 365) * 86400000
    const auditDue = state.auditLogs.length > 0 && Date.parse(state.auditLogs[0].createdAt) < auditCutoff
    const retentionDays = Number(state.settings?.audit?.workLogRetentionDays || 0)
    const logCutoff = new Date(Date.now() - retentionDays * 86400000).toISOString().slice(0, 10)
    const logsDue = retentionDays > 0 && state.workLogs.some(row => row.date && row.date < logCutoff)
    if (!auditDue && !logsDue) return
    this.commit(
      draft => {
        pruneAudit(draft)
        if (retentionDays > 0) draft.workLogs = draft.workLogs.filter(row => !row.date || row.date >= logCutoff)
      },
      { reason: 'maintenance' }
    )
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------
  /** Memoise an expensive read per write generation (invalidated by any commit). */
  memo<T>(key: string, compute: () => T): T {
    const hit = this.cache.get(key)
    if (hit && hit.writeCount === this.state.meta.writeCount) return hit.value as T
    const value = compute()
    this.cache.set(key, { writeCount: this.state.meta.writeCount, value })
    return value
  }

  get revision(): number {
    return this.state.meta.writeCount
  }

  // ---- writes --------------------------------------------------------------------------------------------------------
  /**
   * Run a mutation and persist it atomically. Contract for `fn`: run every check that can fail with an HttpError
   * BEFORE the first mutation. An HttpError is assumed to leave the state untouched; any other error, and any failed
   * write, restores the last persisted state.
   */
  commit<T>(fn: (state: StoreState) => T, options: CommitOptions = {}): T {
    if (this.closed) throw new HttpError(503, 'Atlas is shutting down', 'SHUTTING_DOWN')
    const snapshot = this.lastJson
    let result: T
    try {
      if (options.backupFirst) this.createBackup(options.backupFirst, { required: true })
      result = fn(this.state)
    } catch (error) {
      if (!(error instanceof HttpError)) this.rollback(snapshot)
      throw error
    }
    try {
      this.persist(options)
    } catch (error) {
      this.rollback(snapshot)
      throw error
    }
    return result
  }

  /** Replace the whole state (CLI re-initialisation). Always snapshots the current file first. */
  replaceState(next: StoreState, options: CommitOptions = {}) {
    this.commit(state => {
      for (const key of Object.keys(state)) delete (state as any)[key]
      Object.assign(state, next)
    }, options)
  }

  private rollback(snapshot: string) {
    if (!snapshot) return
    try {
      this.state = JSON.parse(snapshot)
      this.cache.clear()
    } catch (error) {
      console.error('Rollback failed; the process must be restarted:', (error as Error).message)
    }
  }

  private persist(options: CommitOptions = {}) {
    const state = this.state
    state.meta.updatedAt = new Date().toISOString()
    state.meta.writeCount = Number(state.meta.writeCount || 0) + 1
    const json = JSON.stringify(state, null, 2)
    try {
      if (fs.existsSync(this.file)) {
        if (this.config.backupOnWrite) this.createBackup('write', { required: false })
        else this.maybeDailyBackup()
      }
      atomicWriteFileSync(this.file, json, 0o600)
    } catch (error) {
      const message = (error as Error).message
      this.lastPersistError = message
      console.error(`Could not write ${this.file}: ${message}`)
      throw new HttpError(
        503,
        'Your change could not be saved to disk, so nothing was changed. Check free disk space and permissions, then try again.',
        'STORAGE_UNAVAILABLE'
      )
    }
    this.lastJson = json
    this.lastPersistedAt = state.meta.updatedAt
    this.lastPersistError = null
    this.cache.clear()
  }

  // ---- backups -------------------------------------------------------------------------------------------------------
  listBackups(): BackupInfo[] {
    return listBackupsIn(this.config.dataDir)
  }

  private maybeDailyBackup() {
    if (Date.now() - this.lastDailyBackup < 24 * 60 * 60 * 1000) return
    if (this.createBackup('daily', { required: false })) this.lastDailyBackup = Date.now()
  }

  /** Copy the current on-disk store to backups/. Returns the path, or null when there is nothing to back up. */
  createBackup(reason = 'manual', { required = true } = {}): string | null {
    return createBackupFile(this.config, reason, { required })
  }

  // ---- diagnostics ---------------------------------------------------------------------------------------------------
  validate() {
    return this.memo('validate', () => validateStoreState(this.state))
  }
  checksum(): string {
    return this.memo('checksum', () => sha256(JSON.stringify(this.state)))
  }
  health() {
    return { writable: this.lastPersistError === null, lastSavedAt: this.lastPersistedAt, error: this.lastPersistError }
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer)
    this.release?.()
    this.release = null
  }
}

/** Copy the live store file into backups/ (verified, private, pruned). Works without opening/migrating the store. */
export function createBackupFile(
  config: Pick<AtlasConfig, 'dataDir' | 'backupRetention'>,
  reason = 'manual',
  { required = true } = {}
): string | null {
  const file = path.join(config.dataDir, STORE_FILE)
  if (!fs.existsSync(file)) return null
  const dir = path.join(config.dataDir, BACKUP_DIR)
  const safeReason =
    String(reason)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .slice(0, 32) || 'snapshot'
  try {
    ensurePrivateDir(dir)
    let target = path.join(dir, `atlas-store-${backupTimestamp()}-${safeReason}.json`)
    for (let i = 1; fs.existsSync(target); i++)
      target = path.join(dir, `atlas-store-${backupTimestamp()}-${safeReason}-${i}.json`)
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL)
    try {
      fs.chmodSync(target, 0o600)
    } catch {
      /* best effort */
    }
    // Verify: the copy must be byte-identical to the source and parse as JSON.
    const copy = fs.readFileSync(target)
    if (sha256(copy) !== sha256(fs.readFileSync(file)))
      throw new Error('backup verification failed (checksum mismatch)')
    JSON.parse(copy.toString('utf8'))
    pruneBackups(config.dataDir, config.backupRetention)
    return target
  } catch (error) {
    const message = `Backup (${reason}) failed: ${(error as Error).message}`
    if (required) throw new HttpError(503, `${message}. The operation was not performed.`, 'BACKUP_FAILED')
    console.error(message)
    return null
  }
}

/**
 * Per-kind retention: routine per-write backups ("write") and everything else (daily, manual, pre-migration,
 * pre-restore, pre-destructive) are pruned independently, so a burst of write snapshots can never evict the
 * snapshots taken before risky operations.
 */
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

// ---- offline operations (CLI) --------------------------------------------------------------------------------------
/** Replace the live store with a backup. The server must not be running (the lock enforces it). */
export function restoreBackup(
  config: AtlasConfig,
  which: string
): { restored: string; preRestore: string | null; counts: Record<string, number> } {
  ensurePrivateDir(config.dataDir)
  const release = acquireLock(config.dataDir)
  try {
    const backups = listBackupsIn(config.dataDir)
    let candidate: string | undefined
    if (which === 'latest') {
      // The newest backup that actually parses and validates.
      candidate = backups
        .map(b => b.path)
        .find(file => {
          try {
            readStoreFile(file, config)
            return true
          } catch {
            return false
          }
        })
      if (!candidate) throw new Error('No valid backup found to restore.')
    } else {
      const resolved =
        backups.find(b => b.file === which)?.path || (fs.existsSync(which) ? path.resolve(which) : undefined)
      if (!resolved) throw new Error(`Backup "${which}" was not found in ${path.join(config.dataDir, BACKUP_DIR)}.`)
      candidate = resolved
    }
    const { state } = readStoreFile(candidate, config)
    const validation = validateStoreState(state)
    if (validation.errors.length)
      throw new Error(`Backup failed validation: ${validation.errors.slice(0, 3).join('; ')}`)
    const file = path.join(config.dataDir, STORE_FILE)
    let preRestore: string | null = null
    if (fs.existsSync(file)) {
      ensurePrivateDir(path.join(config.dataDir, BACKUP_DIR))
      preRestore = path.join(config.dataDir, BACKUP_DIR, `atlas-store-${backupTimestamp()}-pre-restore.json`)
      fs.copyFileSync(file, preRestore)
    }
    atomicWriteFileSync(file, fs.readFileSync(candidate), 0o600)
    return {
      restored: candidate,
      preRestore,
      counts: {
        tasks: state.tasks.length,
        projects: state.projects.length,
        people: state.people.length,
        users: state.users.length
      }
    }
  } finally {
    release()
  }
}
