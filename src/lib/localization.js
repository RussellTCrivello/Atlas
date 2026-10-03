import { RTL_LANGUAGES } from './constants.js'

const formatterCache = new Map()
const FORMAT_TOKEN = /yyyy|yy|MMMM|MMM|MM|M|dd|d/g

function getFormatter(locale, timeZone, options, numberingSystem) {
  const key = JSON.stringify([locale, timeZone, options, numberingSystem || ''])
  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone, ...(numberingSystem ? { numberingSystem } : {}) })
    if (formatterCache.size > 100) formatterCache.clear()
    formatterCache.set(key, formatter)
  }
  return formatter
}

function applyDatePattern(date, pattern, locale, timeZone, numberingSystem) {
  if (typeof pattern !== 'string' || !pattern.trim() || !/(?:yyyy|yy|MMMM|MMM|MM|M|dd|d)/.test(pattern)) return null
  const textParts = Object.fromEntries(getFormatter(locale, timeZone, { year: 'numeric', month: 'long', day: 'numeric' }, numberingSystem).formatToParts(date).map(part => [part.type, part.value]))
  const shortMonthParts = Object.fromEntries(getFormatter(locale, timeZone, { month: 'short' }, numberingSystem).formatToParts(date).map(part => [part.type, part.value]))
  const numericMonthParts = Object.fromEntries(getFormatter(locale, timeZone, { month: 'numeric' }, numberingSystem).formatToParts(date).map(part => [part.type, part.value]))
  const twoDigitMonthParts = Object.fromEntries(getFormatter(locale, timeZone, { month: '2-digit' }, numberingSystem).formatToParts(date).map(part => [part.type, part.value]))
  const numericDayParts = Object.fromEntries(getFormatter(locale, timeZone, { day: 'numeric' }, numberingSystem).formatToParts(date).map(part => [part.type, part.value]))
  const twoDigitDayParts = Object.fromEntries(getFormatter(locale, timeZone, { day: '2-digit' }, numberingSystem).formatToParts(date).map(part => [part.type, part.value]))
  const values = {
    yyyy: textParts.year || '', yy: String(textParts.year || '').slice(-2),
    MMMM: textParts.month || '', MMM: shortMonthParts.month || textParts.month || '',
    MM: twoDigitMonthParts.month || numericMonthParts.month || '', M: numericMonthParts.month || '',
    dd: twoDigitDayParts.day || numericDayParts.day || '', d: numericDayParts.day || ''
  }
  FORMAT_TOKEN.lastIndex = 0
  return pattern.replace(FORMAT_TOKEN, token => values[token] ?? token)
}

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
  const numberingSystem = settings?.localization?.numberFormats?.[locale] || settings?.workspace?.regionalFormats?.number || undefined
  const hasExplicitIntlOptions = Object.keys(options).length > 0
  if (!hasExplicitIntlOptions) {
    const pattern = settings?.localization?.dateFormats?.[locale] || settings?.workspace?.regionalFormats?.date || settings?.dateFormat
    try {
      const formatted = applyDatePattern(date, pattern, locale, timeZone, numberingSystem)
      if (formatted !== null) return formatted
    } catch {}
  }
  try {
    return getFormatter(locale, timeZone, { dateStyle: 'medium', ...options }, numberingSystem).format(date)
  } catch { return String(value) }
}
