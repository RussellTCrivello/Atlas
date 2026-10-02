import type { Express } from 'express'
import { z } from 'zod'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import { ACTIVITY_PERIODS, REPORT_PERIODS, parse } from '../../validation/schemas'
import { auditContext, requirePermission, userOf, param } from '../context'

export function registerReportRoutes(http: Express, app: Container) {
  const need = (permission: string | string[], message?: string) => requirePermission(app, permission, message)

  http.get(
    '/api/reports/activity/:period',
    need('viewReports'),
    handler((req, res) => {
      const period = parse(z.enum(ACTIVITY_PERIODS), req.params.period)
      const requested = String(req.query.userId || 'all')
      const limit = Math.min(5000, Math.max(1, Math.trunc(Number(req.query.limit)) || 500))
      const report = app.reports.activityFor(userOf(req), period, requested, limit)
      if (app.ctx.settings.audit?.trackReads)
        app.audit.push('report.viewed', auditContext(req), { report: 'activity', period, userId: requested })
      res.json(report)
    })
  )

  http.get(
    '/api/reports/:period',
    need('viewReports'),
    handler((req, res) => {
      const period = parse(z.enum(REPORT_PERIODS), String(req.params.period).toLowerCase())
      res.json(app.reports.delivery(period))
    })
  )
}
