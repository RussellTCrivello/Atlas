// What the browser loads and polls: the bootstrap payload, the revision counter, and search.
import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import { userOf } from '../context'

export function registerWorkspaceRoutes(http: Express, app: Container) {
  http.get(
    '/api/bootstrap',
    handler((req, res) => res.json(app.bootstrap.forUser(userOf(req))))
  )
  http.get('/api/revision', (_req, res) =>
    res.json({ revision: app.ctx.revision, serverTime: new Date().toISOString() })
  )
  http.get('/api/search', (req, res) =>
    res.json(app.search.search(String(req.query.q || ''), Number(req.query.limit) || 8))
  )
}
