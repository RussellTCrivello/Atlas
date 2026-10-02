// Human-readable labels built on the client so they follow the *user's* language (the server sends raw dates and day counts).
import { localDate } from './format'
import { tr, translateUiText } from './i18n'

/** "Today", "Tomorrow", "3d late" or a short date for a task. */
export function dueText(
  task: { dueDays?: number | null; dueDate?: string; due?: string },
  language: string,
  settings: any
): string {
  const days = task.dueDays
  if (days === null || days === undefined) return task.due || ''
  if (days === 0) return translateUiText(settings, 'Today')
  if (days === 1) return translateUiText(settings, 'Tomorrow')
  if (days < 0) return tr(settings, '{days}d late', { days: -days })
  return localDate(task.dueDate, language)
}

/** "12 days", "3 days late" or "No date" for a project deadline. */
export function deadlineText(
  project: { deadlineDays?: number | null; deadlineDate?: string; days?: string },
  language: string,
  settings: any
): string {
  const days = project.deadlineDays
  if (days === null || days === undefined) return project.days || translateUiText(settings, 'No date')
  if (days < 0) return tr(settings, '{days} days late', { days: -days })
  return tr(settings, '{days} days', { days })
}
