// Settings > Custom fields.
import { useState } from 'react'
import { slug } from '../../lib/format'
import { Icon } from '../../ui/icons'

export function AdvancedCustomFieldsAdmin({ form, patch, canAdmin }) {
  const [entity, setEntity] = useState('tasks')
  const [draft, setDraft] = useState({ key: '', label: '', type: 'text' })
  const fields = form.customFields?.[entity] || []
  const updateFields = rows =>
    patch(
      `customFields.${entity}`,
      rows.map((row, index) => ({ ...row, order: index + 1 }))
    )
  const add = () => {
    const key = slug(draft.key).replaceAll('-', '_')
    if (!key || fields.some(field => field.key === key)) return
    updateFields([
      ...fields,
      {
        ...draft,
        key,
        label: draft.label || draft.key,
        visible: true,
        required: false,
        validation: '',
        permissions: [],
        order: fields.length + 1
      }
    ])
    setDraft({ key: '', label: '', type: 'text' })
  }
  const updateField = (index, row) =>
    updateFields(fields.map((field, i) => (i === index ? { ...field, ...row } : field)))
  const moveField = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateFields(next)
  }
  return (
    <div className="custom-fields-admin advanced-custom-fields">
      <div className="admin-toolbar">
        <label>
          Entity
          <select value={entity} onChange={e => setEntity(e.target.value)}>
            {Object.keys(form.customFields || {}).map(key => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
        <input
          disabled={!canAdmin}
          value={draft.key}
          onChange={e => setDraft({ ...draft, key: e.target.value })}
          placeholder="field_key"
        />
        <input
          disabled={!canAdmin}
          value={draft.label}
          onChange={e => setDraft({ ...draft, label: e.target.value })}
          placeholder="Field label"
        />
        <select disabled={!canAdmin} value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>
          {[
            'text',
            'number',
            'date',
            'datetime',
            'checkbox',
            'dropdown',
            'multi-select',
            'user',
            'attachment',
            'url',
            'calculated'
          ].map(type => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={add}>
          Add field
        </button>
      </div>
      <div className="custom-field-table">
        <div className="custom-field-head">
          <span>Key</span>
          <span>Label</span>
          <span>Type</span>
          <span>Rules</span>
          <span>Permissions</span>
          <span />
        </div>
        {fields.map((field, index) => (
          <div className="custom-field-row" key={field.key}>
            <code>{field.key}</code>
            <input
              disabled={!canAdmin}
              value={field.label || ''}
              onChange={e => updateField(index, { label: e.target.value })}
            />
            <select
              disabled={!canAdmin}
              value={field.type || 'text'}
              onChange={e => updateField(index, { type: e.target.value })}
            >
              {[
                'text',
                'number',
                'date',
                'datetime',
                'checkbox',
                'dropdown',
                'multi-select',
                'user',
                'attachment',
                'url',
                'calculated'
              ].map(type => (
                <option key={type}>{type}</option>
              ))}
            </select>
            <div className="field-rules">
              <label>
                <input
                  disabled={!canAdmin}
                  type="checkbox"
                  checked={field.visible !== false}
                  onChange={e => updateField(index, { visible: e.target.checked })}
                />{' '}
                visible
              </label>
              <label>
                <input
                  disabled={!canAdmin}
                  type="checkbox"
                  checked={field.required === true}
                  onChange={e => updateField(index, { required: e.target.checked })}
                />{' '}
                required
              </label>
              <input
                disabled={!canAdmin}
                value={field.validation || ''}
                onChange={e => updateField(index, { validation: e.target.value })}
                placeholder="validation rule"
              />
            </div>
            <input
              disabled={!canAdmin}
              value={(field.permissions || []).join(', ')}
              onChange={e =>
                updateField(index, {
                  permissions: e.target.value
                    .split(',')
                    .map(x => x.trim())
                    .filter(Boolean)
                })
              }
              placeholder="permissions"
            />
            <div>
              <button
                type="button"
                className="icon-button subtle"
                disabled={!canAdmin || index === 0}
                onClick={() => moveField(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button subtle"
                disabled={!canAdmin || index === fields.length - 1}
                onClick={() => moveField(index, 1)}
              >
                ↓
              </button>
              <button
                aria-label="Delete"
                type="button"
                className="icon-button subtle danger-icon"
                disabled={!canAdmin}
                onClick={() => updateFields(fields.filter((_, i) => i !== index))}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
