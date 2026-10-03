// Doing something to many tasks at once: bulk edit, undo of a delete, and CSV import. Each answers with how many records were
// affected and, for the ones that were not, why; the browser shows that as a report rather than as a single yes or no.
import express, { type Express } from 'express'
import type { Container } from '../../app/container'
import { handler } from '../../util'
import { importSchema, restoreSchema, taskBulkSchema } from '../../validation/records'
import { parse } from '../../validation/schemas'
import { auditContext, requirePermission, userOf } from '../context'

/** Imports carry a whole file, so their body may be larger than the 1 MB every other request is held to. */
export const IMPORT_PATH = '/api/tasks/import'
export const IMPORT_BODY_LIMIT = '6mb'

export function registerTaskBatchRoutes(http: Express, app: Container) {
  const need = (permission: string | string[], message?: string) => requirePermission(app, permission, message)

  // Whether each task may be changed is decided per task (the same rules as changing one); deleting needs `manageTasks`.
  http.post(
    '/api/tasks/bulk',
    need('writeTasks'),
    handler((req, res) => res.json(app.taskBulk.bulk(userOf(req), parse(taskBulkSchema, req.body), auditContext(req))))
  )

  http.post(
    '/api/tasks/restore',
    need('manageTasks', 'Undoing a delete needs the "manageTasks" permission'),
    handler((req, res) =>
      res.json(app.taskBulk.restore(userOf(req), parse(restoreSchema, req.body).batch, auditContext(req)))
    )
  )

  // The larger body parser runs here, after sign-in and the permission check: an anonymous request can never make the server
  // buffer megabytes (the global parser skips this path).
  http.post(
    IMPORT_PATH,
    need('writeTasks'),
    express.json({ limit: IMPORT_BODY_LIMIT }),
    handler((req, res) => res.json(app.taskImport.run(userOf(req), parse(importSchema, req.body), auditContext(req))))
  )
}
