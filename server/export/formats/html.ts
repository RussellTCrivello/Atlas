// The print document: a complete, standalone HTML page generated from the database-backed document model, never from the
// screen. It carries its own print stylesheet (page size, margins, repeating table headers, page numbers in the margin boxes,
// colours that survive printing), contains no script, and escapes every value. The browser (or the desktop app) prints this
// page, so what comes out of the printer is the report, not whatever the interface was showing.
import type {
  BarsSection,
  Column,
  ExportDocument,
  RenderOptions,
  Rendered,
  SummarySection,
  TableSection
} from '../model'
import { cleanText, displayCell } from '../values'

const esc = (value: unknown) =>
  cleanText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

/** Text safe inside a CSS string literal (and inside a <style> element). */
const cssString = (value: unknown) =>
  cleanText(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('<', '\\3c ')
    .replace(/[\r\n]+/g, ' ')

const css = (options: RenderOptions, footer: string) => `
@font-face{font-family:"Atlas Sans";src:url("/fonts/AtlasSans-Regular.ttf") format("truetype");font-weight:400}
@font-face{font-family:"Atlas Sans";src:url("/fonts/AtlasSans-Bold.ttf") format("truetype");font-weight:700}
@page{size:A4 ${options.orientation};margin:${options.margin}mm;
  @bottom-left{content:"${cssString(footer)}";font:8pt "Atlas Sans",sans-serif;color:#64748b}
  @bottom-right{content:"${'\\00a0'}" counter(page) " / " counter(pages);font:8pt "Atlas Sans",sans-serif;color:#64748b}}
:root{--ink:#1f2937;--muted:#64748b;--line:#e2e8f0;--accent:#6d5dfc;--head:#1f2937;--pad:6px 8px;--size:10pt}
[data-template=compact]{--pad:3px 6px;--size:8.5pt}
[data-template=standard]{--pad:4px 7px;--size:9pt}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:var(--size)/1.4 "Atlas Sans",system-ui,"Segoe UI",Roboto,Arial,sans-serif;color:var(--ink);background:#fff}
@media screen{body{background:#eef1f6;padding:24px}.sheet{max-width:1100px;margin:0 auto;background:#fff;padding:32px;border-radius:8px;box-shadow:0 8px 30px rgba(15,23,42,.12)}}
@media print{.sheet{padding:0}.doc-foot{display:none}}
.brand{color:var(--accent);font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:8pt;border-top:4px solid var(--accent);padding-top:6px}
h1{margin:4px 0 2px;font-size:${options.template === 'executive' ? '22pt' : '16pt'};line-height:1.15}
.sub{margin:0 0 4px;color:var(--muted);font-size:11pt}
.meta,.filters{margin:2px 0;color:var(--muted);font-size:8.5pt}
.filters{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:4px}
.filters li{background:#f1f5f9;border-radius:99px;padding:1px 8px}
h2{font-size:12pt;margin:18px 0 6px;break-after:avoid}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:12px 0 4px}
.tile{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:#f8fafc;break-inside:avoid}
.tile dt{font-size:8pt;color:var(--muted);margin:0}.tile dd{margin:2px 0 0;font-size:16pt;font-weight:700}
.tile small{display:block;color:var(--muted);font-size:7.5pt}
ul.bars{list-style:none;margin:0;padding:0}
ul.bars li{display:grid;grid-template-columns:minmax(90px,28%) 1fr 44px;gap:8px;align-items:center;margin:3px 0;break-inside:avoid}
.bar{height:9px;background:#f1f5f9;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;background:var(--accent);border-radius:99px}
.bar i.t-good{background:#16a34a}.bar i.t-warn{background:#d97706}.bar i.t-bad{background:#dc2626}.bar i.t-info{background:#3b82f6}.bar i.t-muted{background:#94a3b8}
ul.bars b{text-align:end}
table{width:100%;border-collapse:collapse;margin:6px 0 12px;table-layout:auto}
caption{text-align:start;font-weight:700;padding:4px 0}
thead{display:table-header-group}tfoot{display:table-footer-group}
th{background:var(--head);color:#fff;text-align:start;padding:var(--pad);font-weight:700;border:1px solid var(--head)}
td{padding:var(--pad);border:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}
tbody tr:nth-child(even) td{background:#fafbfd}
tr{break-inside:avoid}
.num{text-align:end;font-variant-numeric:tabular-nums}.mid{text-align:center}
tr.group th{background:#f1f5f9;color:var(--ink);border-color:var(--line)}
tfoot td{font-weight:700;background:#f8fafc}
td.tone-good,.tone-good{background:#dcfce7!important;color:#166534}td.tone-warn,.tone-warn{background:#fef3c7!important;color:#92400e}
td.tone-bad,.tone-bad{background:#fee2e2!important;color:#991b1b}td.tone-info,.tone-info{background:#dbeafe!important;color:#1e40af}
td.tone-muted,.tone-muted{background:#f1f5f9!important;color:#475569}
td.status{font-weight:700}
.empty{color:var(--muted);font-style:italic}
.doc-foot{margin-top:16px;color:var(--muted);font-size:8pt;border-top:1px solid var(--line);padding-top:6px}
`

function summary(section: SummarySection): string {
  return (
    (section.title ? `<h2>${esc(section.title)}</h2>` : '') +
    `<dl class="tiles">${section.items.map(item => `<div class="tile${item.tone ? ` tone-${item.tone}` : ''}"><dt>${esc(item.label)}</dt><dd>${esc(item.value)}</dd>${item.hint ? `<small>${esc(item.hint)}</small>` : ''}</div>`).join('')}</dl>`
  )
}

function bars(section: BarsSection): string {
  const max = Math.max(1, ...section.items.map(item => item.value))
  return (
    (section.title ? `<h2>${esc(section.title)}</h2>` : '') +
    `<ul class="bars">${section.items.map(item => `<li><span>${esc(item.label)}</span><span class="bar"><i class="t-${item.tone ?? 'info'}" style="width:${Math.round((item.value / max) * 100)}%"></i></span><b>${esc(item.value)}</b></li>`).join('')}</ul>`
  )
}

function table(doc: ExportDocument, section: TableSection): string {
  const columns = section.columns
  const align = (column: Column) =>
    ['integer', 'number', 'percent'].includes(column.type)
      ? ' class="num"'
      : column.type === 'boolean' || column.align === 'center'
        ? ' class="mid"'
        : ''
  const group = section.groupBy ? section.columns.find(column => column.key === section.groupBy) : undefined
  let current: string | null = null
  const rows = section.rows
    .map((row, index) => {
      let heading = ''
      if (group) {
        const label = displayCell(row[group.key] ?? null, group, doc.language, doc.words)
        if (label !== current) {
          current = label
          heading = `<tr class="group"><th colspan="${columns.length}" scope="colgroup">${esc(label)}</th></tr>`
        }
      }
      const cells = columns
        .map(column => {
          const tone = section.tones?.[String(index)]?.[column.key]
          const classes = [
            tone ? `tone-${tone}` : '',
            column.type === 'status' ? 'status' : '',
            ['integer', 'number', 'percent'].includes(column.type) ? 'num' : '',
            column.type === 'boolean' || column.align === 'center' ? 'mid' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return `<td${classes ? ` class="${classes}"` : ''}>${esc(displayCell(row[column.key] ?? null, column, doc.language, doc.words))}</td>`
        })
        .join('')
      return `${heading}<tr>${cells}</tr>`
    })
    .join('')
  const totals = section.totals
    ? `<tfoot><tr>${columns.map((column, i) => `<td${align(column)}>${esc(i === 0 && section.totals![column.key] === undefined ? doc.words.total : displayCell(section.totals![column.key] ?? null, column, doc.language, doc.words))}</td>`).join('')}</tr></tfoot>`
    : ''
  return (
    (section.title ? `<h2>${esc(section.title)}</h2>` : '') +
    `<table><caption class="sr">${esc(section.title || doc.title)} (${section.rows.length} ${esc(doc.words.rows)})</caption><thead><tr>${columns.map(column => `<th scope="col"${align(column)}>${esc(column.label)}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows || `<tr><td colspan="${columns.length}" class="empty">${esc(doc.words.empty)}</td></tr>`}</tbody>${totals}</table>`
  )
}

export function renderHtml(doc: ExportDocument, options: RenderOptions): Rendered {
  const body = doc.sections
    .map(section =>
      section.kind === 'summary' ? summary(section) : section.kind === 'bars' ? bars(section) : table(doc, section)
    )
    .join('\n')
  const html =
    `<!doctype html><html lang="${esc(doc.language)}" dir="${doc.direction}" data-template="${options.template}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Atlas Workspace"><title>${esc(doc.title)}</title>` +
    `<style>${css(options, doc.footerText || `${doc.workspace} · ${doc.title}`)}.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}</style></head><body><div class="sheet">` +
    `<header>${options.branding ? `<div class="brand">${esc(doc.workspace)}</div>` : ''}<h1>${esc(doc.title)}</h1>${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}` +
    `<p class="meta">${esc(doc.words.generated)} ${esc(doc.generatedAt.slice(0, 16).replace('T', ' '))} UTC · ${esc(doc.words.by)} ${esc(doc.generatedBy)}</p>` +
    `${doc.filters.length ? `<ul class="filters" aria-label="${esc(doc.words.filters)}">${doc.filters.map(filter => `<li>${esc(filter)}</li>`).join('')}</ul>` : ''}</header>` +
    `<main>${body}</main><footer class="doc-foot">${esc(doc.footerText || `${doc.workspace} · ${doc.title}`)}</footer></div></body></html>`
  return { body: html, mime: 'text/html; charset=utf-8', extension: 'html' }
}
