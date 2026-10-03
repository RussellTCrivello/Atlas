// The controls in the filter row under the column headers: a text box, a pick-several list, a from/to range, a yes/no choice.
// Each one narrows the list further; clearing it widens the list again. Text is applied after a short pause in typing.
import { useEffect, useId, useRef, useState } from 'react'
import { type FilterValue } from '../../../lib/grid-model'
import { tr } from '../../../lib/i18n'
import { useApp } from '../../../ui/app-context'

interface Option {
  value: string
  label: string
}
interface Props {
  kind: 'text' | 'select' | 'dateRange' | 'number' | 'boolean'
  label: string
  value: FilterValue | undefined
  options?: Option[]
  onChange: (value: FilterValue) => void
  /** Pick one instead of several (the owner of a task). */
  single?: boolean
}

export function GridFilter({ kind, label, value, options = [], onChange, single }: Props) {
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  if (kind === 'text')
    return <TextFilter label={label} value={typeof value === 'string' ? value : ''} onChange={onChange} t={t} />
  if (kind === 'select')
    return (
      <PickFilter
        label={label}
        options={options}
        value={Array.isArray(value) ? value : value ? [String(value)] : []}
        onChange={onChange}
        single={single}
        t={t}
      />
    )
  if (kind === 'boolean')
    return (
      <select
        aria-label={`${t('Filter')} ${label}`}
        value={typeof value === 'string' ? value : ''}
        onChange={event => onChange(event.target.value)}
      >
        <option value="">{t('Any')}</option>
        <option value="true">{t('Yes')}</option>
        <option value="false">{t('No')}</option>
      </select>
    )
  const range = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as {
    from?: string
    to?: string
  }
  const type = kind === 'number' ? 'number' : 'date'
  return (
    <div className="range-filter">
      <input
        type={type}
        aria-label={`${label}: ${t('from')}`}
        value={range.from || ''}
        onChange={event => onChange({ ...range, from: event.target.value })}
      />
      <input
        type={type}
        aria-label={`${label}: ${t('to')}`}
        value={range.to || ''}
        onChange={event => onChange({ ...range, to: event.target.value })}
      />
    </div>
  )
}

function TextFilter({
  label,
  value,
  onChange,
  t
}: {
  label: string
  value: string
  onChange: (v: string) => void
  t: (p: string) => string
}) {
  const [draft, setDraft] = useState(value)
  const applied = useRef(value)
  // The box follows the grid when it is cleared from outside (Reset, Clear filters, a saved view).
  useEffect(() => {
    if (value !== applied.current) {
      applied.current = value
      setDraft(value)
    }
  }, [value])
  useEffect(() => {
    if (draft === applied.current) return
    const timer = setTimeout(() => {
      applied.current = draft
      onChange(draft)
    }, 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft])
  return (
    <input
      type="search"
      aria-label={`${t('Filter')} ${label}`}
      placeholder={t('Contains…')}
      value={draft}
      onChange={event => setDraft(event.target.value)}
    />
  )
}

function PickFilter({
  label,
  options,
  value,
  onChange,
  single,
  t
}: {
  label: string
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  single?: boolean
  t: (p: string, v?: Record<string, unknown>) => string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const summary = !value.length
    ? t('All')
    : value.length === 1
      ? options.find(option => option.value === value[0])?.label || value[0]
      : t('{count} selected', { count: value.length })
  const toggle = (optionValue: string) => {
    if (single) {
      onChange(value[0] === optionValue ? [] : [optionValue])
      setOpen(false)
    } else onChange(value.includes(optionValue) ? value.filter(v => v !== optionValue) : [...value, optionValue])
  }
  return (
    <div
      className="pick-filter"
      ref={box}
      onKeyDown={event => event.key === 'Escape' && open && (event.stopPropagation(), setOpen(false))}
    >
      <button
        type="button"
        className="pick-button"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${t('Filter')} ${label}: ${summary}`}
        onClick={() => setOpen(!open)}
      >
        <span>{summary}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="pick-list" id={`${id}-list`} role="group" aria-label={label}>
          {options.map(option => (
            <label key={option.value}>
              <input
                type={single ? 'radio' : 'checkbox'}
                name={id}
                checked={value.includes(option.value)}
                onChange={() => toggle(option.value)}
              />{' '}
              {option.label}
            </label>
          ))}
          {value.length > 0 && (
            <button type="button" className="text-button" onClick={() => onChange([])}>
              {t('Clear')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
