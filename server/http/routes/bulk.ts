// Bulk changes and copies for projects, people, milestones and alerts. The task versions live in tasks.ts and task-batches.ts.
import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import {
  alertBulkSchema,
  duplicateSchema,
  milestoneBulkSchema,
  peopleBulkSchema,
  projectBulkSchema
} from '../../validation/records'
import { parse } from '../../validation/schemas'
import { auditContext, requirePermission, userOf, param } from '../context'

export function registerBulkRoutes(http: Express, app: Container) {
  const need = (permission: string | string[], message?: string) => requirePermission(app, permission, message)
  const who = auditContext

  http.post(
    '/api/projects/bulk',
    need('manageProjects'),
    handler((req, res) => res.json(app.projects.bulk(parse(projectBulkSchema, req.body), who(req))))
  )
  http.post(
    '/api/projects/:id/duplicate',
    need('manageProjects'),
    handler((req, res) =>
      res.json(app.projects.duplicate(userOf(req), param(req), parse(duplicateSchema, req.body), who(req)))
    )
  )

  http.post(
    '/api/people/bulk',
    need('managePeople'),
    handler((req, res) => res.json(app.people.bulk(parse(peopleBulkSchema, req.body), who(req))))
  )
  http.post(
    '/api/people/:id/duplicate',
    need('managePeople'),
    handler((req, res) => res.json(app.people.duplicatePerson(param(req), who(req))))
  )

  http.post(
    '/api/milestones/bulk',
    need('manageProjects'),
    handler((req, res) => res.json(app.planning.bulkMilestones(parse(milestoneBulkSchema, req.body), who(req))))
  )
  http.post(
    '/api/milestones/:id/duplicate',
    need('manageProjects'),
    handler((req, res) => res.json(app.planning.duplicateMilestone(param(req), who(req))))
  )

  http.post(
    '/api/alerts/bulk',
    // The baseline for resolving is the same as for one alert; deleting is checked again by the service.
    need(['writeTasks', 'manageAlerts'], 'Task write access is required to update alerts'),
    handler((req, res) => res.json(app.planning.bulkAlerts(userOf(req), parse(alertBulkSchema, req.body), who(req))))
  )
  http.post(
    '/api/alerts/:id/duplicate',
    need('manageAlerts'),
    handler((req, res) => res.json(app.planning.duplicateAlert(param(req), who(req))))
  )
}
