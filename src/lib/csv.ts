// CSV export. Spreadsheet programs run any cell that begins with = + - @ (or a tab/CR) as a formula, so user-entered text
// such as `=HYPERLINK("http://evil","Click")` would execute when the export is opened ("CSV injection").
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?\d+([.,]\d+)?$/

/** Neutralise formula triggers by prefixing an apostrophe, the OWASP-recommended mitigation. Plain numbers are untouched. */
export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value
}

export function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined ? '' : typeof value === 'string' ? neutralizeFormula(value) : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  return [
    columns.map(c => csvCell(c.label)).join(','),
    ...rows.map(row => columns.map(c => csvCell(row[c.key])).join(','))
  ].join('\r\n')
}
