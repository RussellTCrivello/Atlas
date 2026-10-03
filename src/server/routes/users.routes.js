export function registerUserRoutes(app, services) {
  const { store, sendError, requireUser, requireAdmin, normalizeEmail, validEmail, configuredPasswordMinLength, MAX_PASSWORD_LENGTH, hashPassword, publicAccessUser, personById, id, auditLog, persist, invalidateUserSessions, auditRead, validText } = services
app.get('/api/users', requireUser, requireAdmin, (req, res) => { auditRead('users', req.user.id); res.json(store.users.map(publicAccessUser)) })
app.post('/api/users', requireUser, requireAdmin, (req, res) => {
  const body = req.body
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = body.password
  const role = body.role ?? 'Viewer'
  if (!validText(name, 120) || !validEmail(email) || typeof password !== 'string' || password.length < configuredPasswordMinLength() || password.length > MAX_PASSWORD_LENGTH) return sendError(res, 400, `Name, valid email, and a password of at least ${configuredPasswordMinLength()} characters are required`)
  if (!Object.hasOwn(store.settings.permissions.roles, role)) return sendError(res, 400, 'Unknown role')
  if (store.users.some(user => normalizeEmail(user.email) === email)) return sendError(res, 409, 'A user with this email already exists')
  if (body.active !== undefined && typeof body.active !== 'boolean') return sendError(res, 400, 'Active must be a boolean')
  if (body.personId && !personById(body.personId)) return sendError(res, 400, 'Linked person does not exist')
  let linkedPersonId = body.personId || ''
  if (!linkedPersonId) {
    const teamId = store.teams[0]?.id || id('team')
    if (!store.teams.some(team => team.id === teamId)) store.teams.push({ id: teamId, name: 'Workspace', color: 'purple', sample: false })
    linkedPersonId = id('person')
    store.people.push({ id: linkedPersonId, name, email, jobTitle: role, teamId, focus: 'Workspace access', capacity: 70, status: 'On track', color: body.avatarColor || 'purple', customFields: {}, sample: false })
  }
  const user = { id: id('user'), name, email, passwordHash: hashPassword(password), role, personId: linkedPersonId, avatarColor: typeof body.avatarColor === 'string' ? body.avatarColor.slice(0, 40) : 'purple', active: body.active !== false, createdAt: new Date().toISOString(), sample: false }
  store.users.push(user)
  auditLog('user.created', req.user.id, { userId: user.id, role })
  persist({ reason: 'user-create' })
  res.json(publicAccessUser(user))
})
app.put('/api/users/:id', requireUser, requireAdmin, (req, res) => {
  const user = store.users.find(item => String(item.id) === String(req.params.id))
  if (!user) return sendError(res, 404, 'User not found')
  const body = req.body
  const name = body.name === undefined ? user.name : typeof body.name === 'string' ? body.name.trim() : ''
  const email = body.email === undefined ? user.email : typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const role = body.role ?? user.role
  const active = body.active === undefined ? user.active !== false : body.active
  const personId = body.personId === undefined ? user.personId : body.personId || ''
  if (!validText(name, 120) || !validEmail(email)) return sendError(res, 400, 'Name and a valid email address are required')
  if (store.users.some(row => row.id !== user.id && normalizeEmail(row.email) === email)) return sendError(res, 409, 'A user with this email already exists')
  if (!Object.hasOwn(store.settings.permissions.roles, role)) return sendError(res, 400, 'Unknown role')
  if (typeof active !== 'boolean') return sendError(res, 400, 'Active must be a boolean')
  if (personId && !personById(personId)) return sendError(res, 400, 'Linked person does not exist')
  if (body.password !== undefined && body.password !== '' && (typeof body.password !== 'string' || body.password.length < configuredPasswordMinLength() || body.password.length > MAX_PASSWORD_LENGTH)) return sendError(res, 400, `Password must be between ${configuredPasswordMinLength()} and ${MAX_PASSWORD_LENGTH} characters`)
  if (user.role === 'Administrator' && user.active !== false && (role !== 'Administrator' || !active)) {
    const anotherActiveAdmin = store.users.some(candidate => candidate.id !== user.id && candidate.role === 'Administrator' && candidate.active !== false)
    if (!anotherActiveAdmin) return sendError(res, 400, 'You cannot disable or demote the last active administrator')
  }
  Object.assign(user, { name, email, role, personId, avatarColor: typeof body.avatarColor === 'string' ? body.avatarColor.slice(0, 40) : user.avatarColor, active })
  const passwordChanged = typeof body.password === 'string' && body.password.length > 0
  if (passwordChanged) {
    user.passwordHash = hashPassword(body.password)
    delete user.password
  }
  if (passwordChanged || !active) invalidateUserSessions(user.id)
  auditLog('user.updated', req.user.id, { userId: user.id, role: user.role, active: user.active, passwordChanged })
  persist({ reason: 'user-update' })
  res.json(publicAccessUser(user))
})
app.delete('/api/users/:id', requireUser, requireAdmin, (req, res) => {
  if (String(req.params.id) === String(req.user.id)) return sendError(res, 400, 'You cannot delete your own account')
  const target = store.users.find(user => String(user.id) === String(req.params.id))
  if (!target) return sendError(res, 404, 'User not found')
  if (target.role === 'Administrator' && target.active !== false && store.users.filter(user => user.role === 'Administrator' && user.active !== false && user.id !== target.id).length === 0) return sendError(res, 400, 'You cannot delete the last active administrator')
  store.users = store.users.filter(user => user.id !== target.id)
  invalidateUserSessions(target.id)
  auditLog('user.deleted', req.user.id, { userId: target.id, role: target.role })
  persist({ reason: 'user-delete' })
  res.json({ ok: true })
})
}
