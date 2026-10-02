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
import { HttpError, conflict, notFound } from '../util'
import type { ProjectCreateInput, ProjectUpdateInput } from '../validation/schemas'
import type { AuditService } from './audit'
import type { BackupService } from './backups'
import { type ServiceContext, numericId } from './context'
import type { TaskService } from './tasks'

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

  update(rawId: unknown, body: ProjectUpdateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const current = this.find(rawId)
      if (body.code && body.code !== current.code && repos.projects.byCode(body.code, current.id))
        throw conflict(`The project code "${body.code}" is already used`, 'DUPLICATE_CODE')
      if (body.teamId) this.ctx.requireTeam(body.teamId)
      if (body.ownerId) this.ctx.requirePerson(body.ownerId, 'owner')
      repos.projects.update(current.id, body)
      this.audit.record('project.updated', who, { projectId: current.id })
      return this.respond(repos.projects.byId(current.id)!)
    })
  }

  delete(rawId: unknown, cascade: boolean, who: AuditContext) {
    const project = this.find(rawId)
    const removed = this.ctx.repos.projects.dependents(project.id)
    const { tasks, milestones, alerts } = removed
    if ((tasks || milestones || alerts) && !cascade)
      throw new HttpError(
        409,
        `This project still has ${tasks} task(s), ${milestones} milestone(s) and ${alerts} alert(s). Deleting it removes them too.`,
        'HAS_DEPENDENTS',
        removed
      )
    // A snapshot first (outside the transaction: SQLite cannot VACUUM inside one); if it cannot be made, nothing is deleted.
    if (tasks || milestones) this.backups.snapshot('pre-delete-project')
    this.ctx.transaction(() => {
      this.ctx.repos.projects.delete(project.id)
      this.audit.record('project.deleted', who, {
        projectId: project.id,
        name: project.name,
        tasks,
        milestones,
        alerts
      })
    })
    return { ok: true, removed }
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
  tasksOf(rawId: unknown, filter: TaskFilter, sort: TaskSort, page: { limit: number; offset: number }) {
    const project = this.find(rawId)
    return { projectId: project.id, ...this.tasks.list({ ...filter, projectId: project.id }, sort, page) }
  }
}
