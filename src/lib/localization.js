import { RTL_LANGUAGES } from './constants.js'

export function textDirection(settings) {
  const language = settings?.localization?.defaultLanguage || settings?.language || 'en'
  return settings?.localization?.textDirectionByLanguage?.[language] || (RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr')
}

export function formatLocalizedDate(value, settings, options = {}) {
  if (value === null || value === undefined || value === '') return ''
  const raw = value instanceof Date ? value : String(value)
  const dateOnly = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const date = value instanceof Date ? value : dateOnly ? new Date(`${raw}T12:00:00Z`) : new Date(raw)
  if (!Number.isFinite(date.getTime())) return String(value)
  const locale = settings?.localization?.defaultLanguage || settings?.language || 'en'
  const timeZone = dateOnly ? 'UTC' : settings?.workspace?.defaultTimezone || 'UTC'
  try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone, ...options }).format(date) }
  catch { return String(value) }
}
