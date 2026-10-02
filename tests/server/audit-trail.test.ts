// The audit trail (SEC-13): hash-chained, append-only by construction, with retention that keeps the chain verifiable.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { createContainer } from '../../server/app/container'
import { CliError, runCommand } from '../../server/cli/commands'
import { loadConfig } from '../../server/config'
import { openDatabase } from '../../server/db/open'
import { chainEntry } from '../../server/domain/audit-chain'
import { openDirect } from '../helpers/db'
import { launch, setupAdmin } from '../helpers/server'

const temp: string[] = []
after(() => temp.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

describe('audit trail integrity (SEC-13)', () => {
  test('entries are hash-chained, and an edited entry is detected even by someone who bypasses the database triggers', async () => {
    const server = await launch()
    try {
      const admin = await setupAdmin(server)
      await admin.post('/api/teams', { name: 'One' })
      await admin.post('/api/teams', { name: 'Two' })
      const ok = (await admin.get('/api/system')).body
      assert.equal(ok.auditChain.ok, true)
      assert.ok(ok.auditChain.checked >= 3)

      // Someone with file access removes the append-only trigger and rewrites an entry.
      const attacker = openDirect(server.dataDir)
      const victim = attacker.get<{ id: string }>('SELECT id FROM audit_log ORDER BY seq LIMIT 1 OFFSET 1')!
      attacker.exec('DROP TRIGGER audit_log_no_update')
      attacker.run(`UPDATE audit_log SET detail = '{"forged":true}' WHERE id = ?`, [victim.id])
      attacker.close()

      await admin.post('/api/teams', { name: 'Three' }) // any write: the chain status is recomputed after each one
      const broken = (await admin.get('/api/system')).body
      assert.equal(broken.auditChain.ok, false)
      assert.equal(broken.auditChain.brokenAt, victim.id)
      assert.equal(broken.ok, false, 'and the overall status turns red')
    } finally {
      await server.cleanup()
    }
  })

  test('the application has no way to edit or remove an entry: the repository only appends', async () => {
    const server = await launch()
    try {
      const audit = server.container.repos.audit as unknown as Record<string, unknown>
      for (const name of ['update', 'delete', 'remove', 'edit', 'set'])
        assert.equal(typeof audit[name], 'undefined', `AuditRepository.${name}`)
      await setupAdmin(server)
      assert.throws(() => server.db.run("UPDATE audit_log SET action = 'x'"), /append-only/)
      assert.throws(() => server.db.run('DELETE FROM audit_log'), /append-only/)
    } finally {
      await server.cleanup()
    }
  })

  test('retention removes the oldest entries and the remaining chain still verifies from the recorded anchor', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-audit-test-'))
    temp.push(dir)
    const config = loadConfig({
      NODE_ENV: 'production',
      ATLAS_DATA_DIR: dir,
      ATLAS_TIMEZONE: 'UTC'
    } as NodeJS.ProcessEnv)
    const opened = openDatabase(config)
    const app = createContainer(config, opened.db)
    try {
      const { audit } = app.repos
      const old = new Date('2001-01-01T00:00:00.000Z')
      app.ctx.transaction(() => {
        let prev = ''
        for (const action of ['old.one', 'old.two']) {
          const entry = chainEntry(prev, action, {}, {}, old)
          audit.append(entry)
          prev = entry.hash!
        }
        app.audit.record('recent.one', {}, {})
        app.audit.record('recent.two', {}, {})
      })
      assert.equal(app.audit.verify().ok, true)
      assert.equal(app.audit.pruneDue(), true)
      const removed = app.ctx.transaction(() => app.audit.prune())
      assert.equal(removed, 2)
      assert.equal(audit.count(), 2)
      assert.ok(app.repos.meta.auditAnchor(), 'the hash of the last removed entry is kept as the anchor')
      const status = app.audit.verify()
      assert.equal(status.ok, true, 'the surviving entries still chain from the anchor')
      assert.equal(status.checked, 2)
      assert.equal(app.audit.pruneDue(), false)
    } finally {
      opened.db.close()
      opened.release?.()
    }
  })

  test('the command-line check reports a broken chain and exits with an error', async () => {
    const server = await launch({ keep: true })
    const dir = server.dataDir
    temp.push(dir)
    const admin = await setupAdmin(server)
    await admin.post('/api/teams', { name: 'One' })
    await server.close()
    const attacker = openDirect(dir)
    attacker.exec('DROP TRIGGER audit_log_no_update')
    attacker.run(`UPDATE audit_log SET actor_id = 'someone-else' WHERE seq = 2`)
    attacker.close()
    const config = loadConfig({
      NODE_ENV: 'production',
      ATLAS_DATA_DIR: dir,
      ATLAS_TIMEZONE: 'UTC'
    } as NodeJS.ProcessEnv)
    const lines: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => void lines.push(args.join(' '))
    try {
      await assert.rejects(
        runCommand(['--check-data'], config),
        (error: any) => error instanceof CliError && error.exitCode === 2
      )
    } finally {
      console.log = original
    }
    assert.match(lines.join('\n'), /hash chain is broken/)
  })
})
