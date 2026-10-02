import { prepareDatabaseExport } from '../domain/export-data.js'

const REPORT_DATASETS = new Set(['delivery-report', 'activity-evidence', 'activity-summary', 'project-contributions'])
const ACTIVITY_DATASETS = new Set(['activity-evidence', 'activity-summary', 'project-contributions'])
const PERIODS = new Set(['daily', 'weekly', 'monthly', 'quarterly', 'yearly'])
const ACTIVITY_PERIODS = new Set(['daily', 'weekly', 'monthly'])

export function registerExportRoutes(app, services) {
  const { sendError, requireUser, requirePermission, can, createDatabaseExportContext, isPlainObject } = services

  app.post('/api/exports/prepare', requireUser, requirePermission('exportData'), (req, res) => {
    const { dataset, recordIds, fields, query: inputQuery } = req.body || {}
    if (typeof dataset !== 'string' || dataset.length > 80) return sendError(res, 400, 'A supported export dataset is required')
    if (recordIds !== undefined && (!Array.isArray(recordIds) || recordIds.length > 25000 || recordIds.some(id => !['string', 'number'].includes(typeof id) || String(id).length > 200))) return sendError(res, 400, 'Selected record IDs are invalid')
    if (fields !== undefined && (!Array.isArray(fields) || fields.length > 250 || fields.some(key => typeof key !== 'string' || key.length > 120 || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(key)))) return sendError(res, 400, 'Selected export fields are invalid')
    if (inputQuery !== undefined && !isPlainObject(inputQuery)) return sendError(res, 400, 'Export query must be an object')
    const query = inputQuery || {}
    if (REPORT_DATASETS.has(dataset) && !can(req.user, 'viewReports')) return sendError(res, 403, 'Report access is required for this export')
    if (dataset === 'users' && !can(req.user, 'manageUsers')) return sendError(res, 403, 'User administration access is required for this export')
    if (query.period !== undefined && (typeof query.period !== 'string' || !(ACTIVITY_DATASETS.has(dataset) ? ACTIVITY_PERIODS : PERIODS).has(query.period.toLowerCase()))) return sendError(res, 400, 'Unsupported report period for this dataset')
    if (query.personId !== undefined && (typeof query.personId !== 'string' || query.personId.length > 200)) return sendError(res, 400, 'Invalid person scope')
    if (query.projectId !== undefined && !['string', 'number'].includes(typeof query.projectId)) return sendError(res, 400, 'Invalid project scope')

    try {
      const context = createDatabaseExportContext()
      const result = prepareDatabaseExport({
        context,
        dataset,
        recordIds,
        fields,
        query: {
          period: String(query.period || 'weekly').toLowerCase(),
          personId: query.personId || 'all',
          projectId: query.projectId
        }
      })
      res.json(result)
    } catch (error) {
      const status = /unsupported export dataset|fields are unavailable|export field is required|selected database records|limited to 25,000/i.test(error.message) ? 400 : 500
      sendError(res, status, status === 500 ? 'Database export preparation failed' : error.message)
    }
  })
}
