// Signing in and out, first-run setup, and password changes. Passwords are hashed before a transaction starts (hashing is
// deliberately slow and must not hold the database lock); everything that changes data happens inside one.
import { compactSettingsForStorage, mergePatch, normalizeSettings } from '../../shared/settings'
import type { AuditContext } from '../domain/audit-chain'
import type { SessionUser, User } from '../domain/types'
import { demoSnapshot } from '../seed/demo'
import { publicUser } from '../presenters/users'
import { hashPassword, validatePassword, verifyAgainstDummy, verifyPassword } from '../security/passwords'
import type { LoginThrottle } from '../security/throttle'
import { HttpError, conflict, id, normalizeEmail, safeEqual, truncate } from '../util'
import { settingsProblems, type ChangePasswordInput, type LoginInput, type SetupInput } from '../validation/schemas'
import type { AuditService } from './audit'
import type { ServiceContext } from './context'
import type { SessionService } from './sessions'

function throttled(retryAfterSeconds: number) {
  return new HttpError(
    429,
    `Too many attempts. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
    'RATE_LIMITED',
    { retryAfterSeconds }
  )
}

export interface SignedIn {
  user: SessionUser
  token: string
}

export class AuthService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService,
    private sessions: SessionService,
    private throttle: LoginThrottle
  ) {}

  isConfigured(): boolean {
    return this.ctx.repos.meta.configured()
  }

  /** Resolve the user behind a session cookie, or null. Never throws (used by endpoints that have a public view). */
  userFor(token: unknown): { user: User; sessionHash: string } | null {
    const maxAge = Number(this.ctx.settings?.security?.sessionDays || 14) * 86400000
    const session = this.sessions.resolve(token, maxAge)
    const user = session && this.ctx.repos.users.byId(session.userId)
    return user && session && user.active !== false ? { user, sessionHash: session.hash } : null
  }

  /** The middleware's question: who is this, and may they continue? Throws the right 401/403. */
  authenticate(token: unknown): { user: User; sessionHash: string } {
    const maxAge = Number(this.ctx.settings?.security?.sessionDays || 14) * 86400000
    const session = this.sessions.resolve(token, maxAge)
    const unauthenticated = new HttpError(401, 'Sign in to continue', 'UNAUTHENTICATED')
    if (!session) throw unauthenticated
    const user = this.ctx.repos.users.byId(session.userId)
    if (!user) {
      this.sessions.revoke(token)
      throw unauthenticated
    }
    if (user.active === false) {
      this.sessions.revoke(token)
      throw new HttpError(403, 'This account is disabled', 'ACCOUNT_DISABLED')
    }
    return { user, sessionHash: session.hash }
  }

  async setup(body: SetupInput, ip: string, who: AuditContext): Promise<SignedIn> {
    const { config } = this.ctx
    const decision = this.throttle.check(ip, `setup:${ip}`)
    if (!decision.allowed) throw throttled(decision.retryAfterSeconds)
    this.throttle.attempt(ip)
    // Setup is a one-time operation. Once a workspace exists this endpoint can never touch it again.
    if (this.isConfigured()) throw conflict('This workspace is already set up. Sign in instead.', 'ALREADY_CONFIGURED')
    if (!safeEqual(String(body.token || ''), config.setupToken)) {
      this.throttle.failure(`setup:${ip}`)
      this.audit.push('setup.token.rejected', who, {})
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

    const user = this.ctx.transaction(() => {
      const { repos } = this.ctx
      if (repos.meta.configured())
        throw conflict('This workspace is already set up. Sign in instead.', 'ALREADY_CONFIGURED')
      if (body.includeDemo && config.allowDemoData) repos.snapshot.replaceAll(demoSnapshot(config))
      const personId = id('person')
      const teamId = id('team')
      const workspaceName =
        (body.workspaceName || settingsIn.workspace?.name || 'Atlas Workspace').trim() || 'Atlas Workspace'
      const workspaceUnit = (body.workspaceUnit || settingsIn.workspace?.unit || 'Operations').trim() || 'Operations'
      repos.teams.insert({ id: teamId, name: workspaceUnit, color: 'purple', sample: false })
      repos.people.insert({
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
      const now = new Date().toISOString()
      const created: User = {
        id: id('user'),
        name: body.name,
        email: body.email,
        passwordHash,
        role: 'Administrator',
        personId,
        avatarColor: 'purple',
        active: true,
        createdAt: now,
        passwordChangedAt: now,
        mustChangePassword: false,
        sample: false
      }
      repos.users.insert(created)
      // Administrator-supplied settings are layered over the defaults; nested workspace names always win.
      repos.settings.save(
        compactSettingsForStorage(
          normalizeSettings(
            mergePatch(mergePatch(structuredClone(this.ctx.settings), settingsIn), {
              workspace: { name: workspaceName, unit: workspaceUnit }
            }),
            { timezone: config.defaultTimezone }
          )
        )
      )
      repos.meta.setConfigured(true)
      this.audit.record(
        'setup.completed',
        { actorId: created.id, ip: who.ip, userAgent: who.userAgent },
        { workspaceName, workspaceUnit }
      )
      return created
    })
    return { user: publicUser(this.ctx.settings, user), token: this.sessions.create(user.id) }
  }

  async login(body: LoginInput, ip: string, who: AuditContext): Promise<SignedIn> {
    const account = normalizeEmail(body.email)
    const decision = this.throttle.check(ip, account)
    if (!decision.allowed) {
      this.audit.push('auth.login.throttled', who, { email: truncate(account, 120) })
      throw throttled(decision.retryAfterSeconds)
    }
    this.throttle.attempt(ip)
    const user = this.ctx.repos.users.byEmail(account)
    let verdict = { ok: false, needsRehash: false }
    if (user) verdict = await verifyPassword(body.password, user.passwordHash)
    else await verifyAgainstDummy(body.password) // same cost for unknown accounts: no enumeration by timing
    if (!user || !verdict.ok) {
      this.throttle.failure(account)
      this.audit.push('auth.login.failed', who, { email: truncate(account, 120), known: Boolean(user) })
      throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS')
    }
    if (user.active === false) {
      this.audit.push('auth.login.disabled', { ...who, actorId: user.id }, {})
      throw new HttpError(403, 'This account is disabled. Contact an administrator.', 'ACCOUNT_DISABLED')
    }
    this.throttle.success(account)
    const upgraded = verdict.needsRehash ? await hashPassword(body.password) : null
    const signedIn = this.ctx.transaction(() => {
      const current = this.ctx.repos.users.byId(user.id)
      if (!current || current.active === false)
        throw new HttpError(401, 'Invalid email or password', 'INVALID_CREDENTIALS')
      this.ctx.repos.users.update(current.id, {
        lastLoginAt: new Date().toISOString(),
        ...(upgraded ? { passwordHash: upgraded } : {})
      })
      this.audit.record('auth.login', { actorId: current.id, ip: who.ip, userAgent: who.userAgent }, {})
      return this.ctx.repos.users.byId(current.id)!
    })
    return { user: publicUser(this.ctx.settings, signedIn), token: this.sessions.create(signedIn.id) }
  }

  logout(token: unknown) {
    this.sessions.revoke(token)
  }

  async changePassword(user: User, body: ChangePasswordInput, ip: string, who: AuditContext, sessionHash: string) {
    const key = `pw:${user.id}`
    const decision = this.throttle.check(ip, key)
    if (!decision.allowed) throw throttled(decision.retryAfterSeconds)
    this.throttle.attempt(ip)
    const verdict = await verifyPassword(body.currentPassword, user.passwordHash)
    if (!verdict.ok) {
      this.throttle.failure(key)
      this.audit.push('auth.password.change.failed', who, {})
      throw new HttpError(400, 'Your current password is incorrect', 'INVALID_CREDENTIALS')
    }
    this.throttle.success(key)
    const weak = validatePassword(body.newPassword, {
      minLength: this.ctx.settings.security.passwordMinLength,
      email: user.email,
      name: user.name
    })
    if (weak) throw new HttpError(400, weak, 'WEAK_PASSWORD')
    if (body.newPassword === body.currentPassword)
      throw new HttpError(400, 'Choose a password different from your current one', 'WEAK_PASSWORD')
    const hash = await hashPassword(body.newPassword)
    const updated = this.ctx.transaction(() => {
      const current = this.ctx.repos.users.byId(user.id)
      if (!current) throw new HttpError(401, 'Sign in to continue', 'UNAUTHENTICATED')
      this.ctx.repos.users.update(current.id, {
        passwordHash: hash,
        passwordChangedAt: new Date().toISOString(),
        mustChangePassword: false
      })
      this.audit.record('auth.password.changed', who, {})
      return this.ctx.repos.users.byId(current.id)!
    })
    // Everyone else signed in as this user is signed out; this browser stays signed in.
    const others = this.sessions.revokeUser(user.id, sessionHash)
    return { ok: true, signedOutElsewhere: others, user: publicUser(this.ctx.settings, updated) }
  }

  logoutAll(user: User, who: AuditContext) {
    this.sessions.revokeUser(user.id)
    this.audit.push('auth.logout.all', who, {})
  }
}
