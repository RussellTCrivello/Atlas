// Cards or a table for the same records. The choice is remembered per person and screen; the cards stay exactly as they were, the
// table adds selection, bulk actions, filters, views and export of the selected rows.
import { useState } from 'react'
import { tr } from '../../lib/i18n'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'

export type Mode = 'cards' | 'table'

export function useViewMode(scope: string): [Mode, (mode: Mode) => void] {
  const { user } = useApp()
  const key = `atlas-mode-${user?.id || 'anonymous'}-${scope}`
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(key) === 'table' ? 'table' : 'cards'
    } catch {
      return 'cards'
    }
  })
  return [
    mode,
    next => {
      setMode(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        /* the choice still applies for this session */
      }
    }
  ]
}

export function ViewSwitch({
  mode,
  onChange,
  first = 'Cards'
}: {
  mode: Mode
  onChange: (mode: Mode) => void
  first?: string
}) {
  const { settings } = useApp()
  return (
    <div className="view-toggle" role="group" aria-label={tr(settings, 'Layout')}>
      <button
        type="button"
        className={mode === 'cards' ? 'selected' : ''}
        aria-pressed={mode === 'cards'}
        onClick={() => onChange('cards')}
      >
        <Icon name="overview" size={15} /> {tr(settings, first)}
      </button>
      <button
        type="button"
        className={mode === 'table' ? 'selected' : ''}
        aria-pressed={mode === 'table'}
        onClick={() => onChange('table')}
      >
        <Icon name="tasks" size={15} /> {tr(settings, 'Table')}
      </button>
    </div>
  )
}
