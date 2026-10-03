// Task as the browser sees it: ids resolved to names, due dates turned into labels and tones.
import { formatDate } from '../domain/time'
import { taskKey } from '../domain/keys'
import type { Task } from '../domain/types'
import { isDone } from '../domain/workflow'
import { daysBetween, isIsoDate } from '../util'
import type { ReferenceIndex } from './reference-index'

export function dueTone(ref: ReferenceIndex, task: Task): string {
  if (isDone(ref.settings, task)) return 'done'
  if (task.dueDate === ref.today) return 'today'
  if (task.dueDate && task.dueDate < ref.today) return 'overdue'
  return 'soon'
}

/** Whole days until the due date (negative when late), or null when the task has no valid date. */
export function dueDays(ref: Pick<ReferenceIndex, 'today'>, task: Pick<Task, 'dueDate'>): number | null {
  if (!task.dueDate || !isIsoDate(task.dueDate)) return null
  const diff = daysBetween(ref.today, task.dueDate)
  return Number.isNaN(diff) ? null : diff
}

export function dueLabel(ref: Pick<ReferenceIndex, 'today' | 'settings'>, task: Pick<Task, 'dueDate'>): string {
  const diff = dueDays(ref, task)
  if (diff === null) return task.dueDate ? String(task.dueDate) : 'No date'
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d late`
  return formatDate(ref.settings, task.dueDate)
}

export interface TaskTag {
  id: string
  name: string
  color: string
}

export function taskPublic(ref: ReferenceIndex, task: Task, tags: TaskTag[] = []) {
  const project = ref.projects.get(String(task.projectId))
  const person = ref.people.get(task.assigneeId)
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
    due: dueLabel(ref, task),
    dueDays: dueDays(ref, task),
    dueTone: dueTone(ref, task),
    status: task.status || 'To do',
    type: task.type || 'Development',
    blocked: Boolean(task.blocked),
    done: isDone(ref.settings, task),
    createdAt: task.createdAt,
    createdBy: task.createdBy || '',
    completedAt: task.completedAt || '',
    customFields: task.customFields || {},
    tags
  }
}
export type TaskPublic = ReturnType<typeof taskPublic>
