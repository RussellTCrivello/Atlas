// Shared harness for the acceptance suites: they run the BUILT application (`npm run build` first) as a separate process,
// exactly as `npm start` and the desktop app do. Unit and integration suites start the server in-process from source.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after } from 'node:test'
import { SETUP_TOKEN, sleep } from './server'

export const root = path.join(import.meta.dirname, '..', '..')
export const bundle = path.join(root, 'dist-desktop', 'app.mjs')
export const web = path.join(root, 'dist')
const built = fs.existsSync(bundle) && fs.existsSync(path.join(web, 'index.html'))
export const skip = built ? false : 'build the project first: npm run build'

const cleanup: (() => void)[] = []
after(() => cleanup.forEach(fn => fn()))

const freePort = () =>
  new Promise<number>(resolve => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })

export interface Running {
  child: ChildProcess
  base: string
  port: number
  logs: () => string
  stop(signal?: NodeJS.Signals): Promise<number | null>
}

export interface StartOptions {
  cwd?: string
  script?: string
  staticDir?: string
  env?: Record<string, string>
}

/** Start the production bundle on a free loopback port and wait until `/api/health` answers. */
export async function start(dataDir: string, options: StartOptions = {}): Promise<Running> {
  const port = await freePort()
  const child = spawn(process.execPath, [options.script || bundle], {
    cwd: options.cwd || root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      ATLAS_DATA_DIR: dataDir,
      ATLAS_STATIC_DIR: options.staticDir || web,
      ATLAS_SETUP_TOKEN: SETUP_TOKEN,
      ATLAS_TIMEZONE: 'Europe/Amsterdam',
      ...(options.env || {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let logs = ''
  child.stdout!.on('data', d => (logs += d))
  child.stderr!.on('data', d => (logs += d))
  const base = `http://127.0.0.1:${port}`
  const running: Running = {
    child,
    base,
    port,
    logs: () => logs,
    stop: async (signal: NodeJS.Signals = 'SIGTERM') => {
      if (child.exitCode !== null) return child.exitCode
      child.kill(signal)
      for (let i = 0; i < 60 && child.exitCode === null; i++) await sleep(50)
      if (child.exitCode === null) child.kill('SIGKILL')
      return child.exitCode
    }
  }
  cleanup.push(() => child.kill('SIGKILL'))
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return running
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null)
      throw Object.assign(new Error(`server exited with ${child.exitCode}: ${logs}`), {
        logs,
        exitCode: child.exitCode
      })
    await sleep(100)
  }
  throw new Error(`server did not start: ${logs}`)
}

/** A throw-away directory that is removed when the test file finishes. */
export const tmp = (name: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `atlas-acc-${name}-`))
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Run an operations command (`--backup-data`, `--check-data`, ...) from the bundle against a data directory. */
export const runCli = (dataDir: string, args: string[], env: Record<string, string> = {}) =>
  spawnSync(process.execPath, [bundle, ...args], {
    env: { ...process.env, NODE_ENV: 'production', ATLAS_DATA_DIR: dataDir, ...env },
    encoding: 'utf8',
    // A build that does not know a command would start a server instead and never exit; fail instead of hanging.
    timeout: 60_000,
    killSignal: 'SIGKILL'
  })
