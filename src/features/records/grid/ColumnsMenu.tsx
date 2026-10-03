// Which columns are shown, and in what order. Every column can be switched on or off (the identifying one stays), moved earlier
// or later with buttons (so it works without dragging), and the whole layout can be put back as it was.
import { useEffect, useId, useRef, useState } from 'react'
import { type ColumnDef, type ColumnState } from '../../../lib/grid-model'
import { tr } from '../../../lib/i18n'
import { useApp } from '../../../ui/app-context'
import { Icon } from '../../../ui/icons'

interface Props {
  defs: ColumnDef[]
  state: ColumnState
  onToggle: (key: string) => void
  onMove: (key: string, delta: -1 | 1) => void
  onResetLayout: () => void
  isDefault: boolean
}

export function ColumnsMenu({ defs, state, onToggle, onMove, onResetLayout, isDefault }: Props) {
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const byKey = new Map(defs.map(def => [def.key, def]))
  const hidden = new Set(state.hidden)
  const movable = state.order.filter(key => !byKey.get(key)?.fixed)
  return (
    <div
      className="menu-wrap"
      ref={box}
      onKeyDown={event => event.key === 'Escape' && open && (event.stopPropagation(), setOpen(false))}
    >
      <button
        type="button"
        className="secondary-button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="columns" size={15} /> {t('Columns')}
      </button>
      {open && (
        <div className="menu-panel" id={`${id}-panel`} role="group" aria-label={t('Choose and arrange columns')}>
          <ul className="column-list">
            {state.order.map(key => {
              const def = byKey.get(key)
              if (!def) return null
              const at = movable.indexOf(key)
              return (
                <li key={key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={def.fixed || !hidden.has(key)}
                      disabled={def.fixed}
                      onChange={() => onToggle(key)}
                    />
                    {t(def.label)}
                  </label>
                  {def.fixed ? (
                    <span className="menu-note">{t('always shown')}</span>
                  ) : (
                    <span className="move-buttons">
                      <button
                        type="button"
                        className="icon-button subtle"
                        disabled={at <= 0}
                        aria-label={t('Move {column} earlier', { column: t(def.label) })}
                        onClick={() => onMove(key, -1)}
                      >
                        <Icon name="sortUp" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button subtle"
                        disabled={at < 0 || at >= movable.length - 1}
                        aria-label={t('Move {column} later', { column: t(def.label) })}
                        onClick={() => onMove(key, 1)}
                      >
                        <Icon name="sortDown" size={13} />
                      </button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
          <button type="button" className="text-button" disabled={isDefault} onClick={onResetLayout}>
            {t('Reset columns, sort and page size')}
          </button>
        </div>
      )}
    </div>
  )
}
