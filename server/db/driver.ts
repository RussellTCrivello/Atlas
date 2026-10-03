// The only module that touches `node:sqlite`. Everything above it (repositories, services) sees a small, typed
// synchronous API with three guarantees the raw driver does not give:
//   * values are bound safely (booleans become 0/1, undefined becomes NULL; nothing is ever interpolated into SQL);
//   * every write happens inside a transaction that either commits completely or rolls back completely, and the
//     data revision advances exactly once per committed write transaction;
//   * I/O failures are recorded, so /api/health can say the store is not writable.
import { createRequire } from 'node:module'
import type { DatabaseSync, StatementSync } from 'node:sqlite'

type SqliteModule = typeof import('node:sqlite')

let sqliteModule: SqliteModule | null = null

/**
 * Load `node:sqlite` once. Node prints an ExperimentalWarning the first time the module is loaded; that notice is about
 * API stability (the engine itself is SQLite 3.5x), so it is filtered here instead of being printed on every start.
 */
export function loadSqlite(): SqliteModule {
  if (sqliteModule) return sqliteModule
  const original = process.emitWarning
  process.emitWarning = function emitWarning(warning: string | Error, ...rest: unknown[]) {
    const text = typeof warning === 'string' ? warning : warning?.message
    if (typeof text === 'string' && /SQLite is an experimental feature/i.test(text)) return
    return (original as (...args: unknown[]) => void).call(process, warning, ...rest)
  } as typeof process.emitWarning
  try {
    sqliteModule = createRequire(import.meta.url)('node:sqlite') as SqliteModule
  } finally {
    process.emitWarning = original
  }
  return sqliteModule
}

export type SqlValue = string | number | bigint | boolean | null | undefined | Uint8Array
export type SqlParams = SqlValue[] | Record<string, SqlValue>
export type Row = Record<string, any>

export interface RunResult {
  changes: number
  lastInsertRowid: number
}

/** The kinds of SQLite failure the application distinguishes. */
export type SqlFailure =
  'unique' | 'foreign-key' | 'check' | 'not-null' | 'readonly' | 'full' | 'io' | 'busy' | 'corrupt' | 'other'

const PRIMARY = { BUSY: 5, READONLY: 8, IOERR: 10, CORRUPT: 11, FULL: 13, CANTOPEN: 14, CONSTRAINT: 19, NOTADB: 26 }
const CONSTRAINT_KIND: Record<number, SqlFailure> = {
  2067: 'unique', // SQLITE_CONSTRAINT_UNIQUE
  1555: 'unique', // SQLITE_CONSTRAINT_PRIMARYKEY
  787: 'foreign-key',
  275: 'check',
  1299: 'not-null'
}

/** Classify a thrown SQLite error (see https://sqlite.org/rescode.html). */
export function classifySqlError(error: unknown): SqlFailure {
  const code = Number((error as { errcode?: number })?.errcode)
  if (!Number.isFinite(code)) return 'other'
  if (CONSTRAINT_KIND[code]) return CONSTRAINT_KIND[code]
  const primary = code & 0xff
  if (primary === PRIMARY.CONSTRAINT) return 'check'
  if (primary === PRIMARY.READONLY) return 'readonly'
  if (primary === PRIMARY.FULL) return 'full'
  if (primary === PRIMARY.IOERR || primary === PRIMARY.CANTOPEN) return 'io'
  if (primary === PRIMARY.BUSY) return 'busy'
  if (primary === PRIMARY.CORRUPT || primary === PRIMARY.NOTADB) return 'corrupt'
  return 'other'
}

/** Failures that mean "the disk is the problem", not "the request was wrong". */
export const isStorageFailure = (error: unknown): boolean =>
  ['readonly', 'full', 'io', 'busy', 'corrupt'].includes(classifySqlError(error))

export interface OpenOptions {
  readOnly?: boolean
  /** Milliseconds to wait for another connection's lock (the CLI may read while the server writes). */
  busyTimeoutMs?: number
}

const STATEMENT_CACHE_LIMIT = 300

export class Database {
  private readonly raw: DatabaseSync
  private readonly statements = new Map<string, StatementSync>()
  private depth = 0
  private writes = 0
  private savepoint = 0
  private rollbackHooks: Array<() => void> = []
  private commitHooks: Array<() => void> = []
  private closed = false
  private bumpRevision = true
  private afterWrite: Array<() => void> = []
  /** Set when the last write transaction failed for a storage reason; cleared by the next successful commit. */
  lastWriteError: string | null = null
  lastCommitAt: string | null = null

  constructor(
    readonly file: string,
    options: OpenOptions = {}
  ) {
    const { DatabaseSync: Sqlite } = loadSqlite()
    this.raw = new Sqlite(file, {
      readOnly: Boolean(options.readOnly),
      timeout: options.busyTimeoutMs ?? 5000,
      enableForeignKeyConstraints: true
    })
  }

  // ---- statements ------------------------------------------------------------------------------------------------
  private prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.raw.prepare(sql)
      if (this.statements.size >= STATEMENT_CACHE_LIMIT) this.statements.clear()
      this.statements.set(sql, statement)
    }
    return statement
  }

  private bind(params: SqlParams | undefined): any[] {
    if (!params) return []
    if (Array.isArray(params)) return params.map(coerce)
    const named: Record<string, any> = {}
    for (const [key, value] of Object.entries(params)) named[key] = coerce(value)
    return [named]
  }

  /** Run DDL or several statements at once (no parameters). Not counted as a data write. */
  exec(sql: string): void {
    this.raw.exec(sql)
  }

  run(sql: string, params?: SqlParams): RunResult {
    const result = this.prepare(sql).run(...this.bind(params))
    const changes = Number(result.changes)
    if (changes > 0) this.writes++
    return { changes, lastInsertRowid: Number(result.lastInsertRowid) }
  }

  get<T extends Row = Row>(sql: string, params?: SqlParams): T | undefined {
    return this.prepare(sql).get(...this.bind(params)) as T | undefined
  }

  all<T extends Row = Row>(sql: string, params?: SqlParams): T[] {
    return this.prepare(sql).all(...this.bind(params)) as T[]
  }

  /** Stream rows without materialising them all (large exports). */
  *iterate<T extends Row = Row>(sql: string, params?: SqlParams): Generator<T> {
    for (const row of this.prepare(sql).iterate(...this.bind(params))) yield row as T
  }

  scalar<T = number>(sql: string, params?: SqlParams): T | undefined {
    const row = this.get(sql, params)
    return row ? (Object.values(row)[0] as T) : undefined
  }

  pragma(name: string): any {
    const row = this.raw.prepare(`PRAGMA ${name}`).get()
    return row ? Object.values(row)[0] : undefined
  }

  // ---- transactions ----------------------------------------------------------------------------------------------
  get inTransaction(): boolean {
    return this.depth > 0
  }

  /**
   * Run `fn` atomically. The outermost call takes the write lock up front (BEGIN IMMEDIATE), so a writer never fails
   * halfway because another connection got in first. Nested calls become savepoints: an error rolls back only the
   * inner work. If `fn` wrote anything, the data revision advances once, inside the same commit; pass `{ revision: false }`
   * for housekeeping writes (sessions, audit batches) that are not changes to the workspace's data.
   */
  transaction<T>(fn: () => T, options: { revision?: boolean } = {}): T {
    if (this.closed) throw new Error('The database is closed')
    if (this.depth > 0) return this.nested(fn)
    try {
      this.raw.exec('BEGIN IMMEDIATE')
    } catch (error) {
      if (isStorageFailure(error)) this.lastWriteError = String((error as Error).message || error)
      throw error
    }
    this.depth = 1
    this.writes = 0
    this.bumpRevision = options.revision !== false
    try {
      const result = fn()
      const wrote = this.writes > 0
      if (wrote && this.bumpRevision) this.advanceRevision()
      this.raw.exec('COMMIT')
      this.depth = 0
      if (wrote) {
        this.lastWriteError = null
        this.lastCommitAt = new Date().toISOString()
      }
      const hooks = this.commitHooks
      this.commitHooks = []
      this.rollbackHooks = []
      hooks.forEach(hook => hook())
      if (wrote) for (const listener of this.afterWrite) this.notify(listener)
      return result
    } catch (error) {
      this.depth = 0
      try {
        this.raw.exec('ROLLBACK')
      } catch {
        /* SQLite already rolled the transaction back (for example after SQLITE_FULL) */
      }
      if (isStorageFailure(error)) this.lastWriteError = String((error as Error).message || error)
      const hooks = this.rollbackHooks
      this.rollbackHooks = []
      this.commitHooks = []
      hooks.forEach(hook => hook())
      throw error
    }
  }

  /** Called after every committed transaction that wrote something (used for write-triggered snapshots). */
  onAfterWrite(listener: () => void) {
    this.afterWrite.push(listener)
  }
  private notify(listener: () => void) {
    try {
      listener()
    } catch (error) {
      console.error('A post-commit task failed:', (error as Error).message)
    }
  }

  private nested<T>(fn: () => T): T {
    const name = `sp_${++this.savepoint}`
    this.raw.exec(`SAVEPOINT ${name}`)
    this.depth++
    try {
      const result = fn()
      this.raw.exec(`RELEASE ${name}`)
      return result
    } catch (error) {
      this.raw.exec(`ROLLBACK TO ${name}`)
      this.raw.exec(`RELEASE ${name}`)
      throw error
    } finally {
      this.depth--
    }
  }

  /** Run `hook` if the surrounding transaction rolls back (used to drop in-memory caches that mirrored the writes). */
  onRollback(hook: () => void) {
    if (this.depth > 0) this.rollbackHooks.push(hook)
  }
  onCommit(hook: () => void) {
    if (this.depth > 0) this.commitHooks.push(hook)
    else hook()
  }

  private advanceRevision() {
    const now = new Date().toISOString()
    this.raw.prepare("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'revision'").run()
    this.raw
      .prepare(
        "INSERT INTO meta(key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(now)
  }

  get revision(): number {
    return Number(this.scalar("SELECT value FROM meta WHERE key = 'revision'") ?? 0)
  }

  // ---- maintenance -----------------------------------------------------------------------------------------------
  /** A consistent, compacted copy of the database (no -wal/-shm files). Safe while other connections write. */
  vacuumInto(target: string) {
    this.raw.prepare('VACUUM INTO ?').run(target)
  }

  /** Flush the write-ahead log into the main file and truncate it (used before copying the file and on shutdown). */
  checkpoint() {
    try {
      this.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    } catch {
      /* a concurrent reader can delay the checkpoint; the data is safe in the WAL either way */
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.statements.clear()
    try {
      this.raw.exec('PRAGMA optimize')
    } catch {
      /* read-only or already failing connection */
    }
    this.raw.close()
  }
}

function coerce(value: SqlValue): string | number | bigint | null | Uint8Array {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}
