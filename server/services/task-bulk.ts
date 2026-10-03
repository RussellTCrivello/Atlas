// Working on many tasks at once: bulk edit, status, assignment, tags and delete (all explicit lists of ids, each record processed
// on its own so that one that cannot be changed is reported while the rest go ahead), undo of a delete, duplicating a task, and
// reading one task with its history.
import type { AuditContext } from '../domain/audit-chain'
import { can } from '../domain/permissions'
import type { User } from '../domain/types'
import { workLogPublic } from '../presenters/activity'
import type { TaskFilter, TaskSort } from '../repositories/tasks'
import { badRequest, forbidden, id as newId, notFound } from '../util'
import type { TaskBulkInput } from '../validation/records'
import type { TaskUpdateInput } from '../validation/schemas'
import type { AuditService } from './audit'
import { type BatchResult, runBatch } from './batch'
import { type ServiceContext, actorOf, numericId } from './context'
import type { TaskService } from './tasks'

export const TRASH_DAYS = 30
export const MAX_SELECTION = 10_000

export class TaskBulkService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService,
    private tasks: TaskService
  ) {}

  private labelOf = (id: number) => {
    const task = this.ctx.repos.tasks.byId(id)
    return task ? `${task.key} · ${task.title}` : `Task ${id}`
  }

  /** Apply one action to the listed tasks. Returns how many were changed and, for each one that could not be, why. */
  bulk(user: User, input: TaskBulkInput, who: AuditContext): BatchResult & { batch?: string } {
    const { repos } = this.ctx
    const ids = input.ids.map(Number).filter(Number.isInteger)
    if (!ids.length) throw badRequest('Select at least one task')
    if (input.action === 'delete' && !can(this.ctx.settings, user, 'manageTasks'))
      throw forbidden('Deleting tasks needs the "manageTasks" permission.')
    const quiet = { audit: false }
    const tagNames = (id: number) => (repos.tags.forTasks([id]).get(id) || []).map(tag => tag.name)
    let batch: string | undefined
    let work: (id: number) => void
    switch (input.action) {
      case 'status':
        work = id => void this.tasks.setStatus(user, id, { status: input.status }, who, quiet)
        break
      case 'assign':
        work = id => void this.tasks.update(user, id, { assigneeId: input.assigneeId }, who, quiet)
        break
      case 'edit': {
        const patch: TaskUpdateInput = {}
        if (input.priority) patch.priority = input.priority
        if (input.type) patch.type = input.type
        if (input.dueDate !== undefined) patch.dueDate = input.dueDate
        if (input.blocked !== undefined) patch.blocked = input.blocked
        if (input.projectId !== undefined) patch.projectId = Number(input.projectId)
        if (!Object.keys(patch).length) throw badRequest('Choose at least one field to change')
        work = id => void this.tasks.update(user, id, patch, who, quiet)
        break
      }
      case 'tag':
        work = id =>
          void this.tasks.update(user, id, { tags: [...new Set([...tagNames(id), ...input.tags])] }, who, quiet)
        break
      case 'untag': {
        const drop = new Set(input.tags.map(name => name.toLowerCase()))
        work = id =>
          void this.tasks.update(
            user,
            id,
            { tags: tagNames(id).filter(name => !drop.has(name.toLowerCase())) },
            who,
            quiet
          )
        break
      }
      case 'delete':
        batch = input.batch || newId('trash')
        work = id => void this.tasks.delete(user, id, who, { audit: false, batch })
        break
    }
    const { action, ids: _ids, ...params } = input as Record<string, unknown>
    void _ids
    const result = runBatch(this.ctx, ids, this.labelOf, work, outcome =>
      this.audit.record(`task.bulk.${String(action)}`, who, {
        requested: outcome.requested,
        succeeded: outcome.succeeded,
        failed: outcome.failed.length,
        sample: ids.slice(0, 20),
        ...params,
        batch
      })
    )
    return { ...result, batch }
  }

  /** Undo a delete: put back everything that went to the trash in that operation (as long as it is still there, 30 days). */
  restore(user: User, batch: string, who: AuditContext): BatchResult {
    const { repos } = this.ctx
    const entries = repos.trash.batch(batch)
    if (!entries.length)
      throw notFound('There is nothing to restore: the deletion was already undone, or it is older than 30 days.')
    const byId = new Map(entries.map(entry => [entry.taskId, entry]))
    return runBatch(
      this.ctx,
      entries.map(entry => entry.taskId),
      id => {
        const task = byId.get(id)?.snapshot?.task
        return task ? `${task.key} · ${task.title}` : `Task ${id}`
      },
      id => {
        const { task, tagIds = [], alertIds = [] } = byId.get(id)!.snapshot
        if (!repos.projects.byId(task.projectId)) throw badRequest('Its project no longer exists')
        if (repos.tasks.exists(id)) throw badRequest('A task with this number already exists')
        repos.tasks.insert({
          ...task,
          assigneeId: task.assigneeId && repos.people.exists(task.assigneeId) ? task.assigneeId : '',
          createdBy: task.createdBy && repos.people.exists(task.createdBy) ? task.createdBy : undefined
        })
        repos.tags.setForTask(
          id,
          tagIds.filter((tagId: string) => repos.tags.byId(tagId))
        )
        repos.alerts.relinkTask(alertIds, id)
        repos.trash.remove(id)
        this.tasks.record({
          actor: actorOf(user),
          task,
          action: 'Restored task',
          statusTo: task.status,
          summary: task.title
        })
      },
      outcome =>
        this.audit.record('task.restored', who, {
          batch,
          requested: outcome.requested,
          restored: outcome.succeeded,
          failed: outcome.failed.length
        })
    )
  }

  /** A copy of a task in the same project: same plan, same tags, back at the first status, not blocked, never completed. */
  duplicate(user: User, rawId: unknown, who: AuditContext) {
    return this.ctx.transaction(() => {
      const source = this.ctx.repos.tasks.byId(numericId(rawId))
      if (!source) throw notFound('Task not found')
      const tags = (this.ctx.repos.tags.forTasks([source.id]).get(source.id) || []).map(tag => tag.name)
      const copy = this.tasks.create(
        user,
        {
          title: `Copy of ${source.title}`.slice(0, 300),
          projectId: source.projectId,
          assigneeId: source.assigneeId,
          priority: source.priority as 'High' | 'Medium' | 'Low',
          dueDate: source.dueDate,
          type: source.type as 'Development',
          blocked: false,
          customFields: source.customFields || {},
          tags
        },
        who,
        { audit: false }
      )
      this.audit.record('task.duplicated', who, { from: source.id, to: copy.numericId })
      return copy
    })
  }

  /** One task with its tags and the last events recorded about it (what the record view shows). */
  detail(rawId: unknown) {
    const { repos } = this.ctx
    const task = repos.tasks.byId(numericId(rawId))
    if (!task) throw notFound('Task not found')
    const ref = this.ctx.reference()
    const project = repos.projects.byId(task.projectId)
    return {
      task: this.tasks.presentOne(task),
      project: project && { id: project.id, name: project.name, code: project.code },
      history: repos.ledger.forTask(task.id, 30).map(log => workLogPublic(ref, log, '', ''))
    }
  }

  /** Every id matching a filter (so "select all N matching" selects exactly those N), refusing sets too large to act on safely. */
  idsFor(filter: TaskFilter, sort: TaskSort | TaskSort[]) {
    const full: TaskFilter = { ...this.tasks.filterContext(), ...filter }
    const total = this.ctx.repos.tasks.count(full)
    const ids = total > MAX_SELECTION ? [] : this.ctx.repos.tasks.idsOf(full, sort, MAX_SELECTION)
    return { ids, total, truncated: total > MAX_SELECTION, limit: MAX_SELECTION }
  }
}
