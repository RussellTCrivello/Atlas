// The bar above a table: how many records are selected and the actions that make sense for that many. With nothing selected the
// actions that need a selection are shown but disabled (so they can be found); with one, the single-record actions work; with
// several, the bulk ones. An action never reaches beyond what is selected, and the count is always on screen and announced.
import { tr } from '../../../lib/i18n'
import { useApp } from '../../../ui/app-context'
import { Icon } from '../../../ui/icons'

export interface BarAction {
  id: string
  label: string
  icon?: string
  /** Works from this many selected records (default 1). */
  min?: number
  /** Up to this many (default: any number). */
  max?: number
  tone?: 'danger'
  /** Shown instead of the selection rules, to explain why it cannot be used right now. */
  disabledReason?: string
  /** Not offered at all (the person's role cannot do it). */
  hidden?: boolean
  /** Works with no selection too (Add, Import). */
  always?: boolean
  onRun: () => void
}

interface Props {
  noun: string
  count: number
  /** How many of the selected records are on the page being shown. */
  onPage: number
  pageRows: number
  pageState: 'none' | 'some' | 'all'
  /** Records matching the current filter, whatever the page. */
  total: number
  allMatching: boolean
  selectingAll: boolean
  /** More matches than can be selected at once. */
  tooMany?: boolean
  limit?: number
  onSelectAllMatching: () => void
  onClear: () => void
  actions: BarAction[]
}

export function SelectionBar(props: Props) {
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const { count, noun } = props
  const offer = props.pageState === 'all' && props.total > count && !props.allMatching
  const elsewhere = count - props.onPage
  const usable = (action: BarAction) =>
    action.always || (count >= (action.min ?? 1) && count <= (action.max ?? Infinity))
  const reason = (action: BarAction) =>
    action.disabledReason ||
    (count === 0
      ? t('Select {noun} first', { noun })
      : action.max === 1
        ? t('Select exactly one record for this')
        : t('Select at least {n} records', { n: action.min ?? 1 }))
  return (
    <section className={`selection-bar ${count ? 'has-selection' : ''}`} aria-label={t('Selection and actions')}>
      <div className="selection-summary">
        <span role="status" aria-live="polite" aria-atomic="true">
          {count === 0
            ? t('Nothing selected')
            : props.allMatching && count > 1
              ? t('All {count} matching {noun} are selected', { count: count.toLocaleString('en'), noun })
              : t('{count} selected', { count: count.toLocaleString('en') })}
          {count > 0 && elsewhere > 0 && !props.allMatching && (
            <span className="selection-extra">
              {' '}
              · {t('{count} on other pages', { count: elsewhere.toLocaleString('en') })}
            </span>
          )}
        </span>
        {offer && !props.tooMany && (
          <button
            type="button"
            className="text-button"
            disabled={props.selectingAll}
            onClick={props.onSelectAllMatching}
          >
            {props.selectingAll
              ? t('Selecting…')
              : t('Select all {total} matching {noun}', { total: props.total.toLocaleString('en'), noun })}
          </button>
        )}
        {offer && props.tooMany && (
          <span className="menu-note">
            {t('Too many to select at once (limit {limit}). Narrow the filter first.', {
              limit: (props.limit || 10000).toLocaleString('en')
            })}
          </span>
        )}
        {count > 0 && (
          <button type="button" className="text-button" onClick={props.onClear}>
            {t('Clear selection')}
          </button>
        )}
      </div>
      <div className="selection-actions" role="toolbar" aria-label={t('Actions')}>
        {props.actions
          .filter(action => !action.hidden)
          .map(action => {
            const enabled = usable(action) && !action.disabledReason
            const label =
              !enabled || action.always || count < 2 || action.max === 1
                ? action.label
                : `${action.label} (${count.toLocaleString('en')})`
            return (
              <button
                key={action.id}
                type="button"
                className={`secondary-button bar-action ${action.tone === 'danger' ? 'danger-button' : ''}`}
                disabled={!enabled}
                aria-disabled={!enabled}
                title={enabled ? undefined : reason(action)}
                onClick={action.onRun}
              >
                {action.icon && <Icon name={action.icon} size={14} />} {label}
              </button>
            )
          })}
      </div>
    </section>
  )
}
