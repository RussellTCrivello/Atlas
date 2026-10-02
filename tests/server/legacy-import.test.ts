// Moving from the JSON document store to SQLite (DATA-04, DATA-06, REP-02 and the SQL move itself). The first start of a
// SQL build finds atlas-store.json and no atlas.db: it imports into a temporary database, verifies, and only then puts the
// result in place. The old file is kept, never deleted.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { buildTranslationCatalog } from '../../shared/i18n/catalog'
import { createContainer } from '../../server/app/container'
import { loadConfig } from '../../server/config'
import { listBackupsIn } from '../../server/db/backup'
import { runChecks } from '../../server/db/check'
import { StoreCorruptError, StoreTooNewError } from '../../server/db/errors'
import { openDatabase } from '../../server/db/open'
import { verifyPassword } from '../../server/security/passwords'
import { openDirect } from '../helpers/db'
import { Api, launch } from '../helpers/server'

const fixture = path.join(import.meta.dirname, '..', 'fixtures', 'store-3.0.0.json')
const temp: string[] = []
const mkdir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-legacy-test-'))
  temp.push(dir)
  return dir
}
const cfg = (dataDir: string) =>
  loadConfig({
    NODE_ENV: 'production',
    ATLAS_DATA_DIR: dataDir,
    ATLAS_TIMEZONE: 'Europe/Amsterdam'
  } as NodeJS.ProcessEnv)
after(() => temp.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

/** A data directory holding a store as the original build left it, with the whole built-in catalogue frozen into the settings. */
function prepare(edit: (raw: any) => void = () => {}) {
  const dir = mkdir()
  const raw = JSON.parse(fs.readFileSync(fixture, 'utf8'))
  const catalog = buildTranslationCatalog()
  raw.settings.localization.translations = { ar: { ...catalog.ar, 'nav.projects': 'مشاريعنا' }, en: { ...catalog.en } }
  edit(raw)
  fs.writeFileSync(path.join(dir, 'atlas-store.json'), JSON.stringify(raw))
  return { dir, raw, original: fs.readFileSync(path.join(dir, 'atlas-store.json')) }
}

function openStore(dir: string) {
  const opened = openDatabase(cfg(dir))
  const app = createContainer(cfg(dir), opened.db)
  return {
    ...opened,
    app,
    close() {
      opened.db.close()
      opened.release?.()
    }
  }
}

describe('first start of the SQL build on a v3.0.0 JSON store', () => {
  test('imports everything, removes only what the old build invented, and keeps the old file', () => {
    const { dir, raw, original } = prepare()
    const store = openStore(dir)
    try {
      const { db, app } = store
      assert.ok(store.legacy, 'the legacy import ran')
      assert.deepEqual(store.legacy!.report.repairs, [], 'this store needed no repairs')

      // The old file is set aside, not deleted, and a verified byte-identical copy sits in backups/.
      assert.equal(fs.existsSync(path.join(dir, 'atlas-store.json')), false)
      const kept = fs.readdirSync(dir).find(name => name.startsWith('atlas-store.json.imported-'))
      assert.ok(kept, 'the old store was renamed, not removed')
      assert.deepEqual(fs.readFileSync(path.join(dir, kept!)), original)
      const backup = listBackupsIn(dir).find(b => b.reason === 'pre-sql-migration')
      assert.ok(backup && backup.format === 'json', 'a pre-migration copy exists in backups/')
      assert.deepEqual(fs.readFileSync(backup!.path), original, 'and is byte-identical to the file before migration')

      // Counts survive the move (tasks, people, projects, accounts).
      assert.equal(db.scalar('SELECT count(*) FROM tasks'), raw.tasks.length)
      assert.equal(db.scalar('SELECT count(*) FROM people'), raw.people.length)
      assert.equal(db.scalar('SELECT count(*) FROM projects'), raw.projects.length)
      assert.equal(db.scalar('SELECT count(*) FROM users'), 4)

      // What the old normaliser invented is gone; real events are kept; history is re-derived from recorded dates only.
      assert.equal(
        db.scalar(
          "SELECT count(*) FROM work_logs WHERE id LIKE 'wl\\_seed\\_%' ESCAPE '\\' OR id LIKE 'wl\\_activity\\_%' ESCAPE '\\'"
        ),
        0,
        'back-filled rows are gone'
      )
      assert.ok(
        !db.all('PRAGMA table_info(work_logs)').some(column => column.name === 'minutes'),
        'invented effort has no column to live in'
      )
      const realBefore = raw.workLogs.filter((row: any) => /^worklog_/.test(row.id))
      assert.equal(realBefore.length, 4)
      for (const row of realBefore)
        assert.equal(
          db.scalar('SELECT count(*) FROM work_logs WHERE id = ?', [row.id]),
          1,
          `real event ${row.action} kept`
        )
      assert.ok(
        Number(db.scalar('SELECT count(*) FROM work_logs WHERE derived = 1')) > 50,
        'history re-derived from recorded timestamps'
      )
      assert.equal(
        db.scalar("SELECT count(*) FROM work_logs WHERE derived = 1 AND time != '' AND source != 'Activity log'"),
        0,
        'no invented clock times on derived task rows'
      )
      assert.equal(
        db.scalar("SELECT count(DISTINCT task_id) FROM work_logs WHERE action = 'Created task'"),
        db.scalar('SELECT count(*) FROM tasks'),
        'exactly one created event per task'
      )
      assert.equal(
        db.scalar("SELECT count(*) FROM work_logs WHERE action = 'Created task'"),
        db.scalar('SELECT count(*) FROM tasks'),
        'and no duplicates'
      )
      assert.equal(
        db.scalar("SELECT count(*) FROM tasks WHERE key NOT GLOB '[A-Z0-9_-]*-[0-9][0-9][0-9]*'"),
        0,
        'task keys frozen'
      )

      // Settings: roles ranked, only the real translation override survives.
      assert.deepEqual(
        Object.fromEntries(Object.entries<any>(app.ctx.settings.permissions.roles).map(([k, v]) => [k, v.rank])),
        { Administrator: 4, Manager: 3, Developer: 2, Viewer: 1 }
      )
      assert.deepEqual(
        app.ctx.settings.localization.translations,
        { ar: { 'nav.projects': 'مشاريعنا' } },
        'the frozen built-in catalogue is dropped'
      )

      // The import is a good database, and its audit trail records where it came from.
      const checks = runChecks(db)
      assert.deepEqual(checks.errors, [])
      assert.equal(db.get('SELECT action FROM audit_log ORDER BY seq DESC LIMIT 1')?.action, 'system.import.legacy')
      assert.ok(app.repos.meta.legacyImport(), 'the import report is stored in the database')
      assert.equal(app.repos.meta.configured(), true)
    } finally {
      store.close()
    }
  })

  test('is idempotent: reopening neither imports nor snapshots again', () => {
    const { dir } = prepare()
    openStore(dir).close()
    const backups = listBackupsIn(dir).length
    const revision = (() => {
      const db = openDirect(dir, true)
      try {
        return db.revision
      } finally {
        db.close()
      }
    })()
    const again = openStore(dir)
    assert.equal(again.legacy, null)
    assert.equal(again.app.ctx.revision, revision)
    again.close()
    assert.equal(listBackupsIn(dir).length, backups)
  })

  test('legacy password hashes keep working and are upgraded on the next successful sign-in', async () => {
    const { dir } = prepare()
    const server = await launch({ dataDir: dir, keep: true })
    try {
      const res = await new Api(server.url).post('/api/auth/login', {
        email: 'maya@atlas.local',
        password: 'atlas-demo'
      })
      assert.equal(res.status, 200)
      const stored = server.container.repos.users.byEmail('maya@atlas.local')!
      assert.equal(stored.passwordHash.split('$').length, 6, 'rewritten in the parameterised format')
      assert.equal((await verifyPassword('atlas-demo', stored.passwordHash)).needsRehash, false)
    } finally {
      await server.cleanup()
    }
  })

  test('people who were signed in stay signed in', () => {
    const token = crypto.randomBytes(32).toString('base64url')
    const { dir } = prepare()
    const hash = crypto.createHash('sha256').update(token).digest('hex')
    const user = JSON.parse(fs.readFileSync(path.join(dir, 'atlas-store.json'), 'utf8')).users[0]
    fs.writeFileSync(
      path.join(dir, 'sessions.json'),
      JSON.stringify({
        version: 1,
        sessions: {
          [hash]: { userId: user.id, createdAt: Date.now(), lastSeenAt: Date.now() },
          [`${'0'.repeat(63)}1`]: { userId: 'nobody', createdAt: 1, lastSeenAt: 1 }
        }
      })
    )
    const store = openStore(dir)
    try {
      assert.equal(store.legacy!.sessionsImported, 1, 'the session of a missing account is not carried over')
      assert.equal(store.app.sessions.resolve(token, 1e12)?.userId, user.id)
      assert.equal(fs.existsSync(path.join(dir, 'sessions.json')), false)
      assert.ok(fs.readdirSync(dir).some(name => name.startsWith('sessions.json.imported-')))
    } finally {
      store.close()
    }
  })
})

describe('old documents with problems SQL will not accept', () => {
  test('every such row is repaired the least destructive way, listed, and nothing is lost silently', () => {
    const { dir, raw } = prepare(doc => {
      doc.tasks[0].projectId = 999 // its project was deleted
      doc.tasks[1].dueDate = '2026-02-30' // an impossible date
      doc.tasks[2].assigneeId = 'ghost' // an assignee who no longer exists
      doc.projects[1].code = doc.projects[0].code // two projects share a code
      doc.people[0].teamId = 'ghost-team'
      doc.counters.task = 500
      doc.milestones[0].projectId = 999
      doc.alerts[0].taskId = 12345
      doc.users[1].personId = doc.users[0].personId // two accounts share one person profile
    })
    const store = openStore(dir)
    try {
      const { db, app } = store
      const repairs = store.legacy!.report.repairs.join('\n')
      assert.match(repairs, /belonged to a project that does not exist; moved to "Recovered items"/)
      assert.match(repairs, /not a valid date/)
      assert.match(repairs, /assignee who no longer exists/)
      assert.match(repairs, /shared the code/)
      assert.match(repairs, /pointed to a team that does not exist/)
      assert.match(repairs, /shared or lacked a person profile/)

      assert.equal(db.scalar('SELECT count(*) FROM tasks'), raw.tasks.length, 'no task was dropped')
      assert.equal(
        db.scalar('SELECT count(*) FROM projects'),
        raw.projects.length + 1,
        'only the "Recovered items" project was added'
      )
      const recovered = db.get("SELECT id FROM projects WHERE code = 'RECOVERED'")!
      assert.equal(db.get('SELECT project_id FROM tasks WHERE id = ?', [raw.tasks[0].id])?.project_id, recovered.id)
      assert.equal(
        db.get('SELECT project_id FROM milestones WHERE id = ?', [raw.milestones[0].id])?.project_id,
        recovered.id
      )
      assert.equal(db.get('SELECT due_date FROM tasks WHERE id = ?', [raw.tasks[1].id])?.due_date, null)
      assert.equal(db.get('SELECT assignee_id FROM tasks WHERE id = ?', [raw.tasks[2].id])?.assignee_id, null)
      assert.equal(db.get('SELECT team_id FROM people WHERE id = ?', [raw.people[0].id])?.team_id, null)
      assert.equal(db.get('SELECT task_id FROM alerts WHERE id = ?', [raw.alerts[0].id])?.task_id, null)
      assert.equal(
        db.scalar('SELECT count(DISTINCT upper(code)) FROM projects'),
        db.scalar('SELECT count(*) FROM projects'),
        'codes are unique now'
      )
      assert.equal(
        db.scalar('SELECT count(*) FROM users'),
        4,
        'both accounts still exist, only the shared link was cleared'
      )
      assert.deepEqual(runChecks(db).errors, [])

      // Identifiers are never reused: the legacy counter was ahead of the largest id in use.
      assert.equal(app.repos.tasks.nextId(), 500)
    } finally {
      store.close()
    }
  })

  test('a store that cannot be read is never imported and never modified', () => {
    const dir = mkdir()
    const file = path.join(dir, 'atlas-store.json')
    fs.writeFileSync(file, '{"meta": {"schemaVersion": "3.1.0"}, "users": [ {"id": ')
    const before = fs.readFileSync(file)
    assert.throws(() => openDatabase(cfg(dir)), StoreCorruptError)
    assert.deepEqual(fs.readFileSync(file), before, 'file untouched')
    assert.equal(fs.existsSync(path.join(dir, 'atlas.db')), false, 'no database was created from it')
    assert.deepEqual(
      fs.readdirSync(dir).filter(name => name.includes('importing')),
      [],
      'no half-finished import is left behind'
    )
    assert.equal(fs.existsSync(path.join(dir, 'atlas.lock')), false)
  })

  test('a store that is not an object is corrupt too', () => {
    const dir = mkdir()
    fs.writeFileSync(path.join(dir, 'atlas-store.json'), '[]')
    assert.throws(() => openDatabase(cfg(dir)), StoreCorruptError)
  })

  test('a store written by a newer Atlas is refused rather than downgraded', () => {
    const dir = mkdir()
    fs.writeFileSync(
      path.join(dir, 'atlas-store.json'),
      JSON.stringify({ meta: { schemaVersion: '9.0.0' }, users: [] })
    )
    assert.throws(() => openDatabase(cfg(dir)), StoreTooNewError)
    assert.equal(fs.existsSync(path.join(dir, 'atlas.db')), false)
  })
})
