// Moving from the JSON document store to SQLite. The first start of a build with SQL finds `atlas-store.json` and no
// `atlas.db`; it imports the document into a temporary database, verifies the result, and only then puts it in place
// and sets the old files aside. The old files are renamed, never deleted, and a byte-identical copy is also kept in
// backups/, so the person can always go back.
import fs from 'node:fs'
import path from 'node:path'
import type { AtlasConfig } from '../config'
import { chainEntry } from '../domain/audit-chain'
import { fsyncDirectory } from '../fsutil'
import { sha256 } from '../util'
import { BACKUP_DIR, DB_FILE, LEGACY_STORE_FILE, verifyDatabaseFile } from './backup'
import { configureConnection, createDatabaseFile } from './create'
import { Database } from './driver'
import { readLegacyStoreFile } from './legacy-store'
import { writeSnapshot, type SnapshotReport } from './snapshot'

export const LEGACY_SESSIONS_FILE = 'sessions.json'

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('.', '')

/** Import one legacy JSON store file into a new database at `target`. Returns what was stored and what was repaired. */
export function importLegacyFile(config: AtlasConfig, source: string, target: string): SnapshotReport {
  const { state } = readLegacyStoreFile(source, config)
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(target + suffix, { force: true })
  const db = createDatabaseFile(target, config)
  try {
    const report = writeSnapshot(db, state, config)
    db.checkpoint()
    return report
  } catch (error) {
    db.close()
    for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(target + suffix, { force: true })
    throw error
  } finally {
    db.close() // a clean close removes the -wal and -shm files, leaving one self-contained file
  }
}

export interface LegacyMigration {
  report: SnapshotReport
  source: string
  keptAs: string
  backup: string
  sessionsImported: number
}

/** Perform the one-time migration of `<dataDir>/atlas-store.json` into `<dataDir>/atlas.db`. */
export function migrateLegacyStore(config: AtlasConfig): LegacyMigration {
  const source = path.join(config.dataDir, LEGACY_STORE_FILE)
  const target = path.join(config.dataDir, DB_FILE)
  const staging = `${target}.importing`
  const original = fs.readFileSync(source)
  const report = importLegacyFile(config, source, staging)
  try {
    const verdict = verifyDatabaseFile(staging)
    if (!verdict.ok) throw new Error(`the imported database failed verification (${verdict.error})`)
    const expected = readLegacyStoreFile(source, config).state
    const want = { users: expected.users.length, people: expected.people.length, tasks: expected.tasks.length }
    // Rows that had to be skipped are listed in the report; anything else missing is a bug and must stop the migration.
    const skipped = report.repairs.filter(line => /was skipped$|had a missing or duplicate id/.test(line)).length
    for (const key of ['users', 'people', 'tasks'] as const)
      if ((verdict.counts?.[key] ?? 0) + skipped < want[key])
        throw new Error(`the import stored ${verdict.counts?.[key] ?? 0} of ${want[key]} ${key}`)

    // A verified, byte-identical copy of the old store goes into backups/ before anything is moved.
    const backupDir = path.join(config.dataDir, BACKUP_DIR)
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 })
    const backup = path.join(backupDir, `atlas-store-${stamp()}-pre-sql-migration.json`)
    fs.writeFileSync(backup, original, { mode: 0o600, flag: 'wx' })
    if (sha256(fs.readFileSync(backup)) !== sha256(original))
      throw new Error('the safety copy of the old store did not verify')

    const sessionsImported = importSessions(config, staging)
    recordImport(staging, { report, sessionsImported, source: LEGACY_STORE_FILE })
    for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(target + suffix, { force: true })
    fs.renameSync(staging, target)
    fsyncDirectory(config.dataDir)
    const keptAs = `${source}.imported-${stamp()}`
    fs.renameSync(source, keptAs)
    const sessionsFile = path.join(config.dataDir, LEGACY_SESSIONS_FILE)
    if (fs.existsSync(sessionsFile)) fs.renameSync(sessionsFile, `${sessionsFile}.imported-${stamp()}`)
    return { report, source, keptAs, backup, sessionsImported }
  } catch (error) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(staging + suffix, { force: true })
    throw error
  }
}

/** Keep people signed in across the upgrade: carry over sessions whose account still exists. */
function importSessions(config: AtlasConfig, dbFile: string): number {
  const file = path.join(config.dataDir, LEGACY_SESSIONS_FILE)
  if (!fs.existsSync(file)) return 0
  let imported = 0
  let parsed: any
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return 0
  }
  const db = createReopened(dbFile)
  try {
    db.transaction(() => {
      for (const [hash, record] of Object.entries<any>(parsed?.sessions || {})) {
        if (!/^[0-9a-f]{64}$/.test(hash) || !record || typeof record.userId !== 'string') continue
        if (!db.get('SELECT 1 FROM users WHERE id = ?', [record.userId])) continue
        db.run('INSERT OR IGNORE INTO sessions(token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)', [
          hash,
          record.userId,
          Number(record.createdAt) || Date.now(),
          Number(record.lastSeenAt) || Date.now()
        ])
        imported++
      }
    })
    return imported
  } finally {
    db.close()
  }
}

function recordImport(dbFile: string, info: { report: SnapshotReport; sessionsImported: number; source: string }) {
  const db = createReopened(dbFile)
  try {
    db.transaction(() => {
      const last = db.get<{ hash: string | null }>('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1')
      const anchor = String(db.scalar("SELECT value FROM meta WHERE key = 'audit_anchor'") ?? '')
      const entry = chainEntry(
        last?.hash || anchor,
        'system.import.legacy',
        {},
        {
          source: info.source,
          counts: info.report.counts,
          repairs: info.report.repairs.length,
          sessionsImported: info.sessionsImported
        }
      )
      db.run(
        'INSERT INTO audit_log(id, action, actor_id, detail, created_at, ip, user_agent, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          entry.id,
          entry.action,
          entry.actorId,
          JSON.stringify(entry.detail),
          entry.createdAt,
          null,
          null,
          entry.prev || '',
          entry.hash
        ]
      )
      const value = JSON.stringify({
        at: new Date().toISOString(),
        source: info.source,
        counts: info.report.counts,
        repairs: info.report.repairs
      })
      db.run(
        "INSERT INTO meta(key, value) VALUES ('legacy_import', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [value]
      )
    })
    db.checkpoint()
  } finally {
    db.close()
  }
}

function createReopened(file: string): Database {
  const db = new Database(file)
  configureConnection(db)
  return db
}
