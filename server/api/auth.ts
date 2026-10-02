// First-run setup, sign-in/out, password change, and the authentication middleware.
import type { Express, NextFunction, Request, Response } from 'express'
import { compactSettingsForStorage, mergePatch, normalizeSettings } from '../../shared/settings'
import { hashPassword, validatePassword, verifyAgainstDummy, verifyPassword } from '../auth'
import { appendAudit } from '../audit'
import { demoStore, DEMO_ACCOUNTS } from '../demo'
import { can } from '../domain'
import { emptyState } from '../migrations'
import { publicUser } from '../presenters'
import { buildIndex } from '../domain'
import { changePasswordSchema, loginSchema, parse, setupSchema, settingsProblems } from '../schemas'
import type { User } from '../types'
import { HttpError, clientIp, conflict, handler, id, normalizeEmail, safeEqual, truncate } from '../util'
import { type Deps, SESSION_COOKIE, auditContext, sessionCookieOptions, sessionHashOf, userOf } from './context'
import { isLoopbackHost } from '../config'

/** The only authenticated endpoints usable while an account is flagged `mustChangePassword`. */
const ALLOWED_WHEN_PASSWORD_CHANGE_REQUIRED =
  /^\/api\/(auth\/(me|password|logout|logout-all)|health|setup\/status)(\?|$)/

export function authenticate(deps: Deps) {
  return (req: Request, res: Response, next: NextFunction) => {
    const { db, sessions } = deps
    const settings = db.state.settings
    const maxAge = Number(settings?.security?.sessionDays || 14) * 86400000
    const token = req.cookies?.[SESSION_COOKIE]
    const session = sessions.resolve(token, maxAge)
    const unauthenticated = new HttpError(401, 'Sign in to continue', 'UNAUTHENTICATED')
    if (!session) return next(unauthenticated)
    const user = db.state.users.find(candidate => candidate.id === session.userId)
    if (!user) {
      sessions.revoke(token)
      return next(unauthenticated)
    }
    if (user.active === false) {
      sessions.revoke(token)
      return next(new HttpError(403, 'This account is disabled', 'ACCOUNT_DISABLED'))
    }
    ;(req as any).user = user
    ;(req as any).sessionHash = session.hash
    if (user.mustChangePassword && !ALLOWED_WHEN_PASSWORD_CHANGE_REQUIRED.test(req.originalUrl))
      return next(new HttpError(403, 'You must choose a new password before continuing', 'PASSWORD_CHANGE_REQUIRED'))
    next()
  }
}

/** Resolve the signed-in user if there is one, without failing the request (used by endpoints with a public view). */
export function optionalUser(deps: Deps, req: Request): User | null {
  const maxAge = Number(deps.db.state.settings?.security?.sessionDays || 14) * 86400000
  const session = deps.sessions.resolve(req.cookies?.[SESSION_COOKIE], maxAge)
  const user = session && deps.db.state.users.find(candidate => candidate.id === session.userId)
  return user && user.active !== false ? user : null
}

function startSession(deps: Deps, req: Request, res: Response, user: User) {
  // A new token on every sign-in; any session presented with the request is discarded (no session fixation).
  deps.sessions.revoke(req.cookies?.[SESSION_COOKIE])
  const token = deps.sessions.create(user.id)
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(deps, req))
}

function throttled(retryAfterSeconds: number) {
  return new HttpError(
    429,
    `Too many attempts. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
    'RATE_LIMITED',
    { retryAfterSeconds }
  )
}

export function registerPublicAuthRoutes(app: Express, deps: Deps) {
  const { db, config, throttle, sessions } = deps

  app.get('/api/setup/status', (req, res) => {
    const configured = Boolean(db.state.configured)
    // Demo credentials are public by design but are only ever offered by a development server, to the local machine.
    const demoVisible =
      config.allowDemoData && !config.isProduction && isLoopbackHost(clientIp(req).replace(/^::ffff:/, ''))
    res.json({
      configured,
      tokenRequired: !configured,
      demoAllowed: demoVisible,
      demo: demoVisible
        ? { email: DEMO_ACCOUNTS[0].email, password: DEMO_ACCOUNTS[0].password, accounts: DEMO_ACCOUNTS }
        : null
    })
  })

  app.post(
    '/api/setup',
    handler(async (req, res) => {
      const ip = clientIp(req)
      const decision = throttle.check(ip, `setup:${ip}`)
      if (!decision.allowed) throw throttled(decision.retryAfterSeconds)
      throttle.attempt(ip)
      // Setup is a one-time operation. Once a workspace exists this endpoint can never touch it again.
      if (db.state.configured)
        throw conflict('This workspace is already set up. Sign in instead.', 'ALREADY_CONFIGURED')
      const body = parse(setupSchema, req.body)
      if (!safeEqual(String(body.token || ''), config.setupToken)) {
        throttle.failure(`setup:${ip}`)
        deps.audit.push('setup.token.rejected', auditContext(req), {})
        throw new HttpError(
          403,
          'A valid setup token is required. It was printed in the server console when Atlas started (or set ATLAS_SETUP_TOKEN).',
          'SETUP_TOKEN_REQUIRED'
        )
      }
      const settingsIn = (body.settings || {}) as Record<string, any>
      const problems = settingsProblems(settingsIn)
      if (problems.length) throw new HttpError(400, `Invalid settings. ${problems[0]}`, 'VALIDATION_FAILED', problems)
      const weak = validatePassword(body.password, {
        minLength: Number(settingsIn.security?.passwordMinLength) || 8,
        email: body.email,
        name: body.name
      })
      if (weak) throw new HttpError(400, weak, 'WEAK_PASSWORD')
      const passwordHash = await hashPassword(body.password)

      const user = db.commit(
        state => {
          if (state.configured)
            throw conflict('This workspace is already set up. Sign in instead.', 'ALREADY_CONFIGURED')
          if (body.includeDemo && config.allowDemoData) {
            const demo = demoStore(config)
            for (const key of Object.keys(state)) delete (state as any)[key]
            Object.assign(state, demo)
          }
          const personId = id('person')
          const teamId = id('team')
          const workspaceName =
            (body.workspaceName || settingsIn.workspace?.name || 'Atlas Workspace').trim() || 'Atlas Workspace'
          const workspaceUnit =
            (body.workspaceUnit || settingsIn.workspace?.unit || 'Operations').trim() || 'Operations'
          state.teams.push({ id: teamId, name: workspaceUnit, color: 'purple', sample: false })
          state.people.push({
            id: personId,
            name: body.name,
            email: body.email,
            jobTitle: 'Workspace Administrator',
            teamId,
            focus: 'Workspace setup',
            capacity: 75,
            status: 'On track',
            color: 'purple',
            sample: false
          })
          const created: User = {
            id: id('user'),
            name: body.name,
            email: body.email,
            passwordHash,
            role: 'Administrator',
            personId,
            avatarColor: 'purple',
            active: true,
            createdAt: new Date().toISOString(),
            passwordChangedAt: new Date().toISOString(),
            mustChangePassword: false,
            sample: false
          }
          state.users.push(created)
          // Administrator-supplied settings are layered over the defaults; nested workspace names always win.
          state.settings = compactSettingsForStorage(
            normalizeSettings(
              mergePatch(mergePatch(state.settings, settingsIn), {
                workspace: { name: workspaceName, unit: workspaceUnit }
              }),
              { timezone: config.defaultTimezone }
            )
          )
          state.configured = true
          appendAudit(
            state,
            'setup.completed',
            { actorId: created.id, ip, userAgent: req.get('user-agent') || undefined },
            { workspaceName, workspaceUnit }
          )
          return created
        },
        { reason: 'setup' }
      )
      startSession(deps, req, res, user)
      res.json({ setup: { configured: true }, user: publicUser(buildIndex(db.state), user) })
    })
  )

  app.post(
    '/api/auth/login',
    handler(async (req, res) => {
      const { email, password } = parse(loginSchema, req.body)
      const ip = clientIp(req)
      const account = normalizeEmail(email)
      const decision = throttle.check(ip, account)
      if (!decision.allowed) {
        deps.audit.push('auth.login.throttled', auditContext(req), { email: truncate(account, 120) })
        throw throttled(decision.retryAfterSeconds)
      }
      throttle.attempt(ip)
      const user = db.state.users.find(candidate => normalizeEmail(candidate.email) === account)
      let verdict = { ok: false, needsRehash: false }
      if (user) verdict = await verifyPassword(password, user.passwordHash)
      else await verifyAgainstDummy(password) // same cost for unknown accounts: no enumeration by timing
      if (!user || !verdict.ok) {
        throttle.failure(account)
        deps.audit.push('auth.login.failed', auditContext(req), { email: truncate(account, 120), known: Boolean(user) })
        throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS')
      }
      if (user.active === false) {
        deps.audit.push('auth.login.disabled', { ...auditContext(req), actorId: user.id }, {})
        throw new HttpError(403, 'This account is disabled. Contact an administrator.', 'ACCOUNT_DISABLED')
      }
      throttle.success(account)
      const upgraded = verdict.needsRehash ? await hashPassword(password) : null
      const signedIn = db.commit(
        state => {
          const current = state.users.find(candidate => candidate.id === user.id)
          if (!current || current.active === false)
            throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS')
          current.lastLoginAt = new Date().toISOString()
          if (upgraded) current.passwordHash = upgraded
          appendAudit(
            state,
            'auth.login',
            { actorId: current.id, ip, userAgent: req.get('user-agent') || undefined },
            {}
          )
          return current
        },
        { reason: 'login' }
      )
      startSession(deps, req, res, signedIn)
      res.json({ user: publicUser(buildIndex(db.state), signedIn) })
    })
  )

  app.post('/api/auth/logout', (req, res) => {
    sessions.revoke(req.cookies?.[SESSION_COOKIE])
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(deps, req), maxAge: undefined })
    res.json({ ok: true })
  })
}

export function registerAccountRoutes(app: Express, deps: Deps) {
  const { db, sessions, throttle } = deps

  app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(buildIndex(db.state), userOf(req)) }))

  app.post(
    '/api/auth/password',
    handler(async (req, res) => {
      const user = userOf(req)
      const { currentPassword, newPassword } = parse(changePasswordSchema, req.body)
      const ip = clientIp(req)
      const key = `pw:${user.id}`
      const decision = throttle.check(ip, key)
      if (!decision.allowed) throw throttled(decision.retryAfterSeconds)
      throttle.attempt(ip)
      const verdict = await verifyPassword(currentPassword, user.passwordHash)
      if (!verdict.ok) {
        throttle.failure(key)
        deps.audit.push('auth.password.change.failed', auditContext(req), {})
        throw new HttpError(400, 'Your current password is incorrect', 'INVALID_CREDENTIALS')
      }
      throttle.success(key)
      const weak = validatePassword(newPassword, {
        minLength: db.state.settings.security.passwordMinLength,
        email: user.email,
        name: user.name
      })
      if (weak) throw new HttpError(400, weak, 'WEAK_PASSWORD')
      if (newPassword === currentPassword)
        throw new HttpError(400, 'Choose a password different from your current one', 'WEAK_PASSWORD')
      const hash = await hashPassword(newPassword)
      const updated = db.commit(
        state => {
          const current = state.users.find(candidate => candidate.id === user.id)
          if (!current) throw new HttpError(401, 'Sign in to continue', 'UNAUTHENTICATED')
          current.passwordHash = hash
          current.passwordChangedAt = new Date().toISOString()
          current.mustChangePassword = false
          appendAudit(state, 'auth.password.changed', auditContext(req), {})
          return current
        },
        { reason: 'password-change' }
      )
      // Everyone else signed in as this user is signed out; this browser stays signed in.
      const others = sessions.revokeUser(user.id, sessionHashOf(req))
      res.json({ ok: true, signedOutElsewhere: others, user: publicUser(buildIndex(db.state), updated) })
    })
  )

  app.post('/api/auth/logout-all', (req, res) => {
    const user = userOf(req)
    sessions.revokeUser(user.id)
    deps.audit.push('auth.logout.all', auditContext(req), {})
    res.clearCookie(SESSION_COOKIE, { ...sessionCookieOptions(deps, req), maxAge: undefined })
    res.json({ ok: true })
  })
}

export { can }
