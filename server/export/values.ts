// Turning a typed cell into text for the formats that print text (PDF, HTML, CSV). Spreadsheets keep real numbers and dates.
import type { Cell, Column, DocumentWords } from './model'

export function localeOf(language: string): string {
  try {
    // Latin digits everywhere, so a number reads the same on screen, in a PDF and in a spreadsheet.
    return new Intl.Locale(`${language}-u-nu-latn`).toString()
  } catch {
    return 'en-u-nu-latn'
  }
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>()
function formatter(locale: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${locale}|${withTime}`
  let found = dateFormatters.get(key)
  if (!found) {
    found = new Intl.DateTimeFormat(
      locale,
      withTime
        ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }
        : { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
    )
    dateFormatters.set(key, found)
  }
  return found
}

/** A cell as the person reads it. Never throws on odd data: an unparsable date is shown as it was stored. */
export function displayCell(value: Cell, column: Column, language: string, words: DocumentWords): string {
  if (value === null || value === undefined || value === '') return ''
  switch (column.type) {
    case 'boolean':
      return value === true || value === 1 || value === '1' || value === 'true' ? words.yes : words.no
    case 'status':
    case 'priority':
      return words.translate(String(value))
    case 'percent':
      return `${Math.round(Number(value))}%`
    case 'integer':
      return Number.isFinite(Number(value)) ? String(Math.round(Number(value))) : String(value)
    case 'number':
      return Number.isFinite(Number(value))
        ? new Intl.NumberFormat(localeOf(language), { maximumFractionDigits: 2 }).format(Number(value))
        : String(value)
    case 'date':
    case 'datetime': {
      const text = String(value)
      const date = new Date(column.type === 'date' ? `${text.slice(0, 10)}T12:00:00Z` : text)
      return Number.isNaN(date.getTime())
        ? text
        : formatter(localeOf(language), column.type === 'datetime').format(date)
    }
    default:
      return String(value)
  }
}

/** Keep control characters out of anything that ends up in XML, HTML or a PDF text stream. */
export const cleanText = (value: unknown): string =>
  String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

/** Excel serial date (days since 1899-12-30) for an ISO date, or null when it is not one. */
export function excelDate(value: Cell): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
  if (!match) return null
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(ms) ? null : Math.round(ms / 86400000) + 25569
}

export const safeFilename = (title: string, fallback = 'atlas-export'): string => {
  const cleaned = String(title ?? '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return cleaned || fallback
}
