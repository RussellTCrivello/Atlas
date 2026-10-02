// Endpoints that need no sign-in: health, what this server is, whether setup is done, the public translation catalogue.
import type { Express } from 'express'
import type { Container } from '../../app/container'
import { DESIGN_SYSTEM_VERSION, isLoopbackHost } from '../../config'
import { can } from '../../domain/permissions'
import { DEMO_ACCOUNTS } from '../../seed/demo'
import { clientIp } from '../../util'
import { optionalUser } from '../authenticate'

export function registerPublicRoutes(http: Express, app: Container) {
  const { config } = app

  http.get('/api/health', (_req, res) => {
    const health = app.system.health()
    res.status(health.writable ? 200 : 503).json({
      ok: health.writable,
      name: 'Atlas Workspace',
      version: config.version,
      mode: config.isProduction ? 'production' : 'development',
      storage: { writable: health.writable, lastSavedAt: health.lastSavedAt },
      time: new Date().toISOString()
    })
  })

  http.get('/api/runtime-config', (req, res) => {
    const base = {
      packagingMode: config.isProduction ? 'production-web' : 'development-web',
      designSystem: { version: DESIGN_SYSTEM_VERSION, localFonts: true, externalUiAssets: false },
      packaging: { web: true, pwa: true, localAssets: true }
    }
    const user = optionalUser(app, req)
    if (!user || !can(app.ctx.settings, user, 'manageSettings')) return void res.json(base)
    res.json({ ...base, database: app.system.databaseInfo() })
  })

  http.get('/api/setup/status', (req, res) => {
    const configured = app.auth.isConfigured()
    // Demo credentials are public by design but are only ever offered by a development server, to the local machine.
    const demoVisible =
      config.allowDemoData && !config.isProduction && isLoopbackHost(clientIp(req).replace(/^::ffff:/, ''))
    res.json({
      configured,
      tokenRequired: !configured,
      demoAllowed: demoVisible,
      demo: demoVisible
        ? { email: DEMO_ACCOUNTS[0].email, password: DEMO_ACCOUNTS[0].password, accounts: DEMO_ACCOUNTS }
        : null
    })
  })

  // The translation catalogue is public (the sign-in screen needs it) but carries no registry/policy metadata.
  http.get('/api/i18n/catalog', (req, res) => {
    const payload = app.localization.catalog(String(req.query.language || req.query.lang || '') || null)
    res.json({ ...payload, interfaces: undefined, keyPolicy: undefined, runtime: undefined })
  })
}
