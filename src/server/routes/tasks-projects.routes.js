export function registerTaskProjectRoutes(app, services) {
  const { store, sendError, requireUser, requirePermission, validText, validOptionalDate, validEmail, teamReferenceExists, personReferenceExists, customFieldInputError, todayLA, nextProjectId, nextTaskId, id, taskPublic, projectPublic, projectById, taskById, taskWorkflowStates, terminalTaskStates, isDone, logWorkEvent, auditLog, persist, can, taskReferenceExists, validDateValue, personById, dueTone, createDatabaseExportContext, auditRead, offlineCreateId } = services
app.get('/api/projects/:id/tasks', requireUser, (req, res) => {
  const context = createDatabaseExportContext()
  const project = context.snapshot.projects.find(row => String(row.id) === String(req.params.id))
  if (!project) return sendError(res, 404, 'Project not found')
  const indexes = {
    people: new Map(context.snapshot.people.map(person => [String(person.id), person])),
    projects: new Map(context.snapshot.projects.map(row => [String(row.id), row])),
    teams: new Map(context.snapshot.teams.map(team => [String(team.id), team]))
  }
  const projectTasks = context.snapshot.tasks.filter(task => String(task.projectId) === String(project.id))
  const tasks = projectTasks
    .map(task => context.workspace.taskPublic(task, context.today, indexes))
    .sort((left, right) => String(left.dueDate || '').localeCompare(String(right.dueDate || '')) || left.title.localeCompare(right.title))
  const milestones = context.snapshot.milestones
    .filter(milestone => String(milestone.projectId) === String(project.id))
    .map(milestone => ({ ...milestone, project: project.name }))
  auditRead('project-tasks', req.user.id)
  res.json({ source: 'sqlite', project: context.workspace.projectPublic(project, context.today, projectTasks, indexes), tasks, milestones, generatedAt: new Date().toISOString() })
})
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
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some(tag => !validText(tag, 60)))) return sendError(res, 400, 'Tags must contain up to 50 values of 60 characters or fewer')
  const tags = body.tags === undefined ? [] : [...new Map(body.tags.map(tag => [tag.trim().toLocaleLowerCase(), tag.trim()])).values()]
  const customFieldError = customFieldInputError('tasks', body.customFields || {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const task = {
    id: offlineCreateId(req, 'tasks', nextTaskId), title, projectId: project.id, assigneeId,
    priority, dueDate, status, type: body.type || 'Development', blocked: body.blocked === true, tags,
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
  if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some(tag => !validText(tag, 60)))) return sendError(res, 400, 'Tags must contain up to 50 values of 60 characters or fewer')
  const tags = body.tags === undefined ? (task.tags || []) : [...new Map(body.tags.map(tag => [tag.trim().toLocaleLowerCase(), tag.trim()])).values()]
  const customFieldError = customFieldInputError('tasks', body.customFields ?? task.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const previous = { status: task.status, assigneeId: task.assigneeId, projectId: task.projectId, title: task.title, priority: task.priority, dueDate: task.dueDate, type: task.type, blocked: task.blocked, tags: task.tags || [], customFields: task.customFields }
  const wasDone = isDone(task)
  Object.assign(task, {
    title, projectId: project.id, assigneeId, priority, dueDate, status,
    type: body.type ?? task.type, blocked: body.blocked ?? task.blocked, tags,
    customFields: body.customFields ?? task.customFields ?? {}
  })
  const isNowDone = isDone(task)
  task.completedAt = isNowDone ? (wasDone ? (task.completedAt || todayLA()) : todayLA()) : undefined
  if (JSON.stringify(previous) !== JSON.stringify({ status: task.status, assigneeId: task.assigneeId, projectId: task.projectId, title: task.title, priority: task.priority, dueDate: task.dueDate, type: task.type, blocked: task.blocked, tags: task.tags || [], customFields: task.customFields })) {
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
app.post('/api/tasks/bulk', requireUser, (req, res) => {
  const body = req.body || {}
  const action = body.action
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : []
  if (!ids.length || ids.length > 1000 || ids.some(value => !value || value.length > 200)) return sendError(res, 400, 'Select between 1 and 1000 task records per bulk request')
  if (!['edit', 'delete'].includes(action)) return sendError(res, 400, 'Unsupported task bulk operation')
  if (action === 'delete') {
    if (!can(req.user, 'manageTasks')) return sendError(res, 403, 'Task management access is required for bulk deletion')
    const selected = new Set(ids)
    const existing = store.tasks.filter(task => selected.has(String(task.id)))
    const found = new Set(existing.map(task => String(task.id)))
    const failures = ids.filter(taskId => !found.has(taskId)).map(id => ({ id, error: 'Task not found' }))
    if (existing.length) {
      store.tasks = store.tasks.filter(task => !selected.has(String(task.id)))
      store.alerts = store.alerts.filter(alert => !selected.has(String(alert.taskId || '')))
      auditLog('tasks.bulk.deleted', req.user.id, { requested: ids.length, affected: existing.length, taskIds: existing.map(task => task.id) })
      persist({ reason: 'tasks-bulk-delete' })
    }
    return res.json({ requested: ids.length, affected: existing.length, succeeded: existing.map(task => task.id), failures })
  }

  const changes = body.changes
  const allowedFields = new Set(['title', 'projectId', 'assigneeId', 'priority', 'dueDate', 'status', 'type', 'blocked', 'tags'])
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some(key => !allowedFields.has(key))) return sendError(res, 400, 'Bulk task edits contain unsupported fields')
  const statusOnly = Object.keys(changes).every(key => key === 'status')
  if (statusOnly ? !can(req.user, 'writeTasks') : !can(req.user, 'manageTasks')) return sendError(res, 403, statusOnly ? 'Task workflow access is required' : 'Task management access is required for these bulk fields')
  const failures = []
  const succeeded = []
  const changedFields = Object.keys(changes)
  const tasksById = new Map(store.tasks.map(task => [String(task.id), task]))
  for (const taskId of ids) {
    const task = tasksById.get(taskId)
    if (!task) { failures.push({ id: taskId, error: 'Task not found' }); continue }
    if (!can(req.user, 'manageTasks') && String(task.assigneeId || '') !== String(req.user.personId || '')) {
      failures.push({ id: taskId, error: 'You may only update tasks assigned to your profile' }); continue
    }
    const next = { ...task }
    const candidate = changes
    if (Object.hasOwn(candidate, 'title')) next.title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
    if (Object.hasOwn(candidate, 'projectId')) {
      const project = projectById(candidate.projectId)
      if (!project) { failures.push({ id: taskId, error: 'A valid project is required' }); continue }
      next.projectId = project.id
    }
    if (Object.hasOwn(candidate, 'assigneeId')) {
      const assigneeId = String(candidate.assigneeId || '')
      if (!personReferenceExists(assigneeId)) { failures.push({ id: taskId, error: 'The selected task owner does not exist' }); continue }
      next.assigneeId = assigneeId
    }
    if (Object.hasOwn(candidate, 'priority')) next.priority = candidate.priority
    if (Object.hasOwn(candidate, 'dueDate')) next.dueDate = candidate.dueDate
    if (Object.hasOwn(candidate, 'status')) next.status = candidate.status
    if (Object.hasOwn(candidate, 'type')) next.type = candidate.type
    if (Object.hasOwn(candidate, 'blocked')) next.blocked = candidate.blocked
    if (Object.hasOwn(candidate, 'tags')) {
      if (!Array.isArray(candidate.tags) || candidate.tags.length > 50 || candidate.tags.some(tag => !validText(tag, 60))) { failures.push({ id: taskId, error: 'Tags must contain up to 50 values of 60 characters or fewer' }); continue }
      next.tags = [...new Map(candidate.tags.map(tag => [tag.trim().toLocaleLowerCase(), tag.trim()])).values()]
    }
    if (!validText(next.title, 200)) { failures.push({ id: taskId, error: 'Task title is required and must be 200 characters or fewer' }); continue }
    if (!taskWorkflowStates().includes(next.status)) { failures.push({ id: taskId, error: 'Invalid task workflow state' }); continue }
    if (!['High', 'Medium', 'Low'].includes(next.priority)) { failures.push({ id: taskId, error: 'Invalid task priority' }); continue }
    if (!validOptionalDate(next.dueDate)) { failures.push({ id: taskId, error: 'Task due date must be a valid calendar date' }); continue }
    if (candidate.type !== undefined && !validText(next.type, 80)) { failures.push({ id: taskId, error: 'Task type must be between 1 and 80 characters' }); continue }
    if (candidate.blocked !== undefined && typeof next.blocked !== 'boolean') { failures.push({ id: taskId, error: 'Blocked must be a boolean' }); continue }
    const changed = changedFields.some(field => JSON.stringify(task[field]) !== JSON.stringify(next[field]))
    if (!changed) { succeeded.push(task.id); continue }
    const wasDone = isDone(task)
    const previousStatus = task.status
    Object.assign(task, next)
    const isNowDone = isDone(task)
    task.completedAt = isNowDone ? (wasDone ? (task.completedAt || todayLA()) : todayLA()) : undefined
    logWorkEvent({ personId: req.user.personId, actorUserId: req.user.id, taskId: task.id, projectId: task.projectId, action: 'Bulk updated task', statusFrom: previousStatus === task.status ? undefined : previousStatus, statusTo: previousStatus === task.status ? undefined : task.status, summary: task.title, minutes: 0 })
    succeeded.push(task.id)
  }
  if (succeeded.length) {
    auditLog('tasks.bulk.updated', req.user.id, { requested: ids.length, affected: succeeded.length, fields: changedFields })
    persist({ reason: 'tasks-bulk-update' })
  }
  res.json({ requested: ids.length, affected: succeeded.length, succeeded, failures })
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
  const project = { id: offlineCreateId(req, 'projects', nextProjectId), name, code, description: body.description || '', teamId, ownerId, color: body.color || 'purple', status, deadline, createdAt: todayLA(), customFields: body.customFields || {}, sample: false }
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
