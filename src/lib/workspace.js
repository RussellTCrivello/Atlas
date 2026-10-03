import { defaultSettings, ROLE_DEFINITIONS } from '../config/workspace-defaults.js'
import { translateUiText } from '../i18n/catalog.js'

export function hasPermission(user, permission) { return Boolean(user?.permissions?.includes(permission) || user?.role === 'Administrator') }
export function mergeDeep(target, source) { const out = { ...(target || {}) }; Object.entries(source || {}).forEach(([key, value]) => { out[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergeDeep(out[key], value) : value }); return out }
export function roleDefinitions(settings) { return { ...ROLE_DEFINITIONS, ...(settings?.permissions?.roles || {}) } }
export function t(settings, key, fallback) { const lang = settings?.localization?.defaultLanguage || settings?.language || 'en'; const catalog = settings?.localization?.translations || {}; return catalog?.[lang]?.[key] || catalog?.[settings?.localization?.fallbackLanguage || 'en']?.[key] || (fallback ? translateUiText(settings, fallback) : key) }
export function enabledPages(settings) { const order = Array.isArray(settings?.interface?.navigationOrder) && settings.interface.navigationOrder.length ? settings.interface.navigationOrder : (settings?.enabledPages || defaultSettings.enabledPages); const visibility = settings?.interface?.navigationVisibility || {}; return order.filter(page => defaultSettings.enabledPages.includes(page) && visibility[page] !== false && settings?.modules?.[page]?.enabled !== false) }
export function customFieldDefinitions(settings, type) { const map = { project: 'projects', task: 'tasks', person: 'people', team: 'teams', milestone: 'milestones', activity: 'activities', alert: 'alerts', report: 'reports' }; const fields = settings?.customFields?.[map[type] || type]; return Array.isArray(fields) ? fields.filter(field => field && typeof field === 'object' && !Array.isArray(field)) : [] }
export function languageOptions(settings) { return settings?.localization?.languagePackages || defaultSettings.localization.languagePackages }
export function userLanguageOptions(settings) {
  const packages = languageOptions(settings)
  const active = new Set(Array.isArray(settings?.localization?.activeLanguages)
    ? settings.localization.activeLanguages.map(String)
    : packages.filter(item => item?.enabled !== false).map(item => String(item?.code || '')))
  active.add(String(settings?.localization?.defaultLanguage || settings?.language || 'en'))
  return packages.filter(item => item && typeof item.code === 'string' && item.enabled !== false && active.has(item.code))
}
export function updateByPath(object, path, value) { const parts = path.split('.'); const copy = structuredClone(object || {}); let ref = copy; parts.slice(0, -1).forEach(part => { ref[part] = Array.isArray(ref[part]) ? [...ref[part]] : { ...(ref[part] || {}) }; ref = ref[part] }); ref[parts.at(-1)] = value; return copy }
