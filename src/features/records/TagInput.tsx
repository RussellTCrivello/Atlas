// Tags as chips: type a name and press Enter or comma to add it, Backspace on an empty box removes the last one. Existing tags
// are offered as suggestions, so people reuse names instead of spelling the same tag three ways.
import { useId, useState } from 'react'
import { tr } from '../../lib/i18n'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: string[]
  inputId?: string
  describedBy?: string
  invalid?: boolean
}

export function TagInput({ value, onChange, suggestions = [], inputId, describedBy, invalid }: Props) {
  const { settings } = useApp()
  const [draft, setDraft] = useState('')
  const listId = useId()
  const add = (raw: string) => {
    const names = raw
      .split(',')
      .map(part => part.trim().slice(0, 40))
      .filter(Boolean)
    if (!names.length) return
    const next = [...value]
    for (const name of names)
      if (!next.some(tag => tag.toLowerCase() === name.toLowerCase()) && next.length < 20) next.push(name)
    onChange(next)
    setDraft('')
  }
  return (
    <div className="tag-input" data-invalid={invalid ? 'true' : undefined}>
      {value.map(tag => (
        <span className="tag-chip" key={tag}>
          {tag}
          <button
            type="button"
            className="tag-remove"
            aria-label={tr(settings, 'Remove tag {name}', { name: tag })}
            onClick={() => onChange(value.filter(item => item !== tag))}
          >
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
      <input
        id={inputId}
        value={draft}
        list={listId}
        maxLength={40}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        placeholder={value.length ? '' : tr(settings, 'Add a tag')}
        onChange={event => (event.target.value.includes(',') ? add(event.target.value) : setDraft(event.target.value))}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            // Enter adds the tag; it must not submit the whole form while a tag is being typed.
            if (draft.trim()) {
              event.preventDefault()
              add(draft)
            }
          } else if (event.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id={listId}>
        {suggestions
          .filter(name => !value.some(tag => tag.toLowerCase() === name.toLowerCase()))
          .map(name => (
            <option key={name} value={name} />
          ))}
      </datalist>
    </div>
  )
}
