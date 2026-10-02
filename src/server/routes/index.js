import { registerSystemRoutes } from './system.routes.js'
import { registerTaskProjectRoutes } from './tasks-projects.routes.js'
import { registerDirectoryRoutes } from './directory.routes.js'
import { registerActivityAlertRoutes } from './activity-alerts.routes.js'
import { registerUserRoutes } from './users.routes.js'
import { registerPreferencesRoutes } from './preferences.routes.js'

export function registerRoutes(app, services) {
  registerSystemRoutes(app, services)
  registerTaskProjectRoutes(app, services)
  registerDirectoryRoutes(app, services)
  registerActivityAlertRoutes(app, services)
  registerUserRoutes(app, services)
  registerPreferencesRoutes(app, services)
  app.use('/api', (_req, res) => services.sendError(res, 404, 'API route not found'))
}
