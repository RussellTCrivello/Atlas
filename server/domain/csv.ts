// A small, strict CSV reader (RFC 4180): quoted fields, doubled quotes, line breaks inside quotes, a byte-order mark, and the
// delimiter a spreadsheet program wrote (comma, semicolon or tab). Pure: no I/O.
export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  delimiter: string
}

export class CsvError extends Error {}

const DELIMITERS = [',', ';', '\t']

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  let best = ','
  let bestCount = -1
  for (const delimiter of DELIMITERS) {
    let count = 0
    let quoted = false
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted
      else if (!quoted && char === delimiter) count++
    }
    if (count > bestCount) {
      best = delimiter
      bestCount = count
    }
  }
  return best
}

export function parseCsv(input: string, maxRows = 20_000): ParsedCsv {
  const text = input.replace(/^\ufeff/, '')
  const delimiter = detectDelimiter(text)
  const records: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  let touched = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += char
    } else if (char === '"' && field === '') {
      quoted = true
      touched = true
    } else if (char === delimiter) {
      row.push(field)
      field = ''
      touched = true
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      if (touched || field !== '' || row.length) {
        row.push(field)
        records.push(row)
        if (records.length > maxRows + 1)
          throw new CsvError(`The file has more than ${maxRows.toLocaleString('en')} rows`)
      }
      field = ''
      row = []
      touched = false
    } else {
      field += char
      touched = true
    }
  }
  if (quoted) throw new CsvError('A quoted value is never closed (a " is missing)')
  if (touched || field !== '' || row.length) {
    row.push(field)
    records.push(row)
  }
  if (!records.length) throw new CsvError('The file is empty')
  const [headers, ...rows] = records
  return {
    headers: headers.map(header => header.trim()),
    rows: rows.filter(values => values.some(value => value.trim() !== '')),
    delimiter
  }
}
