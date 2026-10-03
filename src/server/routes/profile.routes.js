import { AVATAR_COLORS } from '../../lib/constants.js'

const PROFILE_FIELDS = new Set(['name', 'avatarColor'])

export function registerProfileRoutes(app, services) {
  const { store, sendError, requireUser, publicAccessUser, validText, personById, auditLog, persist } = services

  app.get('/api/profile', requireUser, (req, res) => {
    res.json({ user: publicAccessUser(req.user) })
  })

  app.put('/api/profile', requireUser, (req, res) => {
    const body = req.body || {}
    const keys = Object.keys(body)
    if (!keys.length || keys.some(key => !PROFILE_FIELDS.has(key))) {
      return sendError(res, 400, 'Only your display name and avatar color may be changed here')
    }

    const user = store.users.find(candidate => String(candidate.id) === String(req.user.id))
    if (!user) return sendError(res, 404, 'User profile was not found')

    const name = body.name === undefined ? user.name : typeof body.name === 'string' ? body.name.trim() : ''
    const avatarColor = body.avatarColor === undefined ? user.avatarColor || 'purple' : body.avatarColor
    if (!validText(name, 120)) return sendError(res, 400, 'A display name of 1 to 120 characters is required')
    if (typeof avatarColor !== 'string' || !AVATAR_COLORS.includes(avatarColor)) {
      return sendError(res, 400, 'Choose one of the available avatar colors')
    }

    const changed = []
    if (user.name !== name) changed.push('name')
    if ((user.avatarColor || 'purple') !== avatarColor) changed.push('avatarColor')
    if (changed.length) {
      Object.assign(user, { name, avatarColor })
      const person = personById(user.personId)
      if (person) {
        if (changed.includes('name')) person.name = name
        if (changed.includes('avatarColor')) person.color = avatarColor
      }
      auditLog('user.profile.updated', user.id, { fields: changed })
      persist({ reason: 'user-profile' })
    }
    res.json({ user: publicAccessUser(user) })
  })
}
