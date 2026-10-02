// Runtime configuration. Everything environment-driven is parsed and validated in one place so that a typo in an
// environment variable fails loudly (or falls back to a safe default with a warning) instead of misbehaving silently.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isValidTimeZone, systemTimeZone } from '../shared/settings'

export const DESIGN_SYSTEM_VERSION = '2.0.0'
export const DEFAULT_BACKUP_RETENTION = 25

export interface AtlasConfig {
  /** Directory that holds package.json (resolved from the code location, never from the working directory). */
  appRoot: string
  dataDir: string
  staticDir: string
  isProduction: boolean
  /** Demo accounts/data. Honoured in development only, never when NODE_ENV=production. */
  allowDemoData: boolean
  host: string
  port: number
  cookieSecure: 'auto' | boolean
  trustProxy: boolean | number | string
  backupRetention: number
  backupOnWrite: boolean
  /** One-time token that must accompany first-run setup. */
  setupToken: string
  setupTokenFromEnv: boolean
  /** Explicit Host-header allow-list (ATLAS_ALLOWED_HOSTS). Empty = default policy. */
  allowedHosts: string[]
  defaultTimezone: string
  version: string
  /** Problems found while reading the environment; logged at startup. */
  warnings: string[]
}

export function findProjectRoot(startDir: string): string {
  let dir = path.resolve(startDir)
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'package.json')
    try {
      if (fs.existsSync(candidate) && JSON.parse(fs.readFileSync(candidate, 'utf8')).name === 'atlas-workspace')
        return dir
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

export function isLoopbackHost(host: string): boolean {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '::1' || h === '::ffff:127.0.0.1' || /^127\./.test(h)
}

function parseTrustProxy(value: string | undefined): boolean | number | string {
  const v = String(value ?? '').trim()
  if (!v || v === 'false' || v === '0') return false
  if (v === 'true') return true
  if (/^\d+$/.test(v)) return Number(v)
  return v
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AtlasConfig> = {}): AtlasConfig {
  const warnings: string[] = []
  const appRoot = path.resolve(env.ATLAS_ROOT || findProjectRoot(path.dirname(fileURLToPath(import.meta.url))))
  const isProduction = env.NODE_ENV === 'production'

  let version = '0.0.0'
  try {
    version = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version || version
  } catch {
    /* package.json is optional in odd packaging layouts */
  }

  // ---- demo mode: development only -------------------------------------------------------------------------------
  const demoRequested = env.ATLAS_ALLOW_DEMO_DATA === 'true'
  if (demoRequested && isProduction)
    warnings.push(
      'ATLAS_ALLOW_DEMO_DATA=true is ignored when NODE_ENV=production (demo accounts have public passwords).'
    )
  const allowDemoData = demoRequested && !isProduction

  // ---- network ---------------------------------------------------------------------------------------------------
  const rawPort = env.PORT ?? '5173'
  let port = Number(rawPort)
  if (!/^\d+$/.test(String(rawPort).trim()) || port > 65535) {
    warnings.push(`PORT="${rawPort}" is not a valid port; using 5173.`)
    port = 5173
  }
  const host = (env.ATLAS_HOST || env.HOST || '127.0.0.1').trim()

  // ---- backups ---------------------------------------------------------------------------------------------------
  let backupRetention = DEFAULT_BACKUP_RETENTION
  if (env.ATLAS_BACKUP_RETENTION !== undefined && env.ATLAS_BACKUP_RETENTION !== '') {
    if (/^\d+$/.test(env.ATLAS_BACKUP_RETENTION.trim()))
      backupRetention = Math.min(100, Math.max(3, Number(env.ATLAS_BACKUP_RETENTION)))
    else
      warnings.push(
        `ATLAS_BACKUP_RETENTION="${env.ATLAS_BACKUP_RETENTION}" is not a whole number; using ${DEFAULT_BACKUP_RETENTION}.`
      )
  }

  // ---- first-run setup token -------------------------------------------------------------------------------------
  let setupToken = String(env.ATLAS_SETUP_TOKEN || '').trim()
  let setupTokenFromEnv = Boolean(setupToken)
  if (setupToken && setupToken.length < 8) {
    warnings.push(
      'ATLAS_SETUP_TOKEN is shorter than 8 characters and was ignored; a random token was generated instead.'
    )
    setupToken = ''
    setupTokenFromEnv = false
  }
  if (!setupToken) setupToken = crypto.randomBytes(16).toString('base64url')

  // ---- time zone -------------------------------------------------------------------------------------------------
  let defaultTimezone = systemTimeZone()
  if (env.ATLAS_TIMEZONE) {
    if (isValidTimeZone(env.ATLAS_TIMEZONE)) defaultTimezone = env.ATLAS_TIMEZONE
    else
      warnings.push(`ATLAS_TIMEZONE="${env.ATLAS_TIMEZONE}" is not a valid IANA time zone; using ${defaultTimezone}.`)
  }

  const cookieSecure = env.ATLAS_COOKIE_SECURE === 'true' ? true : env.ATLAS_COOKIE_SECURE === 'false' ? false : 'auto'

  const config: AtlasConfig = {
    appRoot,
    dataDir: path.resolve(env.ATLAS_DATA_DIR || path.join(appRoot, 'data')),
    staticDir: path.resolve(env.ATLAS_STATIC_DIR || path.join(appRoot, 'dist')),
    isProduction,
    allowDemoData,
    host,
    port,
    cookieSecure,
    trustProxy: parseTrustProxy(env.ATLAS_TRUST_PROXY),
    backupRetention,
    backupOnWrite: env.ATLAS_BACKUP_ON_WRITE === 'true',
    setupToken,
    setupTokenFromEnv,
    allowedHosts: String(env.ATLAS_ALLOWED_HOSTS || '')
      .split(',')
      .map(entry => entry.trim().toLowerCase())
      .filter(Boolean),
    defaultTimezone,
    version,
    warnings
  }
  return { ...config, ...overrides }
}
