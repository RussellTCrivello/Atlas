// The export and print panel. It asks the server for a document built from the database; it never builds one from the screen.
// What it sends is a description: the dataset, the columns, the filters the person set, the format. What the server returns is
// the file (or, for print, the page shown in the preview).
import { useEffect, useMemo, useState } from 'react'
import { errorMessage } from '../../lib/api'
import {
  type Condition,
  type ExportCatalog,
  type ExportPreview,
  type ExportRequest,
  downloadBlob,
  fetchExportCatalog,
  previewExport,
  requestExport
} from '../../lib/export'
import { isActive } from '../../lib/filters'
import { uiLanguage } from '../../lib/i18n'
import { hasPermission } from '../../lib/settings'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { openPrintPreview, registerPrinter } from './print'

interface Props {
  /** Which dataset to export (see GET /api/exports/datasets). */
  dataset: string
  title: string
  /** Narrowing the page applied that is not a filter condition (a project, a period, "assigned to me"…). */
  scope?: Record<string, string | number | boolean>
  /** The advanced-filter conditions the person built. */
  filters?: Condition[]
  /** The text in the page's search box. */
  query?: string
  sort?: { key: string; dir?: string }
  /** What the page thinks the row count is; shown until the server has counted. */
  rowsHint?: number
  /** This export is what Ctrl/Cmd+P prints on this page. */
  primary?: boolean
  /** The text of the button that opens the panel. */
  label?: string
}

const FILE_FORMATS = ['pdf', 'xlsx', 'csv', 'json']

export function ExportMenu({ dataset, title, scope, filters, query, sort, rowsHint, primary = true, label }: Props) {
  const { user, notify, settings } = useApp()
  const language = uiLanguage(settings)
  const allowed = hasPermission(user, 'exportData') && settings?.interface?.actionVisibility?.export !== false
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<ExportCatalog | null>(null)
  const [selected, setSelected] = useState<string[] | null>(null)
  const [format, setFormat] = useState('')
  const [orientation, setOrientation] = useState('landscape')
  const [margin, setMargin] = useState('14')
  const [template, setTemplate] = useState('executive')
  const [fileTitle, setFileTitle] = useState(title)
  const [groupBy, setGroupBy] = useState('')
  const [preview, setPreview] = useState<ExportPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [busy, setBusy] = useState(false)

  const entry = catalog?.datasets.find(item => item.id === dataset)
  const columns = entry?.columns ?? []
  const chosen = selected ?? columns.filter(column => column.defaultVisible).map(column => column.key)
  const activeFilters = useMemo(() => (filters || []).filter(isActive), [filters])
  const scopeKey = JSON.stringify(scope || {})

  // What the server needs to know to build the document (everything except the format).
  const description = useMemo(
    (): Omit<ExportRequest, 'format'> => ({
      dataset,
      columns: chosen,
      filters: activeFilters,
      q: query?.trim() || undefined,
      scope: scope && Object.keys(scope).length ? scope : undefined,
      sort,
      title: fileTitle,
      language,
      orientation,
      margin: Number(margin),
      template,
      groupBy: groupBy || undefined
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      dataset,
      chosen.join('|'),
      JSON.stringify(activeFilters),
      query,
      scopeKey,
      JSON.stringify(sort),
      fileTitle,
      language,
      orientation,
      margin,
      template,
      groupBy
    ]
  )

  // Load what can be exported the first time the panel opens.
  useEffect(() => {
    if (!allowed || !open || catalog) return
    let alive = true
    fetchExportCatalog(language)
      .then(next => {
        if (!alive) return
        setCatalog(next)
        setFormat(current => current || next.formats.find(item => FILE_FORMATS.includes(item)) || '')
        setOrientation(next.defaults.orientation)
        setMargin(String(next.defaults.margin))
        setTemplate(next.defaults.template)
      })
      .catch(error => alive && setPreviewError(errorMessage(error)))
    return () => {
      alive = false
    }
  }, [allowed, open, catalog, language])

  // Count the rows (and show a few) as the person changes columns and filters. Nothing is produced or recorded.
  useEffect(() => {
    if (!allowed || !open || !entry) return
    if (!chosen.length) {
      setPreview(null)
      setPreviewError('Choose at least one column')
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      previewExport({ ...description, format: 'csv' })
        .then(result => {
          if (!alive) return
          setPreview(result)
          setPreviewError('')
        })
        .catch(error => alive && setPreviewError(errorMessage(error)))
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [allowed, open, entry, description])

  const guarded = async (action: () => Promise<void>) => {
    if (!chosen.length) {
      notify({ title: 'Choose at least one column', tone: 'warning' })
      return
    }
    setBusy(true)
    try {
      await action()
    } catch (error) {
      notify({ title: 'Export failed', body: errorMessage(error), tone: 'warning' })
    } finally {
      setBusy(false)
    }
  }
  const doExport = () =>
    guarded(async () => {
      const file = await requestExport({ ...description, format: format as ExportRequest['format'] })
      downloadBlob(file.blob, file.filename)
      if (file.basicFont)
        notify({
          title: 'PDF created with a basic font',
          body: 'The Unicode font could not be loaded, so Arabic, Persian and Hebrew text may not display correctly. Try again or export to XLSX.',
          tone: 'warning'
        })
    })
  const print = () => guarded(() => openPrintPreview(description))

  // Ctrl/Cmd+P and File > Print print this page's main export, through the server, never the screen.
  useEffect(() => {
    if (!allowed || !primary || !(catalog ? catalog.formats.includes('print') : true)) return
    return registerPrinter(async () => {
      try {
        const base = (await fetchExportCatalog(language)).datasets.find(item => item.id === dataset)
        if (!base) throw new Error('This page has nothing to print for your role.')
        await openPrintPreview({
          ...description,
          columns: description.columns?.length
            ? description.columns
            : base.columns.filter(c => c.defaultVisible).map(c => c.key)
        })
      } catch (error) {
        notify({ title: 'Could not print', body: errorMessage(error), tone: 'warning' })
      }
    })
  }, [allowed, primary, catalog, language, dataset, description, notify])

  if (!allowed) return null
  const formats = (catalog?.formats ?? []).filter(item => FILE_FORMATS.includes(item))
  const canPrint = Boolean(catalog?.formats.includes('print')) && settings?.interface?.actionVisibility?.print !== false
  const groupable = columns.filter(
    column => ['status', 'priority', 'text'].includes(column.type) && chosen.includes(column.key)
  )
  const sample = preview?.sample ?? []
  const shownColumns = (preview?.columns ?? []).slice(0, 5)
  return (
    <div className="export-wrap">
      <button
        type="button"
        className="secondary-button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <Icon name="external" size={15} /> {label || 'Export / print'}
      </button>
      {open && (
        <div className="export-panel" role="group" aria-label="Customize export">
          <div className="advanced-filter-head">
            <strong>Customize export</strong>
            <button
              type="button"
              className="icon-button subtle"
              aria-label="Close export panel"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          <label className="tiny-label">
            Report title
            <input value={fileTitle} onChange={event => setFileTitle(event.target.value)} />
          </label>
          <div className="column-checks">
            {columns.map(column => (
              <label key={column.key} title={column.source ? `Database field: ${column.source}` : undefined}>
                <input
                  type="checkbox"
                  checked={chosen.includes(column.key)}
                  onChange={event =>
                    setSelected(
                      event.target.checked
                        ? columns.filter(c => c.key === column.key || chosen.includes(c.key)).map(c => c.key)
                        : chosen.filter(key => key !== column.key)
                    )
                  }
                />
                {column.label}
              </label>
            ))}
            {!catalog && !previewError && <span className="filter-hint">Loading…</span>}
          </div>
          <div className="print-options">
            <label>
              Format
              <select value={format} onChange={event => setFormat(event.target.value)}>
                {formats.includes('pdf') && <option value="pdf">PDF</option>}
                {formats.includes('xlsx') && <option value="xlsx">Excel</option>}
                {formats.includes('csv') && <option value="csv">CSV</option>}
                {formats.includes('json') && <option value="json">JSON</option>}
              </select>
            </label>
            <label>
              Orientation
              <select value={orientation} onChange={event => setOrientation(event.target.value)}>
                <option>landscape</option>
                <option>portrait</option>
              </select>
            </label>
            <label>
              Margins
              <select value={margin} onChange={event => setMargin(event.target.value)}>
                <option value="10">Narrow</option>
                <option value="14">Standard</option>
                <option value="20">Wide</option>
              </select>
            </label>
            <label>
              Layout
              <select value={template} onChange={event => setTemplate(event.target.value)}>
                {(catalog?.templates ?? ['executive']).map(item => (
                  <option key={item} value={item}>
                    {item.charAt(0).toUpperCase() + item.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            {groupable.length > 0 && (
              <label>
                Group rows by
                <select value={groupBy} onChange={event => setGroupBy(event.target.value)}>
                  <option value="">None</option>
                  {groupable.map(column => (
                    <option key={column.key} value={column.key}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Rows
              <input value={preview ? preview.rows : (rowsHint ?? '')} readOnly />
            </label>
          </div>
          {preview?.filters.length ? <p className="filter-hint">Filtered by: {preview.filters.join(' · ')}</p> : null}
          {sample.length > 0 && (
            <div className="export-preview" aria-label="Sample of the rows that will be exported">
              <table>
                <thead>
                  <tr>
                    {shownColumns.map(column => (
                      <th key={column.key} scope="col">
                        {column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sample.slice(0, 3).map((row, index) => (
                    <tr key={index}>
                      {shownColumns.map(column => (
                        <td key={column.key}>{row[column.key]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {previewError && (
            <p className="filter-hint" role="alert">
              {previewError}
            </p>
          )}
          <p className="filter-hint">
            Exports contain every row that matches your filters, read straight from the database, not only the rows on
            screen.
          </p>
          <div className="export-actions">
            {formats.length > 0 && (
              <button type="button" className="secondary-button" disabled={busy || !format} onClick={doExport}>
                Export
              </button>
            )}
            {canPrint && (
              <button type="button" className="primary-button" disabled={busy} onClick={print}>
                Print
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
