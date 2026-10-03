// Starting and stopping the server: open the database, wire the container, serve the API and the web app, and shut down
// in an order that never loses a write (stop accepting requests, flush queued audit events, checkpoint, release the lock).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import express, { type Express } from 'express'
import { type AtlasConfig, isLoopbackHost, loadConfig } from '../config'
import { type Database } from '../db/driver'
import { type OpenDatabaseOptions, openDatabase } from '../db/open'
import { errorHandler } from '../http/middleware'
import { type Container, createContainer } from './container'
import { createApp } from './create-app'

export interface RunningServer {
  app: Express
  server: http.Server
  container: Container
  db: Database
  config: AtlasConfig
  host: string
  port: number
  url: string
  close(): Promise<void>
}

export interface StartOptions {
  /** Log the banner and setup token (CLI). Embedders such as Electron handle presentation themselves. */
  banner?: boolean
  /** If the configured port is busy, fall back to an OS-assigned one instead of failing. */
  portFallback?: boolean
  /** `'none'` serves the API only (used by tests); by default the built web app (production) or Vite (development). */
  web?: 'auto' | 'none'
  /** How to create the database when none exists. */
  database?: OpenDatabaseOptions
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

export async function startServer(
  config: AtlasConfig = loadConfig(),
  options: StartOptions = {}
): Promise<RunningServer> {
  const opened = openDatabase(config, options.database)
  const container = createContainer(config, opened.db)
  let vite: { close(): Promise<void> } | null = null
  let httpServer: http.Server | null = null
  const release = () => {
    try {
      opened.db.checkpoint()
      opened.db.close()
    } finally {
      opened.release?.()
    }
  }
  try {
    const app = createApp(container)
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
    container.maintenance.start()
    const address = httpServer.address() as { port: number }
    const host = config.host
    const url = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`
    const server = httpServer
    let closing: Promise<void> | null = null
    const close = () =>
      (closing ??= (async () => {
        container.maintenance.stop()
        await new Promise<void>(resolve => {
          server.close(() => resolve())
          server.closeIdleConnections?.()
          setTimeout(() => {
            server.closeAllConnections?.()
          }, 2000).unref?.()
        })
        container.audit.flush()
        await vite?.close()
        release()
      })())
    const running: RunningServer = {
      app,
      server,
      container,
      db: opened.db,
      config,
      host,
      port: address.port,
      url,
      close
    }
    if (options.banner) printBanner(running, opened.legacy?.keptAs)
    return running
  } catch (error) {
    try {
      httpServer?.close()
      await vite?.close()
    } catch {
      /* ignore */
    }
    release()
    throw error
  }
}

function printBanner(running: RunningServer, importedFrom?: string) {
  const { config, container } = running
  config.warnings.forEach(warning => console.warn(`⚠ ${warning}`))
  if (importedFrom)
    console.log(
      `Moved your data from the old JSON store into the SQL database. The old file was kept as ${importedFrom}.`
    )
  console.log(`Atlas Workspace listening on ${running.url}`)
  if (config.allowDemoData)
    console.log('Development demo data enabled via ATLAS_ALLOW_DEMO_DATA=true (demo accounts have public passwords).')
  if (!container.auth.isConfigured()) {
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
