// The Express application: middleware in a deliberate order, then the routes. No business logic lives here.
import compression from 'compression'
import cookieParser from 'cookie-parser'
import express from 'express'
import { registerAccountRoutes, registerPublicAuthRoutes } from '../http/routes/auth'
import { authenticate } from '../http/authenticate'
import { apiNotFound, hostGuard, originGuard, requestId, securityHeaders } from '../http/middleware'
import { registerBulkRoutes } from '../http/routes/bulk'
import { registerExportRoutes } from '../http/routes/exports'
import { registerLocalizationRoutes } from '../http/routes/localization'
import { registerPeopleRoutes } from '../http/routes/people'
import { registerPlanningRoutes } from '../http/routes/planning'
import { registerProjectRoutes } from '../http/routes/projects'
import { registerPublicRoutes } from '../http/routes/public'
import { registerReportRoutes } from '../http/routes/reports'
import { registerSettingsRoutes } from '../http/routes/settings'
import { registerSystemRoutes } from '../http/routes/system'
import { registerTagAndViewRoutes } from '../http/routes/tags'
import { IMPORT_PATH, registerTaskBatchRoutes } from '../http/routes/task-batches'
import { registerTaskRoutes } from '../http/routes/tasks'
import { registerUserRoutes } from '../http/routes/users'
import { registerWorkspaceRoutes } from '../http/routes/workspace'
import type { Container } from './container'

export function createApp(app: Container) {
  const { config } = app
  const http = express()
  http.disable('x-powered-by')
  http.set('trust proxy', config.trustProxy)
  http.use(requestId())
  http.use(hostGuard(config))
  http.use(securityHeaders(config))
  http.use(compression())
  http.use(cookieParser())
  const json = express.json({ limit: '1mb' })
  // A CSV import carries a whole file: it has its own, larger parser, mounted after sign-in (see routes/task-batches.ts).
  http.use((req, res, next) => (req.path === IMPORT_PATH ? next() : json(req, res, next)))
  http.use(originGuard())

  // ---- public ----
  registerPublicRoutes(http, app)
  registerPublicAuthRoutes(http, app)

  // ---- everything below needs a signed-in user ----
  http.use('/api', authenticate(app))
  registerAccountRoutes(http, app)
  registerWorkspaceRoutes(http, app)
  registerTaskBatchRoutes(http, app) // before registerTaskRoutes: /api/tasks/bulk must not be read as /api/tasks/:id
  registerTaskRoutes(http, app)
  registerTagAndViewRoutes(http, app)
  registerBulkRoutes(http, app)
  registerProjectRoutes(http, app)
  registerPeopleRoutes(http, app)
  registerPlanningRoutes(http, app)
  registerUserRoutes(http, app)
  registerSettingsRoutes(http, app)
  registerLocalizationRoutes(http, app)
  registerReportRoutes(http, app)
  registerExportRoutes(http, app)
  registerSystemRoutes(http, app)
  http.use('/api', apiNotFound())
  return http
}
