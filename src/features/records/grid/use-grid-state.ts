// The state of one data grid: what is searched, filtered and sorted, which columns are shown and how wide, how many rows a page
// holds, and which page. The layout (columns, sort, page size) is remembered per person and screen; filters and search are not,
// because coming back to a list that is still filtered by last week's search looks like missing data.
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Condition } from '../../../lib/filters'
import {
  type ColumnDef,
  type ColumnFilters,
  type ColumnState,
  type FilterValue,
  type GridConfig,
  type SortSpec,
  PAGE_SIZES,
  activeColumnFilters,
  cycleSort,
  defaultColumns,
  isEmptyFilter,
  moveColumn,
  parseConfig,
  reconcileColumns,
  removeSort,
  resizeColumn,
  toggleColumn
} from '../../../lib/grid-model'

export interface GridStateOptions {
  /** The screen this grid belongs to (also the key of its saved views): `project-tasks`, `my-work`, `projects`… */
  scope: string
  userId: string
  defs: ColumnDef[]
  defaultSort: SortSpec[]
  defaultPageSize: number
  /** Filters that are not a column (see parseConfig). */
  virtualFilters?: string[]
}

const storageKey = (userId: string, scope: string) => `atlas-grid-${userId || 'anonymous'}-${scope}`

function readLayout(key: string, defs: ColumnDef[], fallback: GridConfig): GridConfig {
  try {
    const raw = localStorage.getItem(key)
    return raw ? parseConfig(JSON.parse(raw), defs, fallback) : fallback
  } catch {
    return fallback
  }
}

const nearestPageSize = (size: number) =>
  PAGE_SIZES.reduce((best, option) => (Math.abs(option - size) < Math.abs(best - size) ? option : best), PAGE_SIZES[0])

export function useGridState({
  scope,
  userId,
  defs,
  defaultSort,
  defaultPageSize,
  virtualFilters = []
}: GridStateOptions) {
  const key = storageKey(userId, scope)
  const fallback = useMemo<GridConfig>(
    () => ({
      columns: defaultColumns(defs),
      sort: defaultSort,
      columnFilters: {},
      conditions: [],
      q: '',
      pageSize: nearestPageSize(defaultPageSize)
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, defs.map(def => def.key).join('|')]
  )
  const [config, setConfig] = useState<GridConfig>(() => ({
    ...readLayout(key, defs, fallback),
    columnFilters: {},
    conditions: [],
    q: ''
  }))
  const [page, setPage] = useState(1)
  const [activeView, setActiveView] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)
  const configRef = useRef(config)
  configRef.current = config

  const persist = (next: GridConfig) => {
    try {
      localStorage.setItem(key, JSON.stringify({ columns: next.columns, sort: next.sort, pageSize: next.pageSize }))
    } catch {
      /* storage unavailable: the layout still applies for this session */
    }
  }
  /** Change the grid; any change to what is shown goes back to page 1 and is no longer "the saved view" as it was. */
  const update = useCallback(
    (patch: Partial<GridConfig>, options: { keepPage?: boolean; keepView?: boolean } = {}) => {
      const next = { ...configRef.current, ...patch }
      configRef.current = next
      setConfig(next)
      if ('columns' in patch || 'sort' in patch || 'pageSize' in patch) persist(next)
      if (!options.keepPage) setPage(1)
      if (!options.keepView) setActiveView('')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [key]
  )

  const columnFilters = config.columnFilters
  const activeFilters = activeColumnFilters(columnFilters)
  const filterCount = Object.keys(activeFilters).length + (config.q.trim() ? 1 : 0) + config.conditions.length

  return {
    config,
    page,
    setPage,
    showFilters,
    setShowFilters,
    activeView,
    /** Number of things narrowing the list: search, column filters, advanced conditions. */
    filterCount,
    hasFilters: filterCount > 0,
    sortBy: (column: string, additive = false) =>
      update({ sort: cycleSort(configRef.current.sort, column, additive) }, { keepView: false }),
    dropSort: (column: string) =>
      update({
        sort: removeSort(configRef.current.sort, column).length
          ? removeSort(configRef.current.sort, column)
          : defaultSort
      }),
    setQuery: (q: string) => update({ q }),
    setColumnFilter: (column: string, value: FilterValue) => {
      const next: ColumnFilters = { ...configRef.current.columnFilters }
      if (isEmptyFilter(value)) delete next[column]
      else next[column] = value
      update({ columnFilters: next })
    },
    setConditions: (conditions: Condition[]) => update({ conditions }),
    clearFilters: () => update({ q: '', columnFilters: {}, conditions: [] }),
    setPageSize: (pageSize: number) => update({ pageSize }),
    setColumns: (columns: ColumnState) => update({ columns }, { keepPage: true }),
    move: (column: string, delta: -1 | 1) =>
      update({ columns: moveColumn(configRef.current.columns, column, delta, defs) }, { keepPage: true }),
    toggle: (column: string) =>
      update({ columns: toggleColumn(configRef.current.columns, column, defs) }, { keepPage: true }),
    resize: (column: string, width: number) =>
      update({ columns: resizeColumn(configRef.current.columns, column, width, defs) }, { keepPage: true }),
    resetWidths: (column: string) => {
      const widths = { ...configRef.current.columns.widths }
      delete widths[column]
      update({ columns: { ...configRef.current.columns, widths } }, { keepPage: true })
    },
    /** Back to how the screen first looks: default columns, sort and page size, nothing filtered, no view selected. */
    reset: () => {
      try {
        localStorage.removeItem(key)
      } catch {
        /* nothing stored */
      }
      configRef.current = fallback
      setConfig(fallback)
      setPage(1)
      setActiveView('')
    },
    /** Make the grid look like a saved view. Anything missing or outdated in it falls back to the defaults. */
    applyView: (viewId: string, raw: unknown) => {
      const next = parseConfig(raw, defs, fallback, virtualFilters)
      configRef.current = { ...next, columns: reconcileColumns(next.columns, defs) }
      setConfig(configRef.current)
      persist(configRef.current)
      setPage(1)
      setActiveView(viewId)
    },
    /** What a saved view should store right now. */
    snapshot: (): GridConfig => configRef.current,
    isDefaultLayout:
      JSON.stringify({ c: config.columns, s: config.sort, p: config.pageSize }) ===
      JSON.stringify({ c: fallback.columns, s: fallback.sort, p: fallback.pageSize })
  }
}

export type GridState = ReturnType<typeof useGridState>
