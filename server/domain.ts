// Pure domain helpers that operate on a state snapshot. No I/O.
import { DEFAULT_WORKFLOW_STATES, ROLE_PERMISSIONS, isValidTimeZone } from '../shared/settings'
import type { Person, Project, StoreState, Task, Team, User } from './types'
import { dateInZone, timeInZone } from './util'

export function workspaceTimezone(settings: any): string {
  const tz = settings?.workspace?.defaultTimezone
  return isValidTimeZone(tz) ? tz : 'UTC'
}
export const todayIn = (settings: any, date = new Date()) => dateInZone(date, workspaceTimezone(settings))
export const timeIn = (settings: any, date = new Date()) => timeInZone(date, workspaceTimezone(settings))

export function workflowDefinitions(settings: any): { id: string; label: string; terminal: boolean }[] {
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

// ---- roles & permissions -----------------------------------------------------------------------------------------
const own = (object: any, key: string) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, key)

export function permissionsFor(settings: any, role: string = 'Viewer'): string[] {
  const registry = settings?.permissions?.roles
  if (own(registry, role) && Array.isArray(registry[role]?.permissions)) return registry[role].permissions
  // A role that no longer exists in the registry degrades to read-only rather than to nothing.
  return ROLE_PERMISSIONS.Viewer
}
export const can = (settings: any, user: Pick<User, 'role'> | null | undefined, permission: string): boolean =>
  Boolean(user) && permissionsFor(settings, user!.role).includes(permission)

export function roleRank(settings: any, role: string): number {
  const registry = settings?.permissions?.roles
  if (own(registry, role) && registry[role]?.rank) return Number(registry[role].rank)
  return ({ Viewer: 1, Developer: 2, Manager: 3, Administrator: 4 } as Record<string, number>)[role] || 1
}
export const roleExists = (settings: any, role: unknown): role is string =>
  typeof role === 'string' && own(settings?.permissions?.roles, role)

/** A user who can still administer the workspace: active, with both user and settings management. */
export function isAdministrator(settings: any, user: User): boolean {
  if (user.active === false) return false
  const permissions = permissionsFor(settings, user.role)
  return permissions.includes('manageUsers') && permissions.includes('manageSettings')
}

export function taskKey(project: Pick<Project, 'code'> | undefined, id: number): string {
  return `${project?.code || 'TASK'}-${String(id).padStart(3, '0')}`
}

// ---- indexed lookups ---------------------------------------------------------------------------------------------
/** Per-request lookup tables so presenters are O(n) instead of O(n·m). */
export interface Index {
  state: StoreState
  settings: any
  today: string
  tz: string
  people: Map<string, Person>
  teams: Map<string, Team>
  projects: Map<string, Project>
  tasks: Map<string, Task>
  tasksByProject: Map<string, Task[]>
  peopleByTeam: Map<string, number>
}
export function buildIndex(state: StoreState, options: { now?: Date; light?: boolean } = {}): Index {
  const now = options.now || new Date()
  const light = Boolean(options.light)
  const people = new Map(state.people.map(person => [person.id, person]))
  const teams = new Map(state.teams.map(team => [team.id, team]))
  const projects = new Map(state.projects.map(project => [String(project.id), project]))
  const tasks = new Map<string, Task>()
  const tasksByProject = new Map<string, Task[]>()
  for (const task of light ? [] : state.tasks) {
    tasks.set(String(task.id), task)
    const key = String(task.projectId)
    const list = tasksByProject.get(key)
    if (list) list.push(task)
    else tasksByProject.set(key, [task])
  }
  const peopleByTeam = new Map<string, number>()
  for (const person of light ? [] : state.people)
    peopleByTeam.set(person.teamId, (peopleByTeam.get(person.teamId) || 0) + 1)
  return {
    state,
    settings: state.settings,
    today: todayIn(state.settings, now),
    tz: workspaceTimezone(state.settings),
    people,
    teams,
    projects,
    tasks,
    tasksByProject,
    peopleByTeam
  }
}

// ---- date formatting for server-built labels ---------------------------------------------------------------------
const localeCache = new Map<string, string>()
export function localeFor(settings: any): string {
  const lang = String(settings?.localization?.defaultLanguage || settings?.workspace?.defaultLanguage || 'en')
  let locale = localeCache.get(lang)
  if (!locale) {
    // Month and weekday names follow the workspace language; digits stay Latin so that numbers elsewhere in the UI match.
    try {
      locale = new Intl.Locale(`${lang}-u-nu-latn`).toString()
    } catch {
      locale = 'en-u-nu-latn'
    }
    localeCache.set(lang, locale)
  }
  return locale
}

// Constructing an Intl.DateTimeFormat is expensive (tens of microseconds); presenters format one date per task, so cache.
const formatterCache = new Map<string, Intl.DateTimeFormat>()
export function formatDate(
  settings: any,
  value: string | undefined | null,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
): string {
  if (!value) return 'No date'
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return String(value)
  try {
    const locale = localeFor(settings)
    const key = `${locale}|${JSON.stringify(options)}`
    let formatter = formatterCache.get(key)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
      formatterCache.set(key, formatter)
    }
    return formatter.format(date)
  } catch {
    return String(value)
  }
}
