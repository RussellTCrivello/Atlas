// Temporary compatibility endpoint: replaced by server-side exports in the next step.
import type { Express } from 'express'
import { z } from 'zod'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import { parse } from '../../validation/schemas'
import { auditContext, requirePermission } from '../context'

export function registerExportRoutes(http: Express, app: Container) {
  http.post(
    '/api/exports/audit',
    requirePermission(app, 'exportData', 'Your role is not allowed to export data'),
    handler((req, res) => {
      const body = parse(
        z.object({
          page: z.string().max(40),
          format: z.enum(['csv', 'xlsx', 'json', 'pdf', 'print']),
          rows: z.number().int().min(0).max(10_000_000),
          columns: z.number().int().min(0).max(200)
        }),
        req.body
      )
      if (app.ctx.settings.audit?.trackExports !== false) app.audit.push('data.exported', auditContext(req), body)
      res.json({ ok: true })
    })
  )
}
