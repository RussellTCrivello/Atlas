// First-run setup, sign-in/out, and the signed-in person's own account (who am I, change password, sign out everywhere).
import type { Express, Request, Response } from 'express'
import type { Container } from '../../app/container'
import { publicUser } from '../../presenters/users'
import { handler, clientIp } from '../../util'
import { changePasswordSchema, loginSchema, parse, setupSchema } from '../../validation/schemas'
import { SESSION_COOKIE, auditContext, sessionCookieOptions, sessionHashOf, userOf } from '../context'

function startSession(app: Container, req: Request, res: Response, token: string) {
  // A new token on every sign-in; any session presented with the request is discarded (no session fixation).
  app.sessions.revoke(req.cookies?.[SESSION_COOKIE])
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(app, req))
}

export function registerPublicAuthRoutes(http: Express, app: Container) {
  http.post(
    '/api/setup',
    handler(async (req, res) => {
      const result = await app.auth.setup(parse(setupSchema, req.body), clientIp(req), auditContext(req))
      startSession(app, req, res, result.token)
      res.json({ setup: { configured: true }, user: result.user })
    })
  )

  http.post(
    '/api/auth/login',
    handler(async (req, res) => {
      const result = await app.auth.login(parse(loginSchema, req.body), clientIp(req), auditContext(req))
      startSession(app, req, res, result.token)
      res.json({ user: result.user })
    })
  )

  http.post('/api/auth/logout', (req, res) => {
    app.auth.logout(req.cookies?.[SESSION_COOKIE])
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(app, req), maxAge: undefined })
    res.json({ ok: true })
  })
}

export function registerAccountRoutes(http: Express, app: Container) {
  http.get('/api/auth/me', (req, res) => res.json({ user: publicUser(app.ctx.settings, userOf(req)) }))

  http.post(
    '/api/auth/password',
    handler(async (req, res) => {
      const result = await app.auth.changePassword(
        userOf(req),
        parse(changePasswordSchema, req.body),
        clientIp(req),
        auditContext(req),
        sessionHashOf(req)
      )
      res.json(result)
    })
  )

  http.post('/api/auth/logout-all', (req, res) => {
    app.auth.logoutAll(userOf(req), auditContext(req))
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(app, req), maxAge: undefined })
    res.json({ ok: true })
  })
}
