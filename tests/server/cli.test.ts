import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { createContainer } from '../../server/app/container'
import { loadConfig } from '../../server/config'
import { listBackupsIn } from '../../server/db/backup'
import { openDatabase } from '../../server/db/open'
import { CliError, runCommand } from '../../server/index'
import { verifyPassword } from '../../server/security/passwords'
import { Api, PASSWORD, launch, setupAdmin, sleep } from '../helpers/server'

const dirs: string[] = []
const mkdir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cli-test-'))
  dirs.push(dir)
  return dir
}
const cfg = (dir: string, env: Record<string, string> = {}) =>
  loadConfig({ ATLAS_DATA_DIR: dir, ATLAS_TIMEZONE: 'Europe/Amsterdam', ...env } as NodeJS.ProcessEnv)

/** Open the database the way the server does (lock, migrations) and give back the services; `close()` releases it. */
function openStore(config: ReturnType<typeof cfg>) {
  const opened = openDatabase(config)
  const container = createContainer(config, opened.db)
  return {
    db: opened.db,
    container,
    close() {
      opened.db.close()
      opened.release?.()
    }
  }
}
after(() => dirs.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

async function capture(fn: () => Promise<unknown>) {
  const lines: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => void lines.push(args.join(' '))
  try {
    await fn()
  } finally {
    console.log = original
  }
  return lines.join('\n')
}

describe('operations commands report mistyped settings (DATA-03)', () => {
  const warnings = async (argv: string[], config: ReturnType<typeof cfg>) => {
    const lines: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => void lines.push(args.join(' '))
    try {
      const handled = await capture(() => runCommand(argv, config))
      return { lines, handled }
    } finally {
      console.warn = original
    }
  }

  test('a command prints the configuration warning; starting the server leaves that to its banner', async () => {
    const dir = mkdir()
    openStore(cfg(dir)).close()
    const bad = cfg(dir, { ATLAS_BACKUP_RETENTION: 'abc' })
    const command = await warnings(['--list-backups'], bad)
    assert.ok(command.lines.some(line => line.includes('ATLAS_BACKUP_RETENTION')))
    const server = await warnings([], bad)
    assert.deepEqual(server.lines, [], 'no command: nothing printed here, so the banner does not repeat it')
    const quiet = await warnings(['--list-backups'], cfg(dir))
    assert.deepEqual(quiet.lines, [])
  })
})

describe('demo data is gated (SEC-09)', () => {
  test('--reset-data is refused in production and without the explicit flag', async () => {
    const dir = mkdir()
    await assert.rejects(
      runCommand(['--reset-data'], cfg(dir, { NODE_ENV: 'production', ATLAS_ALLOW_DEMO_DATA: 'true' })),
      (e: any) => e instanceof CliError && /production/.test(e.message)
    )
    await assert.rejects(
      runCommand(['--reset-data'], cfg(dir, { NODE_ENV: 'development' })),
      (e: any) => e instanceof CliError && /ATLAS_ALLOW_DEMO_DATA=true/.test(e.message)
    )
    assert.equal(fs.existsSync(path.join(dir, 'atlas.db')), false, 'nothing was written')
  })

  test('ATLAS_ALLOW_DEMO_DATA is ignored (with a warning) under NODE_ENV=production', () => {
    const config = cfg(mkdir(), { NODE_ENV: 'production', ATLAS_ALLOW_DEMO_DATA: 'true' })
    assert.equal(config.allowDemoData, false)
    assert.ok(config.warnings.some(w => w.includes('ATLAS_ALLOW_DEMO_DATA')))
  })

  test('in development the flag loads demo data, snapshots an existing store first, and hashes the demo passwords', async () => {
    const dir = mkdir()
    openStore(cfg(dir)).close()
    const out = await capture(() =>
      runCommand(['--reset-data'], cfg(dir, { NODE_ENV: 'development', ATLAS_ALLOW_DEMO_DATA: 'true' }))
    )
    assert.match(out, /Reset .* with development demo data/)
    const store = openStore(cfg(dir))
    try {
      const { db } = store
      assert.equal(store.container.auth.isConfigured(), true)
      assert.equal(db.scalar('SELECT count(*) FROM tasks'), 54)
      assert.equal(store.container.ctx.settings.workspace.name, 'Northstar')
      assert.equal(
        db.scalar("SELECT count(*) FROM users WHERE sample = 0 OR password_hash NOT LIKE 'scrypt$%'"),
        0,
        'every demo account is flagged as sample data and has a hashed password'
      )
      assert.ok(listBackupsIn(dir).some(b => b.reason === 'pre-reset-data'))
      assert.ok(!db.all('PRAGMA table_info(work_logs)').some(column => column.name === 'minutes'))
    } finally {
      store.close()
    }
  })

  test('demo credentials are only offered by a development server with the flag, never in production', async () => {
    const dev = await launch({ env: { NODE_ENV: 'development', ATLAS_ALLOW_DEMO_DATA: 'true' } })
    const prod = await launch({ env: { NODE_ENV: 'production', ATLAS_ALLOW_DEMO_DATA: 'true' } })
    try {
      const d = (await new Api(dev.url).get('/api/setup/status')).body
      assert.equal(d.demoAllowed, true)
      assert.ok(d.demo.accounts.length === 4)
      const p = (await new Api(prod.url).get('/api/setup/status')).body
      assert.deepEqual(p, { configured: false, tokenRequired: true, demoAllowed: false, demo: null })
    } finally {
      await dev.cleanup()
      await prod.cleanup()
    }
  })

  test('setup with demo data (development) and later demo removal also removes the public demo accounts', async () => {
    const server = await launch({ env: { NODE_ENV: 'development', ATLAS_ALLOW_DEMO_DATA: 'true' } })
    try {
      const admin = await setupAdmin(server, { includeDemo: true })
      assert.ok((await admin.get('/api/bootstrap')).body.tasks.length >= 54)
      assert.equal(
        (await new Api(server.url).post('/api/auth/login', { email: 'maya@atlas.local', password: 'atlas-demo' }))
          .status,
        200
      )
      const removed = await admin.delete('/api/setup/seed')
      assert.equal(removed.status, 200)
      assert.ok(removed.body.accountsRemoved >= 4)
      assert.equal(
        (await new Api(server.url).post('/api/auth/login', { email: 'maya@atlas.local', password: 'atlas-demo' }))
          .status,
        401
      )
      const boot = (await admin.get('/api/bootstrap')).body
      assert.equal(boot.tasks.length, 0)
      assert.equal(boot.user.email, 'admin@example.com')
    } finally {
      await server.cleanup()
    }
  })

  test('demo removal refuses to run when it would leave no real administrator', async () => {
    const dir = mkdir()
    await runCommand(['--reset-data'], cfg(dir, { NODE_ENV: 'development', ATLAS_ALLOW_DEMO_DATA: 'true' }))
    const server = await launch({
      dataDir: dir,
      keep: true,
      env: { NODE_ENV: 'development', ATLAS_ALLOW_DEMO_DATA: 'true' }
    })
    try {
      const maya = new Api(server.url)
      await maya.post('/api/auth/login', { email: 'maya@atlas.local', password: 'atlas-demo' })
      const res = await maya.delete('/api/setup/seed')
      assert.equal(res.status, 409)
      assert.equal(res.body.code, 'NEEDS_REAL_ADMIN')
    } finally {
      await server.cleanup()
    }
  })
})

describe('operations commands', () => {
  test('--init-production wipes only with --yes and always snapshots first', async () => {
    const dir = mkdir()
    const config = cfg(dir, { NODE_ENV: 'production' })
    const seed = openStore(config)
    seed.db.transaction(() => seed.container.repos.meta.setConfigured(true))
    seed.close()
    await assert.rejects(
      runCommand(['--init-production'], config),
      (e: any) => e instanceof CliError && /--yes/.test(e.message)
    )
    const probe = openStore(config)
    assert.equal(probe.container.auth.isConfigured(), true)
    probe.close()
    await runCommand(['--init-production', '--yes'], config)
    const store = openStore(config)
    assert.equal(store.container.auth.isConfigured(), false)
    assert.ok(listBackupsIn(dir).some(b => b.reason === 'pre-init-production'))
    store.close()
  })

  test('--reset-admin-password recovers a locked-out account, ends its sessions and forces a new password', async () => {
    const server = await launch({ keep: true })
    const admin = await setupAdmin(server)
    const dir = server.dataDir
    const cookie = admin.cookie
    await sleep(450)
    await server.close()
    const config = cfg(dir, { NODE_ENV: 'production' })
    const out = await capture(() =>
      runCommand(['--reset-admin-password', '--email', 'ADMIN@example.com', '--activate'], config)
    )
    const temp = /Temporary password \(shown once\): (\S+)/.exec(out)?.[1]
    assert.ok(temp && temp.length >= 12)
    const store = openStore(config)
    try {
      const user = store.container.repos.users.list()[0]
      assert.equal(user.mustChangePassword, true)
      assert.equal((await verifyPassword(temp!, user.passwordHash)).ok, true)
      assert.equal((await verifyPassword(PASSWORD, user.passwordHash)).ok, false)
      assert.ok(store.db.all("SELECT 1 FROM audit_log WHERE action = 'user.password.reset.cli'").length > 0)
      assert.equal(store.container.sessions.resolve(cookie.split('=')[1], 1e12), null, 'old session no longer valid')
    } finally {
      store.close()
    }
    await assert.rejects(runCommand(['--reset-admin-password', '--email', 'nobody@example.com'], config), CliError)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('--check-data validates, --list-backups lists, --backup-data copies', async () => {
    const dir = mkdir()
    const config = cfg(dir)
    openStore(config).close()
    assert.match(await capture(() => runCommand(['--check-data'], config)), /OK/)
    assert.match(await capture(() => runCommand(['--backup-data'], config)), /Created backup/)
    assert.match(await capture(() => runCommand(['--list-backups'], config)), /manual/)
    fs.writeFileSync(path.join(dir, 'atlas.db'), 'garbage')
    await assert.rejects(runCommand(['--check-data'], config), CliError)
  })

  test('--restore reports clearly when there is nothing to restore', async () => {
    await assert.rejects(
      runCommand(['--restore', 'latest'], cfg(mkdir())),
      (e: any) => e instanceof CliError && /Restore failed/.test(e.message)
    )
    await assert.rejects(runCommand(['--restore'], cfg(mkdir())), CliError)
  })
})
