// Operational data: tasks, projects, people, teams, milestones, activity, alerts.
//
// Every handler follows the same shape:  validate input -> check permissions/ownership/references -> db.commit(mutate +
// ledger + audit) -> respond. All checks that can fail run before the first mutation (see DocumentStore.commit).
import type { Express } from 'express'
import { type Index, buildIndex, can, isDone, taskKey, todayIn, timeIn, workflowStates } from '../domain'
import { appendAudit } from '../audit'
import { recordEvent, activityTimelineSummary } from '../ledger'
import { activityPublic, alertPublic, personPublic, projectPublic, taskPublic } from '../presenters'
import {
  activityCreateSchema,
  alertCreateSchema,
  alertPatchSchema,
  milestoneCreateSchema,
  milestoneUpdateSchema,
  parse,
  personCreateSchema,
  personUpdateSchema,
  projectCreateSchema,
  projectUpdateSchema,
  taskCreateSchema,
  taskStatusSchema,
  taskUpdateSchema,
  teamCreateSchema,
  teamUpdateSchema
} from '../schemas'
import type { Person, Project, StoreState, Task, Team, User } from '../types'
import { HttpError, badRequest, conflict, forbidden, handler, id, notFound } from '../util'
import { type Deps, auditContext, requirePermission, userOf } from './context'

// ---- lookups & reference checks -----------------------------------------------------------------------------------
const numeric = (value: unknown) => (/^\d+$/.test(String(value)) ? Number(value) : NaN)

function findTask(state: StoreState, rawId: unknown): Task {
  const task = state.tasks.find(candidate => candidate.id === numeric(rawId))
  if (!task) throw notFound('Task not found')
  return task
}
function findProject(state: StoreState, rawId: unknown): Project {
  const project = state.projects.find(candidate => candidate.id === numeric(rawId))
  if (!project) throw notFound('Project not found')
  return project
}
function requireProject(state: StoreState, rawId: unknown): Project {
  const project = state.projects.find(candidate => candidate.id === numeric(rawId))
  if (!project) throw badRequest('The selected project does not exist')
  return project
}
function requirePerson(state: StoreState, personId: string, label = 'person'): Person {
  const person = state.people.find(candidate => candidate.id === personId)
  if (!person) throw badRequest(`The selected ${label} does not exist`)
  return person
}
function requireTeam(state: StoreState, teamId: string): Team {
  const team = state.teams.find(candidate => candidate.id === teamId)
  if (!team) throw badRequest('The selected team does not exist')
  return team
}
const light = (state: StoreState): Index => buildIndex(state, { light: true })
const actorOf = (user: User) => ({ id: user.id, personId: user.personId })

function nextTaskId(state: StoreState): number {
  const value = Math.max(state.counters.task || 1, state.tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1)
  state.counters.task = value + 1
  return value
}
function nextProjectId(state: StoreState): number {
  const value = Math.max(
    state.counters.project || 1,
    state.projects.reduce((max, project) => Math.max(max, project.id), 0) + 1
  )
  state.counters.project = value + 1
  return value
}

function uniqueProjectCode(state: StoreState, name: string): string {
  const base = (
    name
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 3) || 'PRJ'
  ).padEnd(2, 'X')
  let code = base
  for (let n = 2; state.projects.some(project => project.code.toUpperCase() === code); n++) code = `${base}${n}`
  return code
}

/** Workflow transition rules apply only when an administrator turned on "Enforce transitions". */
function assertTransition(settings: any, user: User, from: string, to: string) {
  const workflow = settings.workflows?.task
  if (!workflow?.enforceTransitions || from === to) return
  const rule = (workflow.transitions || []).find((transition: any) => transition.from === from && transition.to === to)
  if (!rule)
    throw new HttpError(
      409,
      `The workflow does not allow moving a task from "${from}" to "${to}".`,
      'TRANSITION_NOT_ALLOWED'
    )
  if (rule.permission && !can(settings, user, rule.permission))
    throw forbidden(`Moving a task from "${from}" to "${to}" needs the "${rule.permission}" permission.`)
}

function assertStatus(settings: any, status: string) {
  const allowed = workflowStates(settings)
  if (!allowed.includes(status)) throw badRequest(`Unknown status "${status}". Valid statuses: ${allowed.join(', ')}`)
}

const isOwnTask = (task: Task, user: User) =>
  Boolean(user.personId) && (task.assigneeId === user.personId || task.createdBy === user.personId)

/** Apply a status change to a task and write the matching ledger event. */
function applyStatus(state: StoreState, user: User, task: Task, status: string) {
  const before = task.status
  if (before === status) return
  const wasDone = isDone(state.settings, task)
  task.status = status
  const nowDone = isDone(state.settings, task)
  if (nowDone && !wasDone) task.completedAt = task.completedAt || todayIn(state.settings)
  if (wasDone && !nowDone) delete task.completedAt
  const action = nowDone && !wasDone ? 'Completed task' : wasDone && !nowDone ? 'Reopened task' : 'Moved task'
  recordEvent(state, { actor: actorOf(user), task, action, statusFrom: before, statusTo: status, summary: task.title })
}

// ---- routes --------------------------------------------------------------------------------------------------------
export function registerDataRoutes(app: Express, deps: Deps) {
  const { db } = deps
  const need = (permission: string | string[], message?: string) => requirePermission(deps, permission, message)

  // ============================== tasks ==============================
  app.post(
    '/api/tasks',
    need('writeTasks'),
    handler((req, res) => {
      const user = userOf(req)
      const body = parse(taskCreateSchema, req.body)
      const settings = db.state.settings
      if (!db.state.projects.length) throw badRequest('Create a project before adding tasks')
      requireProject(db.state, body.projectId)
      const assigneeId = body.assigneeId || user.personId || ''
      if (assigneeId) requirePerson(db.state, assigneeId, 'assignee')
      const status = body.status || workflowStates(settings)[0] || 'To do'
      assertStatus(settings, status)
      const created = db.commit(
        state => {
          const project = requireProject(state, body.projectId)
          const task: Task = {
            id: nextTaskId(state),
            title: body.title,
            projectId: project.id,
            assigneeId,
            priority: body.priority || 'Medium',
            dueDate: body.dueDate === undefined ? todayIn(state.settings) : body.dueDate,
            status,
            type: body.type || 'Development',
            blocked: Boolean(body.blocked),
            customFields: body.customFields || {},
            createdAt: todayIn(state.settings),
            createdBy: user.personId || undefined,
            sample: false
          }
          task.key = taskKey(project, task.id)
          if (isDone(state.settings, task)) task.completedAt = todayIn(state.settings)
          state.tasks.push(task)
          recordEvent(state, {
            actor: actorOf(user),
            task,
            action: 'Created task',
            statusTo: task.status,
            summary: task.title
          })
          if (task.completedAt)
            recordEvent(state, {
              actor: actorOf(user),
              task,
              action: 'Completed task',
              statusTo: task.status,
              summary: task.title
            })
          appendAudit(state, 'task.created', auditContext(req), { taskId: task.id, projectId: task.projectId })
          return taskPublic(light(state), task)
        },
        { reason: 'task-create' }
      )
      res.json(created)
    })
  )

  app.put(
    '/api/tasks/:id',
    need('writeTasks'),
    handler((req, res) => {
      const user = userOf(req)
      const settings = db.state.settings
      const current = findTask(db.state, req.params.id)
      const body = parse(taskUpdateSchema, req.body)
      const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '')
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
      if (body.projectId !== undefined && changed.includes('projectId')) requireProject(db.state, body.projectId)
      if (changed.includes('assigneeId') && body.assigneeId) requirePerson(db.state, body.assigneeId, 'assignee')
      if (changed.includes('status')) {
        assertStatus(settings, body.status!)
        assertTransition(settings, user, current.status, body.status!)
      }
      if (!changed.length) return res.json(taskPublic(light(db.state), current))

      const updated = db.commit(
        state => {
          const task = findTask(state, req.params.id)
          const before = { ...task }
          if (changed.includes('title')) task.title = body.title!
          if (changed.includes('projectId')) task.projectId = requireProject(state, body.projectId).id
          if (changed.includes('priority')) task.priority = body.priority!
          if (changed.includes('type')) task.type = body.type!
          if (changed.includes('dueDate')) task.dueDate = body.dueDate!
          if (changed.includes('customFields')) task.customFields = body.customFields!
          if (changed.includes('blocked')) {
            task.blocked = Boolean(body.blocked)
            recordEvent(state, {
              actor: actorOf(user),
              task,
              action: task.blocked ? 'Blocked task' : 'Unblocked task',
              summary: task.title
            })
          }
          if (changed.includes('assigneeId')) {
            const name = (id: string) => state.people.find(person => person.id === id)?.name || 'Unassigned'
            task.assigneeId = body.assigneeId!
            recordEvent(state, {
              actor: actorOf(user),
              task,
              action: 'Assigned task',
              summary: `${task.title}: ${name(before.assigneeId)} → ${name(task.assigneeId)}`
            })
          }
          if (changed.includes('status')) applyStatus(state, user, task, body.status!)
          const detailFields = changed.filter(key =>
            ['title', 'projectId', 'priority', 'type', 'dueDate', 'customFields'].includes(key)
          )
          if (detailFields.length)
            recordEvent(state, {
              actor: actorOf(user),
              task,
              action: 'Updated task',
              summary: `${task.title} (${detailFields.join(', ')})`
            })
          appendAudit(state, 'task.updated', auditContext(req), {
            taskId: task.id,
            fields: changed,
            previousStatus: before.status,
            status: task.status
          })
          return taskPublic(light(state), task)
        },
        { reason: 'task-update' }
      )
      res.json(updated)
    })
  )

  app.patch(
    '/api/tasks/:id/status',
    need('writeTasks'),
    handler((req, res) => {
      const user = userOf(req)
      const settings = db.state.settings
      const current = findTask(db.state, req.params.id)
      const body = parse(taskStatusSchema, req.body)
      const states = workflowStates(settings)
      let target: string
      if (body.status) {
        assertStatus(settings, body.status)
        target = body.status
      } else if (body.advance) {
        target = states[Math.min(states.length - 1, Math.max(0, states.indexOf(current.status)) + 1)] || states[0]
      } else throw badRequest('Provide a status, or advance: true')
      assertTransition(settings, user, current.status, target)
      if (target === current.status) return res.json(taskPublic(light(db.state), current))
      const updated = db.commit(
        state => {
          const task = findTask(state, req.params.id)
          const from = task.status
          applyStatus(state, user, task, target)
          appendAudit(state, 'task.status.changed', auditContext(req), { taskId: task.id, from, to: task.status })
          return taskPublic(light(state), task)
        },
        { reason: 'task-status' }
      )
      res.json(updated)
    })
  )

  app.delete(
    '/api/tasks/:id',
    need('manageTasks'),
    handler((req, res) => {
      const user = userOf(req)
      findTask(db.state, req.params.id)
      db.commit(
        state => {
          const task = findTask(state, req.params.id)
          recordEvent(state, {
            actor: actorOf(user),
            task,
            action: 'Deleted task',
            statusFrom: task.status,
            summary: task.title
          })
          state.tasks = state.tasks.filter(candidate => candidate.id !== task.id)
          // Alerts that pointed at the task keep their text but no longer reference a missing row.
          state.alerts.forEach(alert => {
            if (String(alert.taskId) === String(task.id)) alert.taskId = ''
          })
          appendAudit(state, 'task.deleted', auditContext(req), { taskId: task.id, title: task.title })
        },
        { reason: 'task-delete' }
      )
      res.json({ ok: true })
    })
  )

  // ============================== projects ==============================
  const projectResponse = (state: StoreState, project: Project) => {
    const index = buildIndex(state)
    return projectPublic(
      index,
      project,
      state.milestones.filter(milestone => milestone.projectId === project.id)
    )
  }

  app.post(
    '/api/projects',
    need('manageProjects'),
    handler((req, res) => {
      const user = userOf(req)
      const body = parse(projectCreateSchema, req.body)
      const state0 = db.state
      if (body.code && state0.projects.some(project => project.code.toUpperCase() === body.code))
        throw conflict(`The project code "${body.code}" is already used`, 'DUPLICATE_CODE')
      const teamId = body.teamId || state0.teams[0]?.id || ''
      if (teamId) requireTeam(state0, teamId)
      const ownerId = body.ownerId || user.personId || ''
      if (ownerId) requirePerson(state0, ownerId, 'owner')
      const created = db.commit(
        state => {
          const project: Project = {
            id: nextProjectId(state),
            name: body.name,
            code: body.code || uniqueProjectCode(state, body.name),
            description: body.description || '',
            teamId,
            ownerId,
            color: body.color || 'purple',
            status: body.status || 'On track',
            deadline: body.deadline === undefined ? todayIn(state.settings) : body.deadline,
            createdAt: todayIn(state.settings),
            customFields: body.customFields || {},
            sample: false
          }
          state.projects.push(project)
          appendAudit(state, 'project.created', auditContext(req), { projectId: project.id })
          return projectResponse(state, project)
        },
        { reason: 'project-create' }
      )
      res.json(created)
    })
  )

  app.put(
    '/api/projects/:id',
    need('manageProjects'),
    handler((req, res) => {
      const current = findProject(db.state, req.params.id)
      const body = parse(projectUpdateSchema, req.body)
      if (
        body.code &&
        body.code !== current.code &&
        db.state.projects.some(project => project.id !== current.id && project.code.toUpperCase() === body.code)
      )
        throw conflict(`The project code "${body.code}" is already used`, 'DUPLICATE_CODE')
      if (body.teamId) requireTeam(db.state, body.teamId)
      if (body.ownerId) requirePerson(db.state, body.ownerId, 'owner')
      const updated = db.commit(
        state => {
          const project = findProject(state, req.params.id)
          for (const key of [
            'name',
            'code',
            'description',
            'teamId',
            'ownerId',
            'color',
            'status',
            'deadline',
            'customFields'
          ] as const)
            if (body[key] !== undefined) (project as any)[key] = body[key]
          appendAudit(state, 'project.updated', auditContext(req), { projectId: project.id })
          return projectResponse(state, project)
        },
        { reason: 'project-update' }
      )
      res.json(updated)
    })
  )

  app.delete(
    '/api/projects/:id',
    need('manageProjects'),
    handler((req, res) => {
      const project = findProject(db.state, req.params.id)
      const tasks = db.state.tasks.filter(task => task.projectId === project.id).length
      const milestones = db.state.milestones.filter(milestone => milestone.projectId === project.id).length
      const alerts = db.state.alerts.filter(alert => String(alert.projectId) === String(project.id)).length
      if ((tasks || milestones || alerts) && req.query.cascade !== 'true')
        throw new HttpError(
          409,
          `This project still has ${tasks} task(s), ${milestones} milestone(s) and ${alerts} alert(s). Deleting it removes them too.`,
          'HAS_DEPENDENTS',
          { tasks, milestones, alerts }
        )
      db.commit(
        state => {
          state.projects = state.projects.filter(candidate => candidate.id !== project.id)
          state.tasks = state.tasks.filter(task => task.projectId !== project.id)
          state.milestones = state.milestones.filter(milestone => milestone.projectId !== project.id)
          state.alerts = state.alerts.filter(alert => String(alert.projectId) !== String(project.id))
          appendAudit(state, 'project.deleted', auditContext(req), {
            projectId: project.id,
            name: project.name,
            tasks,
            milestones,
            alerts
          })
        },
        { reason: 'project-delete', backupFirst: tasks || milestones ? 'pre-delete-project' : undefined }
      )
      res.json({ ok: true, removed: { tasks, milestones, alerts } })
    })
  )

  // ============================== people & teams ==============================
  app.post(
    '/api/people',
    need('managePeople'),
    handler((req, res) => {
      const body = parse(personCreateSchema, req.body)
      const teamId = body.teamId || db.state.teams[0]?.id || ''
      if (teamId) requireTeam(db.state, teamId)
      const created = db.commit(
        state => {
          const person: Person = {
            id: id('person'),
            name: body.name,
            email: body.email || '',
            jobTitle: body.jobTitle || 'Contributor',
            teamId,
            focus: body.focus || 'Workspace priorities',
            capacity: body.capacity ?? 70,
            status: body.status || 'On track',
            color: body.color || 'purple',
            customFields: body.customFields || {},
            sample: false
          }
          state.people.push(person)
          appendAudit(state, 'person.created', auditContext(req), { personId: person.id })
          return personPublic(buildIndex(state, { light: true }), person)
        },
        { reason: 'person-create' }
      )
      res.json(created)
    })
  )

  app.put(
    '/api/people/:id',
    need('managePeople'),
    handler((req, res) => {
      if (!db.state.people.some(person => person.id === req.params.id)) throw notFound('Person not found')
      const body = parse(personUpdateSchema, req.body)
      if (body.teamId) requireTeam(db.state, body.teamId)
      const updated = db.commit(
        state => {
          const person = state.people.find(candidate => candidate.id === req.params.id)!
          for (const key of [
            'name',
            'email',
            'jobTitle',
            'teamId',
            'focus',
            'capacity',
            'status',
            'color',
            'customFields'
          ] as const)
            if (body[key] !== undefined) (person as any)[key] = body[key]
          appendAudit(state, 'person.updated', auditContext(req), { personId: person.id })
          return personPublic(buildIndex(state, { light: true }), person)
        },
        { reason: 'person-update' }
      )
      res.json(updated)
    })
  )

  app.delete(
    '/api/people/:id',
    need('managePeople'),
    handler((req, res) => {
      const personId = req.params.id
      if (!db.state.people.some(person => person.id === personId)) throw notFound('Person not found')
      if (db.state.users.some(user => user.personId === personId))
        throw badRequest('Cannot delete a person who has a sign-in account. Delete or re-link the account first.')
      const result = db.commit(
        state => {
          state.people = state.people.filter(person => person.id !== personId)
          let unassigned = 0
          state.tasks.forEach(task => {
            if (task.assigneeId === personId) {
              task.assigneeId = ''
              unassigned++
            }
          })
          let ownerCleared = 0
          state.projects.forEach(project => {
            if (project.ownerId === personId) {
              project.ownerId = ''
              ownerCleared++
            }
          })
          appendAudit(state, 'person.deleted', auditContext(req), {
            personId,
            unassignedTasks: unassigned,
            projectsWithoutOwner: ownerCleared
          })
          return { unassigned, ownerCleared }
        },
        { reason: 'person-delete' }
      )
      res.json({ ok: true, unassignedTasks: result.unassigned, projectsWithoutOwner: result.ownerCleared })
    })
  )

  app.post(
    '/api/teams',
    need('managePeople'),
    handler((req, res) => {
      const body = parse(teamCreateSchema, req.body)
      const team = db.commit(
        state => {
          const created: Team = {
            id: id('team'),
            name: body.name,
            color: body.color || 'purple',
            customFields: body.customFields || {},
            sample: false
          }
          state.teams.push(created)
          appendAudit(state, 'team.created', auditContext(req), { teamId: created.id })
          return created
        },
        { reason: 'team-create' }
      )
      res.json(team)
    })
  )

  app.put(
    '/api/teams/:id',
    need('managePeople'),
    handler((req, res) => {
      if (!db.state.teams.some(team => team.id === req.params.id)) throw notFound('Team not found')
      const body = parse(teamUpdateSchema, req.body)
      const team = db.commit(
        state => {
          const target = state.teams.find(candidate => candidate.id === req.params.id)!
          for (const key of ['name', 'color', 'customFields'] as const)
            if (body[key] !== undefined) (target as any)[key] = body[key]
          appendAudit(state, 'team.updated', auditContext(req), { teamId: target.id })
          return target
        },
        { reason: 'team-update' }
      )
      res.json(team)
    })
  )

  app.delete(
    '/api/teams/:id',
    need('managePeople'),
    handler((req, res) => {
      if (!db.state.teams.some(team => team.id === req.params.id)) throw notFound('Team not found')
      if (db.state.people.some(person => person.teamId === req.params.id))
        throw badRequest('Move people before deleting this team')
      if (db.state.projects.some(project => project.teamId === req.params.id))
        throw badRequest('Move projects to another team before deleting this team')
      db.commit(
        state => {
          state.teams = state.teams.filter(team => team.id !== req.params.id)
          appendAudit(state, 'team.deleted', auditContext(req), { teamId: req.params.id })
        },
        { reason: 'team-delete' }
      )
      res.json({ ok: true })
    })
  )

  // ============================== milestones ==============================
  const normalizeMilestoneStatus = (status?: string) => (status === 'Completed' ? 'Complete' : status)

  app.post(
    '/api/milestones',
    need('manageProjects'),
    handler((req, res) => {
      const body = parse(milestoneCreateSchema, req.body)
      requireProject(db.state, body.projectId)
      const created = db.commit(
        state => {
          const milestone = {
            id: id('milestone'),
            name: body.name,
            projectId: requireProject(state, body.projectId).id,
            dueDate: body.dueDate || todayIn(state.settings),
            status: normalizeMilestoneStatus(body.status) || 'Upcoming',
            customFields: body.customFields || {},
            sample: false
          }
          state.milestones.push(milestone)
          appendAudit(state, 'milestone.created', auditContext(req), { milestoneId: milestone.id })
          return milestone
        },
        { reason: 'milestone-create' }
      )
      res.json(created)
    })
  )

  app.put(
    '/api/milestones/:id',
    need('manageProjects'),
    handler((req, res) => {
      if (!db.state.milestones.some(milestone => milestone.id === req.params.id)) throw notFound('Milestone not found')
      const body = parse(milestoneUpdateSchema, req.body)
      if (body.projectId !== undefined) requireProject(db.state, body.projectId)
      const updated = db.commit(
        state => {
          const milestone = state.milestones.find(candidate => candidate.id === req.params.id)!
          if (body.name !== undefined) milestone.name = body.name
          if (body.projectId !== undefined) milestone.projectId = Number(body.projectId)
          if (body.dueDate !== undefined) milestone.dueDate = body.dueDate
          if (body.status !== undefined) milestone.status = normalizeMilestoneStatus(body.status)!
          if (body.customFields !== undefined) milestone.customFields = body.customFields
          appendAudit(state, 'milestone.updated', auditContext(req), { milestoneId: milestone.id })
          return milestone
        },
        { reason: 'milestone-update' }
      )
      res.json(updated)
    })
  )

  app.delete(
    '/api/milestones/:id',
    need('manageProjects'),
    handler((req, res) => {
      if (!db.state.milestones.some(milestone => milestone.id === req.params.id)) throw notFound('Milestone not found')
      db.commit(
        state => {
          state.milestones = state.milestones.filter(milestone => milestone.id !== req.params.id)
          appendAudit(state, 'milestone.deleted', auditContext(req), { milestoneId: req.params.id })
        },
        { reason: 'milestone-delete' }
      )
      res.json({ ok: true })
    })
  )

  // ============================== daily activity ==============================
  app.post(
    '/api/activity',
    need('logActivity'),
    handler((req, res) => {
      const user = userOf(req)
      const body = parse(activityCreateSchema, req.body)
      // Updates are attributed to the signed-in person. Posting on someone else's behalf needs people-management rights.
      const personId = body.personId || user.personId
      if (!personId) throw badRequest('Your account is not linked to a person profile, so it cannot post updates')
      if (personId !== user.personId && !can(db.state.settings, user, 'managePeople'))
        throw forbidden('You can only post updates as yourself')
      requirePerson(db.state, personId)
      const created = db.commit(
        state => {
          const now = new Date()
          const activity = {
            id: id('activity'),
            personId,
            date: todayIn(state.settings, now),
            time: timeIn(state.settings, now),
            yesterday: body.yesterday || '',
            today: body.today || '',
            blocked: body.blocked || '',
            upcoming: body.upcoming || '',
            status: body.status || 'Confirmed',
            customFields: body.customFields || {},
            sample: false
          }
          state.activities.push(activity)
          recordEvent(
            state,
            {
              actor: { id: user.id, personId },
              action: activity.blocked ? 'Raised blocker' : 'Logged update',
              statusTo: activity.blocked ? 'Blocked' : 'Confirmed',
              summary: activityTimelineSummary(activity),
              source: 'Activity log'
            },
            now
          )
          appendAudit(state, 'activity.logged', auditContext(req), { activityId: activity.id, personId })
          return activityPublic(buildIndex(state, { light: true }), activity)
        },
        { reason: 'activity' }
      )
      res.json(created)
    })
  )

  app.delete(
    '/api/activity/:id',
    need('manageTasks'),
    handler((req, res) => {
      if (!db.state.activities.some(activity => activity.id === req.params.id)) throw notFound('Activity not found')
      db.commit(
        state => {
          state.activities = state.activities.filter(activity => activity.id !== req.params.id)
          appendAudit(state, 'activity.deleted', auditContext(req), { activityId: req.params.id })
        },
        { reason: 'activity-delete' }
      )
      res.json({ ok: true })
    })
  )

  // ============================== alerts ==============================
  const alertRefs = (state: StoreState, body: { projectId?: unknown; taskId?: unknown }) => {
    const projectId = body.projectId === '' || body.projectId == null ? '' : requireProject(state, body.projectId).id
    const taskId = body.taskId === '' || body.taskId == null ? '' : findTaskStrict(state, body.taskId).id
    return { projectId, taskId }
  }
  const findTaskStrict = (state: StoreState, rawId: unknown) => {
    const task = state.tasks.find(candidate => candidate.id === numeric(rawId))
    if (!task) throw badRequest('The selected task does not exist')
    return task
  }

  app.post(
    '/api/alerts',
    need('manageAlerts'),
    handler((req, res) => {
      const body = parse(alertCreateSchema, req.body)
      alertRefs(db.state, body)
      const created = db.commit(
        state => {
          const refs = alertRefs(state, body)
          const type = body.type || 'info'
          const alert = {
            id: id('alert'),
            title: body.title,
            body: body.body || '',
            type,
            tone: body.tone || (type === 'risk' || type === 'blocker' ? 'orange' : 'blue'),
            projectId: refs.projectId,
            taskId: refs.taskId,
            resolved: false,
            createdAt: todayIn(state.settings),
            customFields: body.customFields || {},
            sample: false
          }
          state.alerts.push(alert)
          appendAudit(state, 'alert.created', auditContext(req), { alertId: alert.id })
          return alertPublic(buildIndex(state, { light: true }), alert)
        },
        { reason: 'alert-create' }
      )
      res.json(created)
    })
  )

  app.patch(
    '/api/alerts/:id',
    // The baseline permission is checked before the body is looked at (VAL-04): an empty or partial patch must not be
    // a way past authorisation. Editing the alert's content additionally needs manageAlerts; resolving needs only this.
    need(['writeTasks', 'manageAlerts'], 'Task write access is required to update alerts'),
    handler((req, res) => {
      const user = userOf(req)
      const settings = db.state.settings
      const body = parse(alertPatchSchema, req.body)
      if (!Object.keys(body).length) throw badRequest('Nothing to update')
      const editKeys = Object.keys(body).filter(key => key !== 'resolved')
      if (editKeys.length && !can(settings, user, 'manageAlerts'))
        throw forbidden('Manager or administrator access required to edit alerts')
      if (!db.state.alerts.some(alert => alert.id === req.params.id)) throw notFound('Alert not found')
      if (body.projectId !== undefined || body.taskId !== undefined) alertRefs(db.state, body)
      const updated = db.commit(
        state => {
          const alert = state.alerts.find(candidate => candidate.id === req.params.id)!
          if (body.title !== undefined) alert.title = body.title
          if (body.body !== undefined) alert.body = body.body
          if (body.type !== undefined) alert.type = body.type
          if (body.tone !== undefined) alert.tone = body.tone
          if (body.projectId !== undefined) alert.projectId = alertRefs(state, { projectId: body.projectId }).projectId
          if (body.taskId !== undefined) alert.taskId = alertRefs(state, { taskId: body.taskId }).taskId
          if (body.customFields !== undefined) alert.customFields = body.customFields
          if (body.resolved !== undefined) alert.resolved = body.resolved
          appendAudit(state, 'alert.updated', auditContext(req), { alertId: alert.id, resolved: alert.resolved })
          return alertPublic(buildIndex(state, { light: true }), alert)
        },
        { reason: 'alert-update' }
      )
      res.json(updated)
    })
  )

  app.delete(
    '/api/alerts/:id',
    need('manageAlerts'),
    handler((req, res) => {
      if (!db.state.alerts.some(alert => alert.id === req.params.id)) throw notFound('Alert not found')
      db.commit(
        state => {
          state.alerts = state.alerts.filter(alert => alert.id !== req.params.id)
          appendAudit(state, 'alert.deleted', auditContext(req), { alertId: req.params.id })
        },
        { reason: 'alert-delete' }
      )
      res.json({ ok: true })
    })
  )
}
