/** CSS-class-safe slug that keeps letters and digits from any script (the old ASCII-only version produced "-" for Arabic). */
export function slug(value: unknown = ''): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
}

/** A file name that is valid on every OS and keeps non-Latin letters ("تقرير المشاريع" stays readable). */
export function safeFilename(title: unknown, fallback = 'atlas-export'): string {
  const cleaned = String(title ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return cleaned || fallback
}

export function initials(name = ''): string {
  return [
    ...String(name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
  ]
    .map(part => [...part][0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function colorFor(value = ''): string {
  return ['purple', 'blue', 'orange', 'green', 'pink', 'teal'][
    [...String(value ?? '')].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 6
  ]
}

/** Whole-day distance labels rendered on the client so they follow the user's language (the server sends `dueDays`). */
export function relativeDays(days: number | null | undefined, language = 'en'): string {
  if (days === null || days === undefined) return ''
  try {
    return new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' }).format(days, 'day')
  } catch {
    return String(days)
  }
}

export function localDate(
  value: string | undefined,
  language = 'en',
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
): string {
  if (!value) return ''
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return String(value)
  try {
    return new Intl.DateTimeFormat(`${language}-u-nu-latn`, { ...options, timeZone: 'UTC' }).format(date)
  } catch {
    return String(value)
  }
}
