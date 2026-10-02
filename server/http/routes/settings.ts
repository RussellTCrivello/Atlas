import type { Express } from 'express'
import type { Container } from '../../app/container'
import { badRequest, handler } from '../../util'
import { auditContext, requirePermission } from '../context'

export function registerSettingsRoutes(http: Express, app: Container) {
  const admin = requirePermission(app, 'manageSettings', 'Administrator access required')

  http.put(
    '/api/settings',
    admin,
    handler((req, res) => {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null
      if (!body) throw badRequest('Settings must be a JSON object')
      res.json(app.settings.update(body, auditContext(req)))
    })
  )
  http.get(
    '/api/settings/export',
    admin,
    handler((_req, res) => res.json(app.settings.export()))
  )
  http.post(
    '/api/settings/import',
    admin,
    handler((req, res) => res.json(app.settings.import(req.body, auditContext(req))))
  )
}
