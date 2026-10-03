// Accounts: who can sign in, with which role. Role changes obey rank (nobody grants or edits a role above their own) and
// the workspace always keeps at least one active administrator.
import type { AuditContext } from '../domain/audit-chain'
import { isAdministrator, roleExists, roleRank } from '../domain/permissions'
import type { User } from '../domain/types'
import { publicAccessUser } from '../presenters/users'
import { hashPassword, hashPasswordSync, validatePassword } from '../security/passwords'
import { HttpError, badRequest, conflict, forbidden, id, notFound } from '../util'
import type { UserCreateInput, UserUpdateInput } from '../validation/schemas'
import type { AuditService } from './audit'
import type { ServiceContext } from './context'
import type { SessionService } from './sessions'

export class UserService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService,
    private sessions: SessionService
  ) {}

  list() {
    const ref = this.ctx.reference()
    return this.ctx.repos.users.list().map(user => publicAccessUser(ref, user))
  }

  /** Is there still at least one active user who can administer the workspace after this change? */
  private adminsAfter(userId: string, change: Partial<User> | 'delete'): number {
    const settings = this.ctx.settings
    return this.ctx.repos.users.list().filter(user => {
      if (user.id === userId) return change !== 'delete' && isAdministrator(settings, { ...user, ...change })
      return isAdministrator(settings, user)
    }).length
  }

  private assertRank(actor: User, role: string) {
    const settings = this.ctx.settings
    if (roleRank(settings, role) > roleRank(settings, actor.role))
      throw forbidden(`You cannot grant or change the "${role}" role: it outranks your own.`)
  }
  private assertEmailFree(email: string, exceptId?: string) {
    if (this.ctx.repos.users.emailTaken(email, exceptId))
      throw conflict('A user with this email already exists', 'DUPLICATE_EMAIL')
  }
  private assertPersonFree(personId: string, exceptId?: string) {
    if (!this.ctx.repos.people.exists(personId)) throw badRequest('The selected person profile does not exist')
    if (this.ctx.repos.users.personLinked(personId, exceptId))
      throw conflict('That person profile already belongs to another account', 'PERSON_ALREADY_LINKED')
  }

  async create(actor: User, body: UserCreateInput, who: AuditContext) {
    const settings = this.ctx.settings
    const role = body.role || 'Viewer'
    if (!roleExists(settings, role)) throw badRequest('Unknown role')
    this.assertRank(actor, role)
    this.assertEmailFree(body.email)
    if (body.personId) this.assertPersonFree(body.personId)
    const weak = validatePassword(body.password, {
      minLength: settings.security.passwordMinLength,
      email: body.email,
      name: body.name
    })
    if (weak) throw new HttpError(400, weak, 'WEAK_PASSWORD')
    const passwordHash = await hashPassword(body.password)
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      this.assertEmailFree(body.email)
      if (body.personId) this.assertPersonFree(body.personId)
      let personId = body.personId
      if (!personId) {
        let teamId = repos.teams.list()[0]?.id
        if (!teamId) {
          teamId = id('team')
          repos.teams.insert({ id: teamId, name: 'Workspace', color: 'purple', sample: false })
        }
        personId = id('person')
        repos.people.insert({
          id: personId,
          name: body.name,
          email: body.email,
          jobTitle: role,
          teamId,
          focus: 'Workspace access',
          capacity: 70,
          status: 'On track',
          color: body.avatarColor || 'purple',
          sample: false
        })
      }
      const now = new Date().toISOString()
      const user: User = {
        id: id('user'),
        name: body.name,
        email: body.email,
        passwordHash,
        role,
        personId,
        avatarColor: body.avatarColor || 'purple',
        active: body.active !== false,
        createdAt: now,
        passwordChangedAt: now,
        // An administrator chose this password, so the person must replace it at first sign-in.
        mustChangePassword: body.mustChangePassword !== false,
        sample: false
      }
      repos.users.insert(user)
      this.audit.record('user.created', who, { userId: user.id, role })
      return publicAccessUser(this.ctx.reference(), user)
    })
  }

  async update(actor: User, rawId: string, body: UserUpdateInput, who: AuditContext) {
    const { repos } = this.ctx
    const settings = this.ctx.settings
    const target = repos.users.byId(rawId)
    if (!target) throw notFound('User not found')
    if (roleRank(settings, target.role) > roleRank(settings, actor.role))
      throw forbidden('You cannot modify an account that outranks yours.')
    if (target.id === actor.id && body.active === false) throw badRequest('You cannot disable your own account')
    if (body.role !== undefined) {
      if (!roleExists(settings, body.role)) throw badRequest('Unknown role')
      this.assertRank(actor, body.role)
    }
    if (body.email !== undefined) this.assertEmailFree(body.email, target.id)
    if (body.personId !== undefined && body.personId !== target.personId)
      this.assertPersonFree(body.personId, target.id)
    const patch: Partial<User> = {}
    if (body.name !== undefined) patch.name = body.name
    if (body.email !== undefined) patch.email = body.email
    if (body.role !== undefined) patch.role = body.role
    if (body.personId !== undefined) patch.personId = body.personId
    if (body.avatarColor !== undefined) patch.avatarColor = body.avatarColor
    if (body.active !== undefined) patch.active = body.active
    if (this.adminsAfter(target.id, patch) === 0)
      throw badRequest('That change would leave the workspace without an active administrator')
    let passwordHash: string | undefined
    if (body.password) {
      const weak = validatePassword(body.password, {
        minLength: settings.security.passwordMinLength,
        email: patch.email || target.email,
        name: patch.name || target.name
      })
      if (weak) throw new HttpError(400, weak, 'WEAK_PASSWORD')
      passwordHash = await hashPassword(body.password)
    }
    const updated = this.ctx.transaction(() => {
      const user = repos.users.byId(target.id)
      if (!user) throw notFound('User not found')
      if (patch.email !== undefined) this.assertEmailFree(patch.email, user.id)
      if (this.adminsAfter(user.id, patch) === 0)
        throw badRequest('That change would leave the workspace without an active administrator')
      const update: Partial<User> = { ...patch }
      if (passwordHash) {
        update.passwordHash = passwordHash
        update.passwordChangedAt = new Date().toISOString()
        update.mustChangePassword = body.mustChangePassword !== false
      } else if (body.mustChangePassword !== undefined) update.mustChangePassword = body.mustChangePassword
      repos.users.update(user.id, update)
      const after = repos.users.byId(user.id)!
      this.audit.record('user.updated', who, {
        userId: user.id,
        roleFrom: user.role,
        roleTo: after.role,
        activeFrom: user.active,
        activeTo: after.active,
        passwordReset: Boolean(passwordHash)
      })
      return publicAccessUser(this.ctx.reference(), after)
    })
    // A reset password or a disabled account must stop working immediately, everywhere.
    if (passwordHash || patch.active === false)
      this.sessions.revokeUser(target.id, target.id === actor.id ? who.sessionHash : undefined)
    return updated
  }

  delete(actor: User, rawId: string, who: AuditContext) {
    const { repos } = this.ctx
    const settings = this.ctx.settings
    const target = repos.users.byId(rawId)
    if (!target) throw notFound('User not found')
    if (target.id === actor.id) throw badRequest('You cannot delete your own account')
    if (roleRank(settings, target.role) > roleRank(settings, actor.role))
      throw forbidden('You cannot delete an account that outranks yours.')
    if (this.adminsAfter(target.id, 'delete') === 0) throw badRequest('You cannot delete the last active administrator')
    this.ctx.transaction(() => {
      repos.users.delete(target.id)
      this.audit.record('user.deleted', who, { userId: target.id, email: target.email, role: target.role })
    })
    this.sessions.revokeUser(target.id)
  }

  /**
   * Command-line recovery for a locked-out account: set a new password (the person must choose another at next sign-in),
   * optionally re-activate the account or change its role. Synchronous on purpose: it runs in a short-lived process.
   */
  resetPasswordFromCommandLine(
    email: string,
    password: string,
    options: { activate?: boolean; role?: string },
    who: AuditContext
  ) {
    const { repos } = this.ctx
    const user = repos.users.byEmail(email)
    if (!user) throw notFound(`No account with email ${email}`)
    if (options.role && !roleExists(this.ctx.settings, options.role)) throw badRequest(`Unknown role ${options.role}`)
    const passwordHash = hashPasswordSync(password)
    this.ctx.transaction(() => {
      repos.users.update(user.id, {
        passwordHash,
        passwordChangedAt: new Date().toISOString(),
        mustChangePassword: true,
        ...(options.activate ? { active: true } : {}),
        ...(options.role ? { role: options.role } : {})
      })
      this.audit.record('user.password.reset.cli', who, {
        userId: user.id,
        activated: Boolean(options.activate),
        role: options.role || undefined
      })
    })
    this.sessions.revokeUser(user.id)
    return user
  }
}
