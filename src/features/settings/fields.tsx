// The building blocks of every settings panel: panel frame, inputs, toggles, selects, lists, JSON editor.
import { isNotApplied, NOT_APPLIED_HINT } from '../../lib/settings-status'
import { useMemo, useState, useEffect } from 'react'
import { Icon } from '../../ui/icons'

export function timeZoneOptions(current) {
  let zones = ['UTC']
  try {
    zones = ['UTC', ...(Intl as any).supportedValuesOf('timeZone')]
  } catch {
    /* older engines: fall back to the current value only */
  }
  return [...new Set([current, ...zones].filter(Boolean))]
}

export function SettingsPanel({ title, description = '', children, wide = false }) {
  return (
    <section className={`panel settings-card ${wide ? 'settings-card-wide' : ''}`}>
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

export function NotAppliedBadge({ path }) {
  return isNotApplied(path) ? (
    <span className="setting-badge" title={NOT_APPLIED_HINT}>
      Not applied yet
    </span>
  ) : null
}

export function SettingInput({
  label,
  value,
  onChange,
  disabled: disabledProp = false,
  type = 'text',
  textarea = false,
  path = '',
  placeholder = '',
  hint = ''
}: any) {
  const disabled = disabledProp || isNotApplied(path)
  return (
    <label>
      {label} <NotAppliedBadge path={path} />
      {textarea ? (
        <textarea
          disabled={disabled}
          value={value || ''}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          rows={3}
        />
      ) : (
        <input
          disabled={disabled}
          type={type}
          value={value ?? ''}
          placeholder={placeholder}
          onChange={e => onChange(type === 'number' ? Number(e.target.value) : e.target.value)}
        />
      )}
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function AdvancedSettingSelect({
  label,
  value,
  onChange,
  disabled: disabledProp,
  options,
  hint = '',
  path = ''
}) {
  const disabled = disabledProp || isNotApplied(path)
  return (
    <label>
      {label} <NotAppliedBadge path={path} />
      <select disabled={disabled} value={value ?? ''} onChange={e => onChange(e.target.value)}>
        {options.map(option =>
          Array.isArray(option) ? (
            <option key={option[0]} value={option[0]}>
              {option[1]}
            </option>
          ) : (
            <option key={option} value={option}>
              {option}
            </option>
          )
        )}
      </select>
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function AdvancedToggleSetting({
  label,
  checked,
  onChange,
  disabled: disabledProp,
  description = '',
  path = ''
}) {
  const disabled = disabledProp || isNotApplied(path)
  return (
    <label className="interface-toggle advanced-toggle">
      <input
        disabled={disabled}
        type="checkbox"
        checked={Boolean(checked)}
        onChange={e => onChange(e.target.checked)}
      />
      <span>
        <strong>
          {label} <NotAppliedBadge path={path} />
        </strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  )
}

export function AdvancedTextListSetting({
  label,
  value = [],
  onChange,
  disabled: disabledProp,
  hint = '',
  separator = 'newline',
  path = ''
}) {
  const disabled = disabledProp || isNotApplied(path)
  const text = Array.isArray(value) ? value.join(separator === 'comma' ? ', ' : '\n') : ''
  const parse = raw =>
    separator === 'comma'
      ? raw
          .split(',')
          .map(x => x.trim())
          .filter(Boolean)
      : raw
          .split('\n')
          .map(x => x.trim())
          .filter(Boolean)
  return (
    <label>
      {label} <NotAppliedBadge path={path} />
      <textarea disabled={disabled} value={text} onChange={e => onChange(parse(e.target.value))} rows={3} />
      {hint && <small>{hint}</small>}
    </label>
  )
}

export function AdvancedJsonConfigEditor({
  label,
  value,
  onChange,
  disabled: disabledProp,
  rows = 5,
  description = '',
  path = ''
}) {
  const disabled = disabledProp || isNotApplied(path)
  const serialized = useMemo(() => JSON.stringify(value ?? {}, null, 2), [value])
  const [text, setText] = useState(() => serialized)
  const [error, setError] = useState('')
  useEffect(() => {
    setText(serialized)
    setError('')
  }, [serialized])
  const apply = () => {
    try {
      onChange(JSON.parse(text || '{}'))
      setError('')
    } catch {
      setError('Invalid JSON. Changes were not applied.')
    }
  }
  return (
    <div className="json-editor">
      <label>
        {label} <NotAppliedBadge path={path} />
        <textarea
          disabled={disabled}
          value={text}
          onChange={e => setText(e.target.value)}
          rows={rows}
          spellCheck="false"
        />
        {description && <small>{description}</small>}
      </label>
      <div className="json-editor-actions">
        <button type="button" className="secondary-button" disabled={disabled} onClick={apply}>
          Apply JSON
        </button>
        {error && (
          <span className="form-error compact-error">
            <Icon name="warning" size={13} />
            {error}
          </span>
        )}
      </div>
    </div>
  )
}
