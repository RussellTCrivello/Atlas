// Public data shapes sent to the browser. Presenters never throw on odd stored data (a bad date renders as text
// rather than turning a whole list into a 500).
import { addDays, daysBetween, isIsoDate } from './util'
import { type Index, formatDate, isDone, permissionsFor, taskKey } from './domain'
import type { Activity, Alert, Person, Project, SessionUser, Task, User, WorkLog } from './types'

export function publicUser(index: Pick<Index, 'settings'>, user: User): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    personId: user.personId,
    avatarColor: user.avatarColor,
    active: user.active !== false,
    mustChangePassword: Boolean(user.mustChangePassword),
    permissions: permissionsFor(index.settings, user.role)
  }
}

export function publicAccessUser(index: Index, user: User) {
  const person = index.people.get(user.personId)
  return {
    ...publicUser(index, user),
    personName: person?.name || user.name,
    team: (person && index.teams.get(person.teamId)?.name) || 'Workspace',
    lastLoginAt: user.lastLoginAt || '',
    createdAt: user.createdAt || '',
    sample: Boolean(user.sample)
  }
}

export function dueTone(index: Index, task: Task): string {
  if (isDone(index.settings, task)) return 'done'
  if (task.dueDate === index.today) return 'today'
  if (task.dueDate && task.dueDate < index.today) return 'overdue'
  return 'soon'
}

/** Whole days until the due date (negative when late), or null when the task has no valid date. */
export function dueDays(index: Index, task: Pick<Task, 'dueDate'>): number | null {
  if (!task.dueDate || !isIsoDate(task.dueDate)) return null
  const diff = daysBetween(index.today, task.dueDate)
  return Number.isNaN(diff) ? null : diff
}

export function dueLabel(index: Index, task: Pick<Task, 'dueDate'>): string {
  const diff = dueDays(index, task)
  if (diff === null) return task.dueDate ? String(task.dueDate) : 'No date'
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d late`
  return formatDate(index.settings, task.dueDate)
}

export function projectProgress(index: Index, project: Project): number {
  const tasks = index.tasksByProject.get(String(project.id)) || []
  if (!tasks.length) return 0
  return Math.round((tasks.filter(task => isDone(index.settings, task)).length / tasks.length) * 100)
}

export function projectHealth(index: Index, project: Project): string {
  if (project.status === 'Completed') return 'Completed'
  if (project.status === 'At risk') return 'At risk'
  const overdue = (index.tasksByProject.get(String(project.id)) || []).some(
    task => !isDone(index.settings, task) && task.dueDate && task.dueDate < index.today
  )
  return overdue ? 'At risk' : 'On track'
}

export function taskPublic(index: Index, task: Task) {
  const project = index.projects.get(String(task.projectId))
  const person = index.people.get(task.assigneeId)
  return {
    numericId: task.id,
    id: task.key || taskKey(project, task.id),
    title: task.title,
    projectId: task.projectId,
    project: project?.name || 'Workspace',
    assigneeId: task.assigneeId,
    assignee: person?.name || 'Unassigned',
    assigneeColor: person?.color || 'purple',
    priority: task.priority || 'Medium',
    dueDate: task.dueDate,
    due: dueLabel(index, task),
    dueDays: dueDays(index, task),
    dueTone: dueTone(index, task),
    status: task.status || 'To do',
    type: task.type || 'Development',
    blocked: Boolean(task.blocked),
    done: isDone(index.settings, task),
    createdAt: task.createdAt,
    createdBy: task.createdBy || '',
    completedAt: task.completedAt || '',
    customFields: task.customFields || {}
  }
}
export type TaskPublic = ReturnType<typeof taskPublic>

export function projectPublic(index: Index, project: Project, milestones: { projectId: number | string }[]) {
  const team = index.teams.get(project.teamId)
  const owner = index.people.get(project.ownerId)
  const taskRows = index.tasksByProject.get(String(project.id)) || []
  const memberIds = [
    ...new Set(
      taskRows
        .map(task => task.assigneeId)
        .concat(project.ownerId)
        .filter(Boolean)
    )
  ]
  const members = memberIds.map(personId => index.people.get(personId)).filter((p): p is Person => Boolean(p))
  const diff = project.deadline && isIsoDate(project.deadline) ? daysBetween(index.today, project.deadline) : null
  return {
    id: `project-${project.id}`,
    numericId: project.id,
    name: project.name,
    code: project.code,
    description: project.description,
    teamId: project.teamId,
    team: team?.name || 'Workspace',
    ownerId: project.ownerId,
    owner: owner?.name || 'Unassigned',
    color: project.color || team?.color || 'purple',
    status: project.status,
    health: projectHealth(index, project),
    progress: projectProgress(index, project),
    deadlineDate: project.deadline,
    deadline: formatDate(index.settings, project.deadline),
    deadlineDays: diff,
    days: diff == null ? 'No date' : diff < 0 ? `${Math.abs(diff)} days late` : `${diff} days`,
    members: members.map(person => person.name),
    memberColors: Object.fromEntries(members.map(person => [person.name, person.color])),
    milestoneRows: milestones.map(milestone => ({ ...milestone, projectId: project.id })),
    customFields: project.customFields || {}
  }
}

export function personPublic(index: Index, person: Person) {
  const team = index.teams.get(person.teamId)
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    jobTitle: person.jobTitle,
    role: person.jobTitle,
    teamId: person.teamId,
    team: team?.name || 'Workspace',
    focus: person.focus,
    capacity: person.capacity,
    load: person.capacity,
    status: person.status,
    color: person.color || team?.color || 'purple',
    customFields: person.customFields || {}
  }
}

export function activityPublic(index: Index, activity: Activity) {
  const person = index.people.get(activity.personId)
  return {
    ...activity,
    customFields: activity.customFields || {},
    person: person?.name || 'Unknown',
    personColor: person?.color || 'purple',
    isToday: activity.date === index.today
  }
}

export function alertPublic(index: Index, alert: Alert) {
  const project = index.projects.get(String(alert.projectId))
  return {
    ...alert,
    customFields: alert.customFields || {},
    project: project?.name || 'Workspace',
    time: alert.createdAt ? formatDate(index.settings, alert.createdAt) : 'Now'
  }
}

/** Ledger row as shown in reports. Names come from live records when they still exist, else from the row's own snapshot. */
export function workLogPublic(index: Index, log: WorkLog, periodKey: string, periodLabel: string) {
  const person = index.people.get(log.personId)
  const task = log.taskId != null ? index.tasks.get(String(log.taskId)) : undefined
  const project = index.projects.get(String(log.projectId ?? task?.projectId ?? ''))
  return {
    id: log.id,
    date: log.date,
    time: log.time || '',
    periodKey,
    periodLabel,
    personId: log.personId,
    person: person?.name || (log.personId ? 'Former member' : 'Unknown'),
    role: person?.jobTitle || '',
    projectId: log.projectId ?? '',
    project: project?.name || log.projectName || 'Workspace',
    projectCode: project?.code || '',
    taskId: log.taskId != null ? task?.key || log.taskKey || taskKey(project, log.taskId) : '',
    taskNumericId: log.taskId ?? '',
    task: task?.title || log.taskTitle || (log.taskId != null ? 'Deleted task' : 'Daily update'),
    action: log.action,
    statusFrom: log.statusFrom || '',
    statusTo: log.statusTo || '',
    status: log.statusTo || log.action,
    summary: log.summary || '',
    source: log.source || 'Task event',
    derived: Boolean(log.derived)
  }
}

export const yesterdayOf = (index: Index) => addDays(index.today, -1)
