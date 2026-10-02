// Acceptance tests for the BUILT application: `npm run build` first, then `npm run test:acceptance`.
// Unlike the unit/integration suites (which start the server in-process from source), these spawn the production bundle
// as a separate process, exactly as `npm start` and the desktop app do, and exercise the failure modes that matter.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { bundle, root, runCli, skip, start, tmp, web } from '../helpers/bundle'
import { Api, PASSWORD, SETUP_TOKEN } from '../helpers/server'

describe('production bundle', { skip }, () => {
  test('serves the app with security headers, a working PWA shell, SPA routing and proper 404s', async () => {
    const server = await start(tmp('serve'))
    try {
      const index = await fetch(server.base)
      const html = await index.text()
      assert.equal(index.status, 200)
      assert.match(html, /<div id="root"><\/div>/)
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline scripts, so the strict CSP holds')
      assert.match(index.headers.get('content-security-policy') || '', /script-src 'self' blob:/)
      assert.equal(index.headers.get('cache-control'), 'no-cache')
      for (const asset of [
        '/sw.js',
        '/manifest.webmanifest',
        '/offline.html',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
        '/icons/icon-maskable-512.png',
        '/atlas-icon.svg'
      ])
        assert.equal((await fetch(server.base + asset)).status, 200, asset)
      const manifest = await (await fetch(`${server.base}/manifest.webmanifest`)).json()
      assert.ok(manifest.icons.some((i: any) => i.sizes === '512x512' && i.purpose === 'maskable'))
      assert.equal((await fetch(`${server.base}/projects`)).status, 200, 'client-side routes fall back to the app')
      const missing = await fetch(`${server.base}/assets/does-not-exist.js`)
      assert.equal(missing.status, 404, 'a missing asset is a 404, not the HTML page')
      assert.doesNotMatch(await missing.text(), /<div id="root">/, 'and it is not the application shell')
      const api = await fetch(`${server.base}/api/nope`)
      assert.ok([401, 404].includes(api.status))
      assert.match(api.headers.get('content-type') || '', /json/)
      const jsAsset = html.match(/src="(\/assets\/[^"]+\.js)"/)![1]
      assert.match((await fetch(server.base + jsAsset)).headers.get('cache-control') || '', /immutable/)
    } finally {
      await server.stop()
    }
  })

  test('first run: the setup token is required and printed once; after setup the workspace cannot be taken over', async () => {
    const dir = tmp('setup')
    const server = await start(dir)
    try {
      assert.match(server.logs(), new RegExp(SETUP_TOKEN))
      const api = new Api(server.base)
      assert.equal((await api.get('/api/setup/status')).body.demoAllowed, false)
      assert.equal(
        (await api.post('/api/setup', { name: 'A', email: 'a@example.com', password: PASSWORD })).status,
        403
      )
      assert.equal(
        (
          await api.post('/api/setup', {
            name: 'Ada',
            email: 'ada@example.com',
            password: PASSWORD,
            token: SETUP_TOKEN
          })
        ).status,
        200
      )
      const attacker = new Api(server.base)
      assert.equal(
        (
          await attacker.post('/api/setup', {
            name: 'Eve',
            email: 'eve@example.com',
            password: PASSWORD,
            token: SETUP_TOKEN
          })
        ).status,
        409
      )
      assert.equal((await api.get('/api/bootstrap')).body.user.email, 'ada@example.com')
      await server.stop()
      const second = await start(dir)
      try {
        assert.doesNotMatch(
          second.logs(),
          new RegExp(SETUP_TOKEN),
          'the token is not printed for a configured workspace'
        )
      } finally {
        await second.stop()
      }
    } finally {
      await server.stop()
    }
  })

  test('data survives restarts, is protected from a second process, and shuts down cleanly', async () => {
    const dir = tmp('persist')
    const first = await start(dir)
    const api = new Api(first.base)
    await api.post('/api/setup', { name: 'Ada', email: 'ada@example.com', password: PASSWORD, token: SETUP_TOKEN })
    const project = (await api.post('/api/projects', { name: 'Persisted', code: 'PER' })).body
    for (let i = 0; i < 5; i++) await api.post('/api/tasks', { title: `Task ${i}`, projectId: project.numericId })
    // a second process on the same data directory must refuse to start
    await assert.rejects(start(dir), (error: any) => error.exitCode === 1 && /already using/.test(error.logs))
    assert.ok(fs.existsSync(path.join(dir, 'atlas.lock')))
    assert.equal(await first.stop('SIGTERM'), 0)
    assert.equal(fs.existsSync(path.join(dir, 'atlas.lock')), false, 'the lock is released on shutdown')
    const again = await start(dir)
    try {
      const api2 = new Api(again.base)
      assert.equal(
        (await api2.post('/api/auth/login', { email: 'ada@example.com', password: PASSWORD })).status,
        200,
        'sessions and accounts survive'
      )
      assert.equal((await api2.get('/api/bootstrap')).body.tasks.length, 5)
    } finally {
      await again.stop()
    }
  })

  test('a crashed process (SIGKILL) leaves a recoverable store and a stale lock that the next start recovers from', async () => {
    const dir = tmp('crash')
    const first = await start(dir)
    const api = new Api(first.base)
    await api.post('/api/setup', { name: 'Ada', email: 'ada@example.com', password: PASSWORD, token: SETUP_TOKEN })
    const project = (await api.post('/api/projects', { name: 'Crashy', code: 'CRS' })).body
    for (let i = 0; i < 20; i++) await api.post('/api/tasks', { title: `T${i}`, projectId: project.numericId })
    await first.stop('SIGKILL')
    assert.ok(fs.existsSync(path.join(dir, 'atlas.lock')), 'a killed process cannot clean up its lock')
    const store = JSON.parse(fs.readFileSync(path.join(dir, 'atlas-store.json'), 'utf8'))
    assert.equal(store.tasks.length, 20, 'every acknowledged write is on disk and the file is complete JSON')
    const again = await start(dir)
    try {
      assert.equal((await new Api(again.base).get('/api/health')).status, 200)
    } finally {
      await again.stop()
    }
  })

  test('a damaged data file stops the server with instructions, is never replaced, and can be restored from a backup', async () => {
    const dir = tmp('corrupt')
    const first = await start(dir)
    const api = new Api(first.base)
    await api.post('/api/setup', { name: 'Ada', email: 'ada@example.com', password: PASSWORD, token: SETUP_TOKEN })
    await api.post('/api/projects', { name: 'Precious', code: 'PRC' })
    await api.post('/api/system/backup')
    await first.stop()
    const file = path.join(dir, 'atlas-store.json')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(0, 300)) // truncated mid-write
    const damaged = fs.readFileSync(file)
    await assert.rejects(start(dir), (error: any) => {
      assert.equal(error.exitCode, 1)
      assert.match(error.logs, /Atlas cannot start/)
      assert.match(error.logs, /was NOT modified or replaced/)
      assert.match(error.logs, /restore:data/)
      return true
    })
    assert.deepEqual(fs.readFileSync(file), damaged, 'the damaged file was left exactly as it was')
    const restore = runCli(dir, ['--restore', 'latest'])
    assert.equal(restore.status, 0, restore.stderr)
    assert.match(restore.stdout, /Restored/)
    const back = await start(dir)
    try {
      const api2 = new Api(back.base)
      assert.equal((await api2.post('/api/auth/login', { email: 'ada@example.com', password: PASSWORD })).status, 200)
      assert.ok((await api2.get('/api/bootstrap')).body.projects.some((p: any) => p.name === 'Precious'))
    } finally {
      await back.stop()
    }
  })

  test('operations commands work from the bundle: backup, list, check', async () => {
    const dir = tmp('ops')
    const server = await start(dir)
    const api = new Api(server.base)
    await api.post('/api/setup', { name: 'Ada', email: 'ada@example.com', password: PASSWORD, token: SETUP_TOKEN })
    const run = (...args: string[]) => runCli(dir, args)
    try {
      assert.match(run('--backup-data').stdout, /Created backup/)
      assert.match(run('--list-backups').stdout, /manual/)
      const check = run('--check-data')
      assert.equal(check.status, 0, check.stdout + check.stderr)
      assert.match(check.stdout, /OK/)
      assert.notEqual(run('--reset-data').status, 0, 'demo data is refused in production')
    } finally {
      await server.stop()
    }
  })

  test('the bundle is self-contained: it runs from a folder with no node_modules and no source tree', async () => {
    const home = tmp('standalone')
    fs.copyFileSync(bundle, path.join(home, 'app.mjs'))
    fs.cpSync(web, path.join(home, 'dist'), { recursive: true })
    const server = await start(path.join(home, 'data'), {
      cwd: home,
      script: path.join(home, 'app.mjs'),
      staticDir: path.join(home, 'dist')
    })
    try {
      assert.equal((await fetch(server.base)).status, 200)
      assert.equal(
        (
          await new Api(server.base).post('/api/setup', {
            name: 'Ada',
            email: 'ada@example.com',
            password: PASSWORD,
            token: SETUP_TOKEN
          })
        ).status,
        200
      )
    } finally {
      await server.stop()
    }
  })

  test('responsiveness with a realistic workspace: 1,000 tasks load quickly and writes stay fast', async () => {
    const dir = tmp('scale')
    const server = await start(dir)
    const api = new Api(server.base)
    await api.post('/api/setup', { name: 'Ada', email: 'ada@example.com', password: PASSWORD, token: SETUP_TOKEN })
    const project = (await api.post('/api/projects', { name: 'Big', code: 'BIG' })).body
    const started = performance.now()
    for (let batch = 0; batch < 20; batch++)
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          api.post('/api/tasks', { title: `Load ${batch * 50 + i}`, projectId: project.numericId })
        )
      )
    const createMs = performance.now() - started
    try {
      const boot = await api.get('/api/bootstrap')
      assert.equal(boot.body.tasks.length, 1000)
      const t0 = performance.now()
      await api.get('/api/bootstrap')
      const bootstrapMs = performance.now() - t0
      const t1 = performance.now()
      await api.get('/api/reports/activity/monthly?userId=all')
      const reportMs = performance.now() - t1
      assert.ok(bootstrapMs < 2000, `bootstrap ${bootstrapMs.toFixed(0)} ms`)
      assert.ok(reportMs < 2000, `activity report ${reportMs.toFixed(0)} ms`)
      assert.ok(createMs / 1000 < 30, `creating 1000 tasks took ${createMs.toFixed(0)} ms`)
      fs.mkdirSync(path.join(root, 'tmp'), { recursive: true })
      fs.writeFileSync(
        path.join(root, 'tmp', 'acceptance-metrics.json'),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            node: process.version,
            tasks: 1000,
            create1000Ms: Math.round(createMs),
            bootstrapMs: Math.round(bootstrapMs),
            activityReportMs: Math.round(reportMs)
          },
          null,
          2
        )
      )
    } finally {
      await server.stop()
    }
  })
})
