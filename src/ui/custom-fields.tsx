// Inputs for the custom fields an administrator defined for a kind of record.
export function CustomFieldInputs({ definitions = [], values = {}, onChange }) {
  if (!definitions.length) return null
  const setField = (key, value) => onChange({ ...(values || {}), [key]: value })
  return (
    <section className="custom-field-runtime">
      <strong>Configured fields</strong>
      {definitions
        .filter(field => field.visible !== false)
        .map(field => (
          <label key={field.key || field.name}>
            {field.label || field.key}
            <input
              type={
                field.type === 'number'
                  ? 'number'
                  : field.type === 'date'
                    ? 'date'
                    : field.type === 'datetime'
                      ? 'datetime-local'
                      : field.type === 'checkbox'
                        ? 'checkbox'
                        : 'text'
              }
              checked={field.type === 'checkbox' ? Boolean(values?.[field.key]) : undefined}
              value={field.type === 'checkbox' ? undefined : values?.[field.key] || ''}
              onChange={e => setField(field.key, field.type === 'checkbox' ? e.target.checked : e.target.value)}
              required={Boolean(field.required)}
            />
          </label>
        ))}
    </section>
  )
}
