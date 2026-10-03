// Tags: the labels people put on tasks. Anyone who can write tasks can create one (tagging a task creates it on the way);
// renaming, recolouring and deleting a tag changes every task that carries it, so those need task management rights.
import type { AuditContext } from '../domain/audit-chain'
import { conflict, id as newId, notFound } from '../util'
import type { TagPatchInput, TagInput } from '../validation/records'
import type { AuditService } from './audit'
import type { ServiceContext } from './context'

export class TagService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService
  ) {}

  list() {
    return this.ctx.repos.tags.list()
  }

  private find(rawId: string) {
    const tag = this.ctx.repos.tags.byId(String(rawId))
    if (!tag) throw notFound('Tag not found')
    return tag
  }

  create(body: TagInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      if (repos.tags.byName(body.name)) throw conflict(`There is already a tag called "${body.name}"`, 'DUPLICATE_TAG')
      const tag = { id: newId('tag'), name: body.name, color: body.color || 'blue' }
      repos.tags.insert(tag)
      this.audit.record('tag.created', who, { tagId: tag.id, name: tag.name })
      return { ...tag, tasks: 0 }
    })
  }

  update(rawId: string, body: TagPatchInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const current = this.find(rawId)
      const clash = body.name ? repos.tags.byName(body.name) : undefined
      if (clash && clash.id !== current.id)
        throw conflict(`There is already a tag called "${body.name}"`, 'DUPLICATE_TAG')
      repos.tags.update(current.id, body)
      this.audit.record('tag.updated', who, { tagId: current.id, from: current.name, to: body.name ?? current.name })
      return repos.tags.list().find(tag => tag.id === current.id)!
    })
  }

  /** Delete a tag: it disappears from every task that carries it (the tasks themselves are untouched). */
  delete(rawId: string, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const current = this.find(rawId)
      const tasks = repos.tags.list().find(tag => tag.id === current.id)?.tasks ?? 0
      repos.tags.delete(current.id)
      this.audit.record('tag.deleted', who, { tagId: current.id, name: current.name, tasks })
      return { ok: true, removedFrom: tasks }
    })
  }
}
