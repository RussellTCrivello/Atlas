// Daily updates, alerts and ledger rows as the browser sees them.
import { formatDate } from '../domain/time'
import { taskKey } from '../domain/keys'
import type { Activity, Alert, WorkLog } from '../domain/types'
import type { ReferenceIndex } from './reference-index'

export function activityPublic(ref: ReferenceIndex, activity: Activity) {
  const person = ref.people.get(activity.personId)
  return {
    ...activity,
    customFields: activity.customFields || {},
    person: person?.name || 'Unknown',
    personColor: person?.color || 'purple',
    isToday: activity.date === ref.today
  }
}

export function alertPublic(ref: ReferenceIndex, alert: Alert) {
  const project = ref.projects.get(String(alert.projectId))
  return {
    ...alert,
    customFields: alert.customFields || {},
    project: project?.name || 'Workspace',
    time: alert.createdAt ? formatDate(ref.settings, alert.createdAt) : 'Now'
  }
}

/** Ledger row as shown in reports. Names come from live records when they still exist, else from the row's own snapshot. */
export function workLogPublic(
  ref: ReferenceIndex,
  log: WorkLog,
  periodKey: string,
  periodLabel: string,
  taskTitle?: string,
  taskKeyNow?: string
) {
  const person = ref.people.get(log.personId)
  const project = ref.projects.get(String(log.projectId ?? ''))
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
    taskId: log.taskId != null ? taskKeyNow || log.taskKey || taskKey(project, log.taskId) : '',
    taskNumericId: log.taskId ?? '',
    task: taskTitle || log.taskTitle || (log.taskId != null ? 'Deleted task' : 'Daily update'),
    action: log.action,
    statusFrom: log.statusFrom || '',
    statusTo: log.statusTo || '',
    status: log.statusTo || log.action,
    summary: log.summary || '',
    source: log.source || 'Task event',
    derived: Boolean(log.derived)
  }
}
export type WorkLogPublic = ReturnType<typeof workLogPublic>
