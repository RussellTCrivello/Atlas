// The work ledger: an append-only record of what happened to work items and who did it.
// Rows carry facts only (who, what, when, from/to status). They never carry invented effort such as minutes.
import { id } from './util'
import { isDone, taskKey, timeIn, todayIn } from './domain'
import type { Activity, Person, StoreState, Task, WorkLog } from './types'

export interface Actor {
  /** User account id. */
  id: string
  personId: string
}

export interface EventInput {
  actor?: Actor | null
  task?: Task | null
  /** Person the event is about when it is not the actor (e.g. the assignee of a task someone else moved). */
  assigneeId?: string
  action: string
  statusFrom?: string
  statusTo?: string
  summary?: string
  source?: string
  sample?: boolean
}

export function recordEvent(state: StoreState, input: EventInput, now = new Date()): WorkLog {
  const task = input.task || null
  const project = task ? state.projects.find(p => p.id === task.projectId) : undefined
  const log: WorkLog = {
    id: id('worklog'),
    // Credit the person who acted. Fall back to the assignee only when the actor has no linked person profile.
    personId: input.actor?.personId || input.assigneeId || task?.assigneeId || '',
    actorUserId: input.actor?.id,
    assigneeId: input.assigneeId ?? task?.assigneeId,
    taskId: task?.id,
    projectId: task?.projectId,
    taskKey: task ? task.key || taskKey(project, task.id) : undefined,
    taskTitle: task?.title,
    projectName: project?.name,
    action: input.action,
    statusFrom: input.statusFrom || '',
    statusTo: input.statusTo || '',
    summary: input.summary || '',
    date: todayIn(state.settings, now),
    time: timeIn(state.settings, now),
    at: now.toISOString(),
    source: input.source || 'Task event',
    sample: Boolean(input.sample)
  }
  state.workLogs.push(log)
  return log
}

/**
 * Build ledger rows from existing records that have none. Used when migrating older stores and when seeding demo data.
 * Only facts that were really recorded are used (a task's creation date and completion date, an activity's timestamp);
 * rows are flagged `derived` so they are never mistaken for live events, and no effort, clock times or intermediate
 * statuses are invented.
 */
export function deriveLedger(state: StoreState): WorkLog[] {
  const rows: WorkLog[] = []
  const have = new Set(state.workLogs.map(row => row.id))
  const projects = new Map(state.projects.map(project => [project.id, project]))
  const add = (row: WorkLog) => {
    if (have.has(row.id)) return
    have.add(row.id)
    rows.push(row)
  }
  const createdTasks = new Set(
    state.workLogs.filter(row => row.action === 'Created task' && row.taskId != null).map(row => row.taskId)
  )
  const completedTasks = new Set(
    state.workLogs.filter(row => row.action === 'Completed task' && row.taskId != null).map(row => row.taskId)
  )
  for (const task of state.tasks) {
    const project = projects.get(task.projectId)
    const common = {
      assigneeId: task.assigneeId,
      taskId: task.id,
      projectId: task.projectId,
      taskKey: task.key || taskKey(project, task.id),
      taskTitle: task.title,
      projectName: project?.name,
      time: '',
      source: 'Task record',
      derived: true,
      sample: Boolean(task.sample)
    }
    if (task.createdAt && !createdTasks.has(task.id))
      add({
        ...common,
        id: `wl_created_${task.id}`,
        personId: task.createdBy || task.assigneeId,
        action: 'Created task',
        statusFrom: '',
        statusTo: '',
        summary: task.title,
        date: task.createdAt
      })
    if (task.completedAt && isDone(state.settings, task) && !completedTasks.has(task.id))
      add({
        ...common,
        id: `wl_completed_${task.id}`,
        personId: task.assigneeId,
        action: 'Completed task',
        statusFrom: '',
        statusTo: task.status,
        summary: task.title,
        date: task.completedAt
      })
  }
  const haveActivity = new Set(state.workLogs.map(row => row.id))
  for (const activity of state.activities as Activity[]) {
    const rowId = `wl_act_${activity.id}`
    if (haveActivity.has(rowId) || !(activity.today || activity.yesterday || activity.blocked)) continue
    add({
      id: rowId,
      personId: activity.personId,
      action: activity.blocked ? 'Raised blocker' : 'Logged update',
      statusFrom: '',
      statusTo: activity.blocked ? 'Blocked' : 'Confirmed',
      summary: activityTimelineSummary(activity),
      date: activity.date,
      time: activity.time || '',
      source: 'Activity log',
      derived: true,
      sample: Boolean(activity.sample)
    })
  }
  return rows
}

export function activityTimelineSummary(
  activity: Pick<Activity, 'yesterday' | 'today' | 'blocked' | 'upcoming'>
): string {
  return [
    activity.yesterday && `Yesterday: ${activity.yesterday}`,
    activity.today && `Today: ${activity.today}`,
    activity.blocked && `Blocked: ${activity.blocked}`,
    activity.upcoming && `Upcoming: ${activity.upcoming}`
  ]
    .filter(Boolean)
    .join(' | ')
}

export const personName = (people: Map<string, Person>, personId: string) => people.get(personId)?.name || 'Unknown'
