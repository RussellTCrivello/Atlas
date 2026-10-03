// Saved views: a person's named table settings (columns, order, widths, sort, filters, page size) for one screen. Views are
// private to their owner; an administrator can share one with everybody. The settings themselves are the browser's business and
// are stored as given (bounded in size); the server decides who may see, change and share them.
import type { AuditContext } from '../domain/audit-chain'
import { can } from '../domain/permissions'
import type { User } from '../domain/types'
import type { SavedView } from '../repositories/views'
import { conflict, forbidden, id as newId, notFound, badRequest } from '../util'
import type { ViewInput, ViewPatchInput } from '../validation/records'
import type { AuditService } from './audit'
import type { ServiceContext } from './context'

export const MAX_VIEWS_PER_SCREEN = 50

export class ViewService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService
  ) {}

  private present(view: SavedView, user: User) {
    const { userId, ...rest } = view
    return { ...rest, mine: userId === user.id }
  }

  /** The person's own views and the shared ones for a screen. */
  list(user: User, scope: string) {
    return this.ctx.repos.views.visibleTo(user.id, scope).map(view => this.present(view, user))
  }

  private mayShare(user: User) {
    return can(this.ctx.settings, user, 'manageSettings')
  }

  private mineOrThrow(user: User, rawId: string): SavedView {
    const view = this.ctx.repos.views.byId(String(rawId))
    // Another person's private view does not exist as far as this person can tell.
    if (!view || (view.userId !== user.id && !view.shared)) throw notFound('View not found')
    return view
  }

  create(user: User, body: ViewInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      if (body.shared && !this.mayShare(user))
        throw forbidden('Sharing a view with everybody needs the "manageSettings" permission.')
      if (repos.views.nameTaken(user.id, body.scope, body.name))
        throw conflict(`You already have a view called "${body.name}"`, 'DUPLICATE_VIEW')
      if (repos.views.countFor(user.id, body.scope) >= MAX_VIEWS_PER_SCREEN)
        throw badRequest(`At most ${MAX_VIEWS_PER_SCREEN} saved views per screen. Delete one you no longer use.`)
      const now = new Date().toISOString()
      const view: SavedView = {
        id: newId('view'),
        userId: user.id,
        scope: body.scope,
        name: body.name,
        config: body.config,
        shared: Boolean(body.shared),
        isDefault: Boolean(body.isDefault),
        createdAt: now,
        updatedAt: now
      }
      if (view.isDefault) repos.views.clearDefault(user.id, view.scope)
      repos.views.insert(view)
      if (view.shared) this.audit.record('view.shared', who, { viewId: view.id, scope: view.scope, name: view.name })
      return this.present(view, user)
    })
  }

  update(user: User, rawId: string, body: ViewPatchInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const current = this.mineOrThrow(user, rawId)
      if (current.userId !== user.id)
        throw forbidden('This view belongs to somebody else. Save a copy of it under your own name.')
      if (body.shared !== undefined && body.shared !== current.shared && !this.mayShare(user))
        throw forbidden('Sharing a view with everybody needs the "manageSettings" permission.')
      if (body.name && repos.views.nameTaken(user.id, current.scope, body.name, current.id))
        throw conflict(`You already have a view called "${body.name}"`, 'DUPLICATE_VIEW')
      if (body.isDefault) repos.views.clearDefault(user.id, current.scope)
      repos.views.update(current.id, body)
      const stored = repos.views.byId(current.id)!
      if (stored.shared || current.shared)
        this.audit.record('view.updated', who, { viewId: stored.id, scope: stored.scope, shared: stored.shared })
      return this.present(stored, user)
    })
  }

  /** The owner can delete their view; an administrator can also remove a shared one that somebody else made. */
  delete(user: User, rawId: string, who: AuditContext) {
    return this.ctx.transaction(() => {
      const current = this.mineOrThrow(user, rawId)
      if (current.userId !== user.id && !(current.shared && this.mayShare(user)))
        throw forbidden('This view belongs to somebody else.')
      this.ctx.repos.views.delete(current.id)
      if (current.shared)
        this.audit.record('view.deleted', who, { viewId: current.id, scope: current.scope, name: current.name })
      return { ok: true }
    })
  }
}
