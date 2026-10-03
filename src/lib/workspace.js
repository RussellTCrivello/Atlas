import { defaultSettings, ROLE_DEFINITIONS } from '../config/workspace-defaults.js'
import { translateUiText } from '../i18n/catalog.js'

export function hasPermission(user, permission) { return Boolean(user?.permissions?.includes(permission) || user?.role === 'Administrator') }
export function mergeDeep(target, source) { const out = { ...(target || {}) }; Object.entries(source || {}).forEach(([key, value]) => { out[key] = value && typeof value === 'object' && !Array.isArray(value) ? mergeDeep(out[key], value) : value }); return out }
const SETTINGS_MAP_PATHS = [
  ['interface', 'colors'], ['interface', 'navigationVisibility'], ['interface', 'actionVisibility'], ['interface', 'tableColumns'], ['interface', 'formLayouts'],
  ['interface', 'cardLayouts'], ['interface', 'dashboardLayouts'], ['modules'], ['customFields'],
  ['localization', 'translations'], ['localization', 'interfaces'], ['localization', 'textDirectionByLanguage'],
  ['localization', 'dateFormats'], ['localization', 'numberFormats'], ['localization', 'currencyFormats'], ['localization', 'timezoneFormats'],
  ['localization', 'approvalWorkflow', 'statusByKey'],
  ['permissions', 'roles'], ['permissions', 'moduleAccess'], ['permissions', 'fieldAccess'], ['permissions', 'actionAccess'],
  ['permissions', 'exportPermissions'], ['permissions', 'reportingPermissions'],
  ['notifications', 'channels'], ['notifications', 'events'],
  ['reports', 'customColumns'], ['reports', 'customFilters'], ['reports', 'customCalculations']
]
export function mergeSettingsWithDefaults(defaults, source = {}) {
  const result = mergeDeep(defaults || {}, source || {})
  for (const path of SETTINGS_MAP_PATHS) {
    let value = source
    for (const segment of path) value = value && typeof value === 'object' ? value[segment] : undefined
    if (value === undefined) continue
    let target = result
    for (const segment of path.slice(0, -1)) target = target?.[segment]
    if (!target || typeof target !== 'object' || ['__proto__', 'prototype', 'constructor'].includes(path.at(-1))) continue
    Object.defineProperty(target, path.at(-1), { value: structuredClone(value), enumerable: true, configurable: true, writable: true })
  }
  return result
}
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
export function updateByPath(object, path, value) {
  const parts = (Array.isArray(path) ? path : String(path).split('.')).map(String)
  if (!parts.length || parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) return structuredClone(object || {})
  const copy = structuredClone(object || {})
  let ref = copy
  parts.slice(0, -1).forEach(part => {
    const child = Object.hasOwn(ref, part) ? ref[part] : undefined
    ref[part] = Array.isArray(child) ? [...child] : child && typeof child === 'object' && !Array.isArray(child) ? { ...child } : {}
    ref = ref[part]
  })
  ref[parts.at(-1)] = value
  return copy
}
