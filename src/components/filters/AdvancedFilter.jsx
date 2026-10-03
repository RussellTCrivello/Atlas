import { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon.jsx'
import { useUserPreferences } from '../../context/user-preferences.jsx'
import { FIELD_OPERATORS } from '../../lib/advanced-filters.js'
import { translateUiText } from '../../i18n/catalog.js'

const EMPTY_CONDITIONS = []

export function AdvancedFilter({ filterKey, fields, onApply, appliedConditions, settings }) {
  const t = value => translateUiText(settings, value)
  const { filters, saveFilter } = useUserPreferences()
  const savedConditions = Array.isArray(filters?.[filterKey]) ? filters[filterKey] : EMPTY_CONDITIONS
  const [open, setOpen] = useState(false)
  const [conditions, setConditions] = useState(savedConditions)
  const lastAppliedRef = useRef(appliedConditions)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setConditions(savedConditions)
    onApply(savedConditions)
  }, [filterKey, savedConditions, onApply])
  useEffect(() => {
    if (!Array.isArray(appliedConditions) || lastAppliedRef.current === appliedConditions) return
    lastAppliedRef.current = appliedConditions
    setConditions(appliedConditions)
  }, [appliedConditions])

  const update = (index, key, value) => setConditions((current) => current.map((condition, rowIndex) => rowIndex === index
    ? { ...condition, [key]: value }
    : condition))
  const add = () => setConditions((current) => [...current, {
    join: 'AND',
    field: fields[0]?.key || '',
    operator: 'contains',
    value: ''
  }])

  const persist = async (nextConditions) => {
    setSaving(true)
    setSaveError('')
    try {
      await saveFilter(filterKey, nextConditions)
      lastAppliedRef.current = nextConditions
      setConditions(nextConditions)
      onApply(nextConditions)
      setOpen(false)
    } catch (error) {
      setSaveError(error.message || t('Could not save this filter.'))
    } finally {
      setSaving(false)
    }
  }

  const apply = () => persist(conditions.filter((condition) => condition.value !== ''))
  const clear = () => persist([])

  return <div className="advanced-filter-wrap">
    <button type="button" className={`secondary-button ${conditions.length ? 'filter-active' : ''}`} aria-expanded={open} aria-controls={`advanced-filter-${filterKey}`} onClick={() => setOpen(!open)}>
      <Icon name="filter" size={15}/> {t('Advanced filter')} {conditions.length > 0 && <span className="filter-badge">{conditions.length}</span>}
    </button>
    {open && <div id={`advanced-filter-${filterKey}`} className="advanced-filter-panel" role="region" aria-label={t('Advanced filter conditions')}>
      <div className="advanced-filter-head">
        <strong>{t('Advanced query builder')}</strong>
        <button type="button" className="icon-button subtle" onClick={() => setOpen(false)} aria-label={t('Close filter panel')}><Icon name="close" size={14}/></button>
      </div>
      {conditions.map((condition, index) => <div className="filter-condition" key={index}>
        {index > 0 && <select aria-label={t('Join operator')} value={condition.join} disabled={saving} onChange={(event) => update(index, 'join', event.target.value)}>
          <option value="AND">{t('AND')}</option><option value="OR">{t('OR')}</option>
        </select>}
        <select aria-label={t('Filter field')} value={condition.field} disabled={saving} onChange={(event) => update(index, 'field', event.target.value)}>
          {fields.map((field) => <option value={field.key} key={field.key}>{field.label}</option>)}
        </select>
        <select aria-label={t('Filter comparison')} value={condition.operator} disabled={saving} onChange={(event) => update(index, 'operator', event.target.value)}>
          {FIELD_OPERATORS.map(([key, label]) => <option value={key} key={key}>{t(label)}</option>)}
        </select>
        <input aria-label={t('Filter value')} value={condition.value} disabled={saving} onChange={(event) => update(index, 'value', event.target.value)} placeholder={t('Value')}/>
        <button type="button" className="icon-button subtle" disabled={saving} onClick={() => setConditions((current) => current.filter((_, rowIndex) => rowIndex !== index))} aria-label={t('Remove condition')}>
          <Icon name="close" size={13}/>
        </button>
      </div>)}
      <div className="advanced-filter-actions">
        <button type="button" className="text-button" disabled={saving || !fields.length} onClick={add}><Icon name="plus" size={13}/> {t('Add condition')}</button>
        <span/>
        <button type="button" className="secondary-button" disabled={saving} onClick={clear}>{t('Clear')}</button>
        <button type="button" className="primary-button" disabled={saving} onClick={apply}>{saving ? t('Saving…') : t('Apply')}</button>
      </div>
      {saveError && <p className="form-error" role="alert">{saveError}</p>}
      <p className="filter-hint">{t('Conditions are evaluated from top to bottom. Mix AND/OR conditions for precise operational queries.')}</p>
    </div>}
  </div>
}
