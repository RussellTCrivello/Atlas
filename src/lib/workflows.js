import { TASK_STATUSES } from './constants.js'

export function workflowStateLabels(settings) {
  const states = settings?.workflows?.task?.states
  return Array.isArray(states) && states.length
    ? states.map((state) => typeof state === 'string' ? state : state.label || state.name).filter(Boolean)
    : TASK_STATUSES
}
