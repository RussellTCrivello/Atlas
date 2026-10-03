// Tags and saved views: the small lists people curate to work faster.
import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import { tagPatchSchema, tagSchema, viewPatchSchema, viewQuerySchema, viewSchema } from '../../validation/records'
import { parse } from '../../validation/schemas'
import { auditContext, requirePermission, userOf, param } from '../context'

export function registerTagAndViewRoutes(http: Express, app: Container) {
  const need = (permission: string | string[], message?: string) => requirePermission(app, permission, message)

  http.get(
    '/api/tags',
    handler((_req, res) => res.json({ tags: app.tags.list() }))
  )
  http.post(
    '/api/tags',
    need('writeTasks'),
    handler((req, res) => res.json(app.tags.create(parse(tagSchema, req.body), auditContext(req))))
  )
  // Renaming or deleting a tag changes every task that carries it.
  http.patch(
    '/api/tags/:id',
    need('manageTasks'),
    handler((req, res) => res.json(app.tags.update(param(req), parse(tagPatchSchema, req.body), auditContext(req))))
  )
  http.delete(
    '/api/tags/:id',
    need('manageTasks'),
    handler((req, res) => res.json(app.tags.delete(param(req), auditContext(req))))
  )

  // Saved views belong to the person who made them (an administrator can share one); every signed-in person has their own.
  http.get(
    '/api/views',
    handler((req, res) => res.json({ views: app.views.list(userOf(req), parse(viewQuerySchema, req.query).scope) }))
  )
  http.post(
    '/api/views',
    handler((req, res) => res.json(app.views.create(userOf(req), parse(viewSchema, req.body), auditContext(req))))
  )
  http.patch(
    '/api/views/:id',
    handler((req, res) =>
      res.json(app.views.update(userOf(req), param(req), parse(viewPatchSchema, req.body), auditContext(req)))
    )
  )
  http.delete(
    '/api/views/:id',
    handler((req, res) => res.json(app.views.delete(userOf(req), param(req), auditContext(req))))
  )
}
