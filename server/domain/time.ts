// Workspace calendar helpers: which day is "today" in the workspace's time zone, and how dates read in its language.
import { isValidTimeZone } from '../../shared/settings'
import { dateInZone, timeInZone } from '../util'

export function workspaceTimezone(settings: any): string {
  const tz = settings?.workspace?.defaultTimezone
  return isValidTimeZone(tz) ? tz : 'UTC'
}
export const todayIn = (settings: any, date = new Date()) => dateInZone(date, workspaceTimezone(settings))
export const timeIn = (settings: any, date = new Date()) => timeInZone(date, workspaceTimezone(settings))

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
