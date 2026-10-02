export function registerTaskProjectRoutes(app, services) {
  const { store, sendError, requireUser, requirePermission, validText, validOptionalDate, validEmail, teamReferenceExists, personReferenceExists, customFieldInputError, todayLA, nextProjectId, nextTaskId, id, taskPublic, projectPublic, projectById, taskById, taskWorkflowStates, terminalTaskStates, isDone, logWorkEvent, auditLog, persist, can, taskReferenceExists, validDateValue, personById, dueTone } = services
app.post('/api/tasks', requireUser, requirePermission('manageTasks'), (req, res) => {
  const body = req.body
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const project = projectById(body.projectId ?? store.projects[0]?.id)
  const assigneeId = body.assigneeId === undefined ? String(req.user.personId || '') : String(body.assigneeId || '')
  const status = body.status ?? taskWorkflowStates()[0] ?? 'To do'
  const priority = body.priority ?? 'Medium'
  const dueDate = body.dueDate ?? todayLA()
  if (!validText(title, 200)) return sendError(res, 400, 'Task title is required and must be 200 characters or fewer')
  if (!project) return sendError(res, 400, 'A valid project is required')
  if (!personReferenceExists(assigneeId)) return sendError(res, 400, 'The selected task owner does not exist')
  if (!taskWorkflowStates().includes(status)) return sendError(res, 400, 'Invalid task workflow state')
  if (!['High', 'Medium', 'Low'].includes(priority)) return sendError(res, 400, 'Invalid task priority')
  if (!validOptionalDate(dueDate)) return sendError(res, 400, 'Task due date must be a valid calendar date')
  if (body.type !== undefined && !validText(body.type, 80)) return sendError(res, 400, 'Task type must be between 1 and 80 characters')
  if (body.blocked !== undefined && typeof body.blocked !== 'boolean') return sendError(res, 400, 'Blocked must be a boolean')
  const customFieldError = customFieldInputError('tasks', body.customFields || {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const task = {
    id: nextTaskId(), title, projectId: project.id, assigneeId,
    priority, dueDate, status, type: body.type || 'Development', blocked: body.blocked === true,
    customFields: body.customFields || {}, createdAt: todayLA(), sample: false
  }
  if (isDone(task)) task.completedAt = todayLA()
  store.tasks.push(task)
  logWorkEvent({ personId: req.user.personId, actorUserId: req.user.id, taskId: task.id, projectId: task.projectId, action: isDone(task) ? 'Created and completed task' : 'Created task', statusTo: task.status, summary: task.title, minutes: 0 })
  auditLog('task.created', req.user.id, { taskId: task.id, projectId: task.projectId })
  persist({ reason: 'task-create' })
  res.json(taskPublic(task, todayLA()))
})
app.put('/api/tasks/:id', requireUser, requirePermission('manageTasks'), (req, res) => {
  const task = taskById(req.params.id)
  if (!task) return sendError(res, 404, 'Task not found')
  const body = req.body
  const project = projectById(body.projectId ?? task.projectId)
  const assigneeId = body.assigneeId === undefined ? task.assigneeId : String(body.assigneeId || '')
  const status = body.status ?? task.status
  const priority = body.priority ?? task.priority
  const dueDate = body.dueDate ?? task.dueDate
  const title = body.title === undefined ? task.title : typeof body.title === 'string' ? body.title.trim() : ''
  if (!validText(title, 200)) return sendError(res, 400, 'Task title is required and must be 200 characters or fewer')
  if (!project) return sendError(res, 400, 'A valid project is required')
  if (!personReferenceExists(assigneeId)) return sendError(res, 400, 'The selected task owner does not exist')
  if (!taskWorkflowStates().includes(status)) return sendError(res, 400, 'Invalid task workflow state')
  if (!['High', 'Medium', 'Low'].includes(priority)) return sendError(res, 400, 'Invalid task priority')
  if (!validOptionalDate(dueDate)) return sendError(res, 400, 'Task due date must be a valid calendar date')
  if (body.type !== undefined && !validText(body.type, 80)) return sendError(res, 400, 'Task type must be between 1 and 80 characters')
  if (body.blocked !== undefined && typeof body.blocked !== 'boolean') return sendError(res, 400, 'Blocked must be a boolean')
  const customFieldError = customFieldInputError('tasks', body.customFields ?? task.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const previous = { status: task.status, assigneeId: task.assigneeId, projectId: task.projectId, title: task.title, priority: task.priority, dueDate: task.dueDate, type: task.type, blocked: task.blocked, customFields: task.customFields }
  const wasDone = isDone(task)
  Object.assign(task, {
    title, projectId: project.id, assigneeId, priority, dueDate, status,
    type: body.type ?? task.type, blocked: body.blocked ?? task.blocked,
    customFields: body.customFields ?? task.customFields ?? {}
  })
  const isNowDone = isDone(task)
  task.completedAt = isNowDone ? (wasDone ? (task.completedAt || todayLA()) : todayLA()) : undefined
  if (JSON.stringify(previous) !== JSON.stringify({ status: task.status, assigneeId: task.assigneeId, projectId: task.projectId, title: task.title, priority: task.priority, dueDate: task.dueDate, type: task.type, blocked: task.blocked, customFields: task.customFields })) {
    logWorkEvent({ personId: req.user.personId, actorUserId: req.user.id, taskId: task.id, projectId: task.projectId, action: 'Updated task', statusFrom: previous.status, statusTo: task.status, summary: task.title, minutes: 0 })
    auditLog('task.updated', req.user.id, { taskId: task.id, previousStatus: previous.status, status: task.status })
    persist({ reason: 'task-update' })
  }
  res.json(taskPublic(task, todayLA()))
})
app.patch('/api/tasks/:id/status', requireUser, requirePermission('writeTasks'), (req, res) => {
  const task = taskById(req.params.id)
  if (!task) return sendError(res, 404, 'Task not found')
  if (!can(req.user, 'manageTasks') && String(task.assigneeId || '') !== String(req.user.personId || '')) return sendError(res, 403, 'You may only update the workflow state of tasks assigned to your profile')
  const statuses = taskWorkflowStates()
  const previousStatus = task.status
  let nextStatus = previousStatus
  if (Object.hasOwn(req.body, 'status')) {
    if (typeof req.body.status !== 'string' || !statuses.includes(req.body.status)) return sendError(res, 400, 'Invalid task workflow state')
    nextStatus = req.body.status
  } else if (req.body.advance === true) {
    const currentIndex = statuses.indexOf(previousStatus)
    if (currentIndex < 0) return sendError(res, 409, 'The task has a workflow state that is no longer configured')
    nextStatus = statuses[Math.min(statuses.length - 1, currentIndex + 1)]
  } else return sendError(res, 400, 'A valid status or advance flag is required')
  if (nextStatus === previousStatus) return res.json(taskPublic(task, todayLA()))
  task.status = nextStatus
  const terminal = terminalTaskStates().includes(task.status) || task.status === 'Done'
  task.completedAt = terminal ? (previousStatus && (terminalTaskStates().includes(previousStatus) || previousStatus === 'Done') ? (task.completedAt || todayLA()) : todayLA()) : undefined
  logWorkEvent({ personId: req.user.personId, actorUserId: req.user.id, taskId: task.id, projectId: task.projectId, action: terminal ? 'Completed task' : 'Moved task', statusFrom: previousStatus, statusTo: task.status, summary: task.title, minutes: 0 })
  auditLog('task.status.changed', req.user.id, { taskId: task.id, from: previousStatus, to: task.status })
  persist({ reason: 'task-status' })
  res.json(taskPublic(task, todayLA()))
})
app.delete('/api/tasks/:id', requireUser, requirePermission('manageTasks'), (req, res) => {
  const task = taskById(req.params.id)
  if (!task) return sendError(res, 404, 'Task not found')
  store.tasks = store.tasks.filter(row => String(row.id) !== String(task.id))
  store.alerts = store.alerts.filter(alert => String(alert.taskId || '') !== String(task.id))
  auditLog('task.deleted', req.user.id, { taskId: task.id, title: task.title, projectId: task.projectId })
  persist({ reason: 'task-delete' })
  res.json({ ok: true })
})

app.post('/api/projects', requireUser, requirePermission('manageProjects'), (req, res) => {
  const body = req.body
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  const teamId = body.teamId ?? store.teams[0]?.id ?? ''
  const ownerId = body.ownerId ?? req.user.personId ?? ''
  const status = body.status ?? 'On track'
  const deadline = body.deadline ?? todayLA()
  if (!validText(name, 160)) return sendError(res, 400, 'Project name is required and must be 160 characters or fewer')
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) return sendError(res, 400, 'Project code must be 1–20 letters, numbers, hyphens, or underscores')
  if (store.projects.some(project => String(project.code).toUpperCase() === code)) return sendError(res, 409, 'Project code already exists')
  if (!teamReferenceExists(teamId) || !personReferenceExists(ownerId)) return sendError(res, 400, 'Project team or owner does not exist')
  if (!['On track', 'At risk', 'Completed'].includes(status)) return sendError(res, 400, 'Invalid project status')
  if (!validOptionalDate(deadline)) return sendError(res, 400, 'Project deadline must be a valid calendar date')
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 3000)) return sendError(res, 400, 'Project description must be 3000 characters or fewer')
  const customFieldError = customFieldInputError('projects', body.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const project = { id: nextProjectId(), name, code, description: body.description || '', teamId, ownerId, color: body.color || 'purple', status, deadline, createdAt: todayLA(), customFields: body.customFields || {}, sample: false }
  store.projects.push(project)
  auditLog('project.created', req.user.id, { projectId: project.id })
  persist({ reason: 'project-create' })
  res.json(projectPublic(project, todayLA()))
})
app.put('/api/projects/:id', requireUser, requirePermission('manageProjects'), (req, res) => {
  const project = projectById(req.params.id)
  if (!project) return sendError(res, 404, 'Project not found')
  const body = req.body
  const name = body.name === undefined ? project.name : typeof body.name === 'string' ? body.name.trim() : ''
  const code = body.code === undefined ? project.code : typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  const teamId = body.teamId ?? project.teamId
  const ownerId = body.ownerId ?? project.ownerId
  const status = body.status ?? project.status
  const deadline = body.deadline ?? project.deadline
  if (!validText(name, 160)) return sendError(res, 400, 'Project name is required and must be 160 characters or fewer')
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) return sendError(res, 400, 'Project code must be 1–20 letters, numbers, hyphens, or underscores')
  if (store.projects.some(row => row.id !== project.id && String(row.code).toUpperCase() === code)) return sendError(res, 409, 'Project code already exists')
  if (!teamReferenceExists(teamId) || !personReferenceExists(ownerId)) return sendError(res, 400, 'Project team or owner does not exist')
  if (!['On track', 'At risk', 'Completed'].includes(status)) return sendError(res, 400, 'Invalid project status')
  if (!validOptionalDate(deadline)) return sendError(res, 400, 'Project deadline must be a valid calendar date')
  if (body.description !== undefined && (typeof body.description !== 'string' || body.description.length > 3000)) return sendError(res, 400, 'Project description must be 3000 characters or fewer')
  const customFieldError = customFieldInputError('projects', body.customFields ?? project.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  Object.assign(project, { name, code, teamId, ownerId, status, deadline, description: body.description ?? project.description, color: body.color ?? project.color, customFields: body.customFields ?? project.customFields ?? {} })
  auditLog('project.updated', req.user.id, { projectId: project.id })
  persist({ reason: 'project-update' })
  res.json(projectPublic(project, todayLA()))
})
app.delete('/api/projects/:id', requireUser, requirePermission('manageProjects'), (req, res) => {
  const project = projectById(req.params.id)
  if (!project) return sendError(res, 404, 'Project not found')
  const removedTaskIds = new Set(store.tasks.filter(task => String(task.projectId) === String(project.id)).map(task => String(task.id)))
  store.projects = store.projects.filter(row => String(row.id) !== String(project.id))
  store.tasks = store.tasks.filter(task => String(task.projectId) !== String(project.id))
  store.milestones = store.milestones.filter(row => String(row.projectId) !== String(project.id))
  store.alerts = store.alerts.filter(alert => String(alert.projectId || '') !== String(project.id) && !removedTaskIds.has(String(alert.taskId || '')))
  auditLog('project.deleted', req.user.id, { projectId: project.id, name: project.name, removedTasks: removedTaskIds.size })
  persist({ reason: 'project-delete' })
  res.json({ ok: true })
})
}
