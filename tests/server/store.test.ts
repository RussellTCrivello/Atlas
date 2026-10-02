import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, mock, test } from 'node:test'
import { buildTranslationCatalog } from '../../shared/i18n/catalog'
import { verifyPassword } from '../../server/auth'
import { loadConfig } from '../../server/config'
import { validateStoreState } from '../../server/migrations'
import {
  DocumentStore,
  StoreCorruptError,
  StoreLockedError,
  StoreMissingError,
  StoreTooNewError,
  listBackupsIn,
  pruneBackups,
  restoreBackup
} from '../../server/store'
import { Api, PASSWORD, launch, setupAdmin } from '../helpers/server'

const fixture = path.join(import.meta.dirname, '..', 'fixtures', 'store-3.0.0.json')
const temp: string[] = []
const mkdir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-store-test-'))
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

describe('migration from the v3.0.0 store written by the original build (DATA-04, REP-02)', () => {
  const prepare = () => {
    const dir = mkdir()
    const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'))
    // what a real instance looks like after an administrator saved settings from the UI: the whole built-in catalog frozen in
    const catalog = buildTranslationCatalog()
    raw.settings.localization.translations = {
      ar: { ...catalog.ar, 'nav.projects': 'مشاريعنا' },
      en: { ...catalog.en }
    }
    fs.writeFileSync(path.join(dir, 'atlas-store.json'), JSON.stringify(raw))
    return { dir, raw }
  }

  test('upgrades in place, snapshots first, and removes only what the old build invented', async () => {
    const { dir, raw } = prepare()
    const original = fs.readFileSync(path.join(dir, 'atlas-store.json'))
    const db = DocumentStore.open(cfg(dir))
    try {
      const state = db.state
      assert.equal(state.meta.schemaVersion, '3.1.0')
      const backup = listBackupsIn(dir).find(b => b.reason === 'pre-migration')
      assert.ok(backup, 'a pre-migration backup exists')
      assert.deepEqual(fs.readFileSync(backup!.path), original, 'and is byte-identical to the file before migration')

      assert.equal(
        state.workLogs.some(row => /^wl_(seed|activity)_/.test(row.id)),
        false,
        'back-filled rows are gone'
      )
      assert.equal(
        state.workLogs.some(row => 'minutes' in row),
        false,
        'invented effort is gone'
      )
      const realBefore = raw.workLogs.filter((row: any) => /^worklog_/.test(row.id))
      assert.equal(realBefore.length, 4)
      for (const row of realBefore)
        assert.ok(
          state.workLogs.some(r => r.id === row.id),
          `real event ${row.action} kept`
        )

      const derived = state.workLogs.filter(row => row.derived)
      assert.ok(derived.length > 50, 'history re-derived from recorded timestamps')
      assert.ok(
        derived.every(row => row.time === '' || row.source === 'Activity log'),
        'no invented clock times on derived task rows'
      )
      assert.ok(derived.every(row => row.source === 'Task record' || row.source === 'Activity log'))
      const created = state.workLogs.filter(row => row.action === 'Created task')
      assert.equal(
        new Set(created.map(row => row.taskId)).size,
        state.tasks.length,
        'exactly one created event per task, no duplicates'
      )

      assert.ok(
        state.tasks.every(task => /^[A-Z0-9_-]+-\d{3}$/.test(task.key || '')),
        'task keys frozen'
      )
      assert.deepEqual(
        Object.fromEntries(Object.entries<any>(state.settings.permissions.roles).map(([k, v]) => [k, v.rank])),
        { Administrator: 4, Manager: 3, Developer: 2, Viewer: 1 }
      )
      assert.deepEqual(
        state.settings.localization.translations,
        { ar: { 'nav.projects': 'مشاريعنا' } },
        'only the real override survives; the frozen built-in catalog is dropped'
      )
      assert.equal(validateStoreState(state).errors.length, 0)
      assert.equal(state.users.length, 4)
    } finally {
      db.close()
    }
  })

  test('is idempotent: reopening does not migrate or snapshot again', () => {
    const { dir } = prepare()
    DocumentStore.open(cfg(dir)).close()
    const backups = listBackupsIn(dir).length
    const firstWrite = JSON.parse(fs.readFileSync(path.join(dir, 'atlas-store.json'), 'utf8')).meta.writeCount
    const again = DocumentStore.open(cfg(dir))
    again.close()
    assert.equal(listBackupsIn(dir).length, backups)
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'atlas-store.json'), 'utf8')).meta.writeCount, firstWrite)
  })

  test('legacy password hashes keep working and are upgraded on the next successful sign-in', async () => {
    const { dir } = prepare()
    const server = await launch({ dataDir: dir, keep: true })
    try {
      const api = new Api(server.url)
      const res = await api.post('/api/auth/login', { email: 'maya@atlas.local', password: 'atlas-demo' })
      assert.equal(res.status, 200)
      const stored = server.db.state.users.find(user => user.email === 'maya@atlas.local')!
      assert.equal(stored.passwordHash.split('$').length, 6, 'rewritten in the parameterised format')
      assert.equal((await verifyPassword('atlas-demo', stored.passwordHash)).needsRehash, false)
    } finally {
      await server.cleanup()
    }
  })
})

describe('fail closed (DATA-01)', () => {
  test('an unparsable store stops the server and is never replaced', () => {
    const dir = mkdir()
    const file = path.join(dir, 'atlas-store.json')
    fs.writeFileSync(file, '{"meta": {"schemaVersion": "3.1.0"}, "users": [ {"id": ')
    const before = fs.readFileSync(file)
    assert.throws(() => DocumentStore.open(cfg(dir)), StoreCorruptError)
    assert.deepEqual(fs.readFileSync(file), before, 'file untouched')
    assert.deepEqual(
      fs.readdirSync(dir).filter(name => name.includes('corrupt')),
      []
    )
    assert.equal(fs.existsSync(path.join(dir, 'atlas.lock')), false, 'lock released after the failure')
  })

  test('a store that is not an object is corrupt too', () => {
    const dir = mkdir()
    fs.writeFileSync(path.join(dir, 'atlas-store.json'), '[]')
    assert.throws(() => DocumentStore.open(cfg(dir)), StoreCorruptError)
  })

  test('a store written by a newer Atlas is refused rather than downgraded', () => {
    const dir = mkdir()
    fs.writeFileSync(
      path.join(dir, 'atlas-store.json'),
      JSON.stringify({ meta: { schemaVersion: '9.0.0' }, users: [] })
    )
    assert.throws(() => DocumentStore.open(cfg(dir)), StoreTooNewError)
  })

  test('a missing store next to existing backups does not silently start an empty (claimable) workspace', () => {
    const dir = mkdir()
    const first = DocumentStore.open(cfg(dir))
    first.createBackup('manual')
    first.close()
    fs.rmSync(path.join(dir, 'atlas-store.json'))
    assert.throws(() => DocumentStore.open(cfg(dir)), StoreMissingError)
    const forced = DocumentStore.open(cfg(dir), { allowFresh: true })
    assert.equal(forced.state.configured, false)
    forced.close()
  })

  test('a brand new directory creates an unconfigured store and a private directory layout', () => {
    const dir = path.join(mkdir(), 'nested', 'data')
    const db = DocumentStore.open(cfg(dir))
    assert.equal(db.state.configured, false)
    assert.equal((fs.statSync(dir).mode & 0o777).toString(8), '700')
    assert.equal((fs.statSync(path.join(dir, 'atlas-store.json')).mode & 0o777).toString(8), '600')
    db.close()
  })
})

describe('single writer lock (DATA-06)', () => {
  test('a second process (or instance) cannot open the same data directory', () => {
    const dir = mkdir()
    const first = DocumentStore.open(cfg(dir))
    assert.throws(() => DocumentStore.open(cfg(dir)), StoreLockedError)
    first.close()
    DocumentStore.open(cfg(dir)).close()
  })

  test('a lock left behind by a dead process is taken over', () => {
    const dir = mkdir()
    fs.writeFileSync(
      path.join(dir, 'atlas.lock'),
      JSON.stringify({ pid: 2_999_999, hostname: os.hostname(), startedAt: new Date().toISOString(), token: 'x' })
    )
    DocumentStore.open(cfg(dir)).close()
  })

  test('a lock held by a live process on another machine is respected', () => {
    const dir = mkdir()
    fs.writeFileSync(
      path.join(dir, 'atlas.lock'),
      JSON.stringify({ pid: process.pid, hostname: 'some-other-host', startedAt: new Date().toISOString(), token: 'x' })
    )
    assert.throws(() => DocumentStore.open(cfg(dir)), StoreLockedError)
  })
})

describe('durable, all-or-nothing writes (DATA-02)', () => {
  test('when the write fails the change is rolled back, reported, and health goes red until the next success', () => {
    const dir = mkdir()
    const db = DocumentStore.open(cfg(dir))
    db.commit(state => state.teams.push({ id: 't1', name: 'Alpha', color: 'blue' }), { reason: 'seed' })
    const onDisk = fs.readFileSync(path.join(dir, 'atlas-store.json'))
    const stub = mock.method(fs, 'renameSync', () => {
      throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })
    })
    try {
      assert.throws(
        () => db.commit(state => state.teams.push({ id: 't2', name: 'Beta', color: 'red' })),
        (error: any) => error.status === 503 && error.code === 'STORAGE_UNAVAILABLE'
      )
      assert.deepEqual(
        db.state.teams.map(t => t.id),
        ['t1'],
        'in-memory state rolled back'
      )
      assert.deepEqual(fs.readFileSync(path.join(dir, 'atlas-store.json')), onDisk, 'file untouched')
      assert.deepEqual(
        fs.readdirSync(dir).filter(name => name.endsWith('.tmp')),
        [],
        'no temp files left behind'
      )
      assert.equal(db.health().writable, false)
    } finally {
      stub.mock.restore()
    }
    db.commit(state => state.teams.push({ id: 't3', name: 'Gamma', color: 'green' }))
    assert.equal(db.health().writable, true)
    assert.deepEqual(
      db.state.teams.map(t => t.id),
      ['t1', 't3']
    )
    db.close()
  })

  test('an unexpected error half-way through a mutation does not leave a half-applied change in memory', () => {
    const dir = mkdir()
    const db = DocumentStore.open(cfg(dir))
    assert.throws(() =>
      db.commit(state => {
        state.teams.push({ id: 'half', name: 'Half', color: 'blue' })
        throw new TypeError('boom')
      })
    )
    assert.equal(db.state.teams.length, 0)
    db.close()
  })

  test('over HTTP a failed write is a clear 503 JSON error and the list is unchanged', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      const stub = mock.method(fs, 'renameSync', () => {
        throw new Error('EIO')
      })
      const res = await admin.post('/api/projects', { name: 'Never saved', code: 'NVR' })
      assert.equal(res.status, 503)
      assert.equal(res.body.code, 'STORAGE_UNAVAILABLE')
      assert.equal((await admin.get('/api/health')).status, 503, 'health reflects the storage failure')
      stub.mock.restore()
      assert.ok(!(await admin.get('/api/bootstrap')).body.projects.some((p: any) => p.code === 'NVR'))
      assert.equal((await admin.post('/api/projects', { name: 'Saved now', code: 'SVD' })).status, 200)
      assert.equal((await admin.get('/api/health')).status, 200)
    } finally {
      await server.cleanup()
    }
  })

  test('two writers cannot interleave: the store file is always one complete JSON document', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      await Promise.all(Array.from({ length: 25 }, (_, i) => admin.post('/api/teams', { name: `Team ${i}` })))
      const parsed = JSON.parse(fs.readFileSync(path.join(server.dataDir, 'atlas-store.json'), 'utf8'))
      assert.equal(parsed.teams.filter((t: any) => t.name.startsWith('Team ')).length, 25)
    } finally {
      await server.cleanup()
    }
  })
})

describe('backups (DATA-03)', () => {
  test('a non-numeric ATLAS_BACKUP_RETENTION is rejected with a warning instead of deleting every backup', () => {
    const dir = mkdir()
    const config = cfg(dir, { ATLAS_BACKUP_RETENTION: 'abc' })
    assert.equal(config.backupRetention, 25)
    assert.ok(config.warnings.some(w => w.includes('ATLAS_BACKUP_RETENTION')))
    const db = DocumentStore.open(config)
    for (let i = 0; i < 4; i++) db.createBackup('manual')
    db.close()
    assert.equal(listBackupsIn(dir).length, 4)
    assert.equal(cfg(dir, { ATLAS_BACKUP_RETENTION: '1' }).backupRetention, 3, 'clamped to a sane minimum')
    assert.equal(cfg(dir, { ATLAS_BACKUP_RETENTION: '9999' }).backupRetention, 100)
  })

  test('routine write snapshots can never evict the snapshots taken before risky operations', () => {
    const dir = mkdir()
    const db = DocumentStore.open(cfg(dir, { ATLAS_BACKUP_RETENTION: '3' }))
    db.createBackup('pre-migration')
    for (let i = 0; i < 8; i++) db.createBackup('write')
    pruneBackups(dir, 3)
    const backups = listBackupsIn(dir)
    assert.equal(backups.filter(b => b.reason === 'write').length, 3)
    assert.equal(backups.filter(b => b.reason === 'pre-migration').length, 1)
    db.close()
  })

  test('the first write of a day takes a daily snapshot; later writes that day do not', () => {
    const dir = mkdir()
    const db = DocumentStore.open(cfg(dir))
    db.commit(state => state.teams.push({ id: 'a', name: 'A', color: 'blue' }))
    db.commit(state => state.teams.push({ id: 'b', name: 'B', color: 'blue' }))
    assert.equal(listBackupsIn(dir).filter(b => b.reason === 'daily').length, 1)
    db.close()
  })

  test('backups are private, verified copies', () => {
    const dir = mkdir()
    const db = DocumentStore.open(cfg(dir))
    const file = db.createBackup('manual')!
    assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600')
    assert.deepEqual(fs.readFileSync(file), fs.readFileSync(path.join(dir, 'atlas-store.json')))
    db.close()
  })

  test('restore replaces the store, keeps a copy of what it replaced, and refuses while a server is running', () => {
    const dir = mkdir()
    const db = DocumentStore.open(cfg(dir))
    db.commit(state => state.teams.push({ id: 'keep', name: 'Keep', color: 'blue' }))
    const backup = path.basename(db.createBackup('manual')!)
    db.commit(state => state.teams.push({ id: 'lose', name: 'Lose', color: 'blue' }))
    assert.throws(() => restoreBackup(cfg(dir), backup), /already using|lock/i)
    db.close()
    const result = restoreBackup(cfg(dir), backup)
    assert.ok(result.preRestore && fs.existsSync(result.preRestore))
    const reopened = DocumentStore.open(cfg(dir))
    assert.deepEqual(
      reopened.state.teams.map(t => t.id),
      ['keep']
    )
    reopened.close()
    const latest = restoreBackup(cfg(dir), 'latest')
    assert.ok(latest.restored)
  })

  test('a corrupt backup is never restored', () => {
    const dir = mkdir()
    const db = DocumentStore.open(cfg(dir))
    const good = db.createBackup('manual')!
    db.close()
    const bad = path.join(path.dirname(good), 'atlas-store-29990101T000000000Z-manual.json')
    fs.writeFileSync(bad, '{ not json')
    assert.throws(() => restoreBackup(cfg(dir), path.basename(bad)))
    assert.equal(restoreBackup(cfg(dir), 'latest').restored, good, '"latest" skips the corrupt newest file')
  })
})

describe('audit trail integrity (SEC-13)', () => {
  test('entries are hash-chained and tampering is detected', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      await admin.post('/api/teams', { name: 'One' })
      await admin.post('/api/teams', { name: 'Two' })
      const ok = (await admin.get('/api/system')).body
      assert.equal(ok.auditChain.ok, true)
      assert.ok(ok.auditChain.checked >= 3)
      const entry = server.db.state.auditLogs[1]
      entry.detail = { forged: true }
      server.db.memo('auditChain', () => null) // chain status is memoised per write; force a fresh evaluation below
      const { verifyAuditChain } = await import('../../server/audit')
      assert.equal(verifyAuditChain(server.db.state).ok, false)
      assert.equal(verifyAuditChain(server.db.state).brokenAt, entry.id)
    } finally {
      await server.cleanup()
    }
  })

  test('audit retention prunes the oldest entries and the remaining chain still verifies', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      for (let i = 0; i < 3; i++) await admin.post('/api/teams', { name: `T${i}` })
      const state = server.db.state
      state.auditLogs.slice(0, 2).forEach(e => (e.createdAt = '2001-01-01T00:00:00.000Z'))
      const { pruneAudit, verifyAuditChain } = await import('../../server/audit')
      assert.equal(pruneAudit(state), 2)
      const status = verifyAuditChain(state)
      assert.equal(status.ok, true, 'the surviving entries still chain from the recorded anchor')
      assert.ok(state.meta.auditAnchor)
      assert.equal(status.checked, state.auditLogs.length)
    } finally {
      await server.cleanup()
    }
  })
})
