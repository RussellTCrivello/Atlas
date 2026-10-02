// What route handlers share: who is making the request, how to record it in the audit trail, and the permission gate.
import type { Request, RequestHandler } from 'express'
import type { Container } from '../app/container'
import type { AuditContext } from '../domain/audit-chain'
import { can } from '../domain/permissions'
import type { User } from '../domain/types'
import { HttpError, clientIp, truncate } from '../util'
import { SESSION_COOKIE } from './middleware'

export const userOf = (req: Request): User => (req as any).user as User
/** A path parameter as text (Express types allow arrays for wildcard routes). */
export const param = (req: Request, name = 'id'): string => String(req.params[name])
export const sessionHashOf = (req: Request): string => (req as any).sessionHash as string

/** Who and from where, for the audit trail. */
export function auditContext(req: Request): AuditContext {
  const user = (req as any).user as User | undefined
  return {
    actorId: user?.id,
    ip: clientIp(req),
    userAgent: req.get('user-agent') || undefined,
    sessionHash: (req as any).sessionHash
  }
}

/** Require a permission (or any one of several); denials are recorded in the audit trail. */
export function requirePermission(
  app: Container,
  permission: string | string[],
  message = 'You do not have permission to complete this action'
): RequestHandler {
  const anyOf = Array.isArray(permission) ? permission : [permission]
  return (req, _res, next) => {
    const user = userOf(req)
    if (!anyOf.some(candidate => can(app.ctx.settings, user, candidate))) {
      app.audit.push('access.denied', auditContext(req), {
        method: req.method,
        path: truncate(req.originalUrl.split('?')[0], 160),
        permission: anyOf.join(' | ')
      })
      return next(new HttpError(403, message, 'FORBIDDEN'))
    }
    next()
  }
}

export function sessionCookieOptions(app: Container, req: Request) {
  const days = Number(app.ctx.settings?.security?.sessionDays || 14)
  const secure = app.config.cookieSecure === 'auto' ? Boolean(req.secure) : app.config.cookieSecure
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: days * 86400000 }
}

export { SESSION_COOKIE }
