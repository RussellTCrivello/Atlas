// The controls above a table that change what it shows: search, the per-column filter row, the advanced AND/OR filter, the
// columns, saved views and Reset. What a page adds (Add, Import, Export) goes in `children`.
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Condition } from '../../../lib/filters'
import type { ColumnDef } from '../../../lib/grid-model'
import { tr } from '../../../lib/i18n'
import { useApp } from '../../../ui/app-context'
import { Icon } from '../../../ui/icons'
import { AdvancedFilter, FilterChips } from '../../export/AdvancedFilter'
import { ColumnsMenu } from './ColumnsMenu'
import type { GridState } from './use-grid-state'
import { ViewsMenu } from './ViewsMenu'

interface Props {
  grid: GridState
  scope: string
  defs: ColumnDef[]
  /** The fields the advanced filter may use (they must be ones the data source understands). */
  filterFields: { key: string; label: string; type?: string }[]
  searchLabel: string
  children?: ReactNode
}

export function GridToolbar({ grid, scope, defs, filterFields, searchLabel, children }: Props) {
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const [draft, setDraft] = useState(grid.config.q)
  const applied = useRef(grid.config.q)
  const [help, setHelp] = useState(false)
  const helpId = useId()
  // The box waits for a pause in typing, and follows the grid when it is cleared from outside (Reset, a saved view).
  useEffect(() => {
    if (grid.config.q !== applied.current) {
      applied.current = grid.config.q
      setDraft(grid.config.q)
    }
  }, [grid.config.q])
  useEffect(() => {
    if (draft === applied.current) return
    const timer = setTimeout(() => {
      applied.current = draft
      grid.setQuery(draft)
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  const columnFilterCount = Object.keys(grid.config.columnFilters).length
  return (
    <>
      <div className="grid-toolbar" role="search">
        <div className="work-search">
          <Icon name="search" size={15} />
          <input
            type="search"
            aria-label={searchLabel}
            placeholder={searchLabel}
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={`secondary-button ${columnFilterCount ? 'filter-active' : ''}`}
          aria-pressed={grid.showFilters}
          onClick={() => grid.setShowFilters(!grid.showFilters)}
        >
          <Icon name="filter" size={15} /> {t('Column filters')}
          {columnFilterCount > 0 && <span className="filter-badge">{columnFilterCount}</span>}
        </button>
        <AdvancedFilter
          filterKey={scope}
          fields={filterFields}
          value={grid.config.conditions}
          onApply={(conditions: Condition[]) => grid.setConditions(conditions)}
        />
        <ColumnsMenu
          defs={defs}
          state={grid.config.columns}
          onToggle={grid.toggle}
          onMove={grid.move}
          onResetLayout={grid.reset}
          isDefault={grid.isDefaultLayout}
        />
        <ViewsMenu scope={scope} activeView={grid.activeView} snapshot={grid.snapshot} onApply={grid.applyView} />
        {grid.hasFilters && (
          <button type="button" className="text-button" onClick={grid.clearFilters}>
            {t('Clear filters')}
          </button>
        )}
        {(!grid.isDefaultLayout || Boolean(grid.activeView)) && (
          <button
            type="button"
            className="text-button"
            onClick={grid.reset}
            title={t('Back to the default columns, sort and page size, with nothing filtered')}
          >
            <Icon name="reset" size={13} /> {t('Reset')}
          </button>
        )}
        <span className="toolbar-spacer" />
        {children}
        <div className="menu-wrap">
          <button
            type="button"
            className="icon-button"
            aria-expanded={help}
            aria-controls={helpId}
            aria-label={t('Keyboard shortcuts')}
            title={t('Keyboard shortcuts')}
            onClick={() => setHelp(!help)}
          >
            <Icon name="keyboard" size={16} />
          </button>
          {help && (
            <div className="menu-panel shortcuts" id={helpId} role="group" aria-label={t('Keyboard shortcuts')}>
              <dl>
                {SHORTCUTS.map(([keys, what]) => (
                  <div key={keys}>
                    <dt>
                      <kbd>{keys}</kbd>
                    </dt>
                    <dd>{t(what)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
      <FilterChips
        conditions={grid.config.conditions}
        fields={filterFields}
        onClear={() => grid.setConditions([])}
        onRemove={(index: number) => grid.setConditions(grid.config.conditions.filter((_, i) => i !== index))}
      />
    </>
  )
}

const SHORTCUTS: [string, string][] = [
  ['↑ ↓', 'Move between rows'],
  ['Space', 'Select or deselect the row'],
  ['Shift + ↑ ↓', 'Extend the selection'],
  ['Shift + click', 'Select a range of rows'],
  ['Ctrl/Cmd + click', 'Add or remove one row'],
  ['Ctrl/Cmd + A', 'Select the page (again: everything that matches)'],
  ['Enter', 'Open the row'],
  ['E or F2', 'Edit the row'],
  ['Delete', 'Delete the selection'],
  ['Esc', 'Clear the selection']
]
