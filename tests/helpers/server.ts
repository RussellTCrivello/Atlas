// Test helpers: boot a real Atlas server in-process on a throw-away data directory and talk to it over HTTP.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type AtlasConfig, type RunningServer, loadConfig, startServer } from '../../server/index'

export const SETUP_TOKEN = 'test-setup-token-0123'
export const PASSWORD = 'Correct-Horse-9'

export interface LaunchOptions {
  env?: Record<string, string>
  dataDir?: string
  keep?: boolean
}
export interface TestServer extends RunningServer {
  dataDir: string
  cleanup(): Promise<void>
  restart(env?: Record<string, string>): Promise<TestServer>
}

export async function launch(options: LaunchOptions = {}): Promise<TestServer> {
  const dataDir = options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-'))
  const env: Record<string, string> = {
    NODE_ENV: 'production',
    ATLAS_DATA_DIR: dataDir,
    ATLAS_SETUP_TOKEN: SETUP_TOKEN,
    ATLAS_HOST: '127.0.0.1',
    ATLAS_TIMEZONE: 'Europe/Amsterdam',
    PORT: '0',
    ...(options.env || {})
  }
  const config: AtlasConfig = loadConfig(env as NodeJS.ProcessEnv)
  const running = await startServer(config, { web: 'none' })
  const server = running as TestServer
  server.dataDir = dataDir
  server.cleanup = async () => {
    await running.close()
    if (!options.keep) fs.rmSync(dataDir, { recursive: true, force: true })
  }
  server.restart = async (nextEnv = {}) => {
    await running.close()
    return launch({ ...options, dataDir, env: { ...(options.env || {}), ...nextEnv }, keep: options.keep })
  }
  return server
}

export interface ApiResponse<T = any> {
  status: number
  headers: Headers
  body: T
  text: string
}

export class Api {
  cookie = ''
  constructor(
    public base: string,
    public name = 'client'
  ) {}

  async request<T = any>(
    method: string,
    route: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<ApiResponse<T>> {
    const init: RequestInit = {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      redirect: 'manual'
    }
    const res = await fetch(this.base + route, init)
    const raw = res.headers.getSetCookie?.() || []
    for (const header of raw) {
      const pair = header.split(';')[0]
      if (/^atlas_sid=;?$/.test(pair) || /Expires=Thu, 01 Jan 1970/i.test(header)) this.cookie = ''
      else if (pair.startsWith('atlas_sid=')) this.cookie = pair
    }
    const text = await res.text()
    let parsed: any = null
    try {
      parsed = JSON.parse(text)
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, body: parsed, text }
  }
  get = <T = any>(route: string, headers?: Record<string, string>) => this.request<T>('GET', route, undefined, headers)
  post = <T = any>(route: string, body?: unknown, headers?: Record<string, string>) =>
    this.request<T>('POST', route, body ?? {}, headers)
  put = <T = any>(route: string, body?: unknown, headers?: Record<string, string>) =>
    this.request<T>('PUT', route, body ?? {}, headers)
  patch = <T = any>(route: string, body?: unknown, headers?: Record<string, string>) =>
    this.request<T>('PATCH', route, body ?? {}, headers)
  delete = <T = any>(route: string, headers?: Record<string, string>) =>
    this.request<T>('DELETE', route, undefined, headers)
}

export async function setupAdmin(server: RunningServer, overrides: Record<string, unknown> = {}): Promise<Api> {
  const admin = new Api(server.url, 'admin')
  const res = await admin.post('/api/setup', {
    name: 'Root Admin',
    email: 'admin@example.com',
    password: PASSWORD,
    token: SETUP_TOKEN,
    workspaceName: 'Test Workspace',
    workspaceUnit: 'Operations',
    ...overrides
  })
  if (res.status !== 200) throw new Error(`setup failed: ${res.status} ${res.text}`)
  return admin
}

export interface MadeUser {
  api: Api
  user: any
  email: string
}
/** Create an account through the API and sign in as it (the forced first-sign-in password change is skipped). */
export async function makeUser(
  server: RunningServer,
  admin: Api,
  role: string,
  name = role,
  extra: Record<string, unknown> = {}
): Promise<MadeUser> {
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@example.com`
  const created = await admin.post('/api/users', {
    name,
    email,
    password: PASSWORD,
    role,
    mustChangePassword: false,
    ...extra
  })
  if (created.status !== 200) throw new Error(`user create failed: ${created.status} ${created.text}`)
  const api = new Api(server.url, name)
  const login = await api.post('/api/auth/login', { email, password: PASSWORD })
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${login.text}`)
  return { api, user: created.body, email }
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
