export function registerActivityAlertRoutes(app, services) {
  const { store, sendError, requireUser, requirePermission, requireManager, validText, validEmail, customFieldInputError, todayLA, timeLA, id, personById, taskById, projectById, projectReferenceExists, taskReferenceExists, activityPublic, alertPublic, createActivityBlockerAlert, can, auditLog, persist } = services
app.post('/api/activity', requireUser, requirePermission('logActivity'), (req, res) => {
  const body = req.body
  const personId = body.personId === undefined ? String(req.user.personId || '') : String(body.personId || '')
  const values = ['yesterday', 'today', 'blocked', 'upcoming'].map(key => typeof body[key] === 'string' ? body[key].trim() : '')
  if (!personId || !personById(personId)) return sendError(res, 400, 'A valid person is required for this activity update')
  if (personId !== String(req.user.personId || '') && !can(req.user, 'managePeople')) return sendError(res, 403, 'You may only log activity for your own profile')
  if (values.some(value => value.length > 2000)) return sendError(res, 400, 'Activity fields may not exceed 2000 characters')
  if (!values.some(Boolean)) return sendError(res, 400, 'Add at least one update before saving')
  const [yesterday, today, blocked, upcoming] = values
  const customFieldError = customFieldInputError('activities', body.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const activity = { id: id('activity'), personId, date: todayLA(), time: timeLA(), yesterday, today, blocked, upcoming, status: 'Confirmed', customFields: body.customFields || {}, sample: false }
  store.activities.push(activity)
  const blockerResult = createActivityBlockerAlert(activity)
  if (blockerResult?.created) auditLog('alert.activity-blocker.created', req.user.id, { alertId: blockerResult.alert.id, activityId: activity.id })
  auditLog('activity.logged', req.user.id, { activityId: activity.id, personId })
  persist({ reason: 'activity' })
  res.json(activityPublic(activity, todayLA()))
})
app.delete('/api/activity/:id', requireUser, requirePermission('manageTasks'), (req, res) => {
  const activity = store.activities.find(row => String(row.id) === String(req.params.id))
  if (!activity) return sendError(res, 404, 'Activity not found')
  store.activities = store.activities.filter(row => row !== activity)
  auditLog('activity.deleted', req.user.id, { activityId: activity.id })
  persist({ reason: 'activity-delete' })
  res.json({ ok: true })
})

app.post('/api/alerts', requireUser, requirePermission('manageAlerts'), (req, res) => {
  const body = req.body
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const task = body.taskId ? taskById(body.taskId) : null
  if (!validText(title, 200)) return sendError(res, 400, 'Alert title is required and must be 200 characters or fewer')
  if (body.taskId && !task) return sendError(res, 400, 'Linked task does not exist')
  const projectId = body.projectId ? String(body.projectId) : task ? String(task.projectId) : ''
  const project = projectId ? projectById(projectId) : null
  if (projectId && !project) return sendError(res, 400, 'Linked project does not exist')
  if (task && project && String(task.projectId) !== String(project.id)) return sendError(res, 400, 'Linked task does not belong to the selected project')
  const type = body.type ?? 'info'
  if (!['info', 'deadline', 'blocker', 'risk'].includes(type)) return sendError(res, 400, 'Invalid alert type')
  if (typeof body.body !== 'undefined' && (typeof body.body !== 'string' || body.body.length > 4000)) return sendError(res, 400, 'Alert details may not exceed 4000 characters')
  const customFieldError = customFieldInputError('alerts', body.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const alert = { id: id('alert'), title, body: body.body || '', type, tone: body.tone || (type === 'risk' || type === 'blocker' ? 'orange' : 'blue'), projectId: project?.id || '', taskId: task?.id || '', resolved: false, createdAt: todayLA(), customFields: body.customFields || {}, sample: false }
  store.alerts.push(alert)
  auditLog('alert.created', req.user.id, { alertId: alert.id })
  persist({ reason: 'alert-create' })
  res.json(alertPublic(alert))
})
app.patch('/api/alerts/:id', requireUser, (req, res) => {
  const alert = store.alerts.find(row => String(row.id) === String(req.params.id))
  if (!alert) return sendError(res, 404, 'Alert not found')
  const body = req.body
  const editKeys = Object.keys(body).filter(key => key !== 'resolved')
  if (editKeys.length && !can(req.user, 'manageAlerts')) return sendError(res, 403, 'Manager or administrator access required to edit alerts')
  if (Object.hasOwn(body, 'resolved') && typeof body.resolved !== 'boolean') return sendError(res, 400, 'Resolved must be a boolean')
  if (!editKeys.length && Object.hasOwn(body, 'resolved') && !can(req.user, 'manageAlerts')) {
    const linkedTask = alert.taskId ? taskById(alert.taskId) : null
    if (!can(req.user, 'writeTasks') || !linkedTask || (!can(req.user, 'manageTasks') && String(linkedTask.assigneeId || '') !== String(req.user.personId || ''))) return sendError(res, 403, 'You may only resolve alerts linked to tasks assigned to your profile')
  }
  if (!editKeys.length && !Object.hasOwn(body, 'resolved')) return sendError(res, 400, 'No alert changes were provided')
  const title = body.title === undefined ? alert.title : typeof body.title === 'string' ? body.title.trim() : ''
  const taskId = body.taskId === undefined ? alert.taskId : body.taskId || ''
  const task = taskId ? taskById(taskId) : null
  const projectId = body.projectId === undefined ? String(alert.projectId || (task?.projectId ?? '')) : body.projectId ? String(body.projectId) : ''
  const project = projectId ? projectById(projectId) : null
  const type = body.type ?? alert.type
  if (editKeys.includes('title') && !validText(title, 200)) return sendError(res, 400, 'Alert title is required and must be 200 characters or fewer')
  if (taskId && !task) return sendError(res, 400, 'Linked task does not exist')
  if (projectId && !project) return sendError(res, 400, 'Linked project does not exist')
  if (task && project && String(task.projectId) !== String(project.id)) return sendError(res, 400, 'Linked task does not belong to the selected project')
  if (body.type !== undefined && !['info', 'deadline', 'blocker', 'risk'].includes(type)) return sendError(res, 400, 'Invalid alert type')
  if (body.body !== undefined && (typeof body.body !== 'string' || body.body.length > 4000)) return sendError(res, 400, 'Alert details may not exceed 4000 characters')
  if (editKeys.length) {
    const customFieldError = customFieldInputError('alerts', body.customFields ?? alert.customFields ?? {})
    if (customFieldError) return sendError(res, 400, customFieldError)
  }
  if (editKeys.length) Object.assign(alert, { title, taskId: task?.id || '', projectId: project?.id || '', body: body.body ?? alert.body, type, tone: body.tone ?? alert.tone, customFields: body.customFields ?? alert.customFields ?? {} })
  if (typeof body.resolved === 'boolean') alert.resolved = body.resolved
  auditLog('alert.updated', req.user.id, { alertId: alert.id, resolved: alert.resolved })
  persist({ reason: 'alert-update' })
  res.json(alertPublic(alert))
})
app.delete('/api/alerts/:id', requireUser, requirePermission('manageAlerts'), (req, res) => {
  const alert = store.alerts.find(row => String(row.id) === String(req.params.id))
  if (!alert) return sendError(res, 404, 'Alert not found')
  store.alerts = store.alerts.filter(row => row !== alert)
  auditLog('alert.deleted', req.user.id, { alertId: alert.id })
  persist({ reason: 'alert-delete' })
  res.json({ ok: true })
})
}
