import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client.js'
import { Icon } from '../Icon.jsx'
import { formatLocalizedDate, textDirection } from '../../lib/localization.js'
import { slug } from '../../lib/strings.js'
import { EXPORT_DATASET_LABELS, exportText as uiText, localizeExportColumns, localizeExportValue } from '../../i18n/export-catalog.js'

const TEMPLATE_LABELS = { executive: 'Executive', ledger: 'Detailed ledger', compact: 'Compact' }
const ACCENTS = { atlas: '#6257E8', ocean: '#087E8B', graphite: '#344054', forest: '#26734D' }
const DATE_STYLES = ['short', 'medium', 'long', 'iso']
const CUSTOM_FIELD_ENTITIES = { projects: 'projects', tasks: 'tasks', people: 'people', activity: 'activities', alerts: 'alerts', milestones: 'milestones' }
function customFieldType(type) {
  if (type === 'number') return 'number'
  if (type === 'date' || type === 'datetime') return 'date'
  if (type === 'checkbox') return 'boolean'
  return 'text'
}
function outputSettings(settings) {
  if (settings?.reports?.localizedOutput !== false && settings?.exports?.respectLanguage !== false) return settings
  return { ...settings, language: 'en', localization: { ...(settings?.localization || {}), defaultLanguage: 'en', fallbackLanguage: 'en' } }
}
function exportDirection(settings) { return settings?.exports?.respectDirection === false ? 'ltr' : textDirection(settings) }
function safeLogoSource(settings) {
  const value = String(settings?.workspace?.branding?.reportLogo || settings?.workspace?.logo || '').trim()
  if (!value || value.length > 2_000_000) return ''
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\\\u0000-\u001f?#]/.test(value)) return ''
  let decodedPath
  try { decodedPath = decodeURIComponent(value) } catch { return '' }
  if (decodedPath.startsWith('//') || decodedPath.split('/').includes('..') || !/\.(?:png|jpe?g|webp|gif)$/i.test(decodedPath)) return ''
  return value
}
async function imageDataUrl(source) {
  if (!source) return ''
  if (source.startsWith('data:image/')) {
    if (!/^data:image\/(?:png|jpeg);base64,/i.test(source)) throw new Error('PDF report logos must be PNG or JPEG images')
    return source
  }
  const response = await fetch(source, { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Configured local report logo could not be loaded')
  const blob = await response.blob()
  if (!['image/png', 'image/jpeg'].includes(blob.type) || blob.size > 2_000_000) throw new Error('PDF report logos must be local PNG or JPEG files under 2 MB')
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Configured local report logo could not be read'))
    reader.readAsDataURL(blob)
  })
}

function xmlSafe(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }
function htmlSafe(value) { return xmlSafe(value).replaceAll("'", '&#39;') }
function columnName(index) { let out = '', n = index + 1; while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26) } return out }
function identifierFor(dataset, row) {
  if (dataset === 'delivery-report') return row.key
  if (dataset === 'activity-summary') return row.personId
  if (dataset === 'project-contributions') return row.projectId
  return row.numericId ?? row.id
}
function asIsoDate(value) {
  if (value instanceof Date) return value
  const raw = String(value ?? '')
  if (!raw) return null
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00Z`) : new Date(raw)
  return Number.isFinite(parsed.getTime()) ? parsed : null
}
function formattedValue(value, column, options, settings) {
  if (value === null || value === undefined || value === '') return ''
  const locale = settings?.localization?.defaultLanguage || settings?.language || 'en'
  if (column.type === 'boolean') return localizeExportValue(value, column, settings)
  if (column.type === 'date') {
    if (options.dateStyle === 'iso') return String(value)
    const date = asIsoDate(value)
    if (!date) return String(value)
    if (options.dateStyle === 'medium') return formatLocalizedDate(value, settings)
    try { return new Intl.DateTimeFormat(locale, { dateStyle: options.dateStyle, timeZone: /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? 'UTC' : settings?.workspace?.defaultTimezone || 'UTC' }).format(date) } catch { return String(value) }
  }
  if (column.type === 'percent') {
    const number = Number(value)
    if (!Number.isFinite(number)) return String(value)
    const numberingSystem = settings?.localization?.numberFormats?.[locale] || settings?.workspace?.regionalFormats?.number
    try { return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, ...(numberingSystem ? { numberingSystem } : {}) }).format(number / 100) } catch { return `${number}%` }
  }
  if (column.type === 'number') {
    const number = Number(value)
    if (!Number.isFinite(number)) return String(value)
    const numberingSystem = settings?.localization?.numberFormats?.[locale] || settings?.workspace?.regionalFormats?.number
    try { return new Intl.NumberFormat(locale, { maximumFractionDigits: 2, ...(numberingSystem ? { numberingSystem } : {}) }).format(number) } catch { return String(number) }
  }
  if (column.translateValue && !(Array.isArray(value) || (value && typeof value === 'object'))) return localizeExportValue(value, column, settings)
  if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value)
  return String(value)
}
function compareValues(left, right, locale) {
  const a = left == null ? '' : String(left)
  const b = right == null ? '' : String(right)
  return a.localeCompare(b, locale, { numeric: true, sensitivity: 'base' })
}
function orderRows(rows, options, columns, settings) {
  const locale = settings?.localization?.defaultLanguage || settings?.language || 'en'
  const direction = options.sortDirection === 'desc' ? -1 : 1
  const getGroup = row => options.groupBy === 'none' ? '' : String(row[options.groupBy] ?? '')
  const ordered = [...rows]
  ordered.sort((a, b) => {
    if (options.groupBy !== 'none') {
      const groupResult = compareValues(getGroup(a), getGroup(b), locale)
      if (groupResult) return groupResult * direction
    }
    if (options.sortBy !== 'none') {
      const column = columns.find(item => item.key === options.sortBy)
      let result = 0
      if (column?.type === 'number' || column?.type === 'percent') result = (Number(a[options.sortBy]) || 0) - (Number(b[options.sortBy]) || 0)
      else result = compareValues(a[options.sortBy], b[options.sortBy], locale)
      if (result) return result * direction
    }
    return 0
  })
  return ordered
}
function summaryMetrics(rows, columns, settings) {
  return columns.filter(column => column.type === 'number' || column.type === 'percent').slice(0, 4).map(column => {
    const total = rows.reduce((sum, row) => sum + (Number(row[column.key]) || 0), 0)
    const isPercent = column.type === 'percent'
    return { label: isPercent ? `${column.label} · ${uiText(settings, 'avg')}` : `${uiText(settings, 'Total')} ${column.label}`, value: isPercent && rows.length ? total / rows.length : total, type: column.type }
  })
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 700)
}
function excelNumber(value) { return Number.isFinite(Number(value)) ? String(Number(value)) : '0' }
async function makeXlsx(rows, columns, title, options, settings, meta) {
  const { zipSync, strToU8 } = await import('fflate')
  const accent = ACCENTS[options.accent] || ACCENTS.atlas
  const accentArgb = `FF${accent.slice(1)}`
  const cell = (value, column, col, row, style) => {
    if ((column.type === 'number' || column.type === 'percent') && value !== null && value !== undefined && value !== '') {
      const numericValue = Number(value) / (column.type === 'percent' ? 100 : 1)
      return `<c r="${col}${row}" s="${column.type === 'percent' ? 3 : 2}" t="n"><v>${excelNumber(numericValue)}</v></c>`
    }
    const formatted = formattedValue(value, column, options, settings)
    return `<c r="${col}${row}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlSafe(formatted)}</t></is></c>`
  }
  const textCell = (value, col, row, style) => `<c r="${col}${row}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlSafe(value)}</t></is></c>`
  const lastColumn = columnName(Math.max(0, columns.length - 1))
  const direction = exportDirection(settings) === 'rtl' ? ' rightToLeft="1"' : ''
  const locale = settings?.localization?.defaultLanguage || 'en'
  const generatedAt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(meta.generatedAt))
  const workspaceName = settings?.workspace?.name || settings?.workspaceName || 'Atlas Workspace'
  const metrics = [{ label: uiText(settings, 'Records'), value: String(rows.length) }, ...summaryMetrics(rows, columns, settings).map(metric => ({ label: metric.label, value: formattedValue(metric.value, { type: metric.type }, options, settings) }))].slice(0, 4)
  let rowIndex = 1
  const rowXml = []
  const merges = []
  const addBanner = (value, style, height = 21) => {
    rowXml.push(`<row r="${rowIndex}" ht="${height}" customHeight="1">${textCell(value, 'A', rowIndex, style)}</row>`)
    if (columns.length > 1) merges.push(`A${rowIndex}:${lastColumn}${rowIndex}`)
    rowIndex += 1
  }
  addBanner(title, 5, 27)
  const metadata = `${options.includeBranding ? `${workspaceName} · ` : ''}${uiText(settings, 'Generated')} ${generatedAt} · ${meta.recordCount} ${uiText(settings, 'SQLite records')}`
  addBanner(metadata, 6, 19)
  if (options.includeSummary) addBanner(`${uiText(settings, 'Summary')} · ${metrics.map(metric => `${metric.label}: ${metric.value}`).join('   ·   ')}`, 7, 21)
  rowIndex += 1
  const headerRowIndex = rowIndex
  const headerRow = columns.map((column, index) => textCell(column.label, columnName(index), headerRowIndex, 1)).join('')
  rowXml.push(`<row r="${headerRowIndex}" ht="24" customHeight="1">${headerRow}</row>`)
  rowIndex += 1
  let activeGroup = null
  const groupColumn = columns.find(column => column.key === options.groupBy)
  for (const record of rows) {
    const groupValue = options.groupBy === 'none' ? '' : String(record[options.groupBy] ?? 'Unassigned')
    if (groupColumn && groupValue !== activeGroup) {
      activeGroup = groupValue
      const groupLabel = `${groupColumn.label}: ${formattedValue(groupValue, groupColumn, options, settings) || uiText(settings, 'Unassigned')}`
      const groupCells = columns.map((column, index) => textCell(index === 0 ? groupLabel : '', columnName(index), rowIndex, 4)).join('')
      rowXml.push(`<row r="${rowIndex}" ht="20" customHeight="1">${groupCells}</row>`)
      rowIndex += 1
    }
    const dataCells = columns.map((column, index) => cell(record[column.key], column, columnName(index), rowIndex)).join('')
    rowXml.push(`<row r="${rowIndex}">${dataCells}</row>`)
    rowIndex += 1
  }
  if (options.includeSignoff) {
    rowIndex += 1
    const preparedCell = textCell(uiText(settings, 'Prepared by: ______________________________'), 'A', rowIndex, 8)
    const reviewedCell = columns.length > 1 ? textCell(uiText(settings, 'Reviewed by: ______________________________'), lastColumn, rowIndex, 8) : ''
    rowXml.push(`<row r="${rowIndex}" ht="24" customHeight="1">${preparedCell}${reviewedCell}</row>`)
  }
  const footerText = String(settings?.reports?.branding?.footerText || '').trim()
  if (footerText) { rowIndex += 1; addBanner(footerText, 6, 20) }
  const widths = columns.map((column, index) => {
    const contentWidth = Math.max(column.label.length, ...rows.slice(0, 80).map(record => String(formattedValue(record[column.key], column, options, settings)).length), 8)
    return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(44, contentWidth + 2)}" customWidth="1"/>`
  }).join('')
  const mergeMarkup = merges.length ? `<mergeCells count="${merges.length}">${merges.map(reference => `<mergeCell ref="${reference}"/>`).join('')}</mergeCells>` : ''
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${direction}><pane ySplit="${headerRowIndex}" topLeftCell="A${headerRowIndex + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rowXml.join('')}</sheetData><autoFilter ref="A${headerRowIndex}:${lastColumn}${Math.max(headerRowIndex, rowIndex - (options.includeSignoff ? 2 : 1))}"/>${mergeMarkup}</worksheet>`
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Atlas Export" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': strToU8(`<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FF1D2939"/><sz val="16"/><name val="Aptos Display"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="${accentArgb}"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F0FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9DDE7"/></left><right style="thin"><color rgb="FFD9DDE7"/></right><top style="thin"><color rgb="FFD9DDE7"/></top><bottom style="thin"><color rgb="FFD9DDE7"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(worksheet)
  }
  return new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
function groupTableRows(rows, columns, options, settings) {
  const body = []
  let activeGroup = null
  const groupColumn = columns.find(column => column.key === options.groupBy)
  for (const row of rows) {
    const groupValue = options.groupBy === 'none' ? '' : String(row[options.groupBy] ?? 'Unassigned')
    if (groupColumn && groupValue !== activeGroup) {
      activeGroup = groupValue
      body.push([{ content: `${groupColumn.label}: ${formattedValue(groupValue, groupColumn, options, settings) || uiText(settings, 'Unassigned')}`, colSpan: columns.length, styles: { fillColor: [239, 238, 255], textColor: [63, 58, 133], fontStyle: 'bold' } }])
    }
    body.push(columns.map(column => formattedValue(row[column.key], column, options, settings)))
  }
  return body
}
async function exportPdf(rows, columns, title, options, settings, meta) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableModule.default || autoTableModule.autoTable
  const direction = exportDirection(settings)
  const doc = new jsPDF({ orientation: options.orientation, format: options.pageSize, unit: 'mm' })
  const accentHex = (ACCENTS[options.accent] || ACCENTS.atlas).slice(1)
  const accentRgb = [0, 2, 4].map(index => parseInt(accentHex.slice(index, index + 2), 16))
  const margin = Number(options.margin) || 14
  const pageWidth = doc.internal.pageSize.getWidth()
  const align = direction === 'rtl' ? 'right' : 'left'
  const x = direction === 'rtl' ? pageWidth - margin : margin
  const footerText = String(settings?.reports?.branding?.footerText || '').trim().slice(0, 500)
  let logoDataUrl = ''
  if (options.includeBranding && settings?.reports?.branding?.includeLogo !== false) {
    try { logoDataUrl = await imageDataUrl(safeLogoSource(settings)) } catch {}
  }
  let pdfFont = 'helvetica'
  try {
    for (const [weight, style] of [['Regular', 'normal'], ['Bold', 'bold']]) {
      const response = await fetch(`/fonts/AtlasSans-${weight}.ttf`)
      if (!response.ok) throw new Error('PDF font is unavailable')
      const fontBuffer = await response.arrayBuffer()
      let binary = ''; new Uint8Array(fontBuffer).forEach(byte => { binary += String.fromCharCode(byte) })
      const fontFile = `AtlasSans-${weight}.ttf`
      doc.addFileToVFS(fontFile, btoa(binary)); doc.addFont(fontFile, 'AtlasSans', style)
    }
    pdfFont = 'AtlasSans'
  } catch {}
  doc.setFont(pdfFont, 'normal')
  doc.setProperties({ title, subject: `${meta.dataset} · ${meta.recordCount} SQLite records`, creator: 'Atlas Workspace' })
  if (direction === 'rtl' && doc.setR2L) doc.setR2L(true)
  const workspaceName = settings?.workspace?.name || settings?.workspaceName || 'Atlas Workspace'
  const generation = new Intl.DateTimeFormat(settings?.localization?.defaultLanguage || 'en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(meta.generatedAt))
  const drawPageFooter = () => {
    const page = doc.internal.getCurrentPageInfo().pageNumber
    const count = doc.internal.getNumberOfPages()
    const pageHeight = doc.internal.pageSize.getHeight()
    doc.setFontSize(7); doc.setTextColor(125, 131, 143)
    if (footerText) doc.text(footerText, pageWidth / 2, pageHeight - 5, { align: 'center', maxWidth: pageWidth - margin * 2 })
    doc.text(`${page} / ${count}`, direction === 'rtl' ? margin : pageWidth - margin, pageHeight - 5, { align: direction === 'rtl' ? 'left' : 'right' })
  }
  doc.setFillColor(...accentRgb); doc.rect(0, 0, pageWidth, 4, 'F')
  doc.setTextColor(27, 35, 50); doc.setFontSize(options.template === 'compact' ? 15 : 19); doc.text(title, x, 15, { align })
  if (options.includeBranding) {
    doc.setTextColor(...accentRgb); doc.setFontSize(8)
    if (logoDataUrl) {
      try {
        const imageType = logoDataUrl.toLowerCase().startsWith('data:image/png') ? 'PNG' : 'JPEG'
        const logoX = direction === 'rtl' ? pageWidth - margin - 18 : margin
        doc.addImage(logoDataUrl, imageType, logoX, 17, 16, 8, 'ATLAS_REPORT_LOGO', 'FAST')
        doc.text(workspaceName, direction === 'rtl' ? x - 22 : x + 22, 21, { align })
      } catch { doc.text(workspaceName, x, 21, { align }) }
    } else doc.text(workspaceName, x, 21, { align })
  }
  doc.setTextColor(111, 119, 136); doc.setFontSize(8); doc.text(`${meta.recordCount} ${uiText(settings, 'database records')} · ${uiText(settings, 'Generated')} ${generation}`, x, options.includeBranding ? 26 : 22, { align })
  if (options.includeSummary) {
    let y = options.includeBranding ? 33 : 29
    const metrics = [{ label: uiText(settings, 'Records'), value: String(rows.length) }, ...summaryMetrics(rows, columns, settings).map(metric => ({ label: metric.label, value: formattedValue(metric.value, { type: metric.type }, options, settings) }))].slice(0, 4)
    const width = (pageWidth - margin * 2) / metrics.length
    metrics.forEach((metric, index) => {
      const left = direction === 'rtl' ? pageWidth - margin - width * (index + 1) : margin + width * index
      doc.setFillColor(246, 247, 251); doc.roundedRect(left + 1, y - 5, width - 3, 12, 1.5, 1.5, 'F')
      doc.setTextColor(108, 116, 132); doc.setFontSize(6); doc.text(metric.label, left + 4, y - 1, { align: direction === 'rtl' ? 'right' : 'left' })
      doc.setTextColor(35, 42, 58); doc.setFontSize(9); doc.text(metric.value, left + 4, y + 4, { align: direction === 'rtl' ? 'right' : 'left' })
    })
    y += 17
    autoTable(doc, {
      head: [columns.map(column => column.label)], body: groupTableRows(rows, columns, options, settings), startY: y,
      margin: { top: margin, right: margin, bottom: margin + 5, left: margin },
      styles: { fontSize: Number(options.fontSize), font: pdfFont, cellPadding: options.template === 'compact' ? 1.8 : 2.6, overflow: 'linebreak', halign: align },
      headStyles: { fillColor: accentRgb, textColor: [255, 255, 255], fontStyle: 'bold', halign: align },
      alternateRowStyles: { fillColor: [249, 250, 252] },
      didDrawPage: drawPageFooter
    })
  } else {
    autoTable(doc, {
      head: [columns.map(column => column.label)], body: groupTableRows(rows, columns, options, settings), startY: options.includeBranding ? 31 : 27,
      margin: { top: margin, right: margin, bottom: margin + 5, left: margin },
      styles: { fontSize: Number(options.fontSize), font: pdfFont, cellPadding: options.template === 'compact' ? 1.8 : 2.6, overflow: 'linebreak', halign: align },
      headStyles: { fillColor: accentRgb, textColor: [255, 255, 255], fontStyle: 'bold', halign: align },
      alternateRowStyles: { fillColor: [249, 250, 252] },
      didDrawPage: drawPageFooter
    })
  }
  if (options.includeSignoff) {
    const pageHeight = doc.internal.pageSize.getHeight()
    const lineWidth = (pageWidth - margin * 2 - 18) / 2
    let y = (doc.lastAutoTable?.finalY || (options.includeBranding ? 31 : 27)) + 15
    if (y + 13 > pageHeight - margin) { doc.addPage(); y = margin + 9 }
    doc.setDrawColor(205, 210, 220); doc.setTextColor(111, 119, 136); doc.setFontSize(7)
    const starts = direction === 'rtl' ? [pageWidth - margin - lineWidth, margin] : [margin, margin + lineWidth + 18]
    starts.forEach((start, index) => {
      doc.line(start, y, start + lineWidth, y)
      doc.text(uiText(settings, index === 0 ? 'Prepared by' : 'Reviewed by'), direction === 'rtl' ? start + lineWidth : start, y + 5, { align: direction === 'rtl' ? 'right' : 'left' })
    })
  }
  doc.save(`${slug(title) || 'atlas-export'}.pdf`)
}
function printHtml(rows, columns, title, options, settings, meta) {
  const direction = exportDirection(settings)
  const accent = ACCENTS[options.accent] || ACCENTS.atlas
  const locale = settings?.localization?.defaultLanguage || 'en'
  const generatedAt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(meta.generatedAt))
  const metrics = [{ label: uiText(settings, 'Records'), value: String(rows.length) }, ...summaryMetrics(rows, columns, settings).map(metric => ({ label: metric.label, value: formattedValue(metric.value, { type: metric.type }, options, settings) }))].slice(0, 4)
  const summary = options.includeSummary ? `<section class="summary">${metrics.map(item => `<div><small>${htmlSafe(item.label)}</small><strong>${htmlSafe(item.value)}</strong></div>`).join('')}</section>` : ''
  const headers = columns.map(column => `<th>${htmlSafe(column.label)}</th>`).join('')
  const datasetLabel = uiText(settings, EXPORT_DATASET_LABELS[meta.dataset] || meta.dataset)
  const reportWorkspaceName = settings?.workspace?.name || settings?.workspaceName || 'Atlas Workspace'
  const localizedWorkspaceName = reportWorkspaceName === 'Atlas Workspace' ? uiText(settings, reportWorkspaceName) : reportWorkspaceName
  const body = []
  let activeGroup = null
  const groupColumn = columns.find(column => column.key === options.groupBy)
  for (const row of rows) {
    const groupValue = options.groupBy === 'none' ? '' : String(row[options.groupBy] ?? 'Unassigned')
    if (groupColumn && groupValue !== activeGroup) {
      activeGroup = groupValue
      body.push(`<tr class="group"><th colspan="${columns.length}">${htmlSafe(groupColumn.label)} · ${htmlSafe(formattedValue(groupValue, groupColumn, options, settings) || uiText(settings, 'Unassigned'))}</th></tr>`)
    }
    body.push(`<tr>${columns.map(column => `<td>${htmlSafe(formattedValue(row[column.key], column, options, settings))}</td>`).join('')}</tr>`)
  }
  const logoSource = options.includeBranding && settings?.reports?.branding?.includeLogo !== false ? safeLogoSource(settings) : ''
  const branding = options.includeBranding ? `<div class="brand">${logoSource ? `<img class="report-logo" src="${htmlSafe(logoSource)}" alt="">` : '<span class="mark">A</span>'}<span>${htmlSafe(localizedWorkspaceName)}</span></div>` : ''
  const reportFooter = String(settings?.reports?.branding?.footerText || '').trim()
  const template = options.template
  return `<!doctype html><html lang="${htmlSafe(locale)}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlSafe(title)}</title><style>
    :root{--accent:${accent};--ink:#1d2939;--muted:#667085;--line:#dfe3ea;--soft:#f6f7fb}*{box-sizing:border-box}body{margin:0;color:var(--ink);font:10pt/1.45 Arial,Helvetica,sans-serif;background:#fff}.report{max-width:1400px;margin:28px auto;padding:0 28px 32px}.topline{height:5px;background:var(--accent);margin:-28px -28px 24px}.brand{display:flex;align-items:center;gap:9px;color:var(--muted);font-size:9pt;font-weight:700;margin-bottom:10px}.report-logo{display:block;max-width:120px;max-height:32px;object-fit:contain}.mark{display:grid;place-items:center;width:24px;height:24px;border-radius:8px;background:var(--accent);color:white;font-weight:800}.heading{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:1px solid var(--line);padding-bottom:16px}.heading h1{margin:0 0 5px;font-size:${template === 'compact' ? 18 : 24}pt;letter-spacing:-.03em}.heading p{margin:0;color:var(--muted);font-size:9pt}.meta{text-align:${direction === 'rtl' ? 'left' : 'right'};color:var(--muted);font-size:8pt;white-space:nowrap}.summary{display:grid;grid-template-columns:repeat(${metrics.length},minmax(0,1fr));gap:10px;margin:17px 0 20px}.summary div{border:1px solid var(--line);border-top:3px solid var(--accent);border-radius:9px;padding:11px 13px;background:#fff}.summary small{display:block;color:var(--muted);font-size:8pt}.summary strong{display:block;margin-top:4px;font-size:15pt}.table-wrap{margin-top:18px;overflow:visible}table{width:100%;border-collapse:collapse;font-size:${template === 'compact' ? 8 : 9}pt;table-layout:auto}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid var(--line);padding:${template === 'compact' ? '6px 7px' : '8px 9px'};text-align:${direction === 'rtl' ? 'right' : 'left'};vertical-align:top;overflow-wrap:anywhere}thead th{background:var(--accent);color:#fff;font-weight:700}.group th{background:#f1f0ff;color:#494197;text-align:${direction === 'rtl' ? 'right' : 'left'};font-size:8pt}.data-note{margin:12px 0 0;color:var(--muted);font-size:8pt}.signature{display:grid;grid-template-columns:repeat(2,1fr);gap:36px;margin-top:28px;color:var(--muted);font-size:8pt}.signature span{border-top:1px solid var(--line);padding-top:6px}.footer{display:flex;justify-content:space-between;gap:15px;margin-top:22px;padding-top:8px;border-top:1px solid var(--line);color:var(--muted);font-size:7.5pt}.footer-note{white-space:pre-wrap;overflow-wrap:anywhere;text-align:center}.ledger table{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.compact .summary div{padding:7px 9px}@page{size:${options.pageSize} ${options.orientation};margin:${options.margin}mm}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.report{max-width:none;margin:0;padding:0}.topline{margin:0 0 18px}.heading{break-after:avoid}.summary{break-inside:avoid}.footer{break-inside:avoid}}
    </style></head><body><main class="report ${template}"><div class="topline"></div>${branding}<header class="heading"><div><h1>${htmlSafe(title)}</h1><p>${htmlSafe(uiText(settings, 'Prepared from current SQLite workspace fields'))} · ${htmlSafe(meta.recordCount)} ${htmlSafe(uiText(settings, 'records'))}</p></div><div class="meta">${htmlSafe(uiText(settings, 'Generated'))}<br>${htmlSafe(generatedAt)}</div></header>${summary}<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${body.join('')}</tbody></table></div>${options.includeSignoff ? `<div class="signature"><span>${htmlSafe(uiText(settings, 'Prepared by'))}</span><span>${htmlSafe(uiText(settings, 'Reviewed by'))}</span></div>` : ''}<div class="footer"><span>${htmlSafe(datasetLabel)} · ${htmlSafe(meta.recordCount)} ${htmlSafe(uiText(settings, 'records'))} · ${htmlSafe(uiText(settings, 'SQLite source'))}</span>${reportFooter ? `<span class="footer-note">${htmlSafe(reportFooter)}</span>` : ''}${options.includeBranding ? `<span>${htmlSafe(localizedWorkspaceName)}</span>` : ''}</div></main></body></html>`
}

export function ExportMenu({ rows, columns, title, settings, dataset, query = {}, canExport = true, canPrint = true, exportScopes }) {
  const actionVisibility = settings?.interface?.actionVisibility || {}
  const configuredFormats = Array.isArray(settings?.exports?.formats) ? settings.exports.formats : ['csv', 'xlsx', 'json', 'pdf', 'print']
  const exportFormats = ['pdf', 'xlsx', 'csv', 'json'].filter(item => configuredFormats.includes(item))
  const allowExport = canExport && actionVisibility.export !== false && exportFormats.length > 0
  const allowPrint = canPrint && actionVisibility.print !== false && configuredFormats.includes('print')
  const configuredTemplates = (Array.isArray(settings?.reports?.templates) ? settings.reports.templates : Object.keys(TEMPLATE_LABELS)).filter(templateId => Object.hasOwn(TEMPLATE_LABELS, templateId))
  const availableTemplates = configuredTemplates.length ? [...new Set(configuredTemplates)] : ['executive']
  const configuredDefaultTemplate = settings?.reports?.defaultTemplate || settings?.printTemplate || 'executive'
  const defaultTemplate = availableTemplates.includes(configuredDefaultTemplate) ? configuredDefaultTemplate : availableTemplates[0]
  const templateKey = availableTemplates.join('|')
  const hasExportScopes = Boolean(exportScopes)
  const [scope, setScope] = useState('filtered')
  const scopeRows = exportScopes?.[scope] || (Array.isArray(rows) ? rows : [])
  const sourceRows = Array.isArray(scopeRows) ? scopeRows : []
  const scopeCount = sourceRows.length
  const baseColumns = Array.isArray(columns) ? columns : []
  const customEntity = CUSTOM_FIELD_ENTITIES[dataset]
  const customColumns = (settings?.customFields?.[customEntity] || [])
    .filter(definition => definition && typeof definition.key === 'string' && definition.visible !== false)
    .map(definition => ({ key: `customFields.${definition.key}`, label: definition.label || definition.key, type: customFieldType(definition.type) }))
  const availableColumns = [...baseColumns, ...customColumns.filter(column => !baseColumns.some(existing => existing.key === column.key))]
  const columnsKey = availableColumns.map(column => column.key).join('|')
  const idsKey = sourceRows.map(row => identifierFor(dataset, row)).filter(value => value !== null && value !== undefined).map(String).join('|')
  const queryKey = JSON.stringify(query || {})
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(() => availableColumns.map(column => column.key))
  const [format, setFormat] = useState('pdf')
  const selectedFormat = exportFormats.includes(format) ? format : (exportFormats[0] || 'pdf')
  const [orientation, setOrientation] = useState(settings?.exports?.pdf?.orientation === 'portrait' ? 'portrait' : 'landscape')
  const [pageSize, setPageSize] = useState('a4')
  const [margin, setMargin] = useState(({ narrow: '9', standard: '14', wide: '20' })[settings?.exports?.pdf?.margins] || '14')
  const [template, setTemplate] = useState(defaultTemplate)
  const [dateStyle, setDateStyle] = useState('medium')
  const [groupBy, setGroupBy] = useState('none')
  const [sortBy, setSortBy] = useState('none')
  const [sortDirection, setSortDirection] = useState('asc')
  const [accent, setAccent] = useState('atlas')
  const [fontSize, setFontSize] = useState('8')
  const [includeSummary, setIncludeSummary] = useState(true)
  const [includeBranding, setIncludeBranding] = useState(settings?.exports?.includeBranding !== false)
  const [includeSignoff, setIncludeSignoff] = useState(false)
  const [fileTitle, setFileTitle] = useState(title)
  const [error, setError] = useState('')
  const [prepared, setPrepared] = useState(null)
  const [preparing, setPreparing] = useState(false)

  useEffect(() => { setSelected(availableColumns.map(column => column.key)) }, [columnsKey])
  useEffect(() => {
    if (!hasExportScopes) return
    if (scope === 'selected' && !(exportScopes?.selected || []).length) setScope('filtered')
  }, [hasExportScopes, scope, exportScopes?.selected?.length])
  useEffect(() => {
    setOrientation(settings?.exports?.pdf?.orientation === 'portrait' ? 'portrait' : 'landscape')
    setMargin(({ narrow: '9', standard: '14', wide: '20' })[settings?.exports?.pdf?.margins] || '14')
    setIncludeBranding(settings?.exports?.includeBranding !== false)
  }, [settings?.exports?.pdf?.orientation, settings?.exports?.pdf?.margins, settings?.exports?.includeBranding])
  useEffect(() => {
    setTemplate(current => availableTemplates.includes(current) ? current : defaultTemplate)
  }, [templateKey, defaultTemplate])
  useEffect(() => {
    if (groupBy !== 'none' && !selected.includes(groupBy)) setGroupBy('none')
    if (sortBy !== 'none' && !selected.includes(sortBy)) setSortBy('none')
  }, [selected, groupBy, sortBy])

  const fieldsKey = selected.join('|')
  const request = useMemo(() => ({
    dataset,
    recordIds: hasExportScopes && scope === 'all' ? undefined : sourceRows.map(row => identifierFor(dataset, row)).filter(value => value !== null && value !== undefined),
    fields: selected,
    query: query || {}
  }), [dataset, idsKey, fieldsKey, queryKey, hasExportScopes, scope])

  useEffect(() => {
    if (!open) return undefined
    let current = true
    setPreparing(true); setError('')
    api.post('/api/exports/prepare', request)
      .then(payload => { if (current) setPrepared(payload) })
      .catch(fetchError => { if (current) { setPrepared(null); setError(fetchError.message || 'Unable to read export rows from SQLite.') } })
      .finally(() => { if (current) setPreparing(false) })
    return () => { current = false }
  }, [open, request])

  const options = { orientation, pageSize, margin, template, dateStyle, groupBy, sortBy, sortDirection, accent, fontSize, includeSummary, includeBranding, includeSignoff }
  const reportSettings = outputSettings(settings)
  const previewColumns = localizeExportColumns(dataset, prepared?.columns || [], reportSettings)
  const previewRows = prepared?.rows || []
  const displayRows = orderRows(previewRows, options, previewColumns, reportSettings)
  const metadata = prepared ? { ...prepared, recordCount: prepared.recordCount, dataset } : null
  const changedSelected = key => setSelected(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  if (!allowExport && !allowPrint) return null

  const loadCurrentData = async () => {
    if (!dataset) throw new Error('This export has no database dataset configured.')
    const payload = await api.post('/api/exports/prepare', request)
    setPrepared(payload)
    return payload
  }
  const audit = async (action, rowCount) => api.post('/api/audit/export', {
    title: String(fileTitle || '').trim().slice(0, 200), format: action, rowCount
  })
  const doExport = async () => {
    setError('')
    try {
      const payload = await loadCurrentData()
      const columnsForExport = localizeExportColumns(dataset, payload.columns, reportSettings)
      const rowsForExport = orderRows(payload.rows, options, columnsForExport, reportSettings)
      if (!columnsForExport.length) throw new Error('Select at least one database field to export.')
      await audit(selectedFormat, rowsForExport.length)
      if (selectedFormat === 'csv') {
        const csvCell = (value, column) => {
          let text = formattedValue(value, column, options, settings)
          if (/^[\t\r\n ]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`
          return `"${text.replaceAll('"', '""')}"`
        }
        const text = [columnsForExport.map(column => csvCell(column.label, { type: 'text' })).join(','), ...rowsForExport.map(row => columnsForExport.map(column => csvCell(row[column.key], column)).join(','))].join('\r\n')
        downloadBlob(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' }), `${slug(fileTitle) || 'atlas-export'}.csv`)
      }
      if (selectedFormat === 'xlsx') downloadBlob(await makeXlsx(rowsForExport, columnsForExport, fileTitle, options, reportSettings, payload), `${slug(fileTitle) || 'atlas-export'}.xlsx`)
      if (selectedFormat === 'json') {
        const json = { metadata: { title: fileTitle, source: payload.source, dataset: payload.dataset, generatedAt: payload.generatedAt, recordCount: payload.recordCount, formatting: options, language: reportSettings?.localization?.defaultLanguage || reportSettings?.language || 'en' }, columns: columnsForExport.map(({ translateValue, ...column }) => column), rows: rowsForExport }
        downloadBlob(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), `${slug(fileTitle) || 'atlas-export'}.json`)
      }
      if (selectedFormat === 'pdf') await exportPdf(rowsForExport, columnsForExport, fileTitle, options, reportSettings, payload)
      setOpen(false)
    } catch (exportError) {
      setError(exportError.message || 'Export failed.')
    }
  }
  const print = async () => {
    setError('')
    const printWindow = window.open('', '_blank', 'popup,width=1200,height=850')
    if (!printWindow) { setError('Allow pop-ups to open a separate, print-ready report.'); return }
    printWindow.document.open()
    printWindow.document.write(`<!doctype html><title>${htmlSafe(uiText(settings, 'Preparing Atlas report…'))}</title><body style="font:16px Arial;padding:40px">${htmlSafe(uiText(settings, 'Preparing report from SQLite…'))}</body>`)
    printWindow.document.close()
    try {
      const payload = await loadCurrentData()
      const columnsForPrint = localizeExportColumns(dataset, payload.columns, reportSettings)
      const rowsForPrint = orderRows(payload.rows, options, columnsForPrint, reportSettings)
      if (!columnsForPrint.length) throw new Error('Select at least one database field to print.')
      await audit('print', rowsForPrint.length)
      printWindow.document.open()
      printWindow.document.write(printHtml(rowsForPrint, columnsForPrint, fileTitle, options, reportSettings, payload))
      printWindow.document.close()
      printWindow.focus()
      setTimeout(() => { try { printWindow.print() } catch {} }, 450)
      setOpen(false)
    } catch (printError) {
      printWindow.close()
      setError(printError.message || 'Report preparation failed.')
    }
  }

  return <div className="export-wrap">
    <button className="secondary-button" onClick={() => { setError(''); setOpen(!open) }}><Icon name="external" size={15}/> {uiText(settings, 'Export / print')}</button>
    {open && <div className="export-panel export-panel-studio">
      <div className="advanced-filter-head"><div><strong>{uiText(settings, 'Atlas report studio')}</strong><small>{uiText(settings, 'Live fields are re-read from SQLite when you export.')}</small></div><button className="icon-button subtle" onClick={() => setOpen(false)} aria-label={uiText(settings, 'Close report studio')}><Icon name="close" size={14}/></button></div>
      {hasExportScopes && <label className="tiny-label export-scope-label">{uiText(settings, 'Export scope')}<select value={scope} onChange={event => setScope(event.target.value)}><option value="selected" disabled={!(exportScopes?.selected || []).length}>{uiText(settings, 'Selected records')} ({new Intl.NumberFormat(settings?.localization?.defaultLanguage || settings?.language || 'en').format((exportScopes?.selected || []).length)})</option><option value="filtered">{uiText(settings, 'Filtered results')} ({new Intl.NumberFormat(settings?.localization?.defaultLanguage || settings?.language || 'en').format((exportScopes?.filtered || []).length)})</option><option value="all">{uiText(settings, 'Entire dataset')}{query?.projectId ? ` ${uiText(settings, 'for this project')}` : ''}</option></select><small>{uiText(settings, scope === 'selected' ? 'Only checked records will be queried from SQLite.' : scope === 'filtered' ? 'The current table filters determine the record IDs; values are re-read from SQLite.' : 'All records within the current dataset and project scope are queried from SQLite.')}</small></label>}
      <label className="tiny-label">{uiText(settings, 'Report title')}<input value={fileTitle} maxLength={200} onChange={event => setFileTitle(event.target.value)}/></label>
      {allowExport && <div className="column-checks export-field-list"><div className="export-field-heading"><span>{uiText(settings, 'Database fields')}</span><span>{new Intl.NumberFormat(settings?.localization?.defaultLanguage || settings?.language || 'en').format(selected.length)} {uiText(settings, 'selected')}</span></div>{availableColumns.map(column => <label key={column.key}><input type="checkbox" checked={selected.includes(column.key)} onChange={() => changedSelected(column.key)}/>{column.label}</label>)}</div>}
      <div className="export-format-grid">
        {allowExport && <label>{uiText(settings, 'File format')}<select value={selectedFormat} onChange={event => setFormat(event.target.value)}>{exportFormats.map(item => <option key={item} value={item}>{item === 'xlsx' ? uiText(settings, 'Excel workbook') : item.toUpperCase()}</option>)}</select></label>}
        <label>{uiText(settings, 'Document template')}<select value={template} onChange={event => setTemplate(event.target.value)}>{availableTemplates.map(value => <option key={value} value={value}>{uiText(settings, TEMPLATE_LABELS[value])}</option>)}</select></label>
        <label>{uiText(settings, 'Page size')}<select value={pageSize} onChange={event => setPageSize(event.target.value)}><option value="a4">{uiText(settings, 'A4')}</option><option value="letter">{uiText(settings, 'Letter')}</option><option value="legal">{uiText(settings, 'Legal')}</option></select></label>
        <label>{uiText(settings, 'Orientation')}<select value={orientation} onChange={event => setOrientation(event.target.value)}><option value="landscape">{uiText(settings, 'Landscape')}</option><option value="portrait">{uiText(settings, 'Portrait')}</option></select></label>
        <label>{uiText(settings, 'Page margins')}<select value={margin} onChange={event => setMargin(event.target.value)}><option value="9">{uiText(settings, 'Narrow')}</option><option value="14">{uiText(settings, 'Standard')}</option><option value="20">{uiText(settings, 'Wide')}</option></select></label>
        <label>{uiText(settings, 'Date formatting')}<select value={dateStyle} onChange={event => setDateStyle(event.target.value)}>{DATE_STYLES.map(style => <option key={style} value={style}>{style === 'iso' ? uiText(settings, 'ISO') : `${uiText(settings, style[0].toUpperCase() + style.slice(1))} · ${uiText(settings, 'locale')}`}</option>)}</select></label>
        <label>{uiText(settings, 'Group rows by')}<select value={groupBy} onChange={event => setGroupBy(event.target.value)}><option value="none">{uiText(settings, 'No grouping')}</option>{availableColumns.filter(column => selected.includes(column.key)).map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label>
        <label>{uiText(settings, 'Sort by')}<select value={sortBy} onChange={event => setSortBy(event.target.value)}><option value="none">{uiText(settings, 'Source order')}</option>{availableColumns.filter(column => selected.includes(column.key)).map(column => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label>
        <label>{uiText(settings, 'Sort direction')}<select value={sortDirection} onChange={event => setSortDirection(event.target.value)}><option value="asc">{uiText(settings, 'Ascending')}</option><option value="desc">{uiText(settings, 'Descending')}</option></select></label>
        <label>{uiText(settings, 'Brand accent')}<select value={accent} onChange={event => setAccent(event.target.value)}>{Object.keys(ACCENTS).map(color => <option key={color} value={color}>{uiText(settings, color)}</option>)}</select></label>
        {allowPrint && <label>{uiText(settings, 'Table text')}<select value={fontSize} onChange={event => setFontSize(event.target.value)}><option value="7">{uiText(settings, 'Small')}</option><option value="8">{uiText(settings, 'Standard')}</option><option value="10">{uiText(settings, 'Large')}</option></select></label>}
      </div>
      <div className="export-check-options"><label><input type="checkbox" checked={includeSummary} onChange={event => setIncludeSummary(event.target.checked)}/> {uiText(settings, 'Include summary metrics')}</label><label><input type="checkbox" checked={includeBranding} onChange={event => setIncludeBranding(event.target.checked)}/> {uiText(settings, 'Include workspace branding')}</label><label><input type="checkbox" checked={includeSignoff} onChange={event => setIncludeSignoff(event.target.checked)}/> {uiText(settings, 'Add review sign-off lines')}</label></div>
      <div className="export-data-status"><span className={preparing ? 'is-loading' : prepared ? 'is-ready' : ''}/><div><strong>{preparing ? uiText(settings, 'Reading database fields…') : prepared ? <><span data-no-i18n>{new Intl.NumberFormat(settings?.localization?.defaultLanguage || settings?.language || 'en').format(prepared.recordCount)}</span> {uiText(settings, 'records ready')}</> : uiText(settings, 'Preview awaiting database read')}</strong><small>{prepared ? <>{uiText(settings, 'SQLite source')} · {uiText(settings, 'refreshed')} <span data-no-i18n>{new Intl.DateTimeFormat(settings?.localization?.defaultLanguage || 'en', { timeStyle: 'short' }).format(new Date(prepared.generatedAt))}</span></> : uiText(settings, 'Rows are fetched from the database, not from the visible screen.')}</small></div><button type="button" className="text-button" disabled={preparing} onClick={() => { setOpen(false); requestAnimationFrame(() => setOpen(true)) }}>{uiText(settings, 'Refresh')}</button></div>
      {prepared && <div className="export-preview"><div className="export-preview-heading"><strong>{uiText(settings, 'Data preview')}</strong><span><span data-no-i18n>{new Intl.NumberFormat(settings?.localization?.defaultLanguage || settings?.language || 'en').format(previewColumns.length)}</span> {uiText(settings, 'fields')} · <span data-no-i18n>{new Intl.NumberFormat(settings?.localization?.defaultLanguage || settings?.language || 'en').format(previewRows.length)}</span> {uiText(settings, 'rows')}</span></div>{!displayRows.length ? <p>{uiText(settings, 'No matching database records.')}</p> : <div className="export-preview-scroll"><table><thead><tr>{previewColumns.slice(0, 5).map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{displayRows.slice(0, 3).map((row, index) => <tr key={index}>{previewColumns.slice(0, 5).map(column => <td key={column.key} data-no-i18n={column.translateValue || column.type === 'boolean' ? undefined : ''}>{formattedValue(row[column.key], column, options, reportSettings)}</td>)}</tr>)}</tbody></table></div>}{includeSummary && <div className="export-preview-summary">{summaryMetrics(previewRows, previewColumns, reportSettings).slice(0, 3).map(metric => <span key={metric.label}>{metric.label}: <strong>{formattedValue(metric.value, { type: metric.type }, options, reportSettings)}</strong></span>)}</div>}</div>}
      {error && <div className="form-error"><Icon name="warning" size={14}/>{error}</div>}
      <div className="export-actions">{allowExport && <button className="secondary-button" onClick={doExport} disabled={preparing || !selected.length}>{uiText(settings, 'Download')} {selectedFormat.toUpperCase()}</button>}{allowPrint && <button className="primary-button" onClick={print} disabled={preparing || !selected.length}>{uiText(settings, 'Open print-ready report')}</button>}</div>
    </div>}
  </div>
}
