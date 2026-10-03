export function createAuthMiddleware({ getStore, sessions, can, invalidateUserSessions, sendError }) {
  function requireUser(req, res, next) {
    const sid = req.cookies?.atlas_sid
    const session = sid && sessions.get(sid)
    if (!session || session.expiresAt <= Date.now()) {
      if (sid) sessions.delete(sid)
      return sendError(res, 401, 'Sign in to continue')
    }
    const user = getStore()?.users?.find(candidate => candidate.id === session.userId)
    if (!user) {
      sessions.delete(sid)
      return sendError(res, 401, 'Sign in to continue')
    }
    if (user.active === false) {
      invalidateUserSessions(user.id)
      return sendError(res, 403, 'This account is disabled')
    }
    req.user = user
    next()
  }

  function optionalUser(req, res, next) {
    const sid = req.cookies?.atlas_sid
    const session = sid && sessions.get(sid)
    if (!session || session.expiresAt <= Date.now()) {
      if (sid) sessions.delete(sid)
      req.user = null
      return next()
    }
    const user = getStore()?.users?.find(candidate => candidate.id === session.userId)
    if (!user) {
      sessions.delete(sid)
      req.user = null
      return next()
    }
    if (user.active === false) {
      invalidateUserSessions(user.id)
      req.user = null
      return next()
    }
    req.user = user
    next()
  }

  function requirePermission(permission, message = 'You do not have permission to complete this action') {
    return (req, res, next) => {
      if (!can(req.user, permission)) return sendError(res, 403, message)
      next()
    }
  }

  function requireManager(req, res, next) {
    if (!can(req.user, 'manageProjects') && !can(req.user, 'managePeople') && !can(req.user, 'manageAlerts')) return sendError(res, 403, 'Manager or administrator access required')
    next()
  }

  function requireAdmin(req, res, next) {
    if (req.user?.role !== 'Administrator' || !can(req.user, 'manageSettings')) return sendError(res, 403, 'Administrator access required')
    next()
  }

  return { requireUser, optionalUser, requirePermission, requireManager, requireAdmin }
}
