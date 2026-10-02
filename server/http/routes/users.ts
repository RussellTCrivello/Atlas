import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import { parse, userCreateSchema, userUpdateSchema } from '../../validation/schemas'
import { auditContext, requirePermission, userOf, param } from '../context'

export function registerUserRoutes(http: Express, app: Container) {
  const need = (permission: string | string[], message?: string) => requirePermission(app, permission, message)

  http.get('/api/users', need('manageUsers'), (_req, res) => res.json(app.users.list()))

  http.post(
    '/api/users',
    need('manageUsers'),
    handler(async (req, res) =>
      res.json(await app.users.create(userOf(req), parse(userCreateSchema, req.body), auditContext(req)))
    )
  )
  http.put(
    '/api/users/:id',
    need('manageUsers'),
    handler(async (req, res) =>
      res.json(await app.users.update(userOf(req), param(req), parse(userUpdateSchema, req.body), auditContext(req)))
    )
  )
  http.delete(
    '/api/users/:id',
    need('manageUsers'),
    handler((req, res) => {
      app.users.delete(userOf(req), param(req), auditContext(req))
      res.json({ ok: true })
    })
  )
}
