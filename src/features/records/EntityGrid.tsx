// A table for lists the browser already holds (projects, people, alerts): the same selection, sorting by several columns, search,
// per-column and advanced filters, column choices, saved views, paging, keyboard use and export of the selected, filtered or whole
// list as the task grid has. What differs is only where the rows come from: here they are filtered and sorted in the browser.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { type BulkResult } from '../../lib/bulk'
import {
  type ColumnDef,
  type LocalColumn,
  filterLocal,
  paginate,
  sortLocal,
  visibleColumns,
  type SortSpec
} from '../../lib/grid-model'
import { tr } from '../../lib/i18n'
import * as selection from '../../lib/selection'
import { useApp } from '../../ui/app-context'
import { ExportMenu } from '../export/ExportMenu'
import { BulkDialog, type BulkSpec } from './BulkDialog'
import { GridEmpty } from './grid/GridStates'
import { type GridColumn, GridTable } from './grid/GridTable'
import { GridToolbar } from './grid/GridToolbar'
import { Pager } from './grid/Pager'
import { type BarAction, SelectionBar } from './grid/SelectionBar'
import { useGridState } from './grid/use-grid-state'

export type EntityColumn<Row> = GridColumn<Row> & LocalColumn<Row>

/** What the page tells the grid about a kind of record: its columns, and what can be done with one or many of them. */
export interface EntityKind<Row> {
  /** The screen (and the key of its saved views): `projects`, `people`, `alerts`. */
  scope: string
  /** Plural, as shown ("projects"). */
  noun: string
  defs: ColumnDef[]
  columns: (t: (phrase: string, values?: Record<string, unknown>) => string) => EntityColumn<Row>[]
  rowId: (row: Row) => string | number
  rowLabel: (row: Row) => string
  filterFields: { key: string; label: string; type?: string }[]
  defaultSort: SortSpec[]
  /** The export dataset these rows come from. */
  dataset: string
  exportTitle: string
  searchLabel: string
}

export interface EntityActions<Row> {
  onOpen?: (row: Row) => void
  onEdit?: (row: Row) => void
  /** Delete pressed on the grid: the selection (or the focused row) as records. */
  onDelete?: (rows: Row[]) => void
  /** Buttons for the bar, given what is selected right now. */
  bar: (selected: Row[], tools: { bulk: (spec: BulkSpec) => void; clear: () => void }) => BarAction[]
  rowActions?: (row: Row) => ReactNode
  onAdd?: () => void
  addLabel?: string
  /** Run after a bulk action: reload the data behind the grid. */
  afterBulk: (result: BulkResult) => void
}

interface Props<Row> {
  kind: EntityKind<Row>
  rows: Row[]
  actions: EntityActions<Row>
  /** Extra export scope for "Entire dataset" (nothing by default). */
  fullScope?: Record<string, string | number | boolean>
  highlight?: string | number | null
}

export function EntityGrid<Row>({ kind, rows, actions, fullScope, highlight }: Props<Row>) {
  const { user, settings } = useApp()
  const t = useCallback((phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values), [settings])
  const grid = useGridState({
    scope: kind.scope,
    userId: user?.id || '',
    defs: kind.defs,
    defaultSort: kind.defaultSort,
    defaultPageSize: Number(settings.pageSize) || 50
  })
  const columns = useMemo(() => kind.columns(t), [kind, t])
  const [picked, setPicked] = useState(selection.EMPTY_SELECTION)
  const [bulk, setBulk] = useState<BulkSpec | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // The list, as the person sees it: searched, filtered, sorted, then cut into pages.
  const found = useMemo(
    () =>
      sortLocal(
        filterLocal(rows, columns, {
          q: grid.config.q,
          columnFilters: grid.config.columnFilters,
          conditions: grid.config.conditions
        }),
        columns,
        grid.config.sort
      ),
    [rows, columns, grid.config.q, grid.config.columnFilters, grid.config.conditions, grid.config.sort]
  )
  const paged = paginate(found, grid.page, grid.config.pageSize)
  useEffect(() => {
    if (grid.page !== paged.page) grid.setPage(paged.page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paged.page])
  const rowId = kind.rowId
  const foundIds = useMemo(() => found.map(rowId), [found, rowId])
  const visibleIds = useMemo(() => paged.rows.map(rowId), [paged.rows, rowId])

  // A new search or filter starts a new selection; records that no longer exist drop out of the old one.
  const findKey = JSON.stringify([grid.config.q, grid.config.columnFilters, grid.config.conditions])
  useEffect(() => setPicked(selection.EMPTY_SELECTION), [findKey])
  const existing = useMemo(() => new Set(rows.map(rowId)), [rows, rowId])
  useEffect(() => setPicked(current => selection.prune(current, id => existing.has(id))), [existing])

  const selectedRows = useMemo(() => rows.filter(row => picked.ids.has(rowId(row))), [rows, picked, rowId])
  const count = selectedRows.length
  const allMatching = count === found.length && found.length > 0 && count > visibleIds.length
  const shown = visibleColumns(columns, grid.config.columns)
  const clear = () => setPicked(selection.EMPTY_SELECTION)

  const tools = {
    bulk: (spec: BulkSpec) =>
      setBulk({
        ...spec,
        onDone: (result, made) => {
          spec.onDone(result, made)
          actions.afterBulk(result)
          keepFailed(spec, result)
        }
      }),
    clear
  }
  // What could not be done stays selected, so the cause can be fixed and the action tried again; what worked is released after a delete.
  const keepFailed = (spec: BulkSpec, result: BulkResult) => {
    const requested = [...new Set(spec.ids)]
    const attempted = requested.slice(0, requested.length - result.notAttempted)
    const failed = new Set(result.failed.map(item => item.id))
    const leftOver = requested.filter(id => failed.has(id) || !attempted.includes(id))
    if (leftOver.length || spec.danger) setPicked(selection.selectAll(selection.EMPTY_SELECTION, leftOver))
    setAnnouncement(`${result.succeeded} of ${result.requested}`)
  }
  const bar = actions.bar(selectedRows, tools)

  return (
    <div className="entity-grid" data-scope={kind.scope}>
      <GridToolbar
        grid={grid}
        scope={kind.scope}
        defs={kind.defs}
        filterFields={kind.filterFields.map(field => ({ ...field, label: t(field.label) }))}
        searchLabel={kind.searchLabel}
      >
        <ExportMenu
          dataset={kind.dataset}
          title={kind.exportTitle}
          selection={[...picked.ids]}
          filteredIds={grid.hasFilters ? foundIds : undefined}
          fullScope={fullScope}
          totalHint={rows.length}
          rowsHint={found.length}
          primary
        />
        {actions.onAdd && (
          <button type="button" className="primary-button" onClick={actions.onAdd}>
            {actions.addLabel || t('Add')}
          </button>
        )}
      </GridToolbar>
      <SelectionBar
        noun={kind.noun}
        count={count}
        onPage={visibleIds.filter(id => picked.ids.has(id)).length}
        pageRows={paged.rows.length}
        pageState={selection.pageState(picked, visibleIds)}
        total={found.length}
        allMatching={allMatching}
        selectingAll={false}
        onSelectAllMatching={() => {
          setPicked(current => selection.selectAll(current, foundIds))
          setAnnouncement(t('All {count} matching {noun} are selected', { count: foundIds.length, noun: kind.noun }))
        }}
        onClear={clear}
        actions={bar}
      />
      <div className={`${kind.scope}-table`}>
        <GridTable
          caption={t(kind.noun)}
          rows={paged.rows}
          rowId={rowId}
          rowLabel={kind.rowLabel}
          columns={shown}
          widths={grid.config.columns.widths}
          sort={grid.config.sort}
          onSort={grid.sortBy}
          filters={grid.config.columnFilters}
          onFilter={grid.setColumnFilter}
          showFilters={grid.showFilters}
          selection={picked}
          onSelect={setPicked}
          onOpen={actions.onOpen}
          onEdit={actions.onEdit}
          onDelete={
            actions.onDelete
              ? focused => actions.onDelete!(count > 0 ? selectedRows : focused ? [focused] : [])
              : undefined
          }
          onSelectAllMatching={() => setPicked(current => selection.selectAll(current, foundIds))}
          onResize={grid.resize}
          onResetWidth={grid.resetWidths}
          highlight={highlight as any}
          rowActions={actions.rowActions}
        />
        {!paged.rows.length && (
          <GridEmpty
            noun={kind.noun}
            filtered={grid.hasFilters}
            onClear={grid.clearFilters}
            onAdd={actions.onAdd}
            addLabel={actions.addLabel}
          />
        )}
      </div>
      <Pager
        page={paged.page}
        pages={paged.pages}
        pageSize={grid.config.pageSize}
        total={found.length}
        noun={kind.noun}
        onPage={grid.setPage}
        onPageSize={grid.setPageSize}
      />
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {bulk && <BulkDialog spec={bulk} onClose={() => setBulk(null)} />}
    </div>
  )
}
