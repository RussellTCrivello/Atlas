// Task use cases: create, change, move through the workflow, delete, and list. Every write happens in one transaction
// together with its ledger event and audit entry, so a change and its history either both exist or neither does.
import { type AuditContext } from '../domain/audit-chain'
import { taskKey } from '../domain/keys'
import { buildEvent, type EventInput } from '../domain/ledger'
import { can } from '../domain/permissions'
import { timeIn, todayIn } from '../domain/time'
import type { Task, User } from '../domain/types'
import { isDone, nextState, transitionRule, workflowStates } from '../domain/workflow'
import { taskPublic } from '../presenters/tasks'
import type { TaskFilter, TaskPatch, TaskSort } from '../repositories/tasks'
import type { TaskCreateInput, TaskStatusInput, TaskUpdateInput } from '../validation/schemas'
import { HttpError, badRequest, forbidden, notFound } from '../util'
import type { AuditService } from './audit'
import { type ServiceContext, actorOf, numericId } from './context'

const isOwnTask = (task: Task, user: User) =>
  Boolean(user.personId) && (task.assigneeId === user.personId || task.createdBy === user.personId)
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')

export class TaskService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService
  ) {}

  private find(rawId: unknown): Task {
    const task = this.ctx.repos.tasks.byId(numericId(rawId))
    if (!task) throw notFound('Task not found')
    return task
  }

  private assertStatus(status: string) {
    const allowed = workflowStates(this.ctx.settings)
    if (!allowed.includes(status)) throw badRequest(`Unknown status "${status}". Valid statuses: ${allowed.join(', ')}`)
  }

  private assertTransition(user: User, from: string, to: string) {
    const verdict = transitionRule(this.ctx.settings, from, to)
    if (!verdict.allowed)
      throw new HttpError(
        409,
        `The workflow does not allow moving a task from "${from}" to "${to}".`,
        'TRANSITION_NOT_ALLOWED'
      )
    if (verdict.permission && !can(this.ctx.settings, user, verdict.permission))
      throw forbidden(`Moving a task from "${from}" to "${to}" needs the "${verdict.permission}" permission.`)
  }

  /** Write a ledger event for a task (the project name is snapshotted so history survives later deletions). */
  private event(input: EventInput, now = new Date()) {
    const project = input.task ? this.ctx.repos.projects.byId(input.task.projectId) : undefined
    this.ctx.repos.ledger.insert(buildEvent(this.ctx.settings, project, input, now))
  }

  /** Apply a status change and write the matching ledger event. */
  private applyStatus(user: User, task: Task, status: string) {
    const before = task.status
    if (before === status) return
    const settings = this.ctx.settings
    const wasDone = isDone(settings, task)
    const nowDone = isDone(settings, { status })
    const patch: TaskPatch = { status }
    if (nowDone && !wasDone) patch.completedAt = task.completedAt || todayIn(settings)
    if (wasDone && !nowDone) patch.completedAt = null
    this.ctx.repos.tasks.update(task.id, patch)
    const updated = { ...task, ...patch, completedAt: patch.completedAt ?? undefined } as Task
    const action = nowDone && !wasDone ? 'Completed task' : wasDone && !nowDone ? 'Reopened task' : 'Moved task'
    this.event({
      actor: actorOf(user),
      task: updated,
      action,
      statusFrom: before,
      statusTo: status,
      summary: task.title
    })
  }

  create(user: User, body: TaskCreateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const settings = this.ctx.settings
      if (!repos.projects.count()) throw badRequest('Create a project before adding tasks')
      const project = this.ctx.requireProject(body.projectId)
      const assigneeId = body.assigneeId || user.personId || ''
      if (assigneeId) this.ctx.requirePerson(assigneeId, 'assignee')
      const status = body.status || workflowStates(settings)[0] || 'To do'
      this.assertStatus(status)
      const id = repos.tasks.nextId()
      const today = todayIn(settings)
      const task: Task = {
        id,
        key: taskKey(project, id),
        title: body.title,
        projectId: project.id,
        assigneeId,
        priority: body.priority || 'Medium',
        dueDate: body.dueDate === undefined ? today : body.dueDate,
        status,
        type: body.type || 'Development',
        blocked: Boolean(body.blocked),
        customFields: body.customFields || {},
        createdAt: today,
        createdBy: user.personId || undefined,
        sample: false
      }
      if (isDone(settings, task)) task.completedAt = today
      repos.tasks.insert(task)
      this.event({ actor: actorOf(user), task, action: 'Created task', statusTo: task.status, summary: task.title })
      if (task.completedAt)
        this.event({ actor: actorOf(user), task, action: 'Completed task', statusTo: task.status, summary: task.title })
      this.audit.record('task.created', who, { taskId: task.id, projectId: task.projectId })
      return taskPublic(this.ctx.reference(), task)
    })
  }

  update(user: User, rawId: unknown, body: TaskUpdateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const settings = this.ctx.settings
      const current = this.find(rawId)
      const changed: string[] = []
      for (const key of ['title', 'priority', 'type', 'assigneeId', 'dueDate', 'status'] as const)
        if (body[key] !== undefined && !same(body[key], current[key])) changed.push(key)
      if (body.projectId !== undefined && Number(body.projectId) !== current.projectId) changed.push('projectId')
      if (body.blocked !== undefined && body.blocked !== Boolean(current.blocked)) changed.push('blocked')
      if (
        body.customFields !== undefined &&
        JSON.stringify(body.customFields) !== JSON.stringify(current.customFields || {})
      )
        changed.push('customFields')

      // Progress (status, blocked flag, custom fields) is open to anyone who can write tasks. Re-planning a task
      // (title, project, assignee, priority, type, due date) needs task management rights or ownership of the task.
      const replanned = changed.some(key =>
        ['title', 'projectId', 'assigneeId', 'priority', 'type', 'dueDate'].includes(key)
      )
      if (replanned && !can(settings, user, 'manageTasks') && !isOwnTask(current, user))
        throw forbidden(
          'You can move any task through the workflow, but only tasks assigned to or created by you can be re-planned. Ask a manager to change this one.'
        )
      if (changed.includes('projectId')) this.ctx.requireProject(body.projectId)
      if (changed.includes('assigneeId') && body.assigneeId) this.ctx.requirePerson(body.assigneeId, 'assignee')
      if (changed.includes('status')) {
        this.assertStatus(body.status!)
        this.assertTransition(user, current.status, body.status!)
      }
      if (!changed.length) return taskPublic(this.ctx.reference(), current)

      const patch: Partial<Task> = {}
      if (changed.includes('title')) patch.title = body.title!
      if (changed.includes('projectId')) patch.projectId = Number(body.projectId)
      if (changed.includes('priority')) patch.priority = body.priority!
      if (changed.includes('type')) patch.type = body.type!
      if (changed.includes('dueDate')) patch.dueDate = body.dueDate!
      if (changed.includes('customFields')) patch.customFields = body.customFields!
      if (changed.includes('blocked')) patch.blocked = Boolean(body.blocked)
      if (changed.includes('assigneeId')) patch.assigneeId = body.assigneeId!
      repos.tasks.update(current.id, patch)
      const task: Task = { ...current, ...patch }

      if (changed.includes('blocked'))
        this.event({
          actor: actorOf(user),
          task,
          action: task.blocked ? 'Blocked task' : 'Unblocked task',
          summary: task.title
        })
      if (changed.includes('assigneeId')) {
        const name = (id: string) => repos.people.byId(id)?.name || 'Unassigned'
        this.event({
          actor: actorOf(user),
          task,
          action: 'Assigned task',
          summary: `${task.title}: ${name(current.assigneeId)} → ${name(task.assigneeId)}`
        })
      }
      if (changed.includes('status')) this.applyStatus(user, task, body.status!)
      const detailFields = changed.filter(key =>
        ['title', 'projectId', 'priority', 'type', 'dueDate', 'customFields'].includes(key)
      )
      if (detailFields.length)
        this.event({
          actor: actorOf(user),
          task,
          action: 'Updated task',
          summary: `${task.title} (${detailFields.join(', ')})`
        })
      const stored = this.find(task.id)
      this.audit.record('task.updated', who, {
        taskId: task.id,
        fields: changed,
        previousStatus: current.status,
        status: stored.status
      })
      return taskPublic(this.ctx.reference(), stored)
    })
  }

  setStatus(user: User, rawId: unknown, body: TaskStatusInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const current = this.find(rawId)
      const settings = this.ctx.settings
      let target: string
      if (body.status) {
        this.assertStatus(body.status)
        target = body.status
      } else if (body.advance) target = nextState(settings, current.status)
      else throw badRequest('Provide a status, or advance: true')
      this.assertTransition(user, current.status, target)
      if (target === current.status) return taskPublic(this.ctx.reference(), current)
      this.applyStatus(user, current, target)
      this.audit.record('task.status.changed', who, { taskId: current.id, from: current.status, to: target })
      return taskPublic(this.ctx.reference(), this.find(current.id))
    })
  }

  delete(user: User, rawId: unknown, who: AuditContext) {
    this.ctx.transaction(() => {
      const task = this.find(rawId)
      this.event({ actor: actorOf(user), task, action: 'Deleted task', statusFrom: task.status, summary: task.title })
      this.ctx.repos.tasks.delete(task.id)
      this.audit.record('task.deleted', who, { taskId: task.id, title: task.title })
    })
  }

  // ---- reading -----------------------------------------------------------------------------------------------------
  /** The terminal workflow labels and today's date, which several filters need. */
  filterContext(): Pick<TaskFilter, 'terminal' | 'today'> {
    const settings = this.ctx.settings
    return {
      terminal: workflowStates(settings).filter(label => isDone(settings, { status: label })),
      today: todayIn(settings)
    }
  }

  /** One page of tasks matching a filter, with the totals a list or board needs. */
  list(filter: TaskFilter, sort: TaskSort, page: { limit: number; offset: number }) {
    const { repos } = this.ctx
    const full: TaskFilter = { ...this.filterContext(), ...filter }
    const ref = this.ctx.reference()
    const rows = repos.tasks.list(full, sort, page).map(row => taskPublic(ref, row))
    const total = repos.tasks.count(full)
    return {
      rows,
      total,
      page: Math.floor(page.offset / page.limit) + 1,
      pageSize: page.limit,
      pages: Math.max(1, Math.ceil(total / page.limit)),
      byStatus: Object.fromEntries(repos.tasks.statusCounts({ ...full, status: undefined })),
      byPriority: Object.fromEntries(repos.tasks.priorityCounts({ ...full, priority: undefined }))
    }
  }

  /** Used by exports and reports: the current time in the workspace's calendar. */
  clock() {
    const settings = this.ctx.settings
    const now = new Date()
    return { today: todayIn(settings, now), time: timeIn(settings, now) }
  }
}
