import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { findProjectRoot, isLoopbackHost, loadConfig } from '../../server/config'

describe('configuration (DATA-07, SEC-02, DATA-03)', () => {
  test('the default data directory is anchored to the project, not to the working directory', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-cwd-'))
    const before = process.cwd()
    try {
      process.chdir(elsewhere)
      const config = loadConfig({})
      assert.equal(config.dataDir, path.join(config.appRoot, 'data'))
      assert.ok(
        !config.dataDir.startsWith(fs.realpathSync(elsewhere)),
        'not created next to an unrelated working directory'
      )
      assert.equal(path.basename(config.appRoot), path.basename(before), 'found the project that contains package.json')
    } finally {
      process.chdir(before)
      fs.rmSync(elsewhere, { recursive: true, force: true })
    }
  })

  test('findProjectRoot walks up from the code location (works from server/, dist-desktop/ or inside an archive)', () => {
    const root = findProjectRoot(path.join(import.meta.dirname, '..', '..', 'server'))
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name, 'atlas-workspace')
  })

  test('network defaults: loopback only, unless the operator says otherwise', () => {
    assert.equal(loadConfig({}).host, '127.0.0.1')
    assert.equal(loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv).host, '127.0.0.1')
    assert.equal(loadConfig({ ATLAS_HOST: '0.0.0.0' }).host, '0.0.0.0')
    assert.equal(loadConfig({ HOST: '10.0.0.5' }).host, '10.0.0.5')
    for (const host of ['127.0.0.1', 'localhost', '::1', '127.1.2.3']) assert.equal(isLoopbackHost(host), true, host)
    for (const host of ['0.0.0.0', '192.168.1.5', 'atlas.example.com']) assert.equal(isLoopbackHost(host), false, host)
  })

  test('invalid values are reported, never silently turned into something dangerous', () => {
    const config = loadConfig({
      PORT: 'abc',
      ATLAS_BACKUP_RETENTION: 'x',
      ATLAS_TIMEZONE: 'Nowhere/City',
      ATLAS_SETUP_TOKEN: 'short'
    })
    assert.equal(config.port, 5173)
    assert.equal(config.backupRetention, 25)
    assert.equal(config.setupToken.length >= 16, true, 'a weak token is replaced by a random one')
    assert.equal(config.setupTokenFromEnv, false)
    assert.equal(config.warnings.length, 4)
    assert.equal(loadConfig({ PORT: '70000' }).port, 5173)
    assert.equal(loadConfig({ PORT: '0' }).port, 0, 'port 0 (any free port) is legitimate')
  })

  test('the setup token comes from the environment when given, otherwise it is random per start', () => {
    assert.equal(loadConfig({ ATLAS_SETUP_TOKEN: 'my-long-secret-token' }).setupToken, 'my-long-secret-token')
    assert.notEqual(loadConfig({}).setupToken, loadConfig({}).setupToken)
  })

  test('cookie, proxy and allowed-host options are parsed strictly', () => {
    assert.equal(loadConfig({}).cookieSecure, 'auto')
    assert.equal(loadConfig({ ATLAS_COOKIE_SECURE: 'true' }).cookieSecure, true)
    assert.equal(loadConfig({ ATLAS_COOKIE_SECURE: 'false' }).cookieSecure, false)
    assert.equal(loadConfig({}).trustProxy, false)
    assert.equal(loadConfig({ ATLAS_TRUST_PROXY: '1' }).trustProxy, 1)
    assert.equal(loadConfig({ ATLAS_TRUST_PROXY: 'loopback' }).trustProxy, 'loopback')
    assert.deepEqual(loadConfig({ ATLAS_ALLOWED_HOSTS: ' Atlas.Example.com , localhost:5173,, ' }).allowedHosts, [
      'atlas.example.com',
      'localhost:5173'
    ])
  })
})
