import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { type RunningServer, loadConfig, startServer } from '../../server/index'
import { raw } from '../helpers/raw'

// The original P0: `npm run app` started Vite with the project root as its web root on 0.0.0.0, which served
// /data/atlas-store.json (password hashes, audit log) and the server source to anyone on the network.
const MARKER = 'TOP-SECRET-MARKER-9f3a'
let base: string
let root: string
let server: RunningServer

before(async () => {
  // The project deliberately lives below folders called "data" and "server": name-based deny globs must not block the app.
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-dev-'))
  root = path.join(base, 'data', 'server', 'atlas')
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'atlas-workspace', version: '0.0.0', type: 'module' })
  )
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>'
  )
  for (const dir of ['src', 'shared', 'public', 'server', 'data', 'docs', 'electron', 'scripts'])
    fs.mkdirSync(path.join(root, dir))
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), 'export const hello = "client code is public"\n')
  fs.writeFileSync(path.join(root, 'public', 'atlas-icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  fs.writeFileSync(path.join(root, 'app.tsx'), `export const secret = "${MARKER}"\n`)
  fs.writeFileSync(path.join(root, 'server', 'store.ts'), `export const secret = "${MARKER}"\n`)
  fs.writeFileSync(path.join(root, 'docs', 'internal.md'), MARKER)
  fs.writeFileSync(path.join(root, '.env'), `TOKEN=${MARKER}\n`)
  fs.writeFileSync(path.join(root, 'data', 'secret.json'), JSON.stringify({ marker: MARKER }))
  fs.symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'dir')
  const config = loadConfig({ ATLAS_ROOT: root, PORT: '0', ATLAS_TIMEZONE: 'Europe/Amsterdam' } as NodeJS.ProcessEnv) // development: no NODE_ENV
  assert.equal(config.dataDir, path.join(root, 'data'), 'default data directory lives under the project root')
  server = await startServer(config)
})
after(async () => {
  await server.close()
  fs.rmSync(base, { recursive: true, force: true })
})

describe('development server exposure (SEC-02)', () => {
  test('listens on the loopback interface only by default', () => {
    assert.equal(server.host, '127.0.0.1')
    assert.equal((server.server.address() as net.AddressInfo).address, '127.0.0.1')
  })

  test('the data directory, server sources, docs and secrets are not served in any form', async () => {
    const paths = [
      '/data/secret.json',
      '/data/atlas-store.json',
      '/app.tsx',
      '/server/store.ts',
      '/docs/internal.md',
      '/.env',
      '/package.json',
      `/@fs${root}/data/secret.json`,
      `/@fs${root}/app.tsx`,
      '/@fs/etc/passwd',
      '/../app.tsx',
      '/%2e%2e/app.tsx',
      '/data/secret.json?raw',
      '/data/secret.json?import&raw',
      '/data/secret.json?url'
    ]
    for (const route of paths) {
      const res = await raw(`${server.url}${route}`)
      assert.ok(!res.text.includes(MARKER), `${route} leaked the secret (HTTP ${res.status})`)
      assert.ok(!res.text.includes('root:x:0:0'), `${route} leaked /etc/passwd`)
      assert.notEqual(res.status, 200, `${route} should not be served (got ${res.status})`)
    }
  })

  test('the application itself still works: index.html and client sources are served', async () => {
    const index = await raw(`${server.url}/`)
    assert.equal(index.status, 200)
    assert.match(index.text, /<div id="root">/)
    const main = await raw(`${server.url}/src/main.tsx`)
    assert.equal(main.status, 200)
    assert.match(main.text, /client code is public/)
    assert.equal((await raw(`${server.url}/atlas-icon.svg`)).status, 200)
  })

  test('the API and the dev server share one port: no separate HMR socket is exposed', async () => {
    const open = await new Promise<boolean>(resolve => {
      const socket = net.connect({ port: 24678, host: '127.0.0.1' })
      socket.once('connect', () => (socket.destroy(), resolve(true)))
      socket.once('error', () => resolve(false))
    })
    assert.equal(open, false)
    assert.equal((await raw(`${server.url}/api/health`)).status, 200)
  })

  test('hostile Host headers are refused by the dev server too', async () => {
    const res = await raw(`${server.url}/src/main.tsx`, { headers: { Host: 'evil.example.com' } })
    assert.equal(res.status, 403)
  })
})
