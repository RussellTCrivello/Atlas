import { useEffect, useState } from 'react'
import { api } from '../../api/client.js'
import { Icon } from '../Icon.jsx'
import { readValue } from '../../lib/advanced-filters.js'
import { textDirection } from '../../lib/localization.js'
import { slug } from '../../lib/strings.js'

function xmlSafe(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;') }
function columnName(index) { let out = '', n = index + 1; while (n) { const r = (n - 1) % 26; out = String.fromCharCode(65 + r) + out; n = Math.floor((n - 1) / 26) } return out }
async function makeXlsx(rows, columns) {
  const { zipSync, strToU8 } = await import('fflate')
  const cell = (value, col, row) => typeof value === 'number' ? `<c r="${col}${row}" t="n"><v>${value}</v></c>` : `<c r="${col}${row}" t="inlineStr"><is><t>${xmlSafe(value)}</t></is></c>`
  const sheetRows = [columns.map((c, i) => cell(c.label, columnName(i), 1)).join(''), ...rows.map((row, r) => columns.map((c, i) => cell(row[c.key], columnName(i), r + 2)).join(''))].map((row, i) => `<row r="${i + 1}">${row}</row>`).join('')
  const files = { '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'), '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'), 'xl/workbook.xml': strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Atlas" sheetId="1" r:id="rId1"/></sheets></workbook>'), 'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'), 'xl/worksheets/sheet1.xml': strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`) }
  return new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 700) }
async function exportPdf(rows, columns, title, orientation, settings = {}, marginSize = 14) {
  const [{ jsPDF }, autoTableModule] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableModule.default || autoTableModule.autoTable
  const dir = textDirection(settings)
  const doc = new jsPDF({ orientation })
  try {
    const fontBuffer = await fetch('/fonts/AtlasSans-Regular.ttf').then(res => res.arrayBuffer())
    let binary = ''; new Uint8Array(fontBuffer).forEach(byte => { binary += String.fromCharCode(byte) })
    doc.addFileToVFS('AtlasSans-Regular.ttf', btoa(binary)); doc.addFont('AtlasSans-Regular.ttf', 'AtlasSans', 'normal'); doc.setFont('AtlasSans', 'normal')
  } catch {}
  if (dir === 'rtl' && doc.setR2L) doc.setR2L(true)
  const pageWidth = doc.internal.pageSize.getWidth()
  const x = dir === 'rtl' ? pageWidth - 14 : 14
  const align = dir === 'rtl' ? 'right' : 'left'
  doc.setFontSize(16); doc.text(title, x, 16, { align })
  doc.setFontSize(8); doc.text(`Generated ${new Date().toLocaleString(settings.localization?.defaultLanguage || settings.language || 'en')}`, x, 22, { align })
  if (settings.exports?.includeBranding !== false) doc.text(settings.workspace?.name || settings.workspaceName || 'Atlas Workspace', x, 26, { align })
  autoTable(doc, { head: [columns.map(c => c.label)], body: rows.map(row => columns.map(c => String(row[c.key] ?? ''))), startY: settings.exports?.includeBranding !== false ? 31 : 28, margin: { top: Number(marginSize) || 14, right: Number(marginSize) || 14, bottom: Number(marginSize) || 14, left: Number(marginSize) || 14 }, styles: { fontSize: 8, font: 'AtlasSans', halign: align }, headStyles: { halign: align }, bodyStyles: { halign: align } })
  doc.save(`${slug(title)}.pdf`)
}

export function ExportMenu({ rows, columns, title, settings, canExport = true, canPrint = true }) {
  const actionVisibility = settings?.interface?.actionVisibility || {}
  const configuredFormats = Array.isArray(settings?.exports?.formats) ? settings.exports.formats : ['csv', 'xlsx', 'json', 'pdf', 'print']
  const exportFormats = ['pdf', 'xlsx', 'csv', 'json'].filter(item => configuredFormats.includes(item))
  const allowExport = canExport && actionVisibility.export !== false && exportFormats.length > 0
  const allowPrint = canPrint && actionVisibility.print !== false && configuredFormats.includes('print')
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState((columns || []).map(column => column.key))
  const [format, setFormat] = useState('pdf')
  const selectedFormat = exportFormats.includes(format) ? format : (exportFormats[0] || 'pdf')
  const [orientation, setOrientation] = useState(settings?.exports?.pdf?.orientation || 'landscape')
  const [margin, setMargin] = useState(({ narrow: '10', standard: '14', wide: '20' })[settings?.exports?.pdf?.margins] || '14')
  useEffect(() => {
    setOrientation(settings?.exports?.pdf?.orientation === 'portrait' ? 'portrait' : 'landscape')
    setMargin(({ narrow: '10', standard: '14', wide: '20' })[settings?.exports?.pdf?.margins] || '14')
  }, [settings?.exports?.pdf?.orientation, settings?.exports?.pdf?.margins])
  const [fileTitle, setFileTitle] = useState(title)
  const [error, setError] = useState('')
  const activeColumns = (columns || []).filter(column => selected.includes(column.key))
  const sourceRows = Array.isArray(rows) ? rows : []
  const flatRows = sourceRows.map(row => Object.fromEntries(activeColumns.map(column => [column.key, readValue(row, column.key)])))
  if (!allowExport && !allowPrint) return null
  const audit = async action => {
    await api.post('/api/audit/export', { title: String(fileTitle || '').trim().slice(0, 200), format: action, rowCount: flatRows.length })
  }
  const doExport = async () => {
    setError('')
    try {
      await audit(selectedFormat)
      if (selectedFormat === 'csv') {
        const csvCell = value => {
          let text = String(value ?? '')
          if (/^[\t\r\n ]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`
          return `"${text.replaceAll('"', '""')}"`
        }
        const text = [activeColumns.map(column => csvCell(column.label)).join(','), ...flatRows.map(row => activeColumns.map(column => csvCell(row[column.key])).join(','))].join('\n')
        downloadBlob(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' }), `${slug(fileTitle)}.csv`)
      }
      if (selectedFormat === 'xlsx') downloadBlob(await makeXlsx(flatRows, activeColumns), `${slug(fileTitle)}.xlsx`)
      if (selectedFormat === 'json') downloadBlob(new Blob([JSON.stringify(flatRows, null, 2)], { type: 'application/json' }), `${slug(fileTitle)}.json`)
      if (selectedFormat === 'pdf') await exportPdf(flatRows, activeColumns, fileTitle, orientation, settings, margin)
      setOpen(false)
    } catch (exportError) {
      setError(exportError.message || 'Export failed.')
    }
  }
  const print = async () => {
    setError('')
    try {
      await audit('print')
      document.body.dataset.printTemplate = settings?.printTemplate || 'executive'
      const style = document.createElement('style')
      style.textContent = `@page{size:${orientation};margin:${margin}mm}`
      document.head.appendChild(style)
      window.print()
      setTimeout(() => { delete document.body.dataset.printTemplate; style.remove() }, 700)
      setOpen(false)
    } catch (printError) {
      setError(printError.message || 'Print preparation failed.')
    }
  }
  return <div className="export-wrap"><button className="secondary-button" onClick={() => { setError(''); setOpen(!open) }}><Icon name="external" size={15}/> Export / print</button>{open && <div className="export-panel"><div className="advanced-filter-head"><strong>Customize export</strong><button className="icon-button subtle" onClick={() => setOpen(false)}><Icon name="close" size={14}/></button></div><label className="tiny-label">Report title<input value={fileTitle} maxLength={200} onChange={event => setFileTitle(event.target.value)}/></label>{allowExport && <div className="column-checks">{(columns || []).map(column => <label key={column.key}><input type="checkbox" checked={selected.includes(column.key)} onChange={event => setSelected(current => event.target.checked ? [...current, column.key] : current.filter(key => key !== column.key))}/>{column.label}</label>)}</div>}{allowExport && <div className="print-options"><label>Format<select value={selectedFormat} onChange={event => setFormat(event.target.value)}>{exportFormats.map(item => <option key={item} value={item}>{item === 'xlsx' ? 'Excel' : item.toUpperCase()}</option>)}</select></label>{allowPrint && <><label>Orientation<select value={orientation} onChange={event => setOrientation(event.target.value)}><option>landscape</option><option>portrait</option></select></label><label>Margins<select value={margin} onChange={event => setMargin(event.target.value)}><option value="10">Narrow</option><option value="14">Standard</option><option value="20">Wide</option></select></label></>}<label>Rows<input value={flatRows.length} readOnly/></label></div>}{!allowExport && allowPrint && <div className="print-options"><label>Orientation<select value={orientation} onChange={event => setOrientation(event.target.value)}><option>landscape</option><option>portrait</option></select></label><label>Margins<select value={margin} onChange={event => setMargin(event.target.value)}><option value="10">Narrow</option><option value="14">Standard</option><option value="20">Wide</option></select></label><label>Rows<input value={flatRows.length} readOnly/></label></div>}{error && <div className="form-error"><Icon name="warning" size={14}/>{error}</div>}<div className="export-actions">{allowExport && <button className="secondary-button" onClick={doExport}>Export</button>}{allowPrint && <button className="primary-button" onClick={print}>Print</button>}</div></div>}</div>
}
