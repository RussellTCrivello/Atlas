// Task workflow rules: which statuses exist, which are terminal ("done"), and which moves the administrator allows.
import { DEFAULT_WORKFLOW_STATES } from '../../shared/settings'
import type { Task } from './types'

export interface WorkflowState {
  id: string
  label: string
  terminal: boolean
}

export function workflowDefinitions(settings: any): WorkflowState[] {
  const states = settings?.workflows?.task?.states
  return Array.isArray(states) && states.length ? states : DEFAULT_WORKFLOW_STATES
}
export const workflowStates = (settings: any): string[] =>
  workflowDefinitions(settings)
    .map(state => state.label)
    .filter(Boolean)
export const terminalStates = (settings: any): string[] =>
  workflowDefinitions(settings)
    .filter(state => state.terminal)
    .map(state => state.label)
    .filter(Boolean)
export const isDone = (settings: any, task: Pick<Task, 'status'> | null | undefined): boolean =>
  Boolean(task) && terminalStates(settings).includes(task!.status)

export type TransitionVerdict =
  { allowed: true; permission?: undefined } | { allowed: true; permission: string } | { allowed: false }

/**
 * Transition rules apply only when an administrator turned on "Enforce transitions". Returns whether the move is allowed
 * and, when it is, the permission a person needs to make it (if the rule names one).
 */
export function transitionRule(settings: any, from: string, to: string): TransitionVerdict {
  const workflow = settings?.workflows?.task
  if (!workflow?.enforceTransitions || from === to) return { allowed: true }
  const rule = (workflow.transitions || []).find((transition: any) => transition.from === from && transition.to === to)
  if (!rule) return { allowed: false }
  return rule.permission ? { allowed: true, permission: String(rule.permission) } : { allowed: true }
}

/** The state a task moves to when someone presses "advance": the next one in workflow order (the last stays last). */
export function nextState(settings: any, current: string): string {
  const states = workflowStates(settings)
  return states[Math.min(states.length - 1, Math.max(0, states.indexOf(current)) + 1)] || states[0]
}
