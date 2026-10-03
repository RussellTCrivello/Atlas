import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import { auditContext, requirePermission } from '../context'

export function registerSystemRoutes(http: Express, app: Container) {
  const admin = requirePermission(app, 'manageSettings', 'Administrator access required')

  http.get('/api/system', admin, (_req, res) => res.json(app.system.status()))
  http.post(
    '/api/system/backup',
    admin,
    handler((req, res) => res.json(app.system.backupNow(auditContext(req))))
  )
  http.get('/api/audit', admin, (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100))
    res.json({ ...app.system.auditPage(limit), today: app.ctx.reference().today })
  })
  http.delete(
    '/api/setup/seed',
    requirePermission(app, 'removeDemoData'),
    handler((req, res) => res.json(app.system.removeDemoData(auditContext(req))))
  )
}
