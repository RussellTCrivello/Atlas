// Milestones, daily updates and alerts.
import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import {
  activityCreateSchema,
  alertCreateSchema,
  alertPatchSchema,
  milestoneCreateSchema,
  milestoneUpdateSchema,
  parse
} from '../../validation/schemas'
import { auditContext, requirePermission, userOf, param } from '../context'

export function registerPlanningRoutes(http: Express, app: Container) {
  const need = (permission: string | string[], message?: string) => requirePermission(app, permission, message)
  const who = auditContext

  http.post(
    '/api/milestones',
    need('manageProjects'),
    handler((req, res) => res.json(app.planning.createMilestone(parse(milestoneCreateSchema, req.body), who(req))))
  )
  http.put(
    '/api/milestones/:id',
    need('manageProjects'),
    handler((req, res) =>
      res.json(app.planning.updateMilestone(param(req), parse(milestoneUpdateSchema, req.body), who(req)))
    )
  )
  http.delete(
    '/api/milestones/:id',
    need('manageProjects'),
    handler((req, res) => {
      app.planning.deleteMilestone(param(req), who(req))
      res.json({ ok: true })
    })
  )

  http.post(
    '/api/activity',
    need('logActivity'),
    handler((req, res) =>
      res.json(app.planning.logActivity(userOf(req), parse(activityCreateSchema, req.body), who(req)))
    )
  )
  http.delete(
    '/api/activity/:id',
    need('manageTasks'),
    handler((req, res) => {
      app.planning.deleteActivity(param(req), who(req))
      res.json({ ok: true })
    })
  )

  http.post(
    '/api/alerts',
    need('manageAlerts'),
    handler((req, res) => res.json(app.planning.createAlert(parse(alertCreateSchema, req.body), who(req))))
  )
  http.patch(
    '/api/alerts/:id',
    // The baseline permission is checked before the body is looked at (VAL-04): an empty or partial patch must not be a
    // way past authorisation. Editing the alert's content additionally needs manageAlerts; resolving needs only this.
    need(['writeTasks', 'manageAlerts'], 'Task write access is required to update alerts'),
    handler((req, res) =>
      res.json(app.planning.patchAlert(userOf(req), param(req), parse(alertPatchSchema, req.body), who(req)))
    )
  )
  http.delete(
    '/api/alerts/:id',
    need('manageAlerts'),
    handler((req, res) => {
      app.planning.deleteAlert(param(req), who(req))
      res.json({ ok: true })
    })
  )
}
