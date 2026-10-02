// The export document model: what a report *is*, independent of how it is drawn. Datasets (services/exports) build one of
// these from database fields; each format (CSV, JSON, XLSX, PDF, print HTML) turns it into bytes. Nothing here knows about
// screens, so printing and exporting can never depend on what the interface happens to show.

/** How a column's values are typed (drives number/date handling and cell styling in every format). */
export type ColumnType =
  'text' | 'longtext' | 'integer' | 'number' | 'percent' | 'date' | 'datetime' | 'boolean' | 'status' | 'priority'

export interface Column {
  key: string
  label: string
  type: ColumnType
  /** The database field this column reads, for the documentation and the JSON export (e.g. `v_task_rows.due_date`). */
  source?: string
  /** Suggested width in characters (spreadsheet and PDF). */
  width?: number
  align?: 'start' | 'center' | 'end'
  /** Shown when the person has not chosen columns. */
  defaultVisible?: boolean
  /** Exists so filters and sorting can use it (as on the screen), but is not offered as an export column. */
  filterOnly?: boolean
}

export type Cell = string | number | boolean | null
export type Row = Record<string, Cell>

/** A semantic colour for a value; each format maps it to its own palette. */
export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'muted'

export interface TableSection {
  kind: 'table'
  id: string
  title?: string
  note?: string
  columns: Column[]
  rows: Row[]
  /** Per-row tones by column key (a status cell can be green, an overdue date red). */
  tones?: Record<string, Partial<Record<string, Tone>>>
  /** A final row of totals, keyed like the rows. */
  totals?: Row
  /** Rows are drawn in groups under a heading taken from this column. */
  groupBy?: string
  /** The table a single-table format (CSV) exports when the document holds several. */
  primary?: boolean
}

export interface SummarySection {
  kind: 'summary'
  title?: string
  items: { label: string; value: string | number; hint?: string; tone?: Tone }[]
}

/** A labelled horizontal bar per value (for example tasks per status). */
export interface BarsSection {
  kind: 'bars'
  title?: string
  items: { label: string; value: number; tone?: Tone }[]
}

export type Section = TableSection | SummarySection | BarsSection

export interface ExportDocument {
  id: string
  title: string
  subtitle?: string
  workspace: string
  generatedAt: string
  generatedBy: string
  language: string
  direction: 'ltr' | 'rtl'
  /** Human-readable lines describing what was filtered, printed under the title. */
  filters: string[]
  /** The administrator's own footer line (Settings > Reports); the formats print it instead of the default. */
  footerText?: string
  sections: Section[]
  /** Fixed words the formats print (translated by the service, so formats never translate). */
  words: DocumentWords
}

export interface DocumentWords {
  generated: string
  by: string
  page: string
  of: string
  filters: string
  rows: string
  total: string
  summary: string
  yes: string
  no: string
  empty: string
  /** Translate a stored value that is also an interface phrase (a status such as "To do", a priority such as "High"). */
  translate: (phrase: string) => string
}

export interface RenderOptions {
  orientation: 'landscape' | 'portrait'
  /** Page margin in millimetres. */
  margin: number
  /** The report template from Settings > Reports: `executive` (roomy, branded), `standard` (balanced) or `compact` (dense). */
  template: 'executive' | 'standard' | 'compact'
  branding: boolean
  /** Font files for the PDF (the service reads them once); absent means the built-in Latin font. */
  fonts?: { regular: Uint8Array; bold: Uint8Array } | null
}

export interface Rendered {
  body: Uint8Array | string
  mime: string
  extension: string
  /** True when a PDF had to fall back to a font without Arabic, Persian or Hebrew glyphs. */
  basicFont?: boolean
}

export const tableSections = (doc: ExportDocument): TableSection[] =>
  doc.sections.filter((s): s is TableSection => s.kind === 'table')
export const rowCount = (doc: ExportDocument): number =>
  tableSections(doc).reduce((sum, section) => sum + section.rows.length, 0)
