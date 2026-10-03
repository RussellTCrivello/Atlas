// Project use cases, including the project page: one project with its numbers, milestones, alerts and tasks.
import type { AuditContext } from '../domain/audit-chain'
import { uniqueProjectCode } from '../domain/keys'
import { todayIn } from '../domain/time'
import type { Project, User } from '../domain/types'
import { isDone, workflowStates } from '../domain/workflow'
import { alertPublic, workLogPublic } from '../presenters/activity'
import { type ProjectPublic, projectPublic } from '../presenters/projects'
import type { ReferenceIndex } from '../presenters/reference-index'
import type { TaskFilter, TaskSort } from '../repositories/tasks'
import { HttpError, conflict, id as newId, notFound } from '../util'
import type { ProjectBulkInput } from '../validation/records'
import type { ProjectCreateInput, ProjectUpdateInput } from '../validation/schemas'
import type { AuditService } from './audit'
import type { BackupService } from './backups'
import { type BatchResult, runBatch } from './batch'
import { type ServiceContext, numericId } from './context'
import type { TaskService } from './tasks'

/** A copy of a project can bring its tasks along, up to this many (more would be a long transaction for a rare need). */
export const MAX_COPIED_TASKS = 2000
const QUIET = { audit: false }

export class ProjectService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService,
    private backups: BackupService,
    private tasks: TaskService
  ) {}

  private find(rawId: unknown): Project {
    const project = this.ctx.repos.projects.byId(numericId(rawId))
    if (!project) throw notFound('Project not found')
    return project
  }

  private terminal(): string[] {
    const settings = this.ctx.settings
    return workflowStates(settings).filter(label => isDone(settings, { status: label }))
  }

  /** Every project as the browser lists it (progress and health from one SQL pass). */
  list(ref: ReferenceIndex = this.ctx.reference()): ProjectPublic[] {
    const { repos } = this.ctx
    const stats = repos.projects.stats(this.terminal(), ref.today)
    const members = repos.projects.memberIds()
    const milestones = new Map<number, ReturnType<typeof repos.milestones.list>>()
    for (const milestone of repos.milestones.list()) {
      const list = milestones.get(milestone.projectId)
      if (list) list.push(milestone)
      else milestones.set(milestone.projectId, [milestone])
    }
    return repos.projects
      .list()
      .map(project =>
        projectPublic(
          ref,
          project,
          milestones.get(project.id) || [],
          stats.get(project.id),
          members.get(project.id) || []
        )
      )
  }

  private respond(project: Project): ProjectPublic {
    const { repos } = this.ctx
    const ref = this.ctx.reference()
    return projectPublic(
      ref,
      project,
      repos.milestones.forProject(project.id),
      repos.projects.stats(this.terminal(), ref.today, project.id).get(project.id),
      repos.projects.memberIds(project.id).get(project.id) || []
    )
  }

  create(user: User, body: ProjectCreateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      if (body.code && repos.projects.byCode(body.code))
        throw conflict(`The project code "${body.code}" is already used`, 'DUPLICATE_CODE')
      const teamId = body.teamId || repos.teams.list()[0]?.id || ''
      if (teamId) this.ctx.requireTeam(teamId)
      const ownerId = body.ownerId || user.personId || ''
      if (ownerId) this.ctx.requirePerson(ownerId, 'owner')
      const settings = this.ctx.settings
      const id = repos.projects.insert({
        name: body.name,
        code: body.code || uniqueProjectCode(body.name, repos.projects.codes()),
        description: body.description || '',
        teamId,
        ownerId,
        color: body.color || 'purple',
        status: body.status || 'On track',
        deadline: body.deadline === undefined ? todayIn(settings) : body.deadline,
        createdAt: todayIn(settings),
        customFields: body.customFields || {},
        sample: false
      })
      this.audit.record('project.created', who, { projectId: id })
      return this.respond(repos.projects.byId(id)!)
    })
  }

  update(rawId: unknown, body: ProjectUpdateInput, who: AuditContext, options: { audit?: boolean } = {}) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const current = this.find(rawId)
      if (body.code && body.code !== current.code && repos.projects.byCode(body.code, current.id))
        throw conflict(`The project code "${body.code}" is already used`, 'DUPLICATE_CODE')
      if (body.teamId) this.ctx.requireTeam(body.teamId)
      if (body.ownerId) this.ctx.requirePerson(body.ownerId, 'owner')
      repos.projects.update(current.id, body)
      if (options.audit !== false) this.audit.record('project.updated', who, { projectId: current.id })
      return this.respond(repos.projects.byId(current.id)!)
    })
  }

  /** What deleting a project would take with it. Refuses unless the person agreed to that (`cascade`). */
  private checkDependents(project: Project, cascade: boolean) {
    const removed = this.ctx.repos.projects.dependents(project.id)
    const { tasks, milestones, alerts } = removed
    if ((tasks || milestones || alerts) && !cascade)
      throw new HttpError(
        409,
        `This project still has ${tasks} task(s), ${milestones} milestone(s) and ${alerts} alert(s). Deleting it removes them too.`,
        'HAS_DEPENDENTS',
        removed
      )
    return removed
  }

  /** The deletion itself, inside the caller's transaction (the caller made the safety snapshot). */
  private remove(
    project: Project,
    removed: ReturnType<ProjectService['checkDependents']>,
    who: AuditContext,
    options: { audit?: boolean } = {}
  ) {
    this.ctx.repos.projects.delete(project.id)
    if (options.audit !== false)
      this.audit.record('project.deleted', who, {
        projectId: project.id,
        name: project.name,
        tasks: removed.tasks,
        milestones: removed.milestones,
        alerts: removed.alerts
      })
  }

  delete(rawId: unknown, cascade: boolean, who: AuditContext) {
    const project = this.find(rawId)
    const removed = this.checkDependents(project, cascade)
    // A snapshot first (outside the transaction: SQLite cannot VACUUM inside one); if it cannot be made, nothing is deleted.
    if (removed.tasks || removed.milestones) this.backups.snapshot('pre-delete-project')
    this.ctx.transaction(() => this.remove(project, removed, who))
    return { ok: true, removed }
  }

  /**
   * Change or delete several projects at once. Each project is its own unit of work: one that cannot be changed (it still
   * has tasks and the person did not agree to delete them, it no longer exists) is reported and the rest go ahead.
   */
  bulk(input: ProjectBulkInput, who: AuditContext): BatchResult {
    const { repos } = this.ctx
    const ids = input.ids.map(Number).filter(Number.isInteger)
    const label = (id: number) => {
      const project = repos.projects.byId(id)
      return project ? `${project.code} · ${project.name}` : `Project ${id}`
    }
    let work: (id: number) => void
    switch (input.action) {
      case 'status':
        work = id => void this.update(id, { status: input.status }, who, QUIET)
        break
      case 'owner':
        work = id => void this.update(id, { ownerId: input.ownerId }, who, QUIET)
        break
      case 'team':
        work = id => void this.update(id, { teamId: input.teamId }, who, QUIET)
        break
      case 'delete': {
        const cascade = Boolean(input.cascade)
        // One safety snapshot for the whole batch, before anything is touched (it cannot be taken inside the transaction).
        const loaded = ids.filter(id => {
          const found = repos.projects.dependents(id)
          return cascade && (found.tasks || found.milestones)
        })
        if (loaded.length) this.backups.snapshot('pre-delete-projects')
        work = id => {
          const project = this.find(id)
          this.remove(project, this.checkDependents(project, cascade), who, QUIET)
        }
        break
      }
    }
    const { action, ids: _ids, ...params } = input as Record<string, unknown>
    void _ids
    return runBatch(this.ctx, ids, label, work, outcome =>
      this.audit.record(`project.bulk.${String(action)}`, who, {
        requested: outcome.requested,
        succeeded: outcome.succeeded,
        failed: outcome.failed.length,
        sample: ids.slice(0, 20),
        ...params
      })
    )
  }

  /** A copy of a project: same plan and settings, its milestones back to "Upcoming", and optionally its tasks (at the first status). */
  duplicate(user: User, rawId: unknown, body: { withTasks?: boolean }, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const source = this.find(rawId)
      const withTasks = Boolean(body.withTasks)
      const taskCount = repos.tasks.count({ projectId: source.id })
      if (withTasks && taskCount > MAX_COPIED_TASKS)
        throw new HttpError(
          409,
          `This project has ${taskCount.toLocaleString('en')} tasks; at most ${MAX_COPIED_TASKS.toLocaleString('en')} can be copied at once. Duplicate it without its tasks.`,
          'TOO_MANY_TO_COPY',
          { tasks: taskCount, limit: MAX_COPIED_TASKS }
        )
      const today = todayIn(this.ctx.settings)
      const copyId = repos.projects.insert({
        name: `Copy of ${source.name}`.slice(0, 120),
        code: uniqueProjectCode(source.name, repos.projects.codes()),
        description: source.description,
        teamId: source.teamId,
        ownerId: source.ownerId,
        color: source.color,
        status: source.status,
        deadline: source.deadline,
        createdAt: today,
        customFields: source.customFields || {},
        sample: false
      })
      const milestones = repos.milestones.forProject(source.id)
      for (const milestone of milestones)
        repos.milestones.insert({
          id: newId('milestone'),
          name: milestone.name,
          projectId: copyId,
          dueDate: milestone.dueDate,
          status: 'Upcoming',
          customFields: milestone.customFields || {},
          sample: false
        })
      let copied = 0
      if (withTasks) {
        const rows = repos.tasks.list({ projectId: source.id }, { key: 'key', dir: 'asc' }, { limit: MAX_COPIED_TASKS })
        const tags = repos.tags.forTasks(rows.map(row => row.id))
        for (const row of rows) {
          this.tasks.insertTask(
            user,
            {
              title: row.title,
              projectId: copyId,
              assigneeId: row.assigneeId,
              priority: row.priority as 'High' | 'Medium' | 'Low',
              dueDate: row.dueDate,
              type: row.type as 'Development',
              blocked: false,
              customFields: row.customFields || {},
              tags: (tags.get(row.id) || []).map(tag => tag.name)
            },
            who,
            QUIET
          )
          copied++
        }
      }
      this.audit.record('project.duplicated', who, {
        from: source.id,
        to: copyId,
        milestones: milestones.length,
        tasks: copied
      })
      return this.respond(repos.projects.byId(copyId)!)
    })
  }

  // ---- the project page ----------------------------------------------------------------------------------------------
  /**
   * Everything the project page shows besides the task list: the project itself, task totals and their breakdown by
   * status and priority, milestones, open alerts, who is working on it, and what happened recently.
   */
  detail(rawId: unknown) {
    const project = this.find(rawId)
    const { repos } = this.ctx
    const settings = this.ctx.settings
    const ref = this.ctx.reference()
    const terminal = this.terminal()
    const scope: TaskFilter = { projectId: project.id, terminal, today: ref.today }
    const counts = repos.tasks.counts(terminal, ref.today, scope)
    const byStatus = repos.tasks.statusCounts(scope)
    const states = workflowStates(settings)
    const statusBreakdown = [
      ...states.map(label => ({ status: label, count: byStatus.get(label) || 0, done: terminal.includes(label) })),
      ...[...byStatus]
        .filter(([label]) => !states.includes(label))
        .map(([label, count]) => ({ status: label, count, done: false }))
    ]
    const byPriority = repos.tasks.priorityCounts(scope)
    const people = repos.projects.workload(project.id, terminal)
    const recent = repos.ledger.forProject(project.id, 8).map(log => workLogPublic(ref, log, '', ''))
    const stats = repos.projects.stats(terminal, ref.today, project.id).get(project.id)
    return {
      project: projectPublic(
        ref,
        project,
        repos.milestones.forProject(project.id),
        stats,
        repos.projects.memberIds(project.id).get(project.id) || []
      ),
      totals: counts,
      byStatus: statusBreakdown,
      byPriority: ['High', 'Medium', 'Low'].map(priority => ({ priority, count: byPriority.get(priority) || 0 })),
      people: people.map(row => ({
        personId: row.personId,
        name: ref.people.get(row.personId)?.name || 'Unassigned',
        color: ref.people.get(row.personId)?.color || 'purple',
        open: row.open,
        done: row.done
      })),
      alerts: repos.alerts
        .forProject(project.id)
        .filter(alert => !alert.resolved)
        .map(alert => alertPublic(ref, alert)),
      recent,
      today: ref.today
    }
  }

  /** One page of the project's tasks (the page a click on a project opens). */
  tasksOf(rawId: unknown, filter: TaskFilter, sort: TaskSort | TaskSort[], page: { limit: number; offset: number }) {
    const project = this.find(rawId)
    return { projectId: project.id, ...this.tasks.list({ ...filter, projectId: project.id }, sort, page) }
  }
}
