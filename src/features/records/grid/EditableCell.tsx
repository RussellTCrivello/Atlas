// A cell that can be changed in place. A choice (status, priority, owner) is a list that saves as soon as it changes; text and
// dates are shown as text with an edit button: Enter or leaving the box saves, Escape puts the old value back. When the server
// refuses (a rule, a permission) the message appears under the cell and nothing changes.
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { errorMessage } from '../../../lib/api'
import { tr } from '../../../lib/i18n'
import { useApp } from '../../../ui/app-context'
import { Icon } from '../../../ui/icons'

export interface InlineEdit<Row> {
  kind: 'text' | 'date' | 'select'
  options?: (row: Row) => { value: string; label: string }[]
  get: (row: Row) => string
  /** Save the new value. Throw (with a message) to refuse it. */
  save: (row: Row, value: string) => Promise<void>
  /** What the control is called for people who cannot see it ("Status of PAY-3"). */
  label: (row: Row) => string
  maxLength?: number
  required?: boolean
  /** Which rows this applies to (default: all). A row it does not apply to shows its value without an edit control. */
  enabled?: (row: Row) => boolean
  /** A list is always shown as a list (no click needed); other kinds show text until edited. */
  always?: boolean
  className?: string
}

export function EditableCell<Row>({ row, edit, children }: { row: Row; edit: InlineEdit<Row>; children: ReactNode }) {
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const current = edit.get(row)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement | HTMLSelectElement>(null)
  // Set once the person has finished with the box (Enter, Escape or leaving it). A browser may also report a blur when the box is
  // removed from the page; that must neither save a value that was just cancelled nor save the same value twice.
  const finished = useRef(false)
  useEffect(() => setValue(current), [current])
  useEffect(() => {
    if (editing) {
      finished.current = false
      input.current?.focus()
    }
  }, [editing])
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(''), 7000)
    return () => clearTimeout(timer)
  }, [error])

  const commit = async (next: string) => {
    if (busy) return
    if (edit.required && !next.trim()) {
      setError(t('This field is required'))
      finished.current = false
      return
    }
    if (next === current) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError('')
    try {
      await edit.save(row, next)
      setEditing(false)
    } catch (failure) {
      setError(errorMessage(failure))
      setValue(current)
      finished.current = false
      if (edit.kind !== 'select') input.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  if (edit.kind === 'select' && (edit.always || editing))
    return (
      <div className="cell-editor">
        <select
          ref={input as React.RefObject<HTMLSelectElement>}
          className={edit.className}
          aria-label={edit.label(row)}
          aria-invalid={error ? true : undefined}
          value={value}
          disabled={busy}
          onChange={event => {
            setValue(event.target.value)
            void commit(event.target.value)
          }}
          onClick={event => event.stopPropagation()}
          onBlur={() => !edit.always && setEditing(false)}
        >
          {[
            ...new Map(
              [...(edit.options?.(row) || []), { value: current, label: current }].map(o => [o.value, o])
            ).values()
          ].map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {error && (
          <span className="cell-error" role="alert">
            {error}
          </span>
        )}
      </div>
    )
  if (editing)
    return (
      <div className="cell-editor">
        <input
          ref={input as React.RefObject<HTMLInputElement>}
          type={edit.kind === 'date' ? 'date' : 'text'}
          aria-label={edit.label(row)}
          aria-invalid={error ? true : undefined}
          maxLength={edit.maxLength}
          value={value}
          disabled={busy}
          onClick={event => event.stopPropagation()}
          onChange={event => setValue(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              finished.current = true
              void commit(value)
            } else if (event.key === 'Escape') {
              event.stopPropagation()
              finished.current = true
              setValue(current)
              setError('')
              setEditing(false)
            }
          }}
          onBlur={() => {
            if (finished.current || error) return
            finished.current = true
            void commit(value)
          }}
        />
        {error && (
          <span className="cell-error" role="alert">
            {error}
          </span>
        )}
      </div>
    )
  return (
    <div className="cell-view">
      <div className="cell-content">{children}</div>
      <button
        type="button"
        className="cell-edit-button"
        aria-label={`${t('Edit')}: ${edit.label(row)}`}
        title={t('Edit here (or press F2 on the row)')}
        onClick={event => {
          event.stopPropagation()
          setEditing(true)
        }}
      >
        <Icon name="edit" size={12} />
      </button>
    </div>
  )
}
