// Milestones, daily updates and alerts: the smaller records around the tasks.
import type { AuditContext } from '../domain/audit-chain'
import { activityTimelineSummary, buildEvent } from '../domain/ledger'
import { can } from '../domain/permissions'
import { timeIn, todayIn } from '../domain/time'
import type { Activity, Alert, Milestone, User } from '../domain/types'
import { activityPublic, alertPublic } from '../presenters/activity'
import type {
  ActivityCreateInput,
  AlertCreateInput,
  AlertPatchInput,
  MilestoneCreateInput,
  MilestoneUpdateInput
} from '../validation/schemas'
import { badRequest, forbidden, id, notFound } from '../util'
import type { AlertBulkInput, MilestoneBulkInput } from '../validation/records'
import type { AuditService } from './audit'
import { type BatchResult, runBatch } from './batch'
import type { ServiceContext } from './context'
import { numericId } from './context'

const QUIET = { audit: false }

const normalizeMilestoneStatus = (status?: string) => (status === 'Completed' ? 'Complete' : status)

export class PlanningService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService
  ) {}

  // ---- milestones --------------------------------------------------------------------------------------------------
  createMilestone(body: MilestoneCreateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const project = this.ctx.requireProject(body.projectId)
      const milestone: Milestone = {
        id: id('milestone'),
        name: body.name,
        projectId: project.id,
        dueDate: body.dueDate || todayIn(this.ctx.settings),
        status: normalizeMilestoneStatus(body.status) || 'Upcoming',
        customFields: body.customFields || {},
        sample: false
      }
      this.ctx.repos.milestones.insert(milestone)
      this.audit.record('milestone.created', who, { milestoneId: milestone.id })
      return milestone
    })
  }

  updateMilestone(rawId: string, body: MilestoneUpdateInput, who: AuditContext, options: { audit?: boolean } = {}) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const current = repos.milestones.byId(rawId)
      if (!current) throw notFound('Milestone not found')
      if (body.projectId !== undefined) this.ctx.requireProject(body.projectId)
      repos.milestones.update(current.id, {
        ...body,
        projectId: body.projectId === undefined ? undefined : Number(body.projectId),
        status: normalizeMilestoneStatus(body.status)
      })
      if (options.audit !== false) this.audit.record('milestone.updated', who, { milestoneId: current.id })
      return repos.milestones.byId(current.id)!
    })
  }

  deleteMilestone(rawId: string, who: AuditContext, options: { audit?: boolean } = {}) {
    this.ctx.transaction(() => {
      const current = this.ctx.repos.milestones.byId(rawId)
      if (!current) throw notFound('Milestone not found')
      this.ctx.repos.milestones.delete(current.id)
      if (options.audit !== false) this.audit.record('milestone.deleted', who, { milestoneId: current.id })
    })
  }

  /** Change the status of, or delete, several milestones at once; one that cannot be changed is reported, the rest go ahead. */
  bulkMilestones(input: MilestoneBulkInput, who: AuditContext): BatchResult {
    const ids = input.ids.map(String)
    const label = (key: string) => this.ctx.repos.milestones.byId(key)?.name || `Milestone ${key}`
    const work =
      input.action === 'status'
        ? (key: string) => void this.updateMilestone(key, { status: input.status }, who, QUIET)
        : (key: string) => void this.deleteMilestone(key, who, QUIET)
    return runBatch(this.ctx, ids, label, work, outcome =>
      this.audit.record(`milestone.bulk.${input.action}`, who, {
        requested: outcome.requested,
        succeeded: outcome.succeeded,
        failed: outcome.failed.length,
        sample: ids.slice(0, 20),
        status: input.action === 'status' ? input.status : undefined
      })
    )
  }

  duplicateMilestone(rawId: string, who: AuditContext) {
    return this.ctx.transaction(() => {
      const source = this.ctx.repos.milestones.byId(rawId)
      if (!source) throw notFound('Milestone not found')
      const copy: Milestone = {
        ...source,
        id: id('milestone'),
        name: `Copy of ${source.name}`.slice(0, 200),
        status: 'Upcoming',
        sample: false
      }
      this.ctx.repos.milestones.insert(copy)
      this.audit.record('milestone.duplicated', who, { from: source.id, to: copy.id })
      return copy
    })
  }

  // ---- daily updates -----------------------------------------------------------------------------------------------
  logActivity(user: User, body: ActivityCreateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const settings = this.ctx.settings
      // Updates are attributed to the signed-in person. Posting on someone else's behalf needs people-management rights.
      const personId = body.personId || user.personId
      if (!personId) throw badRequest('Your account is not linked to a person profile, so it cannot post updates')
      if (personId !== user.personId && !can(settings, user, 'managePeople'))
        throw forbidden('You can only post updates as yourself')
      this.ctx.requirePerson(personId)
      const now = new Date()
      const activity: Activity = {
        id: id('activity'),
        personId,
        date: todayIn(settings, now),
        time: timeIn(settings, now),
        yesterday: body.yesterday || '',
        today: body.today || '',
        blocked: body.blocked || '',
        upcoming: body.upcoming || '',
        status: body.status || 'Confirmed',
        customFields: body.customFields || {},
        sample: false
      }
      repos.activities.insert(activity)
      repos.ledger.insert(
        buildEvent(
          settings,
          undefined,
          {
            actor: { id: user.id, personId },
            action: activity.blocked ? 'Raised blocker' : 'Logged update',
            statusTo: activity.blocked ? 'Blocked' : 'Confirmed',
            summary: activityTimelineSummary(activity),
            source: 'Activity log'
          },
          now
        )
      )
      this.audit.record('activity.logged', who, { activityId: activity.id, personId })
      return activityPublic(this.ctx.reference(), activity)
    })
  }

  deleteActivity(rawId: string, who: AuditContext) {
    this.ctx.transaction(() => {
      const current = this.ctx.repos.activities.byId(rawId)
      if (!current) throw notFound('Activity not found')
      this.ctx.repos.activities.delete(current.id)
      this.audit.record('activity.deleted', who, { activityId: current.id })
    })
  }

  // ---- alerts ------------------------------------------------------------------------------------------------------
  private alertRefs(body: { projectId?: unknown; taskId?: unknown }) {
    const none = (value: unknown) => value === '' || value === null || value === undefined
    const projectId = none(body.projectId) ? '' : this.ctx.requireProject(body.projectId).id
    let taskId: number | '' = ''
    if (!none(body.taskId)) {
      const task = this.ctx.repos.tasks.byId(numericId(body.taskId))
      if (!task) throw badRequest('The selected task does not exist')
      taskId = task.id
    }
    return { projectId, taskId }
  }

  createAlert(body: AlertCreateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const refs = this.alertRefs(body)
      const type = body.type || 'info'
      const alert: Alert = {
        id: id('alert'),
        title: body.title,
        body: body.body || '',
        type,
        tone: body.tone || (type === 'risk' || type === 'blocker' ? 'orange' : 'blue'),
        projectId: refs.projectId,
        taskId: refs.taskId,
        resolved: false,
        createdAt: todayIn(this.ctx.settings),
        customFields: body.customFields || {},
        sample: false
      }
      this.ctx.repos.alerts.insert(alert)
      this.audit.record('alert.created', who, { alertId: alert.id })
      return alertPublic(this.ctx.reference(), alert)
    })
  }

  patchAlert(user: User, rawId: string, body: AlertPatchInput, who: AuditContext, options: { audit?: boolean } = {}) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      if (!Object.keys(body).length) throw badRequest('Nothing to update')
      // Editing the alert's content needs manageAlerts; resolving needs only the baseline permission the route checked (VAL-04).
      const editKeys = Object.keys(body).filter(key => key !== 'resolved')
      if (editKeys.length && !can(this.ctx.settings, user, 'manageAlerts'))
        throw forbidden('Manager or administrator access required to edit alerts')
      const current = repos.alerts.byId(rawId)
      if (!current) throw notFound('Alert not found')
      const patch: Partial<Alert> = { ...body } as Partial<Alert>
      if (body.projectId !== undefined) patch.projectId = this.alertRefs({ projectId: body.projectId }).projectId
      if (body.taskId !== undefined) patch.taskId = this.alertRefs({ taskId: body.taskId }).taskId
      repos.alerts.update(current.id, patch)
      const updated = repos.alerts.byId(current.id)!
      if (options.audit !== false)
        this.audit.record('alert.updated', who, { alertId: updated.id, resolved: updated.resolved })
      return alertPublic(this.ctx.reference(), updated)
    })
  }

  deleteAlert(rawId: string, who: AuditContext, options: { audit?: boolean } = {}) {
    this.ctx.transaction(() => {
      const current = this.ctx.repos.alerts.byId(rawId)
      if (!current) throw notFound('Alert not found')
      this.ctx.repos.alerts.delete(current.id)
      if (options.audit !== false) this.audit.record('alert.deleted', who, { alertId: current.id })
    })
  }

  /**
   * Resolve, reopen or delete several alerts. Resolving needs only the baseline task permission (as for one alert); deleting
   * needs alert management, checked here because the route only knows the baseline.
   */
  bulkAlerts(user: User, input: AlertBulkInput, who: AuditContext): BatchResult {
    if (input.action === 'delete' && !can(this.ctx.settings, user, 'manageAlerts'))
      throw forbidden('Manager or administrator access required to delete alerts')
    const ids = input.ids.map(String)
    const label = (key: string) => this.ctx.repos.alerts.byId(key)?.title || `Alert ${key}`
    const work =
      input.action === 'delete'
        ? (key: string) => void this.deleteAlert(key, who, QUIET)
        : (key: string) => void this.patchAlert(user, key, { resolved: input.action === 'resolve' }, who, QUIET)
    return runBatch(this.ctx, ids, label, work, outcome =>
      this.audit.record(`alert.bulk.${input.action}`, who, {
        requested: outcome.requested,
        succeeded: outcome.succeeded,
        failed: outcome.failed.length,
        sample: ids.slice(0, 20)
      })
    )
  }

  duplicateAlert(rawId: string, who: AuditContext) {
    return this.ctx.transaction(() => {
      const source = this.ctx.repos.alerts.byId(rawId)
      if (!source) throw notFound('Alert not found')
      const copy: Alert = {
        ...source,
        id: id('alert'),
        title: `Copy of ${source.title}`.slice(0, 200),
        resolved: false,
        createdAt: todayIn(this.ctx.settings),
        sample: false
      }
      this.ctx.repos.alerts.insert(copy)
      this.audit.record('alert.duplicated', who, { from: source.id, to: copy.id })
      return alertPublic(this.ctx.reference(), copy)
    })
  }
}
