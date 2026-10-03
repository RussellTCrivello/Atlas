// A real .xlsx workbook, written without a spreadsheet library: one sheet per table (plus a summary sheet), a styled header,
// real dates and numbers (so sorting and filtering work), tone colouring, column widths from the content, a frozen header
// row, an auto-filter, print titles, landscape/portrait set up to fit the page width, and a footer with page numbers.
// Text is written as inline strings, which spreadsheet programs never evaluate as formulas.
import { strToU8, zipSync } from 'fflate'
import type {
  BarsSection,
  Cell,
  Column,
  ExportDocument,
  RenderOptions,
  Rendered,
  SummarySection,
  TableSection
} from '../model'
import { cleanText, displayCell, excelDate } from '../values'
import { StyleBook, TONES, type Spec } from './xlsx-styles'

const xml = (value: unknown) =>
  cleanText(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const ACCENT = 'FF6D5DFC'
const HEADER_FILL = 'FF1F2937'
const MAX_TEXT = 32_000

function columnName(index: number): string {
  let out = ''
  let n = index + 1
  while (n) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function sheetName(wanted: string, taken: Set<string>): string {
  const base =
    cleanText(wanted)
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 28) || 'Sheet'
  let name = base
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 28 - String(n).length - 1)} ${n}`
  taken.add(name.toLowerCase())
  return name
}

interface Built {
  name: string
  xml: string
  filter?: { ref: string; titleRow: number }
}

class Sheet {
  private rows: string[] = []
  private merges: string[] = []
  private widths: number[] = []
  private row = 0
  maxCols = 1
  constructor(
    private styles: StyleBook,
    private rtl: boolean
  ) {}

  get nextRow() {
    return this.row + 1
  }
  width(col: number, chars: number) {
    this.widths[col] = Math.max(this.widths[col] ?? 8, Math.min(60, Math.ceil(chars)))
  }
  merge(range: string) {
    this.merges.push(range)
  }
  private cell(
    col: number,
    row: number,
    value: Cell | undefined,
    style: number,
    kind: 'text' | 'number' | 'date'
  ): string {
    const ref = `${columnName(col)}${row}`
    if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${style}"/>`
    if (kind === 'number' && Number.isFinite(Number(value)))
      return `<c r="${ref}" s="${style}"><v>${Number(value)}</v></c>`
    if (kind === 'date') {
      const serial = excelDate(value)
      if (serial !== null) return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`
    }
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(String(value).slice(0, MAX_TEXT))}</t></is></c>`
  }
  /** Append one row of cells. Each entry is [value, spec, kind]. Returns the row number. */
  add(cells: [Cell | undefined, Spec, ('text' | 'number' | 'date')?][], height?: number): number {
    const number = ++this.row
    const out = cells
      .map(([value, spec, kind], col) => this.cell(col, number, value, this.styles.xf(spec), kind ?? 'text'))
      .join('')
    this.maxCols = Math.max(this.maxCols, cells.length)
    this.rows.push(`<row r="${number}"${height ? ` ht="${height}" customHeight="1"` : ''}>${out}</row>`)
    return number
  }
  blank() {
    this.row++
  }
  finish(options: {
    orientation: RenderOptions['orientation']
    margin: number
    freezeRow?: number
    filter?: string
    selected: boolean
    footer: string
    extra?: string
  }): string {
    const cols = this.widths
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w || 10}" customWidth="1"/>`)
      .join('')
    const pane = options.freezeRow
      ? `<pane ySplit="${options.freezeRow}" topLeftCell="A${options.freezeRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>`
      : ''
    const inches = (options.margin / 25.4).toFixed(2)
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet ${NS}>` +
      `<sheetPr><tabColor rgb="${ACCENT}"/><pageSetUpPr fitToPage="1"/></sheetPr>` +
      `<dimension ref="A1:${columnName(Math.max(0, this.maxCols - 1))}${Math.max(1, this.row)}"/>` +
      `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${this.rtl ? ' rightToLeft="1"' : ''}${options.selected ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (cols ? `<cols>${cols}</cols>` : '') +
      `<sheetData>${this.rows.join('')}</sheetData>` +
      (options.filter ? `<autoFilter ref="${options.filter}"/>` : '') +
      (this.merges.length
        ? `<mergeCells count="${this.merges.length}">${this.merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
        : '') +
      (options.extra || '') +
      `<printOptions horizontalCentered="1"/><pageMargins left="${inches}" right="${inches}" top="${inches}" bottom="${inches}" header="0.3" footer="0.3"/>` +
      `<pageSetup paperSize="9" orientation="${options.orientation}" fitToWidth="1" fitToHeight="0"/>` +
      `<headerFooter><oddFooter>${xml(options.footer)}</oddFooter></headerFooter></worksheet>`
    )
  }
}

const footer = (doc: ExportDocument) =>
  `&L${doc.footerText || doc.workspace}&C${doc.title}&R${doc.words.page} &P ${doc.words.of} &N`

const titleBlock = (sheet: Sheet, doc: ExportDocument, span: number, align: 'left' | 'right') => {
  const left = (spec: Spec): Spec => ({ ...spec, align: { h: align } })
  const fill = (n: number): [Cell, Spec][] => Array.from({ length: n - 1 }, () => [null, {}] as [Cell, Spec])
  const row = (text: string, spec: Spec, height?: number) => {
    const number = sheet.add([[text, left(spec)], ...fill(span)], height)
    if (span > 1) sheet.merge(`A${number}:${columnName(span - 1)}${number}`)
  }
  row(doc.title, { font: { bold: true, size: 16, color: 'FF1F2937' } }, 24)
  if (doc.subtitle) row(doc.subtitle, { font: { italic: true, color: 'FF64748B' } })
  row(
    `${doc.workspace} · ${doc.words.generated} ${doc.generatedAt.slice(0, 16).replace('T', ' ')} UTC · ${doc.words.by} ${doc.generatedBy}`,
    { font: { size: 9, color: 'FF64748B' } }
  )
  if (doc.filters.length)
    row(`${doc.words.filters}: ${doc.filters.join(' · ')}`, { font: { size: 9, color: 'FF64748B' } })
  sheet.blank()
}

function tableSheet(
  book: StyleBook,
  doc: ExportDocument,
  table: TableSection,
  options: RenderOptions,
  name: string,
  first: boolean
): Built {
  const rtl = doc.direction === 'rtl'
  const sheet = new Sheet(book, rtl)
  const start: 'left' | 'right' = rtl ? 'right' : 'left'
  titleBlock(sheet, doc, Math.max(1, table.columns.length), start)
  if (table.title) {
    const n = sheet.add([[table.title, { font: { bold: true, size: 12, color: 'FF1F2937' }, align: { h: start } }]])
    void n
  }
  const header: Spec = {
    font: { bold: true, color: 'FFFFFFFF' },
    fill: HEADER_FILL,
    border: 'thin',
    align: { h: 'center', v: 'center', wrap: true }
  }
  const headerRow = sheet.add(
    table.columns.map(column => [column.label, header] as [Cell, Spec]),
    22
  )
  table.columns.forEach((column, i) => sheet.width(i, Math.max(column.label.length + 3, column.width ?? 0)))

  const body = (row: Record<string, Cell>, rowIndex: number) => {
    const cells = table.columns.map((column, col): [Cell | undefined, Spec, ('text' | 'number' | 'date')?] => {
      const value = row[column.key]
      const tone = table.tones?.[String(rowIndex)]?.[column.key]
      const paint: Spec = tone
        ? { fill: TONES[tone].bg, font: { color: TONES[tone].fg, bold: column.type === 'status' } }
        : {}
      const base: Spec = { border: 'thin', align: { v: 'top' }, ...paint }
      const shown = displayCell(value ?? null, column, doc.language, doc.words)
      sheet.width(col, Math.min(column.type === 'longtext' ? 50 : 40, shown.length + 2))
      switch (column.type) {
        case 'date':
        case 'datetime':
          return [
            value,
            {
              ...base,
              numFmt: column.type === 'date' ? 'yyyy-mm-dd' : 'yyyy-mm-dd hh:mm',
              align: { v: 'top', h: 'center' }
            },
            'date'
          ]
        case 'integer':
          return [value, { ...base, numFmt: '0', align: { v: 'top', h: 'right' } }, 'number']
        case 'number':
          return [value, { ...base, numFmt: '#,##0.00', align: { v: 'top', h: 'right' } }, 'number']
        case 'percent':
          return [
            value === null || value === undefined || value === '' ? null : Number(value) / 100,
            { ...base, numFmt: '0%', align: { v: 'top', h: 'right' } },
            'number'
          ]
        case 'boolean':
          return [shown, { ...base, align: { v: 'top', h: 'center' } }]
        case 'longtext':
          return [shown, { ...base, align: { v: 'top', wrap: true } }]
        default:
          return [
            shown,
            {
              ...base,
              align: {
                v: 'top',
                h: column.align === 'center' ? 'center' : column.align === 'end' ? 'right' : undefined,
                wrap: column.type !== 'status'
              }
            }
          ]
      }
    })
    sheet.add(cells)
  }

  let lastRow = headerRow
  let current: string | null = null
  table.rows.forEach((row, index) => {
    if (table.groupBy) {
      const group = displayCell(
        row[table.groupBy] ?? null,
        table.columns.find(c => c.key === table.groupBy) ?? ({ key: '', label: '', type: 'text' } as Column),
        doc.language,
        doc.words
      )
      if (group !== current) {
        current = group
        const n = sheet.add([
          [group, { font: { bold: true }, fill: 'FFF1F5F9', border: 'thin' }],
          ...Array.from(
            { length: table.columns.length - 1 },
            () => [null, { fill: 'FFF1F5F9', border: 'thin' }] as [Cell, Spec]
          )
        ])
        if (table.columns.length > 1) sheet.merge(`A${n}:${columnName(table.columns.length - 1)}${n}`)
      }
    }
    body(row, index)
    lastRow = sheet.nextRow - 1
  })
  if (table.totals) {
    const totals = table.columns.map((column, col): [Cell | undefined, Spec, ('text' | 'number' | 'date')?] => {
      const value =
        col === 0 && table.totals![column.key] === undefined ? doc.words.total : (table.totals![column.key] ?? null)
      const numeric = ['integer', 'number', 'percent'].includes(column.type) && typeof value === 'number'
      return [
        numeric && column.type === 'percent' ? Number(value) / 100 : value,
        {
          font: { bold: true },
          border: 'top',
          numFmt: numeric ? (column.type === 'percent' ? '0%' : '#,##0') : undefined,
          align: { h: numeric ? 'right' : undefined }
        },
        numeric ? 'number' : 'text'
      ]
    })
    sheet.add(totals)
  }
  if (!table.rows.length) sheet.add([[doc.words.empty, { font: { italic: true, color: 'FF64748B' } }]])

  const ref = `A${headerRow}:${columnName(table.columns.length - 1)}${Math.max(lastRow, headerRow)}`
  return {
    name,
    filter: { ref, titleRow: headerRow },
    xml: sheet.finish({
      orientation: options.orientation,
      margin: options.margin,
      freezeRow: headerRow,
      filter: table.rows.length ? ref : undefined,
      selected: first,
      footer: footer(doc)
    })
  }
}

function summarySheet(
  book: StyleBook,
  doc: ExportDocument,
  sections: (SummarySection | BarsSection)[],
  options: RenderOptions,
  name: string,
  first: boolean
): Built {
  const rtl = doc.direction === 'rtl'
  const sheet = new Sheet(book, rtl)
  const start: 'left' | 'right' = rtl ? 'right' : 'left'
  titleBlock(sheet, doc, 3, start)
  sheet.width(0, 34)
  sheet.width(1, 16)
  sheet.width(2, 40)
  const bars: string[] = []
  for (const section of sections) {
    if (section.title) sheet.add([[section.title, { font: { bold: true, size: 12 }, align: { h: start } }]], 20)
    if (section.kind === 'summary') {
      for (const item of section.items) {
        const tone = item.tone ? TONES[item.tone] : null
        sheet.add([
          [item.label, { font: { bold: true }, border: 'thin', align: { h: start } }],
          [
            typeof item.value === 'number' ? item.value : String(item.value),
            { font: { bold: true, size: 12, color: tone?.fg }, fill: tone?.bg, border: 'thin', align: { h: 'right' } },
            typeof item.value === 'number' ? 'number' : 'text'
          ],
          [item.hint ?? '', { font: { size: 9, color: 'FF64748B' }, align: { h: start, wrap: true } }]
        ])
      }
    } else {
      const first = sheet.nextRow
      for (const item of section.items)
        sheet.add([
          [item.label, { border: 'thin', align: { h: start } }],
          [item.value, { border: 'thin', align: { h: 'right' } }, 'number']
        ])
      if (section.items.length)
        bars.push(
          `<conditionalFormatting sqref="B${first}:B${sheet.nextRow - 1}"><cfRule type="dataBar" priority="${bars.length + 1}"><dataBar><cfvo type="num" val="0"/><cfvo type="max"/><color rgb="${ACCENT}"/></dataBar></cfRule></conditionalFormatting>`
        )
    }
    sheet.blank()
  }
  return {
    name,
    xml: sheet.finish({
      orientation: 'portrait',
      margin: options.margin,
      selected: first,
      footer: footer(doc),
      extra: bars.join('')
    })
  }
}

export function renderXlsx(doc: ExportDocument, options: RenderOptions): Rendered {
  const book = new StyleBook()
  const taken = new Set<string>()
  const sheets: Built[] = []
  const glance = doc.sections.filter((s): s is SummarySection | BarsSection => s.kind !== 'table')
  if (glance.length) sheets.push(summarySheet(book, doc, glance, options, sheetName(doc.words.summary, taken), true))
  doc.sections
    .filter((s): s is TableSection => s.kind === 'table')
    .forEach((table, i) =>
      sheets.push(
        tableSheet(
          book,
          doc,
          table,
          options,
          sheetName(table.title || (table.primary ? doc.title : table.id), taken),
          !sheets.length && i === 0
        )
      )
    )
  if (!sheets.length) sheets.push(summarySheet(book, doc, [], options, sheetName(doc.words.summary, taken), true))

  const quoted = (sheet: Built) => `'${sheet.name.replaceAll("'", "''")}'`
  const absolute = (ref: string) => ref.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')
  const names = sheets
    .map((sheet, i) =>
      sheet.filter
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${quoted(sheet)}!${absolute(sheet.filter.ref)}</definedName>` +
          `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${quoted(sheet)}!$${sheet.filter.titleRow}:$${sheet.filter.titleRow}</definedName>`
        : ''
    )
    .join('')
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join('') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
    ),
    'docProps/core.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(doc.title)}</dc:title><dc:creator>${xml(doc.generatedBy)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xml(doc.generatedAt)}</dcterms:created></cp:coreProperties>`
    ),
    'docProps/app.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Atlas Workspace</Application><Company>${xml(doc.workspace)}</Company></Properties>`
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${NS}><bookViews><workbookView/></bookViews><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}</workbook>`
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ),
    'xl/styles.xml': strToU8(book.toXml())
  }
  sheets.forEach((sheet, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheet.xml)))
  return {
    body: zipSync(files, { level: 6 }),
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx'
  }
}
