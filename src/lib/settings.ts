// Client-side view of workspace settings and the signed-in user's permissions.
import {
  DEFAULT_WORKFLOW_STATES,
  defaultSettings as buildDefaults,
  diffPatch,
  mergeDeep,
  normalizeSettings
} from '../../shared/settings'

/** Defaults including the built-in translation catalog (the server stores only administrator overrides). */
export const defaultSettings: any = buildDefaults({ builtinTranslations: true })

/** Fill gaps in whatever the server sent (non-administrators receive a subset) with defaults. */
export function clientSettings(raw: any): any {
  return normalizeSettings(raw || {}, { builtinTranslations: true })
}

export { diffPatch, mergeDeep }

/**
 * Permissions come from the server per user. There is deliberately no "Administrator can do everything" shortcut here:
 * the server is the authority, and a role named Administrator whose registry entry was edited must not look more
 * capable in the UI than it is.
 */
export function hasPermission(user: any, permission: string): boolean {
  return Boolean(user?.permissions?.includes(permission))
}

export function workflowStateLabels(settings: any): string[] {
  const states = settings?.workflows?.task?.states
  const labels =
    Array.isArray(states) && states.length
      ? states.map((state: any) => (typeof state === 'string' ? state : state.label || state.name)).filter(Boolean)
      : DEFAULT_WORKFLOW_STATES.map(state => state.label)
  return labels
}

export function enabledPages(settings: any): string[] {
  const order =
    Array.isArray(settings?.interface?.navigationOrder) && settings.interface.navigationOrder.length
      ? settings.interface.navigationOrder
      : settings?.enabledPages || defaultSettings.enabledPages
  const visibility = settings?.interface?.navigationVisibility || {}
  return order.filter(
    (page: string) =>
      defaultSettings.enabledPages.includes(page) &&
      visibility[page] !== false &&
      settings?.modules?.[page]?.enabled !== false
  )
}

const FIELD_MAP: Record<string, string> = {
  project: 'projects',
  task: 'tasks',
  person: 'people',
  team: 'teams',
  activity: 'activities',
  alert: 'alerts',
  report: 'reports'
}
export function customFieldDefinitions(settings: any, type: string): any[] {
  return settings?.customFields?.[FIELD_MAP[type] || type] || []
}

export function languageOptions(settings: any): any[] {
  return settings?.localization?.languagePackages || defaultSettings.localization.languagePackages
}

export function updateByPath(object: any, path: string, value: unknown) {
  const parts = path.split('.')
  const copy = structuredClone(object || {})
  let ref = copy
  parts.slice(0, -1).forEach(part => {
    ref[part] = Array.isArray(ref[part]) ? [...ref[part]] : { ...(ref[part] || {}) }
    ref = ref[part]
  })
  ref[parts.at(-1)!] = value
  return copy
}

// ---- per-person preferences ----------------------------------------------------------------------------------------
// Theme, density and (when the workspace allows it) language are personal. They are kept per browser profile and per
// account, and layered over the workspace defaults; changing them never changes anything for anyone else.
export interface Preferences {
  theme?: 'light' | 'dark' | 'system'
  density?: 'comfortable' | 'compact'
  language?: string
}
const prefKey = (userId: string) => `atlas-prefs:${userId}`

export function loadPreferences(userId: string | undefined): Preferences {
  if (!userId) return {}
  try {
    return JSON.parse(localStorage.getItem(prefKey(userId)) || '{}')
  } catch {
    return {}
  }
}
export function savePreferences(userId: string, prefs: Preferences) {
  try {
    localStorage.setItem(prefKey(userId), JSON.stringify(prefs))
  } catch {
    /* storage full or blocked: preferences simply do not persist */
  }
}

/** Workspace settings with the user's preferences applied on top. */
export function withPreferences(settings: any, prefs: Preferences): any {
  const next = structuredClone(settings)
  if (prefs.theme) {
    next.theme = prefs.theme
    next.interface = { ...(next.interface || {}), theme: prefs.theme }
  }
  if (prefs.density) {
    next.density = prefs.density
    next.interface = { ...(next.interface || {}), density: prefs.density }
  }
  const allowed = next.localization?.userLanguagePreference !== false
  if (allowed && prefs.language && (next.localization?.activeLanguages || []).includes(prefs.language)) {
    next.language = prefs.language
    next.localization = { ...(next.localization || {}), defaultLanguage: prefs.language }
    next.workspace = { ...(next.workspace || {}), defaultLanguage: prefs.language }
  }
  return next
}

/** Remove everything one person's browser remembers (saved filters, preferences stay for next sign-in). */
export function clearSessionStorage() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('atlas-filter')) localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
