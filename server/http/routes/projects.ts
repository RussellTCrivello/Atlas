import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import { taskQuerySchema, toTaskListing } from '../../validation/queries'
import { parse, projectCreateSchema, projectUpdateSchema } from '../../validation/schemas'
import { auditContext, requirePermission, userOf, param } from '../context'

export function registerProjectRoutes(http: Express, app: Container) {
  const need = (permission: string | string[], message?: string) => requirePermission(app, permission, message)

  /** Everything the project page shows except its task list: numbers, milestones, alerts, people, recent activity. */
  http.get(
    '/api/projects/:id',
    handler((req, res) => res.json(app.projects.detail(param(req))))
  )

  /** All tasks of one project, filtered, sorted and paged by the database. */
  http.get(
    '/api/projects/:id/tasks',
    handler((req, res) => {
      const query = parse(taskQuerySchema, req.query)
      const { filter, sort, page } = toTaskListing(query, userOf(req))
      res.json(app.projects.tasksOf(param(req), filter, sort, page))
    })
  )

  http.post(
    '/api/projects',
    need('manageProjects'),
    handler((req, res) =>
      res.json(app.projects.create(userOf(req), parse(projectCreateSchema, req.body), auditContext(req)))
    )
  )

  http.put(
    '/api/projects/:id',
    need('manageProjects'),
    handler((req, res) =>
      res.json(app.projects.update(param(req), parse(projectUpdateSchema, req.body), auditContext(req)))
    )
  )

  http.delete(
    '/api/projects/:id',
    need('manageProjects'),
    handler((req, res) => res.json(app.projects.delete(param(req), req.query.cascade === 'true', auditContext(req))))
  )
}
