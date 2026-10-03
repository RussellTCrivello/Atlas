export function registerDirectoryRoutes(app, services) {
  const { store, sendError, requireUser, requirePermission, validText, validEmail, teamReferenceExists, personReferenceExists, projectReferenceExists, taskReferenceExists, customFieldInputError, teamById, todayLA, validOptionalDate, id, personById, projectById, taskById, personPublic, auditLog, persist, offlineCreateId } = services
app.post('/api/people', requireUser, requirePermission('managePeople'), (req, res) => {
  const body = req.body
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const teamId = body.teamId ?? store.teams[0]?.id ?? ''
  const capacity = body.capacity === undefined ? 70 : Number(body.capacity)
  const status = body.status ?? 'On track'
  if (!validText(name, 120) || !validEmail(email)) return sendError(res, 400, 'A name (up to 120 characters) and valid email address are required')
  if (store.people.some(person => String(person.email || '').toLowerCase() === email)) return sendError(res, 409, 'A person with this email already exists')
  if (!teamReferenceExists(teamId)) return sendError(res, 400, 'Selected team does not exist')
  if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) return sendError(res, 400, 'Capacity must be between 0 and 100')
  if (!['On track', 'Needs attention'].includes(status)) return sendError(res, 400, 'Invalid person status')
  const customFieldError = customFieldInputError('people', body.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const person = { id: offlineCreateId(req, 'people', () => id('person')), name, email, jobTitle: typeof body.jobTitle === 'string' ? body.jobTitle.trim().slice(0, 120) : 'Contributor', teamId, focus: typeof body.focus === 'string' ? body.focus.trim().slice(0, 300) : '', capacity, status, color: typeof body.color === 'string' ? body.color.slice(0, 40) : 'purple', customFields: body.customFields || {}, sample: false }
  store.people.push(person)
  auditLog('person.created', req.user.id, { personId: person.id })
  persist({ reason: 'person-create' })
  res.json(personPublic(person))
})
app.put('/api/people/:id', requireUser, requirePermission('managePeople'), (req, res) => {
  const person = personById(req.params.id)
  if (!person) return sendError(res, 404, 'Person not found')
  const body = req.body
  const name = body.name === undefined ? person.name : typeof body.name === 'string' ? body.name.trim() : ''
  const email = body.email === undefined ? person.email : typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const teamId = body.teamId ?? person.teamId
  const capacity = body.capacity === undefined ? person.capacity : Number(body.capacity)
  const status = body.status ?? person.status
  if (!validText(name, 120) || !validEmail(email)) return sendError(res, 400, 'A name (up to 120 characters) and valid email address are required')
  if (store.people.some(row => row.id !== person.id && String(row.email || '').toLowerCase() === email)) return sendError(res, 409, 'A person with this email already exists')
  if (!teamReferenceExists(teamId)) return sendError(res, 400, 'Selected team does not exist')
  if (!Number.isFinite(capacity) || capacity < 0 || capacity > 100) return sendError(res, 400, 'Capacity must be between 0 and 100')
  if (!['On track', 'Needs attention'].includes(status)) return sendError(res, 400, 'Invalid person status')
  const customFieldError = customFieldInputError('people', body.customFields ?? person.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  Object.assign(person, { name, email, teamId, capacity, status, jobTitle: body.jobTitle === undefined ? person.jobTitle : String(body.jobTitle).trim().slice(0, 120), focus: body.focus === undefined ? person.focus : String(body.focus).trim().slice(0, 300), color: body.color ?? person.color, customFields: body.customFields ?? person.customFields ?? {} })
  auditLog('person.updated', req.user.id, { personId: person.id })
  persist({ reason: 'person-update' })
  res.json(personPublic(person))
})
app.delete('/api/people/:id', requireUser, requirePermission('managePeople'), (req, res) => {
  const person = personById(req.params.id)
  if (!person) return sendError(res, 404, 'Person not found')
  if (store.users.some(user => String(user.personId || '') === String(person.id))) return sendError(res, 400, 'This person is linked to a user account and cannot be deleted')
  if (store.tasks.some(task => String(task.assigneeId || '') === String(person.id)) || store.projects.some(project => String(project.ownerId || '') === String(person.id)) || store.activities.some(activity => String(activity.personId || '') === String(person.id)) || (store.workLogs || []).some(log => String(log.personId || '') === String(person.id))) return sendError(res, 409, 'Reassign this person’s work and activity history before deleting the profile')
  store.people = store.people.filter(row => String(row.id) !== String(person.id))
  auditLog('person.deleted', req.user.id, { personId: person.id, name: person.name })
  persist({ reason: 'person-delete' })
  res.json({ ok: true })
})

app.post('/api/teams', requireUser, requirePermission('managePeople'), (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  if (!validText(name, 120)) return sendError(res, 400, 'Team name is required and must be 120 characters or fewer')
  if (store.teams.some(team => team.name.toLowerCase() === name.toLowerCase())) return sendError(res, 409, 'A team with this name already exists')
  const customFieldError = customFieldInputError('teams', req.body.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const team = { id: offlineCreateId(req, 'teams', () => id('team')), name, color: typeof req.body.color === 'string' ? req.body.color.slice(0, 40) : 'purple', customFields: req.body.customFields || {}, sample: false }
  store.teams.push(team)
  auditLog('team.created', req.user.id, { teamId: team.id })
  persist({ reason: 'team-create' })
  res.json(team)
})
app.put('/api/teams/:id', requireUser, requirePermission('managePeople'), (req, res) => {
  const team = teamById(req.params.id)
  if (!team) return sendError(res, 404, 'Team not found')
  const name = req.body.name === undefined ? team.name : typeof req.body.name === 'string' ? req.body.name.trim() : ''
  if (!validText(name, 120)) return sendError(res, 400, 'Team name is required and must be 120 characters or fewer')
  if (store.teams.some(row => row.id !== team.id && row.name.toLowerCase() === name.toLowerCase())) return sendError(res, 409, 'A team with this name already exists')
  const customFieldError = customFieldInputError('teams', req.body.customFields ?? team.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  Object.assign(team, { name, color: req.body.color ?? team.color, customFields: req.body.customFields ?? team.customFields ?? {} })
  auditLog('team.updated', req.user.id, { teamId: team.id })
  persist({ reason: 'team-update' })
  res.json(team)
})
app.delete('/api/teams/:id', requireUser, requirePermission('managePeople'), (req, res) => {
  const team = teamById(req.params.id)
  if (!team) return sendError(res, 404, 'Team not found')
  if (store.people.some(person => person.teamId === team.id) || store.projects.some(project => project.teamId === team.id)) return sendError(res, 400, 'Move people and projects before deleting this team')
  store.teams = store.teams.filter(row => row.id !== team.id)
  auditLog('team.deleted', req.user.id, { teamId: team.id })
  persist({ reason: 'team-delete' })
  res.json({ ok: true })
})

app.post('/api/milestones', requireUser, requirePermission('manageProjects'), (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : ''
  const project = projectById(req.body.projectId ?? store.projects[0]?.id)
  const dueDate = req.body.dueDate ?? todayLA()
  const status = req.body.status ?? 'Upcoming'
  if (!validText(name, 160)) return sendError(res, 400, 'Milestone name is required and must be 160 characters or fewer')
  if (!project) return sendError(res, 400, 'A valid project is required')
  if (!validOptionalDate(dueDate)) return sendError(res, 400, 'Milestone due date must be a valid calendar date')
  if (!['Upcoming', 'At risk', 'Complete'].includes(status)) return sendError(res, 400, 'Invalid milestone status')
  const customFieldError = customFieldInputError('milestones', req.body.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  const milestone = { id: offlineCreateId(req, 'milestones', () => id('milestone')), name, projectId: project.id, dueDate, status, customFields: req.body.customFields || {}, sample: false }
  store.milestones.push(milestone)
  auditLog('milestone.created', req.user.id, { milestoneId: milestone.id })
  persist({ reason: 'milestone-create' })
  res.json(milestone)
})
app.put('/api/milestones/:id', requireUser, requirePermission('manageProjects'), (req, res) => {
  const milestone = store.milestones.find(row => String(row.id) === String(req.params.id))
  if (!milestone) return sendError(res, 404, 'Milestone not found')
  const name = req.body.name === undefined ? milestone.name : typeof req.body.name === 'string' ? req.body.name.trim() : ''
  const project = projectById(req.body.projectId ?? milestone.projectId)
  const dueDate = req.body.dueDate ?? milestone.dueDate
  const status = req.body.status ?? milestone.status
  if (!validText(name, 160)) return sendError(res, 400, 'Milestone name is required and must be 160 characters or fewer')
  if (!project) return sendError(res, 400, 'A valid project is required')
  if (!validOptionalDate(dueDate)) return sendError(res, 400, 'Milestone due date must be a valid calendar date')
  if (!['Upcoming', 'At risk', 'Complete'].includes(status)) return sendError(res, 400, 'Invalid milestone status')
  const customFieldError = customFieldInputError('milestones', req.body.customFields ?? milestone.customFields ?? {})
  if (customFieldError) return sendError(res, 400, customFieldError)
  Object.assign(milestone, { name, projectId: project.id, dueDate, status, customFields: req.body.customFields ?? milestone.customFields ?? {} })
  auditLog('milestone.updated', req.user.id, { milestoneId: milestone.id })
  persist({ reason: 'milestone-update' })
  res.json(milestone)
})
app.delete('/api/milestones/:id', requireUser, requirePermission('manageProjects'), (req, res) => {
  const milestone = store.milestones.find(row => String(row.id) === String(req.params.id))
  if (!milestone) return sendError(res, 404, 'Milestone not found')
  store.milestones = store.milestones.filter(row => row !== milestone)
  auditLog('milestone.deleted', req.user.id, { milestoneId: milestone.id })
  persist({ reason: 'milestone-delete' })
  res.json({ ok: true })
})
}
