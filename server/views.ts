// Response builders that decide what each role is allowed to see.
import { buildTranslationCatalog } from '../shared/i18n/catalog'
import { RTL_LANGUAGES } from '../shared/i18n/catalog'
import { withLegacySettings } from '../shared/settings'
import { type Index, buildIndex, can, formatDate, isDone } from './domain'
import {
  activityPublic,
  alertPublic,
  personPublic,
  projectPublic,
  publicAccessUser,
  publicUser,
  taskPublic,
  type TaskPublic
} from './presenters'
import { reportFor } from './reports'
import type { StoreState, User } from './types'
import { addDays } from './util'

/** Top-level settings branches every signed-in user needs to render the UI. Everything else is administrator-only. */
const MEMBER_BRANCHES = [
  'workspace',
  'interface',
  'modules',
  'workflows',
  'customFields',
  'exports',
  'reports'
] as const
const MEMBER_LOCALIZATION = [
  'activeLanguages',
  'defaultLanguage',
  'fallbackLanguage',
  'userLanguagePreference',
  'textDirectionByLanguage',
  'dateFormats',
  'numberFormats',
  'currencyFormats',
  'timezoneFormats',
  'translations',
  'languagePackages',
  'runtime'
] as const

/**
 * Settings as sent to the browser. Administrators receive the whole tree (minus the bulky runtime missing-key log,
 * which has its own endpoint); everyone else receives only what is needed to render screens. In particular
 * security, audit, integration and storage settings and the role/permission registry never leave the server for
 * non-administrators.
 */
export function settingsForClient(settings: any, admin: boolean): any {
  if (admin) {
    const copy = structuredClone(settings)
    if (copy.localization) {
      copy.localization.missingKeys = []
      copy.localization.missingKeyCount = settings.localization?.missingKeys?.length || 0
    }
    return copy
  }
  const out: any = {}
  for (const branch of MEMBER_BRANCHES)
    if (settings[branch] !== undefined) out[branch] = structuredClone(settings[branch])
  if (out.workspace) out.workspace = { ...out.workspace, organization: undefined }
  out.localization = {}
  for (const key of MEMBER_LOCALIZATION)
    if (settings.localization?.[key] !== undefined) out.localization[key] = structuredClone(settings.localization[key])
  return withLegacySettings(out)
}

export function dashboard(
  index: Index,
  tasks: TaskPublic[],
  projects: ReturnType<typeof projectPublic>[],
  alerts: ReturnType<typeof alertPublic>[],
  user: User
) {
  const { state, settings, today } = index
  const open = tasks.filter(task => !isDone(settings, { status: task.status }))
  const activeProjects = projects.filter(project => project.health !== 'Completed').length
  const atRisk = projects.filter(project => project.health === 'At risk').length
  const yesterday = addDays(today, -1)
  const todayEntries = state.activities.filter(activity => activity.date === today)
  const yesterdayEntries = state.activities.filter(activity => activity.date === yesterday)
  const person = (personId: string) => index.people.get(personId)?.name || 'Unknown'
  const pulse = (title: string, detail: string, time: string, icon: string) => ({
    title,
    detail: detail || 'No update',
    time: time || '',
    icon
  })

  // "Yesterday": what people report having done. Prefer each person's entry logged today (its "yesterday" field);
  // for people who have not posted today, use the "today" plan from the entry they logged yesterday.
  const doneYesterday = new Map<string, ReturnType<typeof pulse>>()
  for (const entry of todayEntries)
    if (entry.yesterday)
      doneYesterday.set(entry.personId, pulse(person(entry.personId), entry.yesterday, entry.time, 'check'))
  for (const entry of yesterdayEntries)
    if (entry.today && !doneYesterday.has(entry.personId))
      doneYesterday.set(entry.personId, pulse(person(entry.personId), entry.today, entry.time, 'check'))

  const upcoming = state.milestones
    .filter(
      milestone => milestone.status !== 'Complete' && milestone.status !== 'Completed' && milestone.dueDate >= today
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4)
    .map(milestone =>
      pulse(
        milestone.name,
        index.projects.get(String(milestone.projectId))?.name || 'Project',
        formatDate(settings, milestone.dueDate),
        'calendar'
      )
    )

  const mine = open.filter(task => task.assigneeId && task.assigneeId === user.personId)
  return {
    stats: {
      activeProjects,
      openTasks: open.length,
      myOpenTasks: mine.length,
      needsAttention: alerts.filter(alert => !alert.resolved).length,
      onTrack: activeProjects ? Math.round(((activeProjects - atRisk) / activeProjects) * 100) : 100,
      completedTasks: tasks.length - open.length
    },
    dailyPulse: {
      yesterday: [...doneYesterday.values()].slice(0, 4),
      today: todayEntries.slice(0, 4).map(entry => pulse(person(entry.personId), entry.today, entry.time, 'bolt')),
      blocked: todayEntries
        .filter(entry => entry.blocked)
        .map(entry => pulse(person(entry.personId), entry.blocked, entry.time, 'warning'))
        .concat(
          open
            .filter(task => task.blocked)
            .slice(0, 3)
            .map(task => pulse(task.title, `${task.project} · ${task.assignee}`, task.due, 'warning'))
        ),
      upcoming
    },
    myTasks: mine.slice(0, 6)
  }
}

const byDueDate = (a: TaskPublic, b: TaskPublic) => {
  // Tasks without a due date sort last; ties keep a stable order by id.
  if (!a.dueDate !== !b.dueDate) return a.dueDate ? -1 : 1
  return String(a.dueDate || '').localeCompare(String(b.dueDate || '')) || a.numericId - b.numericId
}

export function bootstrapFor(state: StoreState, user: User) {
  const index = buildIndex(state)
  const { settings } = index
  const canAdmin = can(settings, user, 'manageSettings')
  const milestonesByProject = new Map<string, StoreState['milestones']>()
  for (const milestone of state.milestones) {
    const key = String(milestone.projectId)
    milestonesByProject.set(key, [...(milestonesByProject.get(key) || []), milestone])
  }
  const teams = state.teams.map(team => ({ ...team, peopleCount: index.peopleByTeam.get(team.id) || 0 }))
  const people = state.people.map(person => personPublic(index, person))
  const projects = state.projects.map(project =>
    projectPublic(index, project, milestonesByProject.get(String(project.id)) || [])
  )
  const tasks = state.tasks.map(task => taskPublic(index, task)).sort(byDueDate)
  const activity = state.activities
    .map(entry => activityPublic(index, entry))
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
  const alerts = state.alerts
    .map(alert => alertPublic(index, alert))
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || String(b.createdAt).localeCompare(String(a.createdAt)))
  const canReport = can(settings, user, 'viewReports')
  return {
    today: index.today,
    revision: state.meta.writeCount,
    user: publicUser(index, user),
    settings: settingsForClient(settings, canAdmin),
    teams,
    people,
    // The account directory (roles, last sign-in) is visible only to those who manage users.
    users: can(settings, user, 'manageUsers') ? state.users.map(account => publicAccessUser(index, account)) : [],
    projects,
    tasks,
    activity,
    alerts,
    dashboard: dashboard(index, tasks, projects, alerts, user),
    reports: canReport ? reportFor(index, 'weekly') : { period: 'weekly', series: [], restricted: true }
  }
}

export function translationCatalogPayload(settings: any, language: string | null = null) {
  const localization = settings.localization || {}
  const fallback = localization.fallbackLanguage || 'en'
  const selected =
    language && (localization.activeLanguages || []).includes(language)
      ? language
      : localization.defaultLanguage || fallback || 'en'
  const builtin = buildTranslationCatalog()
  const catalogFor = (lang: string) => ({ ...(builtin[lang] || {}), ...(localization.translations?.[lang] || {}) })
  return {
    language: selected,
    fallbackLanguage: fallback,
    direction: localization.textDirectionByLanguage?.[selected] || (RTL_LANGUAGES.includes(selected) ? 'rtl' : 'ltr'),
    catalog: { ...catalogFor(fallback), ...catalogFor(selected) },
    fallbackCatalog: catalogFor(fallback),
    languages: localization.languagePackages || [],
    activeLanguages: localization.activeLanguages || [],
    interfaces: localization.interfaces || {},
    keyPolicy: localization.keyPolicy || {},
    runtime: localization.runtime || {},
    generatedAt: new Date().toISOString()
  }
}
