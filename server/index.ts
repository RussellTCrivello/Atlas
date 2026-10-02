// Atlas Workspace server: application factory, lifecycle and command line.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import compression from 'compression'
import cookieParser from 'cookie-parser'
import express, { type Express } from 'express'
import { LoginThrottle, SessionManager, hashPasswordSync } from './auth'
import { type AtlasConfig, isLoopbackHost, loadConfig } from './config'
import { demoStore } from './demo'
import { can, permissionsFor } from './domain'
import { apiNotFound, errorHandler, hostGuard, originGuard, requestId, securityHeaders } from './http'
import { emptyState, validateStoreState } from './migrations'
import {
  StoreCorruptError,
  StoreLockedError,
  StoreMissingError,
  StoreTooNewError,
  DocumentStore,
  STORE_FILE,
  createBackupFile,
  listBackupsIn,
  readStoreFile,
  restoreBackup
} from './store'
import { appendAudit } from './audit'
import { AuditBuffer, MissingKeyLog, type Deps } from './api/context'
import { authenticate, optionalUser, registerAccountRoutes, registerPublicAuthRoutes } from './api/auth'
import { registerAdminRoutes, registerPublicInfoRoutes, registerRuntimeConfig } from './api/admin'
import { registerDataRoutes } from './api/data'
import { translationCatalogPayload } from './views'
import { normalizeEmail } from './util'

export { loadConfig, DocumentStore, restoreBackup, listBackupsIn }
export type { AtlasConfig }

export interface RunningServer {
  app: Express
  server: http.Server
  db: DocumentStore
  config: AtlasConfig
  host: string
  port: number
  url: string
  close(): Promise<void>
}

// ---- app factory ---------------------------------------------------------------------------------------------------
export function createApp(config: AtlasConfig, db: DocumentStore) {
  const sessions = new SessionManager(path.join(config.dataDir, 'sessions.json'))
  sessions.prune(
    Number(db.state.settings?.security?.sessionDays || 14) * 86400000,
    new Set(db.state.users.map(user => user.id))
  )
  const deps: Deps = {
    config,
    db,
    sessions,
    throttle: new LoginThrottle(),
    audit: new AuditBuffer(db),
    missingKeys: new MissingKeyLog()
  }

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', config.trustProxy)
  app.use(requestId())
  app.use(hostGuard(config))
  app.use(securityHeaders(config))
  app.use(compression())
  app.use(cookieParser())
  app.use(express.json({ limit: '1mb' }))
  app.use(originGuard())

  // ---- public ----
  registerPublicInfoRoutes(app, deps)
  registerPublicAuthRoutes(app, deps)
  registerRuntimeConfig(app, deps, req => {
    const user = optionalUser(deps, req)
    return Boolean(user && can(db.state.settings, user, 'manageSettings'))
  })
  // The translation catalog is public (the sign-in screen needs it) but carries no registry/policy metadata.
  app.get('/api/i18n/catalog', (req, res) => {
    const payload = translationCatalogPayload(
      db.state.settings,
      String(req.query.language || req.query.lang || '') || null
    )
    res.json({ ...payload, interfaces: undefined, keyPolicy: undefined, runtime: undefined })
  })

  // ---- everything below needs a signed-in user ----
  app.use('/api', authenticate(deps))
  registerAccountRoutes(app, deps)
  registerAdminRoutes(app, deps)
  registerDataRoutes(app, deps)
  app.use('/api', apiNotFound())
  return { app, deps }
}

function mountStatic(app: Express, config: AtlasConfig) {
  const index = path.join(config.staticDir, 'index.html')
  if (!fs.existsSync(index))
    throw new Error(`The web build was not found at ${config.staticDir}. Run "npm run build" first.`)
  app.use(
    express.static(config.staticDir, {
      index: false,
      setHeaders(res, filePath) {
        const rel = path.relative(config.staticDir, filePath).split(path.sep).join('/')
        if (rel.startsWith('assets/')) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        else if (rel === 'sw.js' || rel === 'manifest.webmanifest' || rel.endsWith('.html'))
          res.setHeader('Cache-Control', 'no-cache')
        else res.setHeader('Cache-Control', 'public, max-age=86400')
        if (rel === 'sw.js') res.setHeader('Service-Worker-Allowed', '/')
      }
    })
  )
  // Single-page-app fallback: only for navigations (GET/HEAD for an extension-less path), never for missing files or API calls.
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || path.extname(req.path) || req.path.startsWith('/api/'))
      return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(index, error => error && next(error))
  })
}

async function mountVite(app: Express, config: AtlasConfig, httpServer: http.Server) {
  const { createServer } = await import('vite')
  const vite = await createServer({
    root: config.appRoot,
    appType: 'spa',
    server: {
      middlewareMode: true,
      host: config.host,
      // The dev server must never serve the data directory, the server sources or secrets.
      allowedHosts: config.allowedHosts.length
        ? config.allowedHosts
        : isLoopbackHost(config.host)
          ? ['localhost', '127.0.0.1', '::1']
          : true,
      hmr: { server: httpServer },
      fs: {
        strict: true,
        allow: [
          path.join(config.appRoot, 'src'),
          path.join(config.appRoot, 'shared'),
          path.join(config.appRoot, 'public'),
          path.join(config.appRoot, 'node_modules'),
          path.join(config.appRoot, 'index.html')
        ],
        // `allow` is a strict allow-list, so the data directory, server sources, docs and package files are unreachable. The deny
        // globs are name-based (not directory-based) on purpose: a glob such as **/data/** would match any project that merely lives
        // under a folder called "data" and block the whole app.
        deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**']
      }
    }
  })
  app.use(vite.middlewares)
  return vite
}

// ---- lifecycle -----------------------------------------------------------------------------------------------------
function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.removeListener('error', onError)
      resolve()
    })
  })
}

export interface StartOptions {
  /** Log the banner and setup token (CLI). Embedders such as Electron handle presentation themselves. */
  banner?: boolean
  /** If the configured port is busy, fall back to an OS-assigned one instead of failing. */
  portFallback?: boolean
  /** `'none'` serves the API only (used by tests); by default the built web app (production) or Vite (development). */
  web?: 'auto' | 'none'
}

export async function startServer(
  config: AtlasConfig = loadConfig(),
  options: StartOptions = {}
): Promise<RunningServer> {
  const db = DocumentStore.open(config)
  let vite: { close(): Promise<void> } | null = null
  let httpServer: http.Server | null = null
  try {
    const { app, deps } = createApp(config, db)
    httpServer = http.createServer(app)
    httpServer.requestTimeout = 60_000
    httpServer.headersTimeout = 30_000
    if (options.web === 'none') {
      /* API only */
    } else if (config.isProduction) mountStatic(app, config)
    else vite = await mountVite(app, config, httpServer)
    app.use(errorHandler())
    try {
      await listen(httpServer, config.port, config.host)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && options.portFallback && config.port !== 0)
        await listen(httpServer, 0, config.host)
      else throw error
    }
    db.startMaintenance()
    const address = httpServer.address() as { port: number }
    const host = config.host
    const url = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`
    const server = httpServer
    let closing: Promise<void> | null = null
    const close = () =>
      (closing ??= (async () => {
        await new Promise<void>(resolve => {
          server.close(() => resolve())
          server.closeIdleConnections?.()
          setTimeout(() => {
            server.closeAllConnections?.()
          }, 2000).unref?.()
        })
        deps.audit.flush()
        deps.sessions.flush()
        await vite?.close()
        db.close()
      })())
    const running: RunningServer = { app, server, db, config, host, port: address.port, url, close }
    if (options.banner) printBanner(running)
    return running
  } catch (error) {
    try {
      httpServer?.close()
      await vite?.close()
    } catch {
      /* ignore */
    }
    db.close()
    throw error
  }
}

function printBanner(running: RunningServer) {
  const { config, db } = running
  config.warnings.forEach(warning => console.warn(`⚠ ${warning}`))
  console.log(`Atlas Workspace listening on ${running.url}`)
  if (config.allowDemoData)
    console.log('Development demo data enabled via ATLAS_ALLOW_DEMO_DATA=true (demo accounts have public passwords).')
  if (!db.state.configured) {
    console.log('First-run setup required.')
    console.log(`  Open ${running.url} and enter this one-time setup token when asked:`)
    console.log(`  ${config.setupToken}`)
  } else console.log('Workspace configured.')
  if (!isLoopbackHost(config.host)) {
    console.log(
      `⚠ Listening on ${config.host}: anyone who can reach this address can see the sign-in page. Use HTTPS (a reverse proxy) and set ATLAS_TRUST_PROXY / ATLAS_ALLOWED_HOSTS. See docs/PRODUCTION.md.`
    )
  }
}

// ---- command line --------------------------------------------------------------------------------------------------
function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const next = argv[index + 1]
  return next && !next.startsWith('--') ? next : ''
}
const has = (argv: string[], name: string) => argv.includes(name)

const HELP = `Atlas Workspace
Usage: node dist-desktop/app.mjs [command]   (or: npm run app / npm start)

  (no command)                    start the server
  --backup-data                   copy the live store to backups/ (safe while the server runs)
  --list-backups                  list backups, newest first
  --restore <file|latest>         replace the store with a backup (stop the server first)
  --check-data                    validate the store and print a summary (read-only)
  --reset-admin-password --email <address> [--password <new>] [--activate] [--role <role>]
                                  set a new password (prints a random one if omitted) for locked-out accounts
  --init-production --yes         DESTRUCTIVE: replace the store with an empty workspace (a backup is taken first)
  --reset-data                    development only: load demo data (needs ATLAS_ALLOW_DEMO_DATA=true, refused in production)
`

/** A command-line failure with a user-facing message. `main()` prints it and exits; tests can assert on it. */
export class CliError extends Error {
  constructor(
    message: string,
    public exitCode = 1
  ) {
    super(message)
    this.name = 'CliError'
  }
}
function fail(message: string, code = 1): never {
  throw new CliError(message, code)
}

export async function runCommand(argv: string[], config: AtlasConfig): Promise<boolean> {
  const dataFile = path.join(config.dataDir, STORE_FILE)
  if (has(argv, '--help') || has(argv, '-h')) {
    console.log(HELP)
    return true
  }
  if (has(argv, '--backup-data')) {
    const backup = createBackupFile(config, 'manual')
    console.log(backup ? `Created backup ${backup}` : `No store found at ${dataFile}`)
    return true
  }
  if (has(argv, '--list-backups')) {
    const backups = listBackupsIn(config.dataDir)
    if (!backups.length) console.log(`No backups in ${path.join(config.dataDir, 'backups')}`)
    backups.forEach(backup =>
      console.log(
        `${backup.createdAt}  ${String(backup.size).padStart(10)} B  ${backup.reason.padEnd(18)} ${backup.file}`
      )
    )
    return true
  }
  if (has(argv, '--restore')) {
    const which = flag(argv, '--restore')
    if (!which) fail('Usage: --restore <backup file name | path | latest>')
    let result
    try {
      result = restoreBackup(config, which!)
    } catch (error) {
      fail(`Restore failed: ${(error as Error).message}`)
    }
    console.log(`Restored ${result!.restored}`)
    if (result!.preRestore) console.log(`The previous store was saved as ${result!.preRestore}`)
    console.log(
      `Contents: ${Object.entries(result!.counts)
        .map(([key, value]) => `${value} ${key}`)
        .join(', ')}`
    )
    return true
  }
  if (has(argv, '--check-data')) {
    if (!fs.existsSync(dataFile)) fail(`No store found at ${dataFile}`)
    let checked
    try {
      checked = readStoreFile(dataFile, config)
    } catch (error) {
      fail(`Store check failed: ${(error as Error).message}`, 2)
    }
    const { state, migrated } = checked!
    const validation = validateStoreState(state)
    console.log(
      `Store ${dataFile}: ${validation.integrity.toUpperCase()}${migrated ? ' (will be migrated on next start)' : ''}`
    )
    console.log(
      `  ${state.users.length} users, ${state.people.length} people, ${state.projects.length} projects, ${state.tasks.length} tasks, ${state.workLogs.length} ledger rows, ${state.auditLogs.length} audit entries`
    )
    validation.errors.forEach(message => console.log(`  ERROR   ${message}`))
    validation.warnings.slice(0, 20).forEach(message => console.log(`  WARNING ${message}`))
    if (validation.errors.length) fail('The store has integrity errors.', 2)
    return true
  }
  if (has(argv, '--reset-admin-password')) {
    const email = normalizeEmail(flag(argv, '--email'))
    if (!email) fail('Usage: --reset-admin-password --email <address> [--password <new>] [--activate] [--role <role>]')
    const db = openForCommand(config)
    try {
      const user = db.state.users.find(candidate => normalizeEmail(candidate.email) === email)
      if (!user) fail(`No account with email ${email}`)
      const supplied = flag(argv, '--password')
      const password = supplied || crypto.randomBytes(12).toString('base64url')
      const role = flag(argv, '--role')
      if (role && !permissionsFor(db.state.settings, role).length) fail(`Unknown role ${role}`)
      db.commit(
        state => {
          const target = state.users.find(candidate => candidate.id === user!.id)!
          target.passwordHash = hashPasswordSync(password)
          target.passwordChangedAt = new Date().toISOString()
          target.mustChangePassword = true
          if (has(argv, '--activate')) target.active = true
          if (role) target.role = role
          appendAudit(
            state,
            'user.password.reset.cli',
            {},
            { userId: target.id, activated: has(argv, '--activate'), role: role || undefined }
          )
        },
        { reason: 'cli-reset-password', backupFirst: 'pre-password-reset' }
      )
      // Existing sessions of that account are no longer valid.
      const sessions = new SessionManager(path.join(config.dataDir, 'sessions.json'))
      sessions.revokeUser(user!.id)
      sessions.flush()
      console.log(`Password for ${user!.email} updated. They must choose a new one at next sign-in.`)
      if (!supplied) console.log(`Temporary password (shown once): ${password}`)
    } finally {
      db.close()
    }
    return true
  }
  if (has(argv, '--init-production')) {
    const db = openForCommand(config)
    try {
      if (db.state.configured && !has(argv, '--yes'))
        fail(
          'This workspace is configured. --init-production would erase it (a backup is taken first). Re-run with --yes to confirm.'
        )
      db.replaceState(emptyState(config), { reason: 'init-production', backupFirst: 'pre-init-production' })
      console.log(
        `Initialised ${dataFile} for first-run setup. A backup of the previous store is in ${path.join(config.dataDir, 'backups')}.`
      )
    } finally {
      db.close()
    }
    return true
  }
  if (has(argv, '--reset-data')) {
    if (config.isProduction) fail('Refusing to load demo data with NODE_ENV=production.')
    if (!config.allowDemoData)
      fail(
        'Demo data has well-known passwords. Re-run with ATLAS_ALLOW_DEMO_DATA=true to confirm: ATLAS_ALLOW_DEMO_DATA=true npm run reset:data'
      )
    const db = openForCommand(config)
    try {
      db.replaceState(demoStore(config), { reason: 'reset-data', backupFirst: 'pre-reset-data' })
      console.log(`Reset ${dataFile} with development demo data`)
    } finally {
      db.close()
    }
    return true
  }
  return false
}

function openForCommand(config: AtlasConfig): DocumentStore {
  return DocumentStore.open(config, { allowFresh: true })
}

export function explainStartupError(error: unknown, config: AtlasConfig) {
  if (error instanceof StoreLockedError) console.error(`\n${error.message}\n`)
  else if (error instanceof StoreCorruptError) {
    console.error(`\nAtlas cannot start: ${error.message}`)
    console.error('The file was NOT modified or replaced. To recover:')
    if (error.backups.length) {
      console.error(
        `  1. Restore the newest valid backup:   npm run restore:data -- latest   (stop any running server first)`
      )
      console.error(`     Available backups (${error.backups.length}):`)
      error.backups
        .slice(0, 5)
        .forEach(backup => console.error(`       ${backup.createdAt}  ${backup.reason}  ${backup.file}`))
    } else
      console.error(
        `  There are no backups in ${path.join(config.dataDir, 'backups')}. Inspect or repair ${error.file} by hand.`
      )
    console.error('')
  } else if (error instanceof StoreMissingError || error instanceof StoreTooNewError)
    console.error(`\nAtlas cannot start: ${error.message}\n`)
  else console.error(error)
}

/** Entry point for `npm run app`, `npm start` and the CLI flags. */
export async function main(argv = process.argv.slice(2)) {
  const config = loadConfig()
  try {
    if (await runCommand(argv, config)) return
    const running = await startServer(config, { banner: true })
    const shutdown = async (signal: string) => {
      console.log(`\n${signal} received, shutting down…`)
      try {
        await running.close()
      } finally {
        process.exit(0)
      }
    }
    process.once('SIGINT', () => void shutdown('SIGINT'))
    process.once('SIGTERM', () => void shutdown('SIGTERM'))
  } catch (error) {
    if (error instanceof CliError) {
      console.error(error.message)
      process.exit(error.exitCode)
    }
    explainStartupError(error, config)
    process.exit(1)
  }
}

/** True when this module graph was started directly (not imported by Electron, tests or another program). */
export function isEntryPoint(moduleUrl: string): boolean {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return pathToFileURL(fs.realpathSync(entry)).href === moduleUrl
  } catch {
    return false
  }
}
