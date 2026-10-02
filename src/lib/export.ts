// Client-side exports (XLSX, PDF, download plumbing) and the audit beacon that records each export on the server.
import { api } from './api'
import { safeFilename } from './format'
import { textDirection } from './i18n'

export type ExportColumn = { key: string; label: string }

const xmlSafe = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    // control characters are not allowed in XML 1.0 and would corrupt the workbook
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

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

/** A minimal .xlsx. Text is written as inline strings, which spreadsheet apps never evaluate as formulas. */
export async function makeXlsx(rows: Record<string, unknown>[], columns: ExportColumn[]): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate')
  const cell = (value: unknown, col: string, row: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? `<c r="${col}${row}" t="n"><v>${value}</v></c>`
      : `<c r="${col}${row}" t="inlineStr"><is><t>${xmlSafe(value)}</t></is></c>`
  const sheetRows = [
    columns.map((c, i) => cell(c.label, columnName(i), 1)).join(''),
    ...rows.map((row, r) => columns.map((c, i) => cell(row[c.key], columnName(i), r + 2)).join(''))
  ]
    .map((row, i) => `<row r="${i + 1}">${row}</row>`)
    .join('')
  const files = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Atlas" sheetId="1" r:id="rId1"/></sheets></workbook>'
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
    )
  }
  return new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 700)
}

async function loadFont(url: string): Promise<string> {
  const buffer = await fetch(url).then(res => {
    if (!res.ok) throw new Error(`font ${url}: ${res.status}`)
    return res.arrayBuffer()
  })
  let binary = ''
  new Uint8Array(buffer).forEach(byte => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

export async function exportPdf(
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
  title: string,
  orientation: 'landscape' | 'portrait',
  settings: any = {}
) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = (autoTableModule as any).default || (autoTableModule as any).autoTable
  const dir = settings.exports?.respectDirection === false ? 'ltr' : textDirection(settings)
  const doc = new jsPDF({ orientation })
  let font = 'helvetica'
  try {
    // Both weights are registered: autoTable renders header cells bold, and a missing bold face silently falls back to
    // a font without Arabic/Hebrew glyphs.
    const [regular, bold] = await Promise.all([
      loadFont('/fonts/AtlasSans-Regular.ttf'),
      loadFont('/fonts/AtlasSans-Bold.ttf')
    ])
    doc.addFileToVFS('AtlasSans-Regular.ttf', regular)
    doc.addFont('AtlasSans-Regular.ttf', 'AtlasSans', 'normal')
    doc.addFileToVFS('AtlasSans-Bold.ttf', bold)
    doc.addFont('AtlasSans-Bold.ttf', 'AtlasSans', 'bold')
    font = 'AtlasSans'
    doc.setFont(font, 'normal')
  } catch {
    /* fall back to the built-in font; Latin text still renders */
  }
  if (dir === 'rtl' && (doc as any).setR2L) (doc as any).setR2L(true)
  const pageWidth = doc.internal.pageSize.getWidth()
  const x = dir === 'rtl' ? pageWidth - 14 : 14
  const align = dir === 'rtl' ? 'right' : 'left'
  doc.setFontSize(16)
  doc.text(title, x, 16, { align })
  doc.setFontSize(8)
  doc.text(
    `Generated ${new Date().toLocaleString(settings.localization?.defaultLanguage || settings.language || 'en')}`,
    x,
    22,
    { align }
  )
  if (settings.exports?.includeBranding !== false)
    doc.text(settings.workspace?.name || settings.workspaceName || 'Atlas Workspace', x, 26, { align })
  autoTable(doc, {
    head: [columns.map(c => c.label)],
    body: rows.map(row => columns.map(c => String(row[c.key] ?? ''))),
    startY: settings.exports?.includeBranding !== false ? 31 : 28,
    styles: { fontSize: 8, font, halign: align },
    headStyles: { font, halign: align, fontStyle: font === 'AtlasSans' ? 'bold' : undefined },
    bodyStyles: { halign: align }
  })
  doc.save(`${safeFilename(title)}.pdf`)
}

/**
 * Tell the server an export is about to happen. The server enforces the `exportData` permission and records the event
 * (who, what, how many rows). Resolves when allowed; rejects (with the server's message) when not.
 */
export function recordExport(page: string, format: string, rows: number, columns: number) {
  return api.post('/api/exports/audit', { page, format, rows, columns })
}
