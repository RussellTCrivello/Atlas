// CSV: the primary table of the document, UTF-8 with a byte-order mark (so Excel reads Arabic, Persian and Hebrew correctly),
// CRLF line ends, every cell quoted, and formula triggers neutralised.
import { type ExportDocument, type Rendered, type Row, type TableSection, tableSections } from '../model'
import { cleanText, displayCell } from '../values'

// Spreadsheet programs run any cell that begins with = + - @ (or a tab/CR) as a formula, so user-entered text such as
// `=HYPERLINK("http://evil","Click")` would execute when the export is opened ("CSV injection").
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?\d+([.,]\d+)?$/

/** Neutralise formula triggers by prefixing an apostrophe, the OWASP-recommended mitigation. Plain numbers are untouched. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value
}

export function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined ? '' : typeof value === 'string' ? neutralizeFormula(value) : String(value)
  return `"${cleanText(text).replaceAll('"', '""')}"`
}

/** The plain matrix → CSV step (kept separate so it can be tested on its own). */
export function toCsv(columns: { key: string; label: string }[], rows: Row[]): string {
  return [
    columns.map(c => csvCell(c.label)).join(','),
    ...rows.map(row => columns.map(c => csvCell(row[c.key])).join(','))
  ].join('\r\n')
}

export function primaryTable(doc: ExportDocument): TableSection | undefined {
  const tables = tableSections(doc)
  return tables.find(table => table.primary) || tables[0]
}

export function renderCsv(doc: ExportDocument): Rendered {
  const table = primaryTable(doc)
  const columns = table?.columns ?? []
  // Dates stay ISO (sortable, locale-proof); everything else is shown the way a person reads it.
  const rows = (table?.rows ?? []).map(row =>
    Object.fromEntries(
      columns.map(column => [
        column.key,
        column.type === 'date' || column.type === 'datetime'
          ? (row[column.key] ?? '')
          : displayCell(row[column.key] ?? null, column, doc.language, doc.words)
      ])
    )
  )
  return { body: `\ufeff${toCsv(columns, rows)}`, mime: 'text/csv; charset=utf-8', extension: 'csv' }
}
