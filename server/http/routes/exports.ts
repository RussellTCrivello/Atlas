// Exports and printing. The browser asks the server for a document built from the database; it never builds one from what
// is on screen. `print` returns the print page (HTML) that the browser shows in a frame and prints.
import type { Express, Response } from 'express'
import type { Container } from '../../app/container'
import { HttpError, handler, truncate } from '../../util'
import { exportRequestSchema } from '../../validation/exports'
import { parse } from '../../validation/schemas'
import { auditContext, requirePermission, userOf } from '../context'

/** A print page needs no script, no network and no outside images: it may only style itself and use our own fonts. */
const PRINT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; font-src 'self' data:; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"

function attachment(res: Response, filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
  )
}

export function registerExportRoutes(http: Express, app: Container) {
  http.get(
    '/api/exports/datasets',
    handler((req, res) =>
      res.json(
        app.exports.catalog(userOf(req), typeof req.query.language === 'string' ? req.query.language : undefined)
      )
    )
  )

  /** A refused export is a security event: it is recorded like any other denied request. */
  const denied = <T>(req: Parameters<typeof auditContext>[0], work: () => T): T => {
    try {
      return work()
    } catch (error) {
      if (error instanceof HttpError && error.status === 403)
        app.audit.push('access.denied', auditContext(req), {
          method: req.method,
          path: truncate(req.originalUrl.split('?')[0], 160),
          permission: String((error.details as { permission?: string } | undefined)?.permission ?? 'exportData')
        })
      throw error
    }
  }

  http.post(
    '/api/exports',
    requirePermission(app, 'exportData', 'Your role is not allowed to export data'),
    handler((req, res) => {
      const request = parse(exportRequestSchema, req.body)
      if (request.preview) return void res.json(denied(req, () => app.exports.preview(userOf(req), request)))
      const result = denied(req, () => app.exports.run(userOf(req), request, auditContext(req)))
      res.setHeader('Content-Type', result.mime)
      res.setHeader('X-Atlas-Rows', String(result.rows))
      if (result.basicFont) res.setHeader('X-Atlas-Basic-Font', '1')
      if (request.format === 'print') {
        res.setHeader('Content-Security-Policy', PRINT_CSP)
        res.setHeader('Content-Disposition', 'inline')
      } else attachment(res, result.filename)
      res.setHeader('X-Atlas-Filename', encodeURIComponent(result.filename))
      res.end(typeof result.body === 'string' ? result.body : Buffer.from(result.body))
    })
  )
}
