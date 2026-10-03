// The SQL engine itself: the driver's guarantees, what the schema enforces, how the database opens (and refuses to open),
// how migrations are applied, and that a failed write changes nothing. These are the properties the old JSON store
// promised, restated for SQLite, plus the ones SQL makes possible.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { createContainer } from '../../server/app/container'
import { loadConfig } from '../../server/config'
import { createBackup, listBackupsIn } from '../../server/db/backup'
import { createDatabaseFile } from '../../server/db/create'
import { Database, classifySqlError } from '../../server/db/driver'
import {
  SchemaMismatchError,
  StoreCorruptError,
  StoreLockedError,
  StoreMissingError,
  StoreTooNewError
} from '../../server/db/errors'
import { openDatabase } from '../../server/db/open'
import { MIGRATIONS, type Migration } from '../../server/db/migrations'
import { inspectMigrations } from '../../server/db/migrator'
import { Api, launch, setupAdmin } from '../helpers/server'

const temp: string[] = []
const mkdir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-db-test-'))
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

/** A fully migrated throw-away database. */
function scratch() {
  const dir = mkdir()
  return { dir, db: createDatabaseFile(path.join(dir, 'scratch.db'), { defaultTimezone: 'UTC' }) }
}
const team = (id: string) => ({ id, name: `Team ${id}` })

describe('driver guarantees', () => {
  test('values are bound, never interpolated; booleans become 0/1 and undefined becomes NULL', () => {
    const { db } = scratch()
    const hostile = "x'); DROP TABLE teams; --"
    db.run('INSERT INTO teams(id, name, sample) VALUES (?, ?, ?)', ['t1', hostile, true])
    db.run('INSERT INTO teams(id, name, sample) VALUES (?, ?, ?)', ['t2', 'Plain', false])
    assert.equal(db.get('SELECT name FROM teams WHERE id = ?', ['t1'])?.name, hostile)
    assert.equal(db.scalar('SELECT sample FROM teams WHERE id = ?', ['t1']), 1)
    assert.equal(db.scalar('SELECT sample FROM teams WHERE id = ?', ['t2']), 0)
    db.run('INSERT INTO people(id, name, team_id) VALUES (?, ?, ?)', ['p1', 'Pat', undefined])
    assert.equal(db.get('SELECT team_id FROM people WHERE id = ?', ['p1'])?.team_id, null)
    assert.equal(db.run('INSERT INTO people(id, name) VALUES (:id, :name)', { id: 'p2', name: 'Named' }).changes, 1)
    db.close()
  })

  test('a transaction commits all of its changes or none of them', () => {
    const { db } = scratch()
    assert.throws(
      () =>
        db.transaction(() => {
          db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['a', 'Alpha'])
          throw new TypeError('boom')
        }),
      TypeError
    )
    assert.equal(db.scalar('SELECT count(*) FROM teams'), 0, 'nothing from the failed transaction survived')
    db.transaction(() => db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['b', 'Beta']))
    assert.equal(db.scalar('SELECT count(*) FROM teams'), 1)
    // a constraint violation half-way through also undoes the earlier statements of the same transaction
    assert.throws(() =>
      db.transaction(() => {
        db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['c', 'Gamma'])
        db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['b', 'Duplicate id'])
      })
    )
    assert.deepEqual(
      db.all('SELECT id FROM teams ORDER BY id').map(row => row.id),
      ['b']
    )
    db.close()
  })

  test('nested transactions are savepoints: an inner failure undoes only the inner work', () => {
    const { db } = scratch()
    db.transaction(() => {
      db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['outer', 'Outer'])
      assert.throws(() =>
        db.transaction(() => {
          db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['inner', 'Inner'])
          throw new Error('inner failed')
        })
      )
      assert.equal(db.inTransaction, true, 'the outer transaction is still open')
    })
    assert.deepEqual(
      db.all('SELECT id FROM teams').map(row => row.id),
      ['outer']
    )
    db.close()
  })

  test('the revision advances once per committed write, and never for reads or quiet housekeeping', () => {
    const { db } = scratch()
    const start = db.revision
    db.transaction(() => db.scalar('SELECT count(*) FROM teams'))
    assert.equal(db.revision, start, 'a read-only transaction does not advance it')
    db.transaction(() => {
      db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['a', 'A'])
      db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['b', 'B'])
    })
    assert.equal(db.revision, start + 1, 'two statements, one committed write, one step')
    db.transaction(() => db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['c', 'C']), { revision: false })
    assert.equal(db.revision, start + 1, 'housekeeping (sessions, audit batches) is not a change to the workspace')
    assert.throws(() =>
      db.transaction(() => (db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['d', 'D']), assert.fail('no')))
    )
    assert.equal(db.revision, start + 1, 'a rolled-back transaction does not advance it either')
    db.close()
  })

  test('failures are classified so a bad request can be told from a bad disk', () => {
    const { db } = scratch()
    const caught = (fn: () => unknown) => {
      try {
        fn()
      } catch (error) {
        return classifySqlError(error)
      }
      return 'none'
    }
    db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['a', 'A'])
    assert.equal(
      caught(() => db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['a', 'again'])),
      'unique'
    )
    assert.equal(
      caught(() => db.run('INSERT INTO people(id, name, team_id) VALUES (?, ?, ?)', ['p', 'P', 'missing'])),
      'foreign-key'
    )
    assert.equal(
      caught(() => db.run('INSERT INTO people(id, name, capacity) VALUES (?, ?, ?)', ['q', 'Q', 500])),
      'check'
    )
    db.exec('PRAGMA query_only = ON')
    assert.equal(
      caught(() => db.run('INSERT INTO teams(id, name) VALUES (?, ?)', ['b', 'B'])),
      'readonly'
    )
    db.exec('PRAGMA query_only = OFF')
    assert.equal(classifySqlError(new Error('not from SQLite')), 'other')
    db.close()
  })

  test('rows can be streamed one at a time', () => {
    const { db } = scratch()
    db.transaction(() => {
      for (let i = 0; i < 50; i++) db.run('INSERT INTO teams(id, name) VALUES (?, ?)', [`t${i}`, `T${i}`])
    })
    let seen = 0
    for (const row of db.iterate('SELECT id FROM teams ORDER BY rowid')) assert.equal(row.id, `t${seen++}`)
    assert.equal(seen, 50)
    db.close()
  })
})

describe('what the schema enforces on its own', () => {
  test('STRICT tables refuse a value of the wrong type', () => {
    const { db } = scratch()
    assert.throws(
      () => db.run('INSERT INTO people(id, name, capacity) VALUES (?, ?, ?)', ['p', 'P', 'lots']),
      /cannot store TEXT value|datatype mismatch|CHECK/i
    )
    db.close()
  })

  test('CHECK constraints refuse impossible dates, malformed JSON and out-of-range values', () => {
    const { db } = scratch()
    db.run('INSERT INTO projects(name, code, created_at) VALUES (?, ?, ?)', ['P', 'PRJ', '2026-01-01'])
    const bad = (sql: string, params: any[]) => assert.throws(() => db.run(sql, params), /CHECK constraint failed/, sql)
    bad('INSERT INTO projects(name, code, created_at, deadline) VALUES (?, ?, ?, ?)', [
      'A',
      'AAA',
      '2026-01-01',
      '2026-02-30'
    ])
    bad('INSERT INTO projects(name, code, created_at, custom_fields) VALUES (?, ?, ?, ?)', [
      'B',
      'BBB',
      '2026-01-01',
      '{not json'
    ])
    bad('INSERT INTO projects(name, code, created_at, custom_fields) VALUES (?, ?, ?, ?)', [
      'C',
      'CCC',
      '2026-01-01',
      '[1,2]'
    ])
    bad('INSERT INTO tasks(key, title, project_id, status, created_at, blocked) VALUES (?, ?, ?, ?, ?, ?)', [
      'K-1',
      'T',
      1,
      'To do',
      '2026-01-01',
      2
    ])
    bad('INSERT INTO people(id, name, capacity) VALUES (?, ?, ?)', ['p', 'P', 101])
    assert.throws(
      () => db.run('INSERT INTO projects(name, code, created_at) VALUES (?, ?, ?)', ['Dup', 'prj', '2026-01-01']),
      /UNIQUE/,
      'project codes are unique regardless of case'
    )
    db.close()
  })

  test('deleting a project removes its tasks, milestones and alerts; deleting a person un-assigns; deleting a task keeps its alerts', () => {
    const { db } = scratch()
    db.run("INSERT INTO teams(id, name) VALUES ('t', 'T')")
    db.run("INSERT INTO people(id, name, team_id) VALUES ('p', 'Pat', 't')")
    db.run(
      "INSERT INTO projects(name, code, created_at, owner_id, team_id) VALUES ('One', 'ONE', '2026-01-01', 'p', 't')"
    )
    db.run("INSERT INTO projects(name, code, created_at) VALUES ('Two', 'TWO', '2026-01-01')")
    const task = (key: string, project: number, assignee: string | null) =>
      db.run(
        "INSERT INTO tasks(key, title, project_id, assignee_id, status, created_at) VALUES (?, ?, ?, ?, 'To do', '2026-01-01')",
        [key, key, project, assignee]
      ).lastInsertRowid
    const t1 = task('ONE-1', 1, 'p')
    const t2 = task('TWO-1', 2, 'p')
    db.run("INSERT INTO milestones(id, name, project_id) VALUES ('m1', 'M', 1)")
    db.run(
      "INSERT INTO alerts(id, title, project_id, task_id, created_at) VALUES ('a-task', 'about a task', 2, ?, '2026-01-01')",
      [t2]
    )
    db.run(
      "INSERT INTO alerts(id, title, project_id, created_at) VALUES ('a-project', 'about project one', 1, '2026-01-01')"
    )

    // a person is deleted: tasks are un-assigned and the project loses its owner; nothing else is touched
    assert.throws(
      () => db.run("DELETE FROM teams WHERE id = 't'"),
      /FOREIGN KEY/,
      'a team with people cannot be deleted'
    )
    db.run("DELETE FROM people WHERE id = 'p'")
    assert.equal(db.get('SELECT assignee_id FROM tasks WHERE id = ?', [t1])?.assignee_id, null)
    assert.equal(db.get('SELECT owner_id FROM projects WHERE id = 1')?.owner_id, null)

    // a task is deleted: its alert stays, without the reference
    db.run('DELETE FROM tasks WHERE id = ?', [t2])
    assert.equal(db.get("SELECT task_id FROM alerts WHERE id = 'a-task'")?.task_id, null)

    // a project is deleted: everything that belongs to it goes with it
    db.run('DELETE FROM projects WHERE id = 1')
    assert.equal(db.scalar('SELECT count(*) FROM tasks WHERE project_id = 1'), 0)
    assert.equal(db.scalar("SELECT count(*) FROM milestones WHERE id = 'm1'"), 0)
    assert.equal(db.scalar("SELECT count(*) FROM alerts WHERE id = 'a-project'"), 0)
    assert.equal(
      db.scalar("SELECT count(*) FROM alerts WHERE id = 'a-task'"),
      1,
      'an alert of another project is untouched'
    )
    db.close()
  })

  test('identifiers are never reused after a deletion', () => {
    const { db } = scratch()
    db.run("INSERT INTO projects(name, code, created_at) VALUES ('One', 'ONE', '2026-01-01')")
    const a = db.run(
      "INSERT INTO tasks(key, title, project_id, status, created_at) VALUES ('K', 'a', 1, 'To do', '2026-01-01')"
    ).lastInsertRowid
    db.run('DELETE FROM tasks WHERE id = ?', [a])
    const b = db.run(
      "INSERT INTO tasks(key, title, project_id, status, created_at) VALUES ('K', 'b', 1, 'To do', '2026-01-01')"
    ).lastInsertRowid
    assert.ok(b > a, `task ${b} must not reuse ${a}`)
    db.close()
  })

  test('the audit trail is append-only: rows cannot be edited or deleted, even by mistake', () => {
    const { db } = scratch()
    db.run("INSERT INTO audit_log(id, action, created_at) VALUES ('a1', 'test.one', '2026-01-01T00:00:00.000Z')")
    assert.throws(() => db.run("UPDATE audit_log SET action = 'forged' WHERE id = 'a1'"), /append-only/)
    assert.throws(() => db.run("DELETE FROM audit_log WHERE id = 'a1'"), /append-only/)
    assert.equal(db.scalar('SELECT count(*) FROM audit_log'), 1)
    db.close()
  })

  test('the export views join names onto ids and never expose a password hash', () => {
    const { db } = scratch()
    db.run("INSERT INTO teams(id, name) VALUES ('t', 'Platform')")
    db.run("INSERT INTO people(id, name, team_id) VALUES ('p', 'Pat', 't')")
    db.run(
      "INSERT INTO users(id, name, email, password_hash, person_id, created_at) VALUES ('u', 'Pat', 'pat@example.com', 'scrypt$secret', 'p', '2026-01-01')"
    )
    db.run(
      "INSERT INTO projects(name, code, created_at, team_id, owner_id) VALUES ('Alpha', 'ALP', '2026-01-01', 't', 'p')"
    )
    db.run(
      "INSERT INTO tasks(key, title, project_id, assignee_id, status, created_at) VALUES ('ALP-001', 'Ship', 1, 'p', 'To do', '2026-01-01')"
    )
    const task = db.get('SELECT * FROM v_task_rows')!
    assert.equal(task.project_name, 'Alpha')
    assert.equal(task.assignee_name, 'Pat')
    assert.equal(task.team_name, 'Platform')
    const views = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'view'").map(row => row.name)
    assert.ok(views.length >= 7)
    for (const view of views) {
      const columns = db.all<{ name: string }>(`PRAGMA table_info(${view})`).map(column => column.name)
      assert.ok(!columns.includes('password_hash'), `${view} exposes ${columns.join(', ')}`)
      assert.ok(!JSON.stringify(db.all(`SELECT * FROM ${view}`)).includes('scrypt$secret'), `${view} leaked a hash`)
    }
    db.close()
  })

  test('the full-text index follows inserts, edits and deletes', () => {
    const { db } = scratch()
    db.run("INSERT INTO projects(name, code, created_at) VALUES ('Alpha', 'ALP', '2026-01-01')")
    const id = db.run(
      "INSERT INTO tasks(key, title, project_id, status, created_at) VALUES ('ALP-001', 'Reconcile invoices', 1, 'To do', '2026-01-01')"
    ).lastInsertRowid
    const hits = (q: string) => db.all('SELECT rowid FROM task_search WHERE task_search MATCH ?', [q]).length
    assert.equal(hits('"reconc"*'), 1, 'prefix search finds the new task')
    db.run('UPDATE tasks SET title = ? WHERE id = ?', ['Pay suppliers', id])
    assert.equal(hits('"reconc"*'), 0, 'the old words are gone after an edit')
    assert.equal(hits('"suppl"*'), 1)
    db.run('DELETE FROM tasks WHERE id = ?', [id])
    assert.equal(hits('"suppl"*'), 0, 'and gone after a delete')
    db.close()
  })
})

describe('opening the database', () => {
  test('a new directory gets a private layout and an unconfigured workspace', () => {
    const dir = path.join(mkdir(), 'nested', 'data')
    const opened = openDatabase(cfg(dir))
    try {
      assert.equal(opened.created, true)
      assert.equal(createContainer(cfg(dir), opened.db).auth.isConfigured(), false)
      assert.equal((fs.statSync(dir).mode & 0o777).toString(8), '700')
      for (const name of ['atlas.db', 'atlas.db-wal', 'atlas.db-shm'])
        if (fs.existsSync(path.join(dir, name)))
          assert.equal((fs.statSync(path.join(dir, name)).mode & 0o777).toString(8), '600', name)
      assert.equal(opened.db.pragma('journal_mode'), 'wal')
      assert.equal(opened.db.pragma('foreign_keys'), 1)
      assert.equal(opened.db.pragma('synchronous'), 2, 'FULL: a committed change has reached the disk')
      assert.equal(opened.db.pragma('user_version'), MIGRATIONS.at(-1)!.version)
    } finally {
      opened.db.close()
      opened.release?.()
    }
    assert.equal(fs.existsSync(path.join(dir, 'atlas.lock')), false, 'the lock is released on close')
  })

  test('a damaged file stops the server and is never replaced or modified', () => {
    const dir = mkdir()
    const file = path.join(dir, 'atlas.db')
    fs.writeFileSync(file, Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(4000, 7)]))
    const before = fs.readFileSync(file)
    assert.throws(() => openDatabase(cfg(dir)), StoreCorruptError)
    assert.deepEqual(fs.readFileSync(file), before, 'the file is exactly as it was')
    assert.equal(fs.existsSync(path.join(dir, 'atlas.lock')), false, 'lock released after the failure')
    assert.deepEqual(
      fs.readdirSync(dir).filter(name => /corrupt|\.new|\.tmp/.test(name)),
      []
    )
  })

  test('a SQLite file that is not an Atlas database is refused', () => {
    const dir = mkdir()
    const stranger = new Database(path.join(dir, 'atlas.db'))
    stranger.exec("CREATE TABLE notes(x TEXT); INSERT INTO notes VALUES ('someone else')")
    stranger.close()
    assert.throws(
      () => openDatabase(cfg(dir)),
      (error: any) => error instanceof StoreCorruptError && /not an Atlas database/.test(error.message)
    )
  })

  test('a database written by a newer Atlas is refused rather than downgraded', () => {
    const dir = mkdir()
    createDatabaseFile(path.join(dir, 'atlas.db'), { defaultTimezone: 'UTC' }).close()
    const db = new Database(path.join(dir, 'atlas.db'))
    db.run(
      "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (99, 'from the future', 'x', 'now')"
    )
    db.close()
    assert.throws(() => openDatabase(cfg(dir)), StoreTooNewError)
    assert.equal(fs.existsSync(path.join(dir, 'atlas.lock')), false)
  })

  test('a missing database next to existing backups does not silently start an empty (claimable) workspace', () => {
    const dir = mkdir()
    const first = openDatabase(cfg(dir))
    createBackup(cfg(dir), first.db, 'manual')
    first.db.close()
    first.release?.()
    fs.rmSync(path.join(dir, 'atlas.db'))
    for (const suffix of ['-wal', '-shm']) fs.rmSync(path.join(dir, `atlas.db${suffix}`), { force: true })
    assert.throws(() => openDatabase(cfg(dir)), StoreMissingError)
    const forced = openDatabase(cfg(dir), { allowFresh: true })
    assert.equal(createContainer(cfg(dir), forced.db).auth.isConfigured(), false)
    forced.db.close()
    forced.release?.()
  })

  test('an empty file left by an interrupted first start is treated as no database at all', () => {
    const dir = mkdir()
    fs.writeFileSync(path.join(dir, 'atlas.db'), '')
    const opened = openDatabase(cfg(dir))
    assert.equal(opened.created, true)
    opened.db.close()
    opened.release?.()
  })

  test('a second process cannot open the same data directory (single writer)', () => {
    const dir = mkdir()
    const first = openDatabase(cfg(dir))
    assert.throws(() => openDatabase(cfg(dir)), StoreLockedError)
    first.db.close()
    first.release?.()
    const again = openDatabase(cfg(dir))
    again.db.close()
    again.release?.()
  })

  test('a lock left behind by a dead process is taken over', () => {
    const dir = mkdir()
    fs.writeFileSync(
      path.join(dir, 'atlas.lock'),
      JSON.stringify({ pid: 2_999_999, hostname: os.hostname(), startedAt: new Date().toISOString(), token: 'x' })
    )
    const opened = openDatabase(cfg(dir))
    opened.db.close()
    opened.release?.()
  })

  test('a lock held by a live process on another machine is respected', () => {
    const dir = mkdir()
    fs.writeFileSync(
      path.join(dir, 'atlas.lock'),
      JSON.stringify({ pid: process.pid, hostname: 'some-other-host', startedAt: new Date().toISOString(), token: 'x' })
    )
    assert.throws(() => openDatabase(cfg(dir)), StoreLockedError)
  })

  test('stored settings are repaired on open so a damaged document cannot break a request', () => {
    const dir = mkdir()
    const first = openDatabase(cfg(dir))
    first.db.run(
      "UPDATE settings SET document = json_set(document, '$.workspace.defaultTimezone', 'Not/AZone', '$.interface.theme', 'neon')"
    )
    first.db.close()
    first.release?.()
    const again = openDatabase(cfg(dir))
    const settings = createContainer(cfg(dir), again.db).ctx.settings
    assert.equal(settings.interface.theme, 'light')
    assert.notEqual(settings.workspace.defaultTimezone, 'Not/AZone')
    again.db.close()
    again.release?.()
  })
})

describe('schema migrations', () => {
  // The migrations under test are injected after the last real one, so these tests stay valid as the schema grows.
  const shipped = MIGRATIONS.at(-1)!.version
  const next = shipped + 1
  const second: Migration = {
    version: next,
    name: 'add a note column to teams',
    sql: 'ALTER TABLE teams ADD COLUMN note TEXT'
  }
  const history = [...MIGRATIONS, second]

  test('a pending migration is applied after a snapshot of the old database, and recorded', () => {
    const dir = mkdir()
    const first = openDatabase(cfg(dir))
    first.db.run("INSERT INTO teams(id, name) VALUES ('keep', 'Keep me')")
    first.db.close()
    first.release?.()
    const upgraded = openDatabase(cfg(dir), { migrations: history })
    try {
      assert.deepEqual(upgraded.migrated, [next])
      assert.equal(upgraded.db.pragma('user_version'), next)
      assert.equal(
        upgraded.db.get("SELECT note FROM teams WHERE id = 'keep'")?.note,
        null,
        'the new column exists and old rows survive'
      )
      const backup = listBackupsIn(dir).find(b => b.reason === 'pre-migration')
      assert.ok(backup, 'a pre-migration snapshot exists')
      const snapshot = new Database(backup!.path, { readOnly: true })
      assert.equal(snapshot.pragma('user_version'), shipped, 'and it holds the schema from before the migration')
      assert.throws(() => snapshot.get('SELECT note FROM teams'), /no such column/)
      snapshot.close()
    } finally {
      upgraded.db.close()
      upgraded.release?.()
    }
    // reopening is idempotent: nothing is applied or snapshotted again
    const backups = listBackupsIn(dir).length
    const again = openDatabase(cfg(dir), { migrations: history })
    assert.deepEqual(again.migrated, [])
    assert.equal(listBackupsIn(dir).length, backups)
    again.db.close()
    again.release?.()
  })

  test('a failed migration changes nothing', () => {
    const dir = mkdir()
    openDatabase(cfg(dir)).db.close()
    const broken: Migration = {
      version: next,
      name: 'half works',
      sql: 'ALTER TABLE teams ADD COLUMN ok TEXT; ALTER TABLE nowhere ADD COLUMN nope TEXT'
    }
    assert.throws(() => openDatabase(cfg(dir), { migrations: [...MIGRATIONS, broken] }))
    const db = new Database(path.join(dir, 'atlas.db'), { readOnly: true })
    assert.equal(db.pragma('user_version'), shipped)
    assert.ok(
      !db.all('PRAGMA table_info(teams)').some(column => column.name === 'ok'),
      'the first statement was rolled back with the second'
    )
    db.close()
  })

  test('a released migration that was edited afterwards is detected and the database is refused', () => {
    const { db } = scratch()
    const edited = MIGRATIONS.map(migration => ({ ...migration, sql: migration.sql + '\n-- edited after release' }))
    assert.throws(() => inspectMigrations(db, db.file, edited), SchemaMismatchError)
    db.close()
  })
})

describe('a failed write changes nothing', () => {
  test('when the disk refuses the write the change is rolled back, reported as 503, and health goes red until the next success', () => {
    const dir = mkdir()
    const opened = openDatabase(cfg(dir))
    const app = createContainer(cfg(dir), opened.db)
    try {
      app.ctx.transaction(() => app.repos.teams.insert({ id: 't1', name: 'Alpha', color: 'blue' }))
      opened.db.exec('PRAGMA query_only = ON') // every write now fails the way a read-only or full disk does
      assert.throws(
        () => app.ctx.transaction(() => app.repos.teams.insert({ id: 't2', name: 'Beta', color: 'red' })),
        (error: any) => error.status === 503 && error.code === 'STORAGE_UNAVAILABLE'
      )
      assert.deepEqual(
        app.repos.teams.list().map(t => t.id),
        ['t1']
      )
      assert.equal(app.system.health().writable, false)
      opened.db.exec('PRAGMA query_only = OFF')
      app.ctx.transaction(() => app.repos.teams.insert({ id: 't3', name: 'Gamma', color: 'green' }))
      assert.equal(app.system.health().writable, true)
      assert.deepEqual(
        app.repos.teams.list().map(t => t.id),
        ['t1', 't3']
      )
    } finally {
      opened.db.close()
      opened.release?.()
    }
  })

  test('a mutation that fails half-way leaves neither rows nor a stale settings cache behind', () => {
    const dir = mkdir()
    const opened = openDatabase(cfg(dir))
    const app = createContainer(cfg(dir), opened.db)
    try {
      const before = app.ctx.settings.workspace.name
      assert.throws(() =>
        app.ctx.transaction(() => {
          app.repos.teams.insert({ id: 'half', name: 'Half', color: 'blue' })
          app.repos.settings.save({
            ...app.ctx.settings,
            workspace: { ...app.ctx.settings.workspace, name: 'Changed' }
          })
          assert.equal(app.ctx.settings.workspace.name, 'Changed', 'visible inside the transaction')
          throw new TypeError('boom')
        })
      )
      assert.equal(app.repos.teams.list().length, 0)
      assert.equal(
        app.ctx.settings.workspace.name,
        before,
        'the cached settings were dropped with the rolled-back change'
      )
    } finally {
      opened.db.close()
      opened.release?.()
    }
  })

  test('over HTTP a failed write is a clear 503 JSON error and the list is unchanged', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      server.db.exec('PRAGMA query_only = ON')
      const res = await admin.post('/api/projects', { name: 'Never saved', code: 'NVR' })
      assert.equal(res.status, 503)
      assert.equal(res.body.code, 'STORAGE_UNAVAILABLE')
      assert.equal((await new Api(server.url).get('/api/health')).status, 503, 'health reflects the storage failure')
      server.db.exec('PRAGMA query_only = OFF')
      assert.ok(!(await admin.get('/api/bootstrap')).body.projects.some((p: any) => p.code === 'NVR'))
      assert.equal((await admin.post('/api/projects', { name: 'Saved now', code: 'SVD' })).status, 200)
      assert.equal((await new Api(server.url).get('/api/health')).status, 200)
    } finally {
      await server.cleanup()
    }
  })

  test('concurrent writers cannot interleave: every change lands and the database stays intact', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      const results = await Promise.all(
        Array.from({ length: 25 }, (_, i) => admin.post('/api/teams', { name: `Team ${i}` }))
      )
      assert.ok(results.every(res => res.status === 200))
      assert.equal(server.db.scalar("SELECT count(*) FROM teams WHERE name LIKE 'Team %'"), 25)
      assert.equal(server.db.pragma('integrity_check'), 'ok')
    } finally {
      await server.cleanup()
    }
  })
})
