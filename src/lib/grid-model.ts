// The rules of a data grid, without a screen: how a click on a header changes the sort (one column, or several), which columns
// are shown and in what order and width, what a saved view contains, and (for lists that live in the browser) how rows are
// filtered, sorted and paged. Lists that live in the database send the same description to the server instead.
import { type Condition, applyAdvancedFilters } from './filters'

// ---- sorting -----------------------------------------------------------------------------------------------------------
export interface SortSpec {
  key: string
  dir: 'asc' | 'desc'
}
export const MAX_SORTS = 4

const flip = (dir: SortSpec['dir']): SortSpec['dir'] => (dir === 'asc' ? 'desc' : 'asc')

/**
 * A click on a column header. Alone it makes that column the only sort (and turns it around if it already was); with Shift it
 * adds the column as a further sort, or turns it around if it is already one of them. Earlier columns win, later ones break ties.
 */
export function cycleSort(sorts: SortSpec[], key: string, additive = false): SortSpec[] {
  const index = sorts.findIndex(sort => sort.key === key)
  if (additive) {
    if (index >= 0) return sorts.map((sort, i) => (i === index ? { ...sort, dir: flip(sort.dir) } : sort))
    return sorts.length >= MAX_SORTS ? sorts : [...sorts, { key, dir: 'asc' }]
  }
  if (sorts.length === 1 && index === 0) return [{ key, dir: flip(sorts[0].dir) }]
  return [{ key, dir: 'asc' }]
}

export const removeSort = (sorts: SortSpec[], key: string): SortSpec[] => sorts.filter(sort => sort.key !== key)

/** Where a column stands in the sort: its position (1 = the main one) and direction, or null. */
export function sortPosition(sorts: SortSpec[], key: string): { position: number; dir: SortSpec['dir'] } | null {
  const index = sorts.findIndex(sort => sort.key === key)
  return index < 0 ? null : { position: index + 1, dir: sorts[index].dir }
}

/** A sort as a query-string value: `priority:desc,due:asc`. */
export const sortParam = (sorts: SortSpec[]) => sorts.map(sort => `${sort.key}:${sort.dir}`).join(',')

// ---- columns ----------------------------------------------------------------------------------------------------------
export interface ColumnDef {
  key: string
  label: string
  width?: number
  minWidth?: number
  /** Always shown and in place (the identifying column). */
  fixed?: boolean
  /** Hidden until the person turns it on. */
  defaultHidden?: boolean
}
export interface ColumnState {
  order: string[]
  hidden: string[]
  widths: Record<string, number>
}
export const MIN_COLUMN_WIDTH = 64
export const MAX_COLUMN_WIDTH = 640

export const defaultColumns = (defs: ColumnDef[]): ColumnState => ({
  order: defs.map(def => def.key),
  hidden: defs.filter(def => def.defaultHidden && !def.fixed).map(def => def.key),
  widths: {}
})

/** Make a stored column layout fit the columns that exist now: unknown ones are dropped, new ones appear at the end. */
export function reconcileColumns(state: Partial<ColumnState> | undefined, defs: ColumnDef[]): ColumnState {
  const known = new Set(defs.map(def => def.key))
  const fallback = defaultColumns(defs)
  if (!state || typeof state !== 'object') return fallback
  const stored = Array.isArray(state.order) ? state.order.filter(key => known.has(key)) : []
  const order = [...new Set([...stored, ...defs.map(def => def.key)])]
  const fixed = new Set(defs.filter(def => def.fixed).map(def => def.key))
  const hidden = Array.isArray(state.hidden)
    ? state.hidden.filter(key => known.has(key) && !fixed.has(key))
    : fallback.hidden
  const widths: Record<string, number> = {}
  for (const [key, value] of Object.entries(state.widths || {}))
    if (known.has(key) && Number.isFinite(value)) widths[key] = clampWidth(Number(value))
  return { order, hidden, widths }
}

export const clampWidth = (width: number, min = MIN_COLUMN_WIDTH) =>
  Math.max(min, Math.min(MAX_COLUMN_WIDTH, Math.round(width)))

/** The columns to draw, in the person's order, without the ones they hid. */
export function visibleColumns<T extends ColumnDef>(defs: T[], state: ColumnState): T[] {
  const byKey = new Map(defs.map(def => [def.key, def]))
  const hidden = new Set(state.hidden)
  return state.order
    .map(key => byKey.get(key))
    .filter((def): def is T => Boolean(def) && (!hidden.has(def!.key) || Boolean(def!.fixed)))
}

/** Move a column one place earlier or later among the columns that can move (the fixed ones stay put). */
export function moveColumn(state: ColumnState, key: string, delta: -1 | 1, defs: ColumnDef[]): ColumnState {
  const fixed = new Set(defs.filter(def => def.fixed).map(def => def.key))
  if (fixed.has(key)) return state
  const movable = state.order.filter(k => !fixed.has(k))
  const at = movable.indexOf(key)
  const to = at + delta
  if (at < 0 || to < 0 || to >= movable.length) return state
  const next = [...movable]
  ;[next[at], next[to]] = [next[to], next[at]]
  let cursor = 0
  return { ...state, order: state.order.map(k => (fixed.has(k) ? k : next[cursor++])) }
}

/** Show or hide a column. At least one column that can be hidden stays visible, so a table is never empty. */
export function toggleColumn(state: ColumnState, key: string, defs: ColumnDef[]): ColumnState {
  const def = defs.find(d => d.key === key)
  if (!def || def.fixed) return state
  if (state.hidden.includes(key)) return { ...state, hidden: state.hidden.filter(k => k !== key) }
  const stillShown = defs.filter(d => !d.fixed && d.key !== key && !state.hidden.includes(d.key))
  return stillShown.length ? { ...state, hidden: [...state.hidden, key] } : state
}

export function resizeColumn(state: ColumnState, key: string, width: number, defs: ColumnDef[]): ColumnState {
  const def = defs.find(d => d.key === key)
  if (!def) return state
  return { ...state, widths: { ...state.widths, [key]: clampWidth(width, def.minWidth ?? MIN_COLUMN_WIDTH) } }
}

// ---- what a saved view holds ------------------------------------------------------------------------------------------
/** The value of one column filter: text, a set of chosen options, or a from/to range. */
export type FilterValue = string | string[] | { from?: string; to?: string }
export type ColumnFilters = Record<string, FilterValue>

export interface GridConfig {
  columns: ColumnState
  sort: SortSpec[]
  columnFilters: ColumnFilters
  conditions: Condition[]
  q: string
  pageSize: number
}

export const PAGE_SIZES = [10, 25, 50, 100, 200]

export const isEmptyFilter = (value: FilterValue | undefined): boolean =>
  value === undefined ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && !Array.isArray(value) && !value.from && !value.to)

export const activeColumnFilters = (filters: ColumnFilters): ColumnFilters =>
  Object.fromEntries(Object.entries(filters).filter(([, value]) => !isEmptyFilter(value)))

/** Read a stored view or layout defensively: whatever is wrong with it (an old version, a hand edit), the grid still opens. */
export function parseConfig(
  raw: unknown,
  defs: ColumnDef[],
  fallback: GridConfig,
  /** Filters that are not a column (the project page's Open / Done / Overdue state) but belong in a saved view. */
  extraFilterKeys: string[] = []
): GridConfig {
  if (!raw || typeof raw !== 'object') return fallback
  const value = raw as Record<string, any>
  const known = new Set(defs.map(def => def.key))
  const filterKeys = new Set([...known, ...extraFilterKeys])
  const sort: SortSpec[] = Array.isArray(value.sort)
    ? value.sort
        .filter((s: any) => s && known.has(String(s.key)) && (s.dir === 'asc' || s.dir === 'desc'))
        .map((s: any) => ({ key: String(s.key), dir: s.dir }))
        .slice(0, MAX_SORTS)
    : []
  const columnFilters: ColumnFilters = {}
  if (value.columnFilters && typeof value.columnFilters === 'object')
    for (const [key, filter] of Object.entries<any>(value.columnFilters))
      if (filterKeys.has(key) && !isEmptyFilter(filter)) columnFilters[key] = filter
  const conditions: Condition[] = Array.isArray(value.conditions)
    ? value.conditions
        .filter((c: any) => c && typeof c.field === 'string' && typeof c.operator === 'string')
        .map((c: any) => ({
          join: c.join === 'OR' ? ('OR' as const) : ('AND' as const),
          field: c.field,
          operator: c.operator,
          value: String(c.value ?? '')
        }))
        .slice(0, 20)
    : []
  return {
    columns: reconcileColumns(value.columns, defs),
    sort: sort.length ? sort : fallback.sort,
    columnFilters,
    conditions,
    q: typeof value.q === 'string' ? value.q.slice(0, 200) : '',
    pageSize: PAGE_SIZES.includes(Number(value.pageSize)) ? Number(value.pageSize) : fallback.pageSize
  }
}

// ---- lists that live in the browser -----------------------------------------------------------------------------------
export interface LocalColumn<Row> extends ColumnDef {
  /** The value to sort and filter by (text, number, or empty). */
  value?: (row: Row) => string | number | boolean | null | undefined
  filter?: 'text' | 'select' | 'dateRange' | 'number' | 'boolean'
  sortable?: boolean
}

const asText = (value: unknown) => (value === null || value === undefined ? '' : String(value))

export function matchesColumnFilter(
  value: unknown,
  filter: FilterValue,
  kind: LocalColumn<unknown>['filter']
): boolean {
  if (isEmptyFilter(filter)) return true
  const text = asText(value)
  if (kind === 'select')
    return (Array.isArray(filter) ? filter : [String(filter)]).some(
      option => option.toLowerCase() === text.toLowerCase()
    )
  if (kind === 'boolean') return String(filter) === String(value === true || text === 'true' || text === '1')
  if (kind === 'dateRange') {
    const range = filter as { from?: string; to?: string }
    const day = text.slice(0, 10)
    if (!day) return false
    return (!range.from || day >= range.from) && (!range.to || day <= range.to)
  }
  if (kind === 'number') {
    const range = filter as { from?: string; to?: string }
    const number = Number(value)
    if (value === '' || value === null || value === undefined || Number.isNaN(number)) return false
    return (
      (range.from === undefined || range.from === '' || number >= Number(range.from)) &&
      (range.to === undefined || range.to === '' || number <= Number(range.to))
    )
  }
  return text.toLowerCase().includes(String(filter).trim().toLowerCase())
}

export interface LocalQuery<Row> {
  q: string
  columnFilters: ColumnFilters
  conditions: Condition[]
  /** Text the global search looks in (defaults to every column's value). */
  searchText?: (row: Row) => string
}

/** Global search AND every column filter AND the advanced filter: each one narrows the result further. */
export function filterLocal<Row>(rows: Row[], columns: LocalColumn<Row>[], query: LocalQuery<Row>): Row[] {
  const needle = query.q.trim().toLowerCase()
  const filters = Object.entries(activeColumnFilters(query.columnFilters))
    .map(([key, filter]) => ({ column: columns.find(c => c.key === key), filter }))
    .filter((entry): entry is { column: LocalColumn<Row>; filter: FilterValue } => Boolean(entry.column?.value))
  const text = query.searchText || ((row: Row) => columns.map(column => asText(column.value?.(row))).join(' '))
  const kept = rows.filter(
    row =>
      (!needle || text(row).toLowerCase().includes(needle)) &&
      filters.every(({ column, filter }) => matchesColumnFilter(column.value!(row), filter, column.filter))
  )
  return query.conditions.length ? applyAdvancedFilters(kept, query.conditions) : kept
}

const compareValues = (a: unknown, b: unknown): number => {
  const empty = (value: unknown) => value === null || value === undefined || value === ''
  if (empty(a) || empty(b)) return Number(empty(a)) - Number(empty(b)) // empty values always last
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
}

/** Sort by several columns: the first decides, the next ones break ties, and rows that tie on all keep their order. */
export function sortLocal<Row>(rows: Row[], columns: LocalColumn<Row>[], sorts: SortSpec[]): Row[] {
  const keys = sorts
    .map(sort => ({ column: columns.find(c => c.key === sort.key), sign: sort.dir === 'desc' ? -1 : 1 }))
    .filter((entry): entry is { column: LocalColumn<Row>; sign: number } => Boolean(entry.column?.value))
  if (!keys.length) return rows
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const { column, sign } of keys) {
        const av = column.value!(a.row)
        const bv = column.value!(b.row)
        const empty = (v: unknown) => v === null || v === undefined || v === ''
        // empty values stay last whichever way the column is sorted
        const order = empty(av) || empty(bv) ? compareValues(av, bv) : compareValues(av, bv) * sign
        if (order) return order
      }
      return a.index - b.index
    })
    .map(entry => entry.row)
}

export interface Paged<Row> {
  rows: Row[]
  total: number
  page: number
  pages: number
  pageSize: number
}
export function paginate<Row>(rows: Row[], page: number, pageSize: number): Paged<Row> {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(Math.max(1, page), pages)
  return {
    rows: rows.slice((current - 1) * pageSize, current * pageSize),
    total: rows.length,
    page: current,
    pages,
    pageSize
  }
}
