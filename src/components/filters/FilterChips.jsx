import { useState } from 'react'
import { Icon } from '../Icon.jsx'
import { useUserPreferences } from '../../context/user-preferences.jsx'

export function FilterChips({ filterKey, conditions, fields, onChange }) {
  const { saveFilter } = useUserPreferences()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  if (!conditions?.length) return null

  const update = async (nextConditions) => {
    setSaving(true)
    setSaveError('')
    try {
      await saveFilter(filterKey, nextConditions)
      onChange(nextConditions)
    } catch (error) {
      setSaveError(error.message || 'Could not update saved filters.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="filter-chips">
    <span>Active filters</span>
    {conditions.map((condition, index) => <button type="button" className="filter-chip" key={`${condition.field}-${index}`} disabled={saving} onClick={() => update(conditions.filter((_, rowIndex) => rowIndex !== index))}>
      <strong>{fields.find((field) => field.key === condition.field)?.label || condition.field}</strong> {condition.operator} <em>{condition.value}</em><Icon name="close" size={11}/>
    </button>)}
    <button type="button" className="text-button" disabled={saving} onClick={() => update([])}>Clear all</button>
    {saveError && <span className="form-error" role="alert">{saveError}</span>}
  </div>
}
