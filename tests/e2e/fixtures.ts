// Shared plumbing for the browser end-to-end tests: an isolated production server per spec file, a first-run helper that goes
// through the real wizard, and trackers that fail a test on anything a user's browser would report as wrong.
import { test as base, expect, type Page, type Response } from '@playwright/test'
import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export { expect }
export const SETUP_TOKEN = 'e2e-setup-token-0123456789'
export const PASSWORD = 'Correct-Horse-9'
export const ADMIN = { name: 'Ada Admin', email: 'ada@example.com', password: PASSWORD }

const root = path.join(import.meta.dirname, '..', '..')
const bundle = path.join(root, 'dist-desktop', 'app.mjs')

export interface Atlas {
  url: string
  port: number
  dir: string
  logs(): string
  stop(signal?: NodeJS.Signals): Promise<void>
  /** Stop and start again on the same port and data directory (what a process manager does after a crash or upgrade). */
  restart(): Promise<void>
}

const freePort = () =>
  new Promise<number>(resolve => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo
      server.close(() => resolve(port))
    })
  })

const alive = new Set<ChildProcess>()
process.on('exit', () => alive.forEach(child => child.kill('SIGKILL')))

/** Start the built bundle in production mode on a free port with its own empty data directory. */
export async function startAtlas(options: { env?: Record<string, string> } = {}): Promise<Atlas> {
  if (!fs.existsSync(bundle)) throw new Error('The application is not built. Run: npm run build')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-e2e-'))
  const port = await freePort()
  let child: ChildProcess
  let logs = ''
  const launch = async () => {
    child = spawn(process.execPath, [bundle], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        ATLAS_DATA_DIR: dir,
        ATLAS_SETUP_TOKEN: SETUP_TOKEN,
        ATLAS_TIMEZONE: 'Europe/Amsterdam',
        ...(options.env || {})
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    alive.add(child)
    child.stdout!.on('data', chunk => (logs += chunk))
    child.stderr!.on('data', chunk => (logs += chunk))
    for (let i = 0; i < 150; i++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return
      } catch {
        /* not listening yet */
      }
      if (child.exitCode !== null) throw new Error(`Atlas exited with ${child.exitCode}:\n${logs}`)
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Atlas did not start:\n${logs}`)
  }
  const stop = async (signal: NodeJS.Signals = 'SIGTERM') => {
    if (!child || child.exitCode !== null) return
    child.kill(signal)
    for (let i = 0; i < 80 && child.exitCode === null; i++) await new Promise(resolve => setTimeout(resolve, 50))
    if (child.exitCode === null) child.kill('SIGKILL')
    alive.delete(child)
  }
  await launch()
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    dir,
    logs: () => logs,
    stop: async signal => {
      await stop(signal)
    },
    restart: async () => {
      await stop()
      await launch()
    }
  }
}

let current: Atlas | null = null

/** Plain `test`, wired so that `baseURL` is the server started for the current spec file. */
export const test = base.extend({
  // Playwright resolves this once for the beforeAll hook's own scope (no server yet) and again for each test.
  baseURL: async ({}, use) => {
    await use(current?.url)
  }
})

/**
 * Call once at the top of a spec file: starts a fresh server (empty data directory) before its tests and stops it after.
 * Tests in a file run in order against the same server, so a file can build on its own earlier steps.
 */
export function freshServer(options: { env?: Record<string, string> } = {}) {
  test.describe.configure({ mode: 'serial' })
  test.beforeAll(async () => {
    current = await startAtlas(options)
  })
  test.afterAll(async () => {
    const dir = current?.dir
    await current?.stop()
    current = null
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })
  return () => current!
}

// ---- things a user's browser would report as wrong --------------------------------------------------------------------------

export interface Problems {
  /** Everything the browser reported so far, including messages a test has allowed. */
  readonly list: string[]
  /** What is left after the allowed patterns are removed. */
  unexpected(): string[]
  /** Accept a known, expected message (checked when asserting, so it can be declared at any point in a test). */
  allow(pattern: RegExp): void
  expectNone(): void
}

/**
 * Collects console errors and warnings (this is also where Content-Security-Policy violations appear), uncaught page errors,
 * failed requests and HTTP error responses. Use `expectNone()` at the end of a flow.
 */
export function trackProblems(page: Page): Problems {
  const list: string[] = []
  const allowed: RegExp[] = [
    // Asking "who am I?" before signing in is a normal 401; browsers log it as a failed resource load.
    /\/api\/auth\/me/
  ]
  page.on('console', message => {
    if (!['error', 'warning'].includes(message.type())) return
    const where = message.location()?.url ? ` (${message.location().url})` : ''
    list.push(`console.${message.type()}: ${message.text()}${where}`)
  })
  page.on('pageerror', error => list.push(`pageerror: ${error.message}`))
  page.on('requestfailed', request => {
    const reason = request.failure()?.errorText || 'failed'
    if (/ABORTED|abort|cancel/i.test(reason)) return // navigations replacing each other
    list.push(`requestfailed: ${request.method()} ${request.url()} ${reason}`)
  })
  page.on('response', (response: Response) => {
    if (response.status() >= 400)
      list.push(`http ${response.status()}: ${response.request().method()} ${response.url()}`)
  })
  const unexpected = () => list.filter(message => !allowed.some(pattern => pattern.test(message)))
  return {
    list,
    unexpected,
    allow: pattern => void allowed.push(pattern),
    expectNone: () => expect(unexpected(), 'the browser reported problems').toEqual([])
  }
}

// ---- flows ------------------------------------------------------------------------------------------------------------------

/** First run through the real three-step wizard, ending signed in as the administrator. */
export async function completeSetup(page: Page, who = ADMIN) {
  await page.goto('/')
  await expect(page.locator('.setup-shell')).toBeVisible()
  for (let step = 0; step < 3; step++) await page.locator('.setup-submit').click()
  await page.getByLabel('Administrator name').fill(who.name)
  await page.getByLabel('Email').fill(who.email)
  await page.getByLabel('Password').fill(who.password)
  await page.getByLabel('Setup token').fill(SETUP_TOKEN)
  await page.locator('.setup-submit').click()
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 20_000 })
}

export async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: /Continue|Signing in/ }).click()
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.locator('.login-shell')).toBeVisible()
}

/** The signed-in browser session is also an API client (same cookie), which is the quickest way to seed data. */
export function api(page: Page) {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, data?: unknown) => {
    const response = await page.request.fetch(url, {
      method,
      data,
      headers: data ? { 'Content-Type': 'application/json' } : {}
    })
    const text = await response.text()
    let body: any = null
    try {
      body = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    return { status: response.status(), body }
  }
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, data?: unknown) => call('POST', url, data ?? {}),
    put: (url: string, data?: unknown) => call('PUT', url, data ?? {}),
    patch: (url: string, data?: unknown) => call('PATCH', url, data ?? {}),
    delete: (url: string) => call('DELETE', url)
  }
}

/**
 * A small, varied set of data through the API: one project with tasks in every state, a milestone, an update and an alert.
 * Tests in a file share a server, so each seeds its own project (unique code) and scopes what it checks to `CODE-`.
 */
export async function seedWorkspace(
  page: Page,
  tasks = 24,
  project: { name: string; code: string; prefix?: string } = { name: 'Payments platform', code: 'PAY' }
) {
  const client = api(page)
  const created = await client.post('/api/projects', { name: project.name, code: project.code })
  if (created.status !== 200)
    throw new Error(`could not create project ${project.code}: ${JSON.stringify(created.body)}`)
  const me = (await client.get('/api/bootstrap')).body.people[0].id
  const statuses = ['To do', 'In progress', 'Review', 'Done']
  const titles = [
    'Reconcile ledger',
    'Fix webhook retries',
    'Design review',
    'Rotate keys',
    'Write runbook',
    'Load test'
  ]
  for (let i = 1; i <= tasks; i++)
    await client.post('/api/tasks', {
      title: `${project.prefix || 'Task'} ${i}: ${titles[i % titles.length]}`,
      projectId: created.body.numericId,
      assigneeId: me,
      dueDate: `2026-1${i % 3}-${String(1 + (i % 27)).padStart(2, '0')}`,
      status: statuses[i % 4],
      priority: ['Low', 'Medium', 'High'][i % 3],
      blocked: i % 7 === 0
    })
  await client.post('/api/milestones', {
    name: `${project.name} milestone`,
    projectId: created.body.numericId,
    dueDate: '2026-12-01',
    status: 'Upcoming'
  })
  return { project: created.body, me }
}
