// Backups and restore of the SQLite database: consistent, verified, private, pruned per kind, and restorable (including
// backups written by the earlier JSON store).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { createContainer } from '../../server/app/container'
import { loadConfig } from '../../server/config'
import { createBackup, listBackupsIn, pruneBackups, restoreBackup, verifyDatabaseFile } from '../../server/db/backup'
import { Database } from '../../server/db/driver'
import { openDatabase } from '../../server/db/open'
import { openDirect } from '../helpers/db'
import { launch, setupAdmin } from '../helpers/server'

const fixture = path.join(import.meta.dirname, '..', 'fixtures', 'store-3.0.0.json')
const temp: string[] = []
const mkdir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-backup-test-'))
  temp.push(dir)
  return dir
}
const cfg = (dataDir: string, env: Record<string, string> = {}) =>
  loadConfig({
    NODE_ENV: 'production',
    ATLAS_DATA_DIR: dataDir,
    ATLAS_TIMEZONE: 'Europe/Amsterdam',
    ...env
  } as NodeJS.ProcessEnv)
after(() => temp.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

function open(config: ReturnType<typeof cfg>) {
  const opened = openDatabase(config)
  const app = createContainer(config, opened.db)
  return {
    db: opened.db,
    app,
    close() {
      opened.db.close()
      opened.release?.()
    }
  }
}
const addTeam = (store: ReturnType<typeof open>, id: string) =>
  store.app.ctx.transaction(() => store.app.repos.teams.insert({ id, name: id, color: 'blue' }))
const teamIds = (dir: string) => {
  const db = openDirect(dir, true)
  try {
    return db.all('SELECT id FROM teams ORDER BY rowid').map(row => row.id)
  } finally {
    db.close()
  }
}

describe('backups (DATA-03)', () => {
  test('a non-numeric ATLAS_BACKUP_RETENTION is rejected with a warning instead of deleting every backup', () => {
    const dir = mkdir()
    const config = cfg(dir, { ATLAS_BACKUP_RETENTION: 'abc' })
    assert.equal(config.backupRetention, 25)
    assert.ok(config.warnings.some(w => w.includes('ATLAS_BACKUP_RETENTION')))
    const store = open(config)
    for (let i = 0; i < 4; i++) createBackup(config, store.db, 'manual')
    store.close()
    assert.equal(listBackupsIn(dir).filter(b => b.reason === 'manual').length, 4)
    assert.equal(cfg(dir, { ATLAS_BACKUP_RETENTION: '1' }).backupRetention, 3, 'clamped to a sane minimum')
    assert.equal(cfg(dir, { ATLAS_BACKUP_RETENTION: '9999' }).backupRetention, 100)
  })

  test('routine write snapshots can never evict the snapshots taken before risky operations', () => {
    const dir = mkdir()
    const config = cfg(dir, { ATLAS_BACKUP_RETENTION: '3' })
    const store = open(config)
    createBackup(config, store.db, 'pre-migration')
    for (let i = 0; i < 8; i++) createBackup(config, store.db, 'write')
    pruneBackups(dir, 3)
    const backups = listBackupsIn(dir)
    assert.equal(backups.filter(b => b.reason === 'write').length, 3)
    assert.equal(backups.filter(b => b.reason === 'pre-migration').length, 1)
    store.close()
  })

  test('the first write of a day takes a daily snapshot; later writes that day do not', () => {
    const dir = mkdir()
    const store = open(cfg(dir))
    addTeam(store, 'a')
    addTeam(store, 'b')
    assert.equal(listBackupsIn(dir).filter(b => b.reason === 'daily').length, 1)
    store.close()
  })

  test('with ATLAS_BACKUP_ON_WRITE a snapshot follows writes (at most one a second)', () => {
    const dir = mkdir()
    const store = open(cfg(dir, { ATLAS_BACKUP_ON_WRITE: 'true' }))
    addTeam(store, 'a')
    addTeam(store, 'b') // within the same second: no second snapshot
    assert.equal(listBackupsIn(dir).filter(b => b.reason === 'write').length, 1)
    store.close()
  })

  test('a backup is a private, verified, self-contained copy that holds exactly what the database held', () => {
    const dir = mkdir()
    const store = open(cfg(dir))
    addTeam(store, 'kept')
    const file = createBackup(cfg(dir), store.db, 'manual')!
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600')
    assert.equal(fs.existsSync(`${file}-wal`), false, 'one file, no write-ahead log beside it')
    const verdict = verifyDatabaseFile(file)
    assert.equal(verdict.ok, true)
    const copy = new Database(file, { readOnly: true })
    assert.deepEqual(
      copy.all('SELECT id FROM teams').map(row => row.id),
      ['kept']
    )
    copy.close()
    store.close()
  })

  test('a backup taken while the server is writing is consistent', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      const writers = Array.from({ length: 40 }, (_, i) => admin.post('/api/teams', { name: `T${i}` }))
      const files = [1, 2, 3].map(() => createBackup(server.config, server.db, 'manual'))
      await Promise.all(writers)
      for (const file of files) {
        const verdict = verifyDatabaseFile(file!)
        assert.equal(verdict.ok, true, verdict.error)
      }
    } finally {
      await server.cleanup()
    }
  })

  test('a damaged or foreign file is not accepted as a backup', () => {
    const dir = mkdir()
    const garbage = path.join(dir, 'garbage.db')
    fs.writeFileSync(garbage, 'not a database at all')
    assert.equal(verifyDatabaseFile(garbage).ok, false)
    const stranger = new Database(path.join(dir, 'stranger.db'))
    stranger.exec('CREATE TABLE t(x)')
    stranger.close()
    assert.match(String(verifyDatabaseFile(path.join(dir, 'stranger.db')).error), /not an Atlas database/)
  })
})

describe('restore', () => {
  test('replaces the database, keeps a copy of what it replaced, and refuses while a server is running', () => {
    const dir = mkdir()
    const store = open(cfg(dir))
    addTeam(store, 'keep')
    const backup = path.basename(createBackup(cfg(dir), store.db, 'manual')!)
    addTeam(store, 'lose')
    assert.throws(() => restoreBackup(cfg(dir), backup), /already using|lock/i)
    store.close()
    const result = restoreBackup(cfg(dir), backup)
    assert.ok(result.preRestore && fs.existsSync(result.preRestore))
    assert.deepEqual(teamIds(dir), ['keep'])
    const preRestore = openDirect(path.dirname(path.dirname(result.preRestore!)), true)
    void preRestore.close()
    assert.ok(restoreBackup(cfg(dir), 'latest').restored)
  })

  test('the old write-ahead log is never paired with the restored file', () => {
    const dir = mkdir()
    const store = open(cfg(dir))
    addTeam(store, 'keep')
    const backup = path.basename(createBackup(cfg(dir), store.db, 'manual')!)
    addTeam(store, 'lose')
    store.close()
    // simulate a crash: stale -wal/-shm files lying next to the live database
    fs.writeFileSync(path.join(dir, 'atlas.db-wal'), 'stale write-ahead log')
    fs.writeFileSync(path.join(dir, 'atlas.db-shm'), 'stale shared memory')
    restoreBackup(cfg(dir), backup)
    assert.equal(fs.existsSync(path.join(dir, 'atlas.db-wal')), false)
    assert.equal(fs.existsSync(path.join(dir, 'atlas.db-shm')), false)
    assert.deepEqual(teamIds(dir), ['keep'])
  })

  test('a corrupt backup is never restored, and "latest" skips it', () => {
    const dir = mkdir()
    const store = open(cfg(dir))
    addTeam(store, 'good')
    const good = createBackup(cfg(dir), store.db, 'manual')!
    store.close()
    const bad = path.join(path.dirname(good), 'atlas-29990101T000000000Z-manual.db')
    fs.writeFileSync(bad, 'SQLite format 3\0 but damaged')
    const live = fs.readFileSync(path.join(dir, 'atlas.db'))
    assert.throws(() => restoreBackup(cfg(dir), path.basename(bad)))
    assert.deepEqual(
      fs.readFileSync(path.join(dir, 'atlas.db')),
      live,
      'a refused restore leaves the live database untouched'
    )
    assert.equal(restoreBackup(cfg(dir), 'latest').restored, good, '"latest" skips the corrupt newest file')
  })

  test('a backup written by the old JSON store can still be restored: it is imported into a fresh database', () => {
    const dir = mkdir()
    fs.mkdirSync(path.join(dir, 'backups'), { recursive: true })
    fs.copyFileSync(fixture, path.join(dir, 'backups', 'atlas-store-20260101T000000000Z-manual.json'))
    const listed = listBackupsIn(dir)
    assert.equal(listed[0].format, 'json')
    const result = restoreBackup(cfg(dir), 'latest')
    assert.equal(result.counts.users, 4)
    assert.ok(result.counts.tasks > 0)
    const store = open(cfg(dir))
    try {
      assert.equal(store.app.repos.users.list().length, 4)
      assert.equal(store.db.pragma('integrity_check'), 'ok')
    } finally {
      store.close()
    }
  })

  test('there is a clear message when there is nothing to restore', () => {
    assert.throws(() => restoreBackup(cfg(mkdir()), 'latest'), /No valid backup found/)
    assert.throws(() => restoreBackup(cfg(mkdir()), 'atlas-nope.db'), /was not found/)
  })
})
