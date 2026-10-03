// What a list says when it has nothing to show: it is empty (nothing exists yet), nothing matches (filters are on), or it could
// not be loaded. Each says what happened and what to do next; none of them is a blank space.
import { tr } from '../../../lib/i18n'
import { useApp } from '../../../ui/app-context'
import { Icon } from '../../../ui/icons'

interface EmptyProps {
  noun: string
  /** Filters or a search are narrowing the list. */
  filtered: boolean
  onClear: () => void
  onAdd?: () => void
  addLabel?: string
  onImport?: () => void
}

export function GridEmpty({ noun, filtered, onClear, onAdd, addLabel, onImport }: EmptyProps) {
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  return (
    <div className="grid-empty" role="status">
      <span className="grid-empty-icon" aria-hidden="true">
        <Icon name={filtered ? 'search' : 'spark'} size={22} />
      </span>
      {filtered ? (
        <>
          <h3>{t('No {noun} match', { noun })}</h3>
          <p>{t('Nothing fits the current search and filters. Loosen them, or start again.')}</p>
          <button type="button" className="secondary-button" onClick={onClear}>
            {t('Clear all filters')}
          </button>
        </>
      ) : (
        <>
          <h3>{t('No {noun} yet', { noun })}</h3>
          <p>{onAdd ? t('Add the first one, or bring them in from a file.') : t('There is nothing here yet.')}</p>
          <div className="grid-empty-actions">
            {onAdd && (
              <button type="button" className="primary-button" onClick={onAdd}>
                <Icon name="plus" size={14} /> {addLabel || t('Add')}
              </button>
            )}
            {onImport && (
              <button type="button" className="secondary-button" onClick={onImport}>
                <Icon name="upload" size={14} /> {t('Import from CSV')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export function GridError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { settings } = useApp()
  return (
    <div className="global-error" role="alert">
      <Icon name="warning" size={15} /> {message}{' '}
      <button type="button" onClick={onRetry}>
        {tr(settings, 'Retry')}
      </button>
    </div>
  )
}
