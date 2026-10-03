// The table of a data grid. It draws what it is given and reports what the person does; it never fetches or filters. Everything a
// person needs is reachable without a mouse: rows are focusable (arrow keys move, Space ticks, Shift+arrows extend, Enter opens,
// F2 edits, Delete deletes the selection, Ctrl/Cmd+A ticks the page, Escape clears), headers sort (Shift adds a second sort),
// column edges resize with the arrow keys, and every control is labelled for a screen reader.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  type ColumnFilters,
  type LocalColumn,
  type SortSpec,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  sortPosition
} from '../../../lib/grid-model'
import { tr } from '../../../lib/i18n'
import * as selection from '../../../lib/selection'
import type { RecordId, SelectionState } from '../../../lib/selection'
import { useApp } from '../../../ui/app-context'
import { type InlineEdit, EditableCell } from './EditableCell'
import { GridFilter } from './GridFilters'

export interface GridColumn<Row> extends LocalColumn<Row> {
  render: (row: Row) => ReactNode
  options?: { value: string; label: string }[]
  /** One choice instead of several in the filter (the owner). */
  single?: boolean
  edit?: InlineEdit<Row>
  className?: string
}

interface Props<Row> {
  caption: string
  rows: Row[]
  rowId: (row: Row) => RecordId
  /** What a row is called ("PAY-3: Write the spec"), for selecting it and for screen readers. */
  rowLabel: (row: Row) => string
  columns: GridColumn<Row>[]
  widths: Record<string, number>
  sort: SortSpec[]
  onSort: (key: string, additive: boolean) => void
  filters: ColumnFilters
  onFilter: (key: string, value: any) => void
  showFilters: boolean
  selection: SelectionState
  /** Change the selection by saying how: each change builds on the latest selection, however quickly events arrive. */
  onSelect: (update: (current: SelectionState) => SelectionState) => void
  onOpen?: (row: Row) => void
  onEdit?: (row: Row) => void
  /** Delete pressed: the grid decides what that means (the selection, or the focused row if nothing is selected). */
  onDelete?: (focused: Row | null) => void
  /** Ctrl/Cmd+A pressed when the whole page is already selected: offer everything that matches. */
  onSelectAllMatching?: () => void
  onResize: (key: string, width: number) => void
  onResetWidth: (key: string) => void
  rowActions?: (row: Row) => ReactNode
  highlight?: RecordId | null
  loading?: boolean
  selectable?: boolean
}

const DEFAULT_WIDTH = 150
const SELECT_WIDTH = 44
const ACTIONS_WIDTH = 96

export function GridTable<Row>(props: Props<Row>) {
  const {
    rows,
    rowId,
    rowLabel,
    columns,
    widths,
    sort,
    filters,
    showFilters,
    selectable = true,
    selection: picked
  } = props
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const visibleIds = useMemo(() => rows.map(rowId), [rows, rowId])
  const state = selection.pageState(picked, visibleIds)
  const headerBox = useRef<HTMLInputElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [focusId, setFocusId] = useState<RecordId | null>(null)
  const rtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl'

  // The header checkbox shows "some" (mixed) when only part of the page is ticked.
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = state === 'some'
  }, [state])
  // Keep a row to land on when Tab arrives: the focused one if it is still shown, else the first.
  const landing = focusId !== null && visibleIds.includes(focusId) ? focusId : (visibleIds[0] ?? null)

  const rowElement = (id: RecordId) =>
    wrap.current?.querySelector<HTMLElement>(`tr[data-row="${String(id).replace(/["\\]/g, '\\$&')}"]`)
  const focusRow = (id: RecordId | undefined) => {
    if (id === undefined) return
    setFocusId(id)
    rowElement(id)?.focus()
  }
  const widthOf = (column: GridColumn<Row>) => widths[column.key] ?? column.width ?? DEFAULT_WIDTH
  const total =
    (selectable ? SELECT_WIDTH : 0) +
    columns.reduce((sum, c) => sum + widthOf(c), 0) +
    (props.rowActions ? ACTIONS_WIDTH : 0)

  const tick = (row: Row, event: { shiftKey: boolean }) => {
    const id = rowId(row)
    props.onSelect(current => selection.pick(current, visibleIds, id, { shift: event.shiftKey }))
    setFocusId(id)
  }

  const onRowClick = (row: Row, event: ReactMouseEvent) => {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea, label, [data-no-open]')) return
    if (event.ctrlKey || event.metaKey) props.onSelect(current => selection.toggle(current, rowId(row)))
    else if (event.shiftKey) props.onSelect(current => selection.pick(current, visibleIds, rowId(row), { shift: true }))
    else props.onOpen?.(row)
    setFocusId(rowId(row))
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    const onRow = target.matches('tr[data-row]')
    const typing = target.closest(
      'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]'
    )
    const key = event.key
    const mod = event.ctrlKey || event.metaKey
    if (typing) return // text boxes keep their own keys (Ctrl+A selects text, arrows move the caret)
    if (mod && key.toLowerCase() === 'a' && selectable) {
      event.preventDefault()
      if (state === 'all' && props.onSelectAllMatching) props.onSelectAllMatching()
      else props.onSelect(current => selection.selectAll(current, visibleIds))
      return
    }
    if (key === 'Escape' && selection.sizeOf(picked) > 0) {
      event.stopPropagation()
      props.onSelect(() => selection.clear())
      return
    }
    const rowEl = target.closest<HTMLElement>('tr[data-row]')
    if (!rowEl || !onRow) return
    const id = visibleIds.find(candidate => String(candidate) === rowEl.dataset.row)
    if (id === undefined) return
    const index = visibleIds.indexOf(id)
    const row = rows[index]
    const move = (to: number) => {
      event.preventDefault()
      const next = visibleIds[Math.max(0, Math.min(visibleIds.length - 1, to))]
      if (event.shiftKey && selectable)
        props.onSelect(current => selection.extend(current, visibleIds, id, to > index ? 1 : -1))
      focusRow(next)
    }
    if (key === 'ArrowDown') move(index + 1)
    else if (key === 'ArrowUp') move(index - 1)
    else if (key === 'Home') move(0)
    else if (key === 'End') move(visibleIds.length - 1)
    else if (key === 'PageDown') move(index + 10)
    else if (key === 'PageUp') move(index - 10)
    else if (key === ' ' && selectable) {
      event.preventDefault()
      tick(row, event)
    } else if (key === 'Enter' && props.onOpen) {
      event.preventDefault()
      props.onOpen(row)
    } else if ((key === 'F2' || (key.toLowerCase() === 'e' && !mod)) && props.onEdit) {
      event.preventDefault()
      props.onEdit(row)
    } else if (key === 'Delete' && props.onDelete) {
      event.preventDefault()
      props.onDelete(row)
    }
  }

  const startResize = (column: GridColumn<Row>, event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = widthOf(column)
    const min = column.minWidth ?? MIN_COLUMN_WIDTH
    const move = (e: PointerEvent) => {
      const delta = (e.clientX - startX) * (rtl ? -1 : 1)
      props.onResize(column.key, Math.max(min, Math.min(MAX_COLUMN_WIDTH, startWidth + delta)))
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const resizeKey = (column: GridColumn<Row>, event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? 48 : 12
    const dir = rtl ? -1 : 1
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()
      props.onResize(column.key, widthOf(column) + (event.key === 'ArrowRight' ? step : -step) * dir)
    } else if (event.key === 'Home') {
      event.preventDefault()
      props.onResetWidth(column.key)
    }
  }

  return (
    <div className={`grid-scroll ${props.loading ? 'is-loading' : ''}`} ref={wrap} onKeyDown={onKeyDown}>
      <table
        className="data-grid"
        style={{ width: Math.max(total, 0), minWidth: '100%' }}
        aria-busy={props.loading || undefined}
      >
        <caption className="sr-only">{props.caption}</caption>
        <colgroup>
          {selectable && <col style={{ width: SELECT_WIDTH }} />}
          {columns.map(column => (
            <col key={column.key} style={{ width: widthOf(column) }} />
          ))}
          {props.rowActions && <col style={{ width: ACTIONS_WIDTH }} />}
        </colgroup>
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className="select-cell">
                <input
                  ref={headerBox}
                  type="checkbox"
                  checked={state === 'all'}
                  disabled={!rows.length}
                  aria-label={t('Select all {count} rows on this page', { count: rows.length })}
                  onChange={() => props.onSelect(current => selection.togglePage(current, visibleIds))}
                />
              </th>
            )}
            {columns.map(column => {
              const position = sortPosition(sort, column.key)
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={column.className}
                  aria-sort={
                    position
                      ? position.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : column.sortable === false
                        ? undefined
                        : 'none'
                  }
                >
                  {column.sortable === false ? (
                    <span className="th-label">{t(column.label)}</span>
                  ) : (
                    <button
                      type="button"
                      className="sort-button"
                      title={t('Sort by {column}. Hold Shift to add it as a further sort.', {
                        column: t(column.label)
                      })}
                      onClick={event => props.onSort(column.key, event.shiftKey)}
                    >
                      <span>{t(column.label)}</span>
                      {position && (
                        <span className="sort-mark" aria-hidden="true">
                          {position.dir === 'asc' ? '▲' : '▼'}
                          {sort.length > 1 && <sup>{position.position}</sup>}
                        </span>
                      )}
                    </button>
                  )}
                  <span
                    className="col-resizer"
                    role="separator"
                    aria-orientation="vertical"
                    tabIndex={0}
                    aria-label={t('Resize the {column} column', { column: t(column.label) })}
                    aria-valuenow={widthOf(column)}
                    aria-valuemin={column.minWidth ?? MIN_COLUMN_WIDTH}
                    aria-valuemax={MAX_COLUMN_WIDTH}
                    onPointerDown={event => startResize(column, event)}
                    onKeyDown={event => resizeKey(column, event)}
                    onDoubleClick={() => props.onResetWidth(column.key)}
                  />
                </th>
              )
            })}
            {props.rowActions && (
              <th scope="col" className="actions-cell">
                <span className="sr-only">{t('Actions')}</span>
              </th>
            )}
          </tr>
          {showFilters && (
            <tr className="filter-row">
              {selectable && <td />}
              {columns.map(column => (
                <td key={column.key}>
                  {column.filter ? (
                    <GridFilter
                      kind={column.filter}
                      label={t(column.label)}
                      value={filters[column.key]}
                      options={column.options}
                      single={column.single}
                      onChange={value => props.onFilter(column.key, value)}
                    />
                  ) : null}
                </td>
              ))}
              {props.rowActions && <td />}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map(row => {
            const id = rowId(row)
            const checked = picked.ids.has(id)
            return (
              <tr
                key={String(id)}
                data-row={String(id)}
                className={`${checked ? 'row-selected' : ''} ${props.highlight === id ? 'row-highlight' : ''}`}
                data-selected={checked ? 'true' : undefined}
                tabIndex={landing === id ? 0 : -1}
                onFocus={event => event.target === event.currentTarget && setFocusId(id)}
                onClick={event => onRowClick(row, event)}
                aria-label={checked ? `${rowLabel(row)}, ${t('selected')}` : rowLabel(row)}
              >
                {selectable && (
                  <td className="select-cell">
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`${t('Select')} ${rowLabel(row)}`}
                      onChange={() => undefined}
                      onClick={event => {
                        event.stopPropagation()
                        tick(row, event)
                      }}
                    />
                  </td>
                )}
                {columns.map(column => (
                  <td key={column.key} className={column.className}>
                    {column.edit && (column.edit.enabled?.(row) ?? true) ? (
                      <EditableCell row={row} edit={column.edit}>
                        {column.render(row)}
                      </EditableCell>
                    ) : (
                      column.render(row)
                    )}
                  </td>
                ))}
                {props.rowActions && <td className="actions-cell">{props.rowActions(row)}</td>}
              </tr>
            )
          })}
          {props.loading &&
            !rows.length &&
            Array.from({ length: 6 }, (_, index) => (
              <tr key={`skeleton-${index}`} className="skeleton-row" aria-hidden="true">
                {selectable && <td />}
                {columns.map(column => (
                  <td key={column.key}>
                    <span className="skeleton" />
                  </td>
                ))}
                {props.rowActions && <td />}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
