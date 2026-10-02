// The sign-in gate every /api route behind it goes through.
import type { NextFunction, Request, Response } from 'express'
import type { Container } from '../app/container'
import type { User } from '../domain/types'
import { HttpError } from '../util'
import { SESSION_COOKIE } from './middleware'

/** The only authenticated endpoints usable while an account is flagged `mustChangePassword`. */
const ALLOWED_WHEN_PASSWORD_CHANGE_REQUIRED =
  /^\/api\/(auth\/(me|password|logout|logout-all)|health|setup\/status)(\?|$)/

export function authenticate(app: Container) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const { user, sessionHash } = app.auth.authenticate(req.cookies?.[SESSION_COOKIE])
      ;(req as any).user = user
      ;(req as any).sessionHash = sessionHash
      if (user.mustChangePassword && !ALLOWED_WHEN_PASSWORD_CHANGE_REQUIRED.test(req.originalUrl))
        return next(new HttpError(403, 'You must choose a new password before continuing', 'PASSWORD_CHANGE_REQUIRED'))
      next()
    } catch (error) {
      next(error)
    }
  }
}

/** Resolve the signed-in user if there is one, without failing the request (used by endpoints with a public view). */
export function optionalUser(app: Container, req: Request): User | null {
  return app.auth.userFor(req.cookies?.[SESSION_COOKIE])?.user ?? null
}
