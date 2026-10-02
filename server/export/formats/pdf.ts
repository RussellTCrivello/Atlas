// PDF drawn on the server with jsPDF and jspdf-autotable: a title block, KPI tiles, bar charts and tables with a repeating
// header, zebra rows, tone colours, grouped rows, totals, running footer with "Page X of Y". The Unicode font (Latin, Arabic,
// Persian, Hebrew) is embedded in both weights; without it the document is still produced and the caller is told.
import { jsPDF } from 'jspdf'
import autoTable, { type CellHookData, type RowInput } from 'jspdf-autotable'
import type {
  BarsSection,
  Column,
  ExportDocument,
  RenderOptions,
  Rendered,
  SummarySection,
  TableSection,
  Tone
} from '../model'
import { cleanText, displayCell } from '../values'

const TONE: Record<Tone, { bg: [number, number, number]; fg: [number, number, number] }> = {
  good: { bg: [220, 252, 231], fg: [22, 101, 52] },
  warn: { bg: [254, 243, 199], fg: [146, 64, 14] },
  bad: { bg: [254, 226, 226], fg: [153, 27, 27] },
  info: { bg: [219, 234, 254], fg: [30, 64, 175] },
  muted: { bg: [241, 245, 249], fg: [71, 85, 105] }
}
const INK: [number, number, number] = [31, 41, 55]
const GREY: [number, number, number] = [100, 116, 139]
const ACCENT: [number, number, number] = [109, 93, 252]
const SCALE = {
  executive: { body: 9, head: 9, pad: 2.4, title: 20 },
  standard: { body: 8, head: 8.5, pad: 1.8, title: 18 },
  compact: { body: 7, head: 7.5, pad: 1.2, title: 15 }
}

export function renderPdf(doc: ExportDocument, options: RenderOptions): Rendered {
  const pdf = new jsPDF({ orientation: options.orientation, unit: 'mm', format: 'a4', compress: true })
  const rtl = doc.direction === 'rtl'
  const scale = SCALE[options.template]
  const margin = options.margin
  let font = 'helvetica'
  let basicFont = false
  if (options.fonts) {
    try {
      // Both weights are registered: table headers are bold, and a missing bold face silently falls back to a font without
      // Arabic/Hebrew glyphs.
      pdf.addFileToVFS('AtlasSans-Regular.ttf', Buffer.from(options.fonts.regular).toString('base64'))
      pdf.addFont('AtlasSans-Regular.ttf', 'AtlasSans', 'normal')
      pdf.addFileToVFS('AtlasSans-Bold.ttf', Buffer.from(options.fonts.bold).toString('base64'))
      pdf.addFont('AtlasSans-Bold.ttf', 'AtlasSans', 'bold')
      font = 'AtlasSans'
    } catch {
      basicFont = true
    }
  } else basicFont = true
  pdf.setFont(font, 'normal')
  const width = pdf.internal.pageSize.getWidth()
  const height = pdf.internal.pageSize.getHeight()
  const usable = width - margin * 2
  const edge = (offset = 0) => (rtl ? width - margin - offset : margin + offset)
  const align: 'left' | 'right' = rtl ? 'right' : 'left'

  // Arabic letters take different shapes depending on their neighbours; jsPDF's plugin applies them when it is available.
  const processArabic = (pdf as unknown as { processArabic?: (text: string) => string }).processArabic?.bind(pdf)
  const shape = (text: string) => {
    const clean = cleanText(text)
    return processArabic && /[\u0600-\u06ff]/.test(clean) ? processArabic(clean) : clean
  }
  const text = (
    value: string,
    x: number,
    y: number,
    opts: { size?: number; bold?: boolean; color?: [number, number, number]; maxWidth?: number } = {}
  ) => {
    pdf.setFont(font, opts.bold ? 'bold' : 'normal')
    pdf.setFontSize(opts.size ?? 9)
    pdf.setTextColor(...(opts.color ?? INK))
    pdf.text(shape(value), x, y, { align, maxWidth: opts.maxWidth })
  }

  // ---- title block ---------------------------------------------------------------------------------------------------
  let y = margin
  if (options.branding) {
    pdf.setFillColor(...ACCENT)
    pdf.rect(margin, y - 2, usable, 1.2, 'F')
    text(doc.workspace, edge(), y + 4, { size: 8, bold: true, color: ACCENT })
    y += 9
  }
  text(doc.title, edge(), y + 4, { size: scale.title, bold: true, maxWidth: usable })
  y += scale.title / 2 + 3
  if (doc.subtitle) {
    text(doc.subtitle, edge(), y + 1, { size: 10, color: GREY, maxWidth: usable })
    y += 6
  }
  text(
    `${doc.words.generated} ${doc.generatedAt.slice(0, 16).replace('T', ' ')} UTC · ${doc.words.by} ${doc.generatedBy}`,
    edge(),
    y + 1,
    { size: 8, color: GREY, maxWidth: usable }
  )
  y += 5
  if (doc.filters.length) {
    text(`${doc.words.filters}: ${doc.filters.join(' · ')}`, edge(), y + 1, { size: 8, color: GREY, maxWidth: usable })
    y += 4 + Math.floor((doc.filters.join(' · ').length * 1.6) / usable) * 3
  }
  y += 3

  const ensure = (needed: number) => {
    if (y + needed > height - margin - 8) {
      pdf.addPage()
      y = margin
    }
  }
  const heading = (title?: string) => {
    if (!title) return
    ensure(14)
    text(title, edge(), y + 4, { size: 12, bold: true })
    y += 8
  }

  const summary = (section: SummarySection) => {
    ensure(section.title ? 32 : 22)
    heading(section.title)
    const perRow = Math.min(4, Math.max(1, section.items.length))
    const tile = (usable - (perRow - 1) * 3) / perRow
    section.items.forEach((item, index) => {
      const col = index % perRow
      if (col === 0) ensure(20)
      const x = rtl ? width - margin - tile - col * (tile + 3) : margin + col * (tile + 3)
      const tone = item.tone ? TONE[item.tone] : { bg: [248, 250, 252] as [number, number, number], fg: INK }
      pdf.setFillColor(...tone.bg)
      pdf.roundedRect(x, y, tile, 17, 1.5, 1.5, 'F')
      pdf.setFont(font, 'normal')
      pdf.setFontSize(7.5)
      pdf.setTextColor(...GREY)
      pdf.text(shape(item.label), rtl ? x + tile - 3 : x + 3, y + 5.5, { align, maxWidth: tile - 6 })
      pdf.setFont(font, 'bold')
      pdf.setFontSize(14)
      pdf.setTextColor(...tone.fg)
      pdf.text(shape(String(item.value)), rtl ? x + tile - 3 : x + 3, y + 12.5, { align, maxWidth: tile - 6 })
      if (col === perRow - 1 || index === section.items.length - 1) y += 20
    })
  }

  const bars = (section: BarsSection) => {
    ensure(section.title ? 28 : 16)
    heading(section.title)
    const max = Math.max(1, ...section.items.map(item => item.value))
    const label = Math.min(55, usable * 0.3)
    for (const item of section.items) {
      ensure(7)
      const tone = TONE[item.tone ?? 'info']
      text(item.label, edge(), y + 4, { size: 8.5, maxWidth: label - 2 })
      const full = usable - label - 18
      const x = rtl ? width - margin - label - full : margin + label
      pdf.setFillColor(241, 245, 249)
      pdf.rect(x, y + 1.2, full, 3.6, 'F')
      pdf.setFillColor(...tone.fg)
      const w = (full * item.value) / max
      pdf.rect(rtl ? x + full - w : x, y + 1.2, w, 3.6, 'F')
      text(String(item.value), rtl ? margin + 2 : margin + usable, y + 4, { size: 8.5, bold: true })
      y += 6.5
    }
    y += 3
  }

  const table = (section: TableSection) => {
    // A heading never ends a page on its own: make room for it, the table header and a couple of rows first.
    ensure(section.title ? 40 : 28)
    heading(section.title)
    // In a right-to-left document the first column is on the right, so the column order is mirrored.
    const columns: Column[] = rtl ? [...section.columns].reverse() : section.columns
    const cell = (row: Record<string, string | number | boolean | null>, column: Column) =>
      shape(displayCell(row[column.key] ?? null, column, doc.language, doc.words))
    const body: RowInput[] = []
    const tones: Record<number, Record<string, Tone | undefined>> = {}
    let current: string | null = null
    section.rows.forEach((row, index) => {
      if (section.groupBy) {
        const column = section.columns.find(c => c.key === section.groupBy)
        const group = column ? displayCell(row[section.groupBy] ?? null, column, doc.language, doc.words) : ''
        if (group !== current) {
          current = group
          body.push([
            {
              content: shape(group),
              colSpan: columns.length,
              styles: { fontStyle: 'bold', fillColor: [241, 245, 249], textColor: INK }
            }
          ])
        }
      }
      tones[body.length] = (section.tones?.[String(index)] || {}) as Record<string, Tone | undefined>
      body.push(columns.map(column => cell(row, column)))
    })
    const total = section.totals
      ? [
          columns.map((column, i) =>
            shape(
              i === (rtl ? columns.length - 1 : 0) && section.totals![column.key] === undefined
                ? doc.words.total
                : displayCell(section.totals![column.key] ?? null, column, doc.language, doc.words)
            )
          )
        ]
      : undefined
    const weights = columns.map(column =>
      Math.max(6, Math.min(40, column.width ?? Math.max(8, column.label.length + 2)))
    )
    const sum = weights.reduce((a, b) => a + b, 0)
    autoTable(pdf, {
      head: [columns.map(column => shape(column.label))],
      body: body.length
        ? body
        : [
            [
              {
                content: shape(doc.words.empty),
                colSpan: columns.length,
                styles: { fontStyle: 'italic', textColor: GREY }
              }
            ]
          ],
      foot: total,
      startY: y,
      margin: { left: margin, right: margin, top: margin, bottom: margin + 8 },
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'avoid',
      styles: {
        font,
        fontSize: scale.body,
        cellPadding: scale.pad,
        halign: rtl ? 'right' : 'left',
        valign: 'top',
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        textColor: INK,
        overflow: 'linebreak'
      },
      headStyles: {
        font,
        fontStyle: 'bold',
        fillColor: [31, 41, 55],
        textColor: 255,
        fontSize: scale.head,
        halign: rtl ? 'right' : 'left'
      },
      footStyles: { font, fontStyle: 'bold', fillColor: [248, 250, 252], textColor: INK },
      alternateRowStyles: { fillColor: [250, 251, 253] },
      columnStyles: Object.fromEntries(
        columns.map((column, i) => [
          i,
          {
            cellWidth: (usable * weights[i]) / sum,
            halign:
              column.type === 'integer' || column.type === 'number' || column.type === 'percent'
                ? rtl
                  ? 'left'
                  : 'right'
                : column.align === 'center' || column.type === 'boolean'
                  ? 'center'
                  : rtl
                    ? 'right'
                    : 'left'
          }
        ])
      ),
      didParseCell(data: CellHookData) {
        if (data.section !== 'body') return
        const tone = tones[data.row.index]?.[columns[data.column.index]?.key]
        if (tone) {
          data.cell.styles.fillColor = TONE[tone].bg
          data.cell.styles.textColor = TONE[tone].fg
          if (columns[data.column.index]?.type === 'status') data.cell.styles.fontStyle = 'bold'
        }
      }
    })
    y = ((pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 8
  }

  for (const section of doc.sections) {
    if (section.kind === 'summary') summary(section)
    else if (section.kind === 'bars') bars(section)
    else table(section)
  }

  // Running footer, drawn last so the total page count is known: workspace and title on one side, "Page X of Y" on the other.
  const pages = pdf.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    pdf.setPage(page)
    pdf.setDrawColor(226, 232, 240)
    pdf.line(margin, height - margin - 5, width - margin, height - margin - 5)
    pdf.setFont(font, 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(...GREY)
    pdf.text(shape(doc.footerText || `${doc.workspace} · ${doc.title}`), edge(), height - margin - 1.5, {
      align,
      maxWidth: usable * 0.7
    })
    pdf.text(
      shape(`${doc.words.page} ${page} ${doc.words.of} ${pages}`),
      rtl ? margin : width - margin,
      height - margin - 1.5,
      { align: rtl ? 'left' : 'right' }
    )
  }
  pdf.setProperties({ title: doc.title, author: doc.generatedBy, creator: 'Atlas Workspace', subject: doc.workspace })
  return { body: new Uint8Array(pdf.output('arraybuffer')), mime: 'application/pdf', extension: 'pdf', basicFont }
}
