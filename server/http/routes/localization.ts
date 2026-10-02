import type { Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import {
  i18nBulkSchema,
  i18nMissingSchema,
  i18nRegisterSchema,
  i18nTranslationSchema,
  parse
} from '../../validation/schemas'
import { auditContext, requirePermission, userOf } from '../context'

export function registerLocalizationRoutes(http: Express, app: Container) {
  const admin = requirePermission(app, 'manageSettings', 'Administrator access required')

  http.get('/api/i18n/missing', admin, (_req, res) => res.json({ keys: app.localization.missingKeys.list() }))
  http.delete('/api/i18n/missing', admin, (_req, res) => {
    app.localization.missingKeys.clear()
    res.json({ ok: true })
  })
  http.get('/api/settings/translations/missing', admin, (_req, res) => res.json(app.localization.missingTranslations()))

  // Any signed-in browser may report a key it could not translate.
  http.post('/api/i18n/missing', (req, res) =>
    res.json(app.localization.reportMissing(parse(i18nMissingSchema, req.body)))
  )

  http.post(
    '/api/i18n/register',
    admin,
    handler((req, res) =>
      res.json(app.localization.register(userOf(req).id, parse(i18nRegisterSchema, req.body), auditContext(req)))
    )
  )
  http.put(
    '/api/i18n/translation',
    admin,
    handler((req, res) =>
      res.json(app.localization.setTranslation(parse(i18nTranslationSchema, req.body), auditContext(req)))
    )
  )
  http.post(
    '/api/i18n/bulk',
    admin,
    handler((req, res) =>
      res.json(app.localization.bulkImport(userOf(req).id, parse(i18nBulkSchema, req.body), auditContext(req)))
    )
  )
}
