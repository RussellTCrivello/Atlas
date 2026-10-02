import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import { taskQuerySchema, toTaskListing } from '../../validation/queries'
import { parse, taskCreateSchema, taskStatusSchema, taskUpdateSchema } from '../../validation/schemas'
import { auditContext, requirePermission, userOf, param } from '../context'

export function registerTaskRoutes(http: Express, app: Container) {
  const need = (permission: string | string[], message?: string) => requirePermission(app, permission, message)

  /** Filtered, sorted, paged task list read straight from the database (the browser's working set is capped; this is not). */
  http.get(
    '/api/tasks',
    handler((req, res) => {
      const query = parse(taskQuerySchema, req.query)
      const { filter, sort, page } = toTaskListing(query, userOf(req))
      res.json(app.tasks.list(filter, sort, page))
    })
  )

  http.post(
    '/api/tasks',
    need('writeTasks'),
    handler((req, res) => res.json(app.tasks.create(userOf(req), parse(taskCreateSchema, req.body), auditContext(req))))
  )

  http.put(
    '/api/tasks/:id',
    need('writeTasks'),
    handler((req, res) =>
      res.json(app.tasks.update(userOf(req), param(req), parse(taskUpdateSchema, req.body), auditContext(req)))
    )
  )

  http.patch(
    '/api/tasks/:id/status',
    need('writeTasks'),
    handler((req, res) =>
      res.json(app.tasks.setStatus(userOf(req), param(req), parse(taskStatusSchema, req.body), auditContext(req)))
    )
  )

  http.delete(
    '/api/tasks/:id',
    need('manageTasks'),
    handler((req, res) => {
      app.tasks.delete(userOf(req), param(req), auditContext(req))
      res.json({ ok: true })
    })
  )
}
