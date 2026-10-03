import crypto from 'node:crypto'

export const ROLE_PERMISSIONS = {
  Administrator: ['manageSettings', 'manageUsers', 'manageProjects', 'managePeople', 'manageAlerts', 'manageTasks', 'writeTasks', 'logActivity', 'viewReports', 'exportData', 'removeDemoData'],
  Manager: ['manageProjects', 'managePeople', 'manageAlerts', 'manageTasks', 'writeTasks', 'logActivity', 'viewReports', 'exportData'],
  Developer: ['writeTasks', 'logActivity', 'viewReports', 'exportData'],
  Viewer: ['viewReports', 'exportData']
}

export function createSecurityService({ getStore, boundedInteger, sessions = new Map(), cookieSecure = false, minPasswordLength = 8, maxPasswordLength = 1024, sessionTokenBytes = 32 }) {
  function configuredSessionDays() {
    return boundedInteger(getStore()?.settings?.security?.sessionDays, 14, 1, 365)
  }

  function configuredPasswordMinLength() {
    return Math.max(minPasswordLength, boundedInteger(getStore()?.settings?.security?.passwordMinLength, minPasswordLength, minPasswordLength, 128))
  }

  function sessionCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure || getStore()?.settings?.security?.cookieSecure === true,
      maxAge: 1000 * 60 * 60 * 24 * configuredSessionDays(),
      path: '/'
    }
  }

  function newSession(userId) {
    const token = crypto.randomBytes(sessionTokenBytes).toString('base64url')
    sessions.set(token, { userId, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * configuredSessionDays() })
    if (sessions.size > 5000) {
      const now = Date.now()
      for (const [key, session] of sessions) if (!session || session.expiresAt <= now) sessions.delete(key)
    }
    return token
  }

  function invalidateUserSessions(userId) {
    for (const [token, session] of sessions) if (session?.userId === userId) sessions.delete(token)
  }

  function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex')
    const key = crypto.scryptSync(String(password), salt, 64).toString('hex')
    return `scrypt$${salt}$${key}`
  }

  function verifyPassword(password, user) {
    const stored = user?.passwordHash || user?.password || ''
    if (!stored) return false
    if (!stored.startsWith('scrypt$')) return stored === password
    const [, salt, key] = stored.split('$')
    if (!salt || !key) return false
    const candidate = crypto.scryptSync(String(password), salt, 64)
    const original = Buffer.from(key, 'hex')
    return original.length === candidate.length && crypto.timingSafeEqual(candidate, original)
  }

  function normalizeUserSecrets(user) {
    if (user.password && !user.passwordHash) user.passwordHash = hashPassword(user.password)
    delete user.password
    return user
  }

  function validatePassword(value) {
    return typeof value === 'string' && value.length >= configuredPasswordMinLength() && value.length <= maxPasswordLength
  }

  function permissionsFor(role = 'Viewer') {
    const configured = getStore()?.settings?.permissions?.roles?.[role]?.permissions
    return Array.isArray(configured) ? configured : ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.Viewer
  }

  function can(user, permission) { return permissionsFor(user?.role).includes(permission) }

  function roleRank(role) {
    const rank = Number(getStore()?.settings?.permissions?.roles?.[role]?.rank)
    if (Number.isFinite(rank)) return rank
    return { Viewer: 1, Developer: 2, Manager: 3, Administrator: 4 }[role] || 1
  }

  return {
    sessions,
    configuredSessionDays,
    configuredPasswordMinLength,
    sessionCookieOptions,
    newSession,
    invalidateUserSessions,
    hashPassword,
    verifyPassword,
    normalizeUserSecrets,
    validatePassword,
    permissionsFor,
    can,
    roleRank
  }
}
