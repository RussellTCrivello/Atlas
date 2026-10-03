// The "advanced filter" query builder and the chips that show active conditions. The same conditions are sent to the server for exports.
import { useState, useEffect } from 'react'
import { isActive, FIELD_OPERATORS, VALUELESS_OPERATORS } from '../../lib/filters'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'

/**
 * `value` makes the builder follow the page (a grid that owns its filters, a saved view being applied); without it the builder
 * keeps its own conditions and remembers them for this person in the browser.
 */
export function AdvancedFilter({
  filterKey,
  fields,
  onApply,
  value
}: {
  filterKey: string
  fields: any[]
  onApply: (conditions: any[]) => void
  value?: any[]
}) {
  const { user } = useApp()
  const controlled = value !== undefined
  const storageKey = `atlas-filter-${user?.id || 'anonymous'}-${filterKey}`
  const [open, setOpen] = useState(false)
  const [conditions, setConditions] = useState(() => {
    if (controlled) return value
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]')
    } catch {
      return []
    }
  })
  useEffect(() => {
    if (controlled) setConditions(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlled && JSON.stringify(value)])
  useEffect(() => {
    if (!controlled) onApply(conditions.filter(isActive))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const update = (i, key, value) =>
    setConditions(current => current.map((c, index) => (index === i ? { ...c, [key]: value } : c)))
  const add = () =>
    setConditions(current => [
      ...current,
      { join: 'AND', field: fields[0]?.key || '', operator: 'contains', value: '' }
    ])
  const apply = () => {
    const active = conditions.filter(isActive)
    if (!controlled)
      try {
        localStorage.setItem(storageKey, JSON.stringify(active))
      } catch {
        /* storage unavailable: the filter still applies for this session */
      }
    onApply(active)
    setOpen(false)
  }
  const clear = () => {
    setConditions([])
    if (!controlled)
      try {
        localStorage.removeItem(storageKey)
      } catch {
        /* ignore */
      }
    onApply([])
  }
  const fieldType = key => fields.find(f => f.key === key)?.type || 'text'
  return (
    <div className="advanced-filter-wrap">
      <button
        type="button"
        className={`secondary-button ${conditions.length ? 'filter-active' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <Icon name="filter" size={15} /> Advanced filter{' '}
        {conditions.length > 0 && <span className="filter-badge">{conditions.length}</span>}
      </button>
      {open && (
        <div className="advanced-filter-panel" role="group" aria-label="Advanced query builder">
          <div className="advanced-filter-head">
            <strong>Advanced query builder</strong>
            <button
              type="button"
              className="icon-button subtle"
              aria-label="Close filter panel"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          {conditions.map((c, i) => (
            <div className="filter-condition" key={i}>
              {i > 0 && (
                <select
                  aria-label="Join with previous condition"
                  value={c.join}
                  onChange={e => update(i, 'join', e.target.value)}
                >
                  <option>AND</option>
                  <option>OR</option>
                </select>
              )}
              <select aria-label="Field" value={c.field} onChange={e => update(i, 'field', e.target.value)}>
                {fields.map(f => (
                  <option value={f.key} key={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select aria-label="Operator" value={c.operator} onChange={e => update(i, 'operator', e.target.value)}>
                {FIELD_OPERATORS.map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
              {!VALUELESS_OPERATORS.has(c.operator) && (
                <input
                  aria-label="Value"
                  type={fieldType(c.field) === 'date' ? 'date' : fieldType(c.field) === 'number' ? 'number' : 'text'}
                  value={c.value}
                  onChange={e => update(i, 'value', e.target.value)}
                  placeholder="Value"
                />
              )}
              <button
                type="button"
                className="icon-button subtle"
                aria-label="Remove condition"
                onClick={() => setConditions(current => current.filter((_, idx) => idx !== i))}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
          <div className="advanced-filter-actions">
            <button type="button" className="text-button" onClick={add}>
              <Icon name="plus" size={13} /> Add condition
            </button>
            <span />
            <button type="button" className="secondary-button" onClick={clear}>
              Clear
            </button>
            <button type="button" className="primary-button" onClick={apply}>
              Apply
            </button>
          </div>
          <p className="filter-hint">
            AND binds tighter than OR: “A AND B OR C” means “(A AND B) OR C”. Conditions without a value are ignored.
          </p>
        </div>
      )}
    </div>
  )
}

export function FilterChips({ conditions, fields, onClear, onRemove }) {
  if (!conditions?.length) return null
  const operatorLabel = key => FIELD_OPERATORS.find(([k]) => k === key)?.[1] || key
  return (
    <div className="filter-chips">
      <span>Active filters</span>
      {conditions.map((c, i) => (
        <button
          type="button"
          className="filter-chip"
          key={i}
          aria-label={`Remove filter ${fields.find(f => f.key === c.field)?.label || c.field}`}
          onClick={() => onRemove(i)}
        >
          {i > 0 && <small>{c.join} </small>}
          <strong>{fields.find(f => f.key === c.field)?.label || c.field}</strong> {operatorLabel(c.operator)}{' '}
          {!VALUELESS_OPERATORS.has(c.operator) && <em>{c.value}</em>}
          <Icon name="close" size={11} />
        </button>
      ))}
      <button type="button" className="text-button" onClick={onClear}>
        Clear all
      </button>
    </div>
  )
}
