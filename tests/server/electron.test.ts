import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, test } from 'node:test'

// The Electron binary cannot be launched in CI-less environments, so the parts that matter for security are checked
// structurally and the navigation rules are unit-tested. A packaged-app smoke test is listed in docs/OPERATIONS_RUNBOOK.md.
const require = createRequire(import.meta.url)
const root = path.join(import.meta.dirname, '..', '..')
const { sameOrigin, isSafeExternalUrl } = require(path.join(root, 'electron', 'security.cjs'))
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const preload = fs.readFileSync(path.join(root, 'electron', 'preload.cjs'), 'utf8')

describe('desktop navigation rules (DESK-02)', () => {
  test('sameOrigin compares the whole origin, not a string prefix', () => {
    const origin = 'http://127.0.0.1:5173'
    assert.equal(sameOrigin('http://127.0.0.1:5173/', origin), true)
    assert.equal(sameOrigin('http://127.0.0.1:5173/api/x?y=1#z', origin), true)
    assert.equal(sameOrigin('http://127.0.0.1:51730/', origin), false, 'the old startsWith() check let this through')
    assert.equal(sameOrigin('http://127.0.0.1.evil.example:5173/', origin), false)
    assert.equal(sameOrigin('https://127.0.0.1:5173/', origin), false)
    assert.equal(sameOrigin('file:///etc/passwd', origin), false)
    assert.equal(sameOrigin('not a url', origin), false)
  })
  test('only web and mail links go to the operating system', () => {
    for (const ok of ['https://example.com/a', 'http://intranet.local/x', 'mailto:someone@example.com'])
      assert.equal(isSafeExternalUrl(ok), true, ok)
    for (const bad of [
      'file:///C:/Windows/system32/calc.exe',
      'javascript:alert(1)',
      'ms-msdt:/id',
      'search-ms:query=x',
      'smb://host/share',
      'vscode://file/x',
      '',
      'nonsense'
    ])
      assert.equal(isSafeExternalUrl(bad), false, bad)
  })
})

describe('desktop shell guard rails (DESK-01..03)', () => {
  test('the window is sandboxed and isolated, and navigation is guarded', () => {
    assert.match(main, /sandbox: true/)
    assert.match(main, /contextIsolation: true/)
    assert.match(main, /nodeIntegration: false/)
    assert.doesNotMatch(main, /sandbox: false/)
    assert.match(main, /will-navigate/)
    assert.match(main, /will-redirect/)
    assert.match(main, /setPermissionRequestHandler/)
    assert.match(main, /will-attach-webview/)
    assert.doesNotMatch(main, /shell\.openExternal\(url\)\s*\n\s*return \{ action: 'allow'/)
  })
  test('only one instance may run, and shutdown releases the data directory', () => {
    assert.match(main, /requestSingleInstanceLock/)
    assert.match(main, /second-instance/)
    assert.match(main, /before-quit/)
    assert.match(main, /running\s*\n?\s*\.close\(\)/)
  })
  test('developer tools are not part of a packaged build', () => {
    assert.match(main, /devToolsAllowed = !electronApp\.isPackaged/)
    assert.doesNotMatch(main, /openDevTools/)
  })
  test('the preload exposes a minimal surface and never process.versions', () => {
    assert.doesNotMatch(preload, /process\.versions/)
    assert.match(preload, /contextBridge\.exposeInMainWorld\('atlasDesktop'/)
    assert.ok(preload.split('\n').length < 30)
  })
  test('the menu has real edit roles (Cut/Copy/Paste work on macOS) and the navigation entries are wired', () => {
    assert.match(main, /role: 'editMenu'/)
    assert.match(main, /role: 'appMenu'/)
    assert.match(main, /atlas:navigate/)
    assert.match(preload, /atlas:navigate/)
  })
  test('the server module exposes everything the shell calls', async () => {
    const server: any = await import('../../app')
    for (const name of ['startServer', 'loadConfig', 'restoreBackup'] as const)
      assert.equal(typeof server[name], 'function', name)
    for (const call of main.matchAll(/server\.(\w+)\(/g))
      assert.equal(typeof server[call[1]], 'function', `main.cjs calls server.${call[1]}`)
  })
  test('the bundle is self-contained so packaging does not depend on module resolution inside an archive', () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts
    assert.doesNotMatch(scripts['build:server'], /--packages=external/)
    assert.match(scripts['build:server'], /--external:vite/)
  })
})
