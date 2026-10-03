// The browser's side of exporting and printing. It never builds a file: it describes what the person wants (which dataset,
// which columns, which filters, which format) and the server builds the document from the database.
import { api, apiFetch } from './api'

export interface ExportColumn {
  key: string
  label: string
  type: string
  defaultVisible: boolean
  source?: string
}
export interface ExportDataset {
  id: string
  title: string
  description: string
  columns: ExportColumn[]
}
export interface ExportCatalog {
  formats: string[]
  templates: string[]
  defaults: { orientation: 'landscape' | 'portrait'; margin: number; template: string }
  datasets: ExportDataset[]
}
export interface Condition {
  join?: 'AND' | 'OR'
  field: string
  operator: string
  value: string
}
export interface ExportRequest {
  dataset: string
  format: 'csv' | 'xlsx' | 'json' | 'pdf' | 'print'
  columns?: string[]
  filters?: Condition[]
  /** Tasks: the list's own query string, so "filtered" means exactly what the list shows. */
  grid?: string
  /** Only these records (the ones selected on screen). */
  ids?: (string | number)[]
  q?: string
  scope?: Record<string, string | number | boolean>
  sort?: { key: string; dir?: string }
  title?: string
  language?: string
  orientation?: string
  margin?: number
  template?: string
  groupBy?: string
  preview?: boolean
}
export interface ExportPreview {
  title: string
  rows: number
  columns: { key: string; label: string; type: string }[]
  sample: Record<string, string>[]
  filters: string[]
}

const catalogs = new Map<string, { at: number; value: Promise<ExportCatalog> }>()
const CATALOG_TTL_MS = 30_000

/** What can be exported (and with which columns) by this person, in their language. Cached briefly. */
export function fetchExportCatalog(language: string): Promise<ExportCatalog> {
  const cached = catalogs.get(language)
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.value
  const value = api.get(`/api/exports/datasets?language=${encodeURIComponent(language)}`) as Promise<ExportCatalog>
  catalogs.set(language, { at: Date.now(), value })
  value.catch(() => catalogs.delete(language))
  return value
}
export const forgetExportCatalog = () => catalogs.clear()

/** How many rows an export would hold, and a few of them. Nothing is produced or recorded. */
export const previewExport = (request: ExportRequest): Promise<ExportPreview> =>
  api.post('/api/exports', { ...request, preview: true }) as Promise<ExportPreview>

export interface ExportedFile {
  blob: Blob
  filename: string
  rows: number
  /** The PDF had to use a font without Arabic, Persian or Hebrew glyphs. */
  basicFont: boolean
}

/** Ask the server for a file. Rejects with the server's own explanation (not allowed, too many rows, …). */
export async function requestExport(request: ExportRequest): Promise<ExportedFile> {
  const res = await apiFetch('/api/exports', { method: 'POST', body: JSON.stringify(request) })
  let filename = 'atlas-export'
  try {
    filename = decodeURIComponent(res.headers.get('X-Atlas-Filename') || filename)
  } catch {
    /* keep the fallback */
  }
  return {
    blob: await res.blob(),
    filename,
    rows: Number(res.headers.get('X-Atlas-Rows') || 0),
    basicFont: res.headers.get('X-Atlas-Basic-Font') === '1'
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 700)
}
