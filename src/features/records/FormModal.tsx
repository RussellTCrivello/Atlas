// The dialog for creating and editing every kind of record. What it asks for comes from form-specs.ts; this file is how it
// behaves: required fields are marked and checked, a problem is shown beside the field it belongs to (and summarised, and the
// first one is focused), unsaved edits are noticed and never thrown away without asking, and a record can be saved in four ways:
// Save, Save and continue editing, Save and create another, or not at all (Cancel, Reset).
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, errorMessage } from '../../lib/api'
import { tr } from '../../lib/i18n'
import { roleDefinitions } from '../../lib/roles'
import { useApp } from '../../ui/app-context'
import { confirmAction } from '../../ui/confirm'
import { CustomFieldInputs } from '../../ui/custom-fields'
import { Icon } from '../../ui/icons'
import { useDialogKeys } from '../../ui/use-dialog'
import { type FieldSpec, type RecordType, carryOver, customFieldsOf, presetsFor, specsFor } from './form-specs'
import { TagInput } from './TagInput'

type SaveMode = 'close' | 'stay' | 'another'

interface Props {
  modal: { type: RecordType; record?: any; nonce?: number } | null
  data: any
  user: any
  onClose: () => void
  /** Create or update. Resolves with the saved record so the dialog can carry on editing it. */
  onSave: (type: RecordType, record: any, form: any) => Promise<any>
  onDelete?: (type: RecordType, record: any) => void
  /** Show another record (or a new one with these starting values) in the same dialog. */
  onReopen?: (type: RecordType, record: any) => void
}

/** Turn a failed save into messages beside the fields they are about, plus whatever is left over for the summary. */
export function explainFailure(
  error: unknown,
  fields: Set<string>
): { byField: Record<string, string>; message: string } {
  const byField: Record<string, string> = {}
  const details = (error as any)?.details
  if (Array.isArray(details))
    for (const issue of details) {
      const name = String(issue?.field || '').split('.')[0]
      if (fields.has(name) && !byField[name]) byField[name] = String(issue.message)
    }
  if ((error as any)?.code === 'DUPLICATE_CODE' && fields.has('code')) byField.code = errorMessage(error)
  return { byField, message: errorMessage(error) }
}

export function FormModal({ modal, data, user, onClose, onSave, onDelete, onReopen }: Props) {
  const type = modal?.type
  const record = modal?.record
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const [form, setForm] = useState<any>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState<SaveMode | ''>('')
  const [tagNames, setTagNames] = useState<string[]>([])
  // What the form looked like when it opened (or was last saved): `dirty` is whether it differs from that.
  const [baseline, setBaseline] = useState('')
  const [loadedKey, setLoadedKey] = useState('')
  const dialogRef = useRef<HTMLFormElement>(null)
  const focusedInvalid = useRef(false)
  const titleId = useId()
  const dirty = Boolean(type) && JSON.stringify(form) !== baseline

  const requestClose = async () => {
    if (
      dirty &&
      !(await confirmAction({
        title: t('Discard your changes?'),
        message: t('Your edits to this record have not been saved.'),
        confirmLabel: t('Discard changes'),
        cancelLabel: t('Keep editing'),
        tone: 'danger'
      }))
    )
      return
    onClose()
  }
  // Focus goes to the first field, not to the close button that comes first in the page.
  const firstField = useMemo(
    () => ({
      get current() {
        return (
          dialogRef.current?.querySelector<HTMLElement>(
            '.form-fields input:not([type="checkbox"]), .form-fields select, .form-fields textarea'
          ) ?? null
        )
      }
    }),
    []
  )
  const onKeyDown = useDialogKeys(dialogRef, Boolean(type), requestClose, firstField)

  // Leaving the page with edits in the box asks first (the browser shows its own prompt for this).
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const context = useMemo(
    () => ({
      data: { ...data, settings: data.settings || settings },
      user,
      record,
      isEdit: Boolean(record?.numericId || record?.id),
      settings
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, user, record, settings]
  )

  // When the dialog is pointed at another record (or a new one), the form is rebuilt in the same render, not in an effect after it:
  // otherwise the heading would already say "Edit task" while the fields still held the old values, and anything typed in between
  // would be lost (and the form would look edited when it was not).
  const key = type ? `${type}|${record?.numericId ?? record?.id ?? ''}|${modal?.nonce ?? ''}` : ''
  if (key !== loadedKey) {
    setLoadedKey(key)
    if (type) {
      const start = presetsFor(type, context)
      setBaseline(JSON.stringify(start))
      setForm(start)
      setErrors({})
      setFailure('')
    }
  }

  // Existing tags are offered while typing one (only task forms use them).
  useEffect(() => {
    if (type !== 'task') return
    let alive = true
    api
      .get('/api/tags')
      .then(result => alive && setTagNames((result.tags || []).map((tag: any) => tag.name)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [type])

  if (!type) return null
  const isEdit = context.isEdit
  const specs = specsFor(type, context, form)
  const known = new Set(specs.map(spec => spec.name))
  const fieldDefs = customFieldsOf(data.settings || settings, type)
  const roles = roleDefinitions(data.settings || settings)
  const set = (name: string, value: any) => {
    setForm((current: any) => ({ ...current, [name]: value }))
    setErrors(current => {
      if (!current[name]) return current
      const { [name]: _gone, ...rest } = current
      void _gone
      return rest
    })
  }
  const reset = () => {
    setForm(JSON.parse(baseline || '{}'))
    setErrors({})
    setFailure('')
  }

  const invalidMessage = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, spec?: FieldSpec) => {
    const v = el.validity
    if (v.valueMissing) return t('This field is required')
    if (v.patternMismatch)
      return spec?.patternHint
        ? t('Use {hint}', { hint: spec.patternHint })
        : t('This value is not in the expected format')
    if (v.typeMismatch) return t('Enter a valid value')
    if (v.tooShort) return t('Use at least {count} characters', { count: spec?.minLength ?? 0 })
    if (v.rangeUnderflow || v.rangeOverflow)
      return t('Enter a number between {min} and {max}', { min: spec?.min ?? 0, max: spec?.max ?? 100 })
    return el.validationMessage || t('This value is not valid')
  }
  const onInvalid = (event: FormEvent, spec: FieldSpec) => {
    // The browser still refuses to submit; we say why next to the field instead of in a bubble that disappears.
    event.preventDefault()
    const el = event.currentTarget as HTMLInputElement
    setErrors(current => ({ ...current, [spec.name]: invalidMessage(el, spec) }))
    if (!focusedInvalid.current) {
      focusedInvalid.current = true
      el.focus()
    }
  }
  const onBlurCheck = (spec: FieldSpec, el: HTMLInputElement) => {
    if (!el.validity.valid) setErrors(current => ({ ...current, [spec.name]: invalidMessage(el, spec) }))
  }

  const submit = async (mode: SaveMode, event?: FormEvent) => {
    event?.preventDefault()
    if (busy) return
    setFailure('')
    setErrors({})
    setBusy(mode)
    try {
      const saved = await onSave(type, record, form)
      setBaseline(JSON.stringify(form))
      if (mode === 'close' || !onReopen) onClose()
      else if (mode === 'stay') onReopen(type, saved && (saved.numericId || saved.id) ? saved : record)
      else onReopen(type, carryOver(type, form))
    } catch (error) {
      const { byField, message } = explainFailure(error, known)
      setErrors(byField)
      setFailure(message)
      const first = Object.keys(byField)[0]
      if (first) setTimeout(() => dialogRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus(), 0)
    } finally {
      setBusy('')
    }
  }

  // The two extra save buttons go through the browser's own validation too (so required fields are enforced the same way).
  const submitVia = (mode: SaveMode) => {
    const formElement = dialogRef.current
    if (!formElement) return
    focusedInvalid.current = false
    if (formElement.checkValidity()) void submit(mode)
  }

  const renderField = (spec: FieldSpec) => {
    const id = `${titleId}-${spec.name}`
    const error = errors[spec.name]
    const aria = {
      'aria-invalid': error ? true : undefined,
      'aria-describedby':
        [error ? `${id}-error` : '', spec.hint ? `${id}-hint` : ''].filter(Boolean).join(' ') || undefined
    }
    const value = form[spec.name]
    const common = {
      id,
      name: spec.name,
      required: spec.required,
      ...aria,
      onInvalid: (event: FormEvent) => onInvalid(event, spec),
      onBlur: (event: any) => onBlurCheck(spec, event.currentTarget)
    }
    let control
    switch (spec.kind) {
      case 'checkbox':
        return (
          <label className="checkbox-label" key={spec.name}>
            <input
              type="checkbox"
              name={spec.name}
              checked={spec.name === 'active' || spec.name === 'mustChangePassword' ? value !== false : Boolean(value)}
              onChange={event => set(spec.name, event.target.checked)}
            />{' '}
            {t(spec.label)}
          </label>
        )
      case 'select':
        control = (
          <select {...common} value={value ?? ''} onChange={event => set(spec.name, event.target.value)}>
            {(spec.options || []).map(option => (
              <option key={`${option.value}`} value={option.value}>
                {t(String(option.label))}
              </option>
            ))}
          </select>
        )
        break
      case 'textarea':
        control = (
          <textarea
            {...common}
            autoFocus={spec.autoFocus}
            rows={spec.rows}
            maxLength={spec.maxLength}
            value={value ?? ''}
            onChange={event => set(spec.name, event.target.value)}
          />
        )
        break
      case 'tags':
        control = (
          <TagInput
            inputId={id}
            value={Array.isArray(value) ? value : []}
            onChange={tags => set(spec.name, tags)}
            suggestions={tagNames}
            describedBy={aria['aria-describedby']}
            invalid={Boolean(error)}
          />
        )
        break
      default:
        control = (
          <input
            {...common}
            autoFocus={spec.autoFocus}
            type={spec.kind === 'text' ? 'text' : spec.kind}
            maxLength={spec.maxLength}
            minLength={spec.minLength}
            min={spec.min}
            max={spec.max}
            pattern={spec.pattern}
            autoComplete={spec.autoComplete}
            title={spec.patternHint}
            value={value ?? ''}
            onChange={event => set(spec.name, spec.upper ? event.target.value.toUpperCase() : event.target.value)}
          />
        )
    }
    const near = spec.maxLength && typeof value === 'string' && value.length >= spec.maxLength * 0.9
    return (
      <div className="field" key={spec.name} data-invalid={error ? 'true' : undefined}>
        <label htmlFor={id}>
          {t(spec.label)}
          {spec.required && (
            <span className="req" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
        {control}
        {spec.hint && !error && (
          <span className="field-hint" id={`${id}-hint`}>
            {t(spec.hint)}
          </span>
        )}
        {near ? (
          <span className="field-hint" aria-live="polite">
            {value.length}/{spec.maxLength}
          </span>
        ) : null}
        {error && (
          <span className="field-error" id={`${id}-error`}>
            <Icon name="warning" size={12} /> {error}
          </span>
        )}
      </div>
    )
  }

  // Fields that share a row sit side by side; the order of the spec is the order on screen.
  const rows: (FieldSpec | FieldSpec[])[] = []
  for (const spec of specs) {
    const last = rows[rows.length - 1]
    if (spec.row && Array.isArray(last) && last[0].row === spec.row) last.push(spec)
    else rows.push(spec.row ? [spec] : spec)
  }
  const title = `${isEdit ? 'Edit' : type === 'activity' ? 'Log' : 'Create'} ${type}`
  const note = type === 'user' ? roles[form.role || 'Viewer']?.summary || roles[form.role || 'Viewer']?.description : ''
  const errorCount = Object.keys(errors).length
  return (
    <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && !dirty && onClose()}>
      <form
        className="modal record-modal"
        onSubmit={event => submit('close', event)}
        onClickCapture={event => {
          // a fresh attempt to save: the first problem it finds gets the focus again
          if ((event.target as HTMLElement).closest('button[type="submit"], [data-save]'))
            focusedInvalid.current = false
        }}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">
              <span className="eyebrow-dot" /> Atlas record
            </span>
            <h2 id={titleId}>{title}</h2>
            <p>
              {t("Changes are saved to this workspace's data store when you press Save.")}{' '}
              {dirty && (
                <span className="dirty-badge" role="status">
                  {t('Unsaved changes')}
                </span>
              )}
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={requestClose}>
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="form-fields">
          <p className="required-legend">
            <span aria-hidden="true">*</span> {t('Required')}
          </p>
          {rows.map((row, index) =>
            Array.isArray(row) ? (
              <div className="form-row" key={index}>
                {row.map(renderField)}
              </div>
            ) : (
              renderField(row)
            )
          )}
          {note && (
            <div className="settings-note">
              <Icon name="check" size={15} />
              <span>{note}</span>
            </div>
          )}
          <CustomFieldInputs
            definitions={fieldDefs}
            values={form.customFields || {}}
            onChange={value => set('customFields', value)}
          />
          {(failure || errorCount > 0) && (
            <div className="form-error" role="alert">
              <Icon name="warning" size={15} />
              <div>
                {failure && <div>{failure}</div>}
                {errorCount > 1 && (
                  <div className="form-error-count">{t('{count} fields need attention', { count: errorCount })}</div>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot record-foot">
          {isEdit && onDelete && (
            <button type="button" className="secondary-button danger-button" onClick={() => onDelete(type, record)}>
              Delete
            </button>
          )}
          <span />
          <button
            type="button"
            className="text-button"
            disabled={!dirty || Boolean(busy)}
            onClick={reset}
            title={t('Put every field back as it was when this dialog opened')}
          >
            {t('Reset')}
          </button>
          <button type="button" className="secondary-button" onClick={requestClose}>
            Cancel
          </button>
          {onReopen && type !== 'activity' && (
            <button
              type="button"
              className="secondary-button"
              data-save="stay"
              disabled={Boolean(busy)}
              onClick={() => submitVia('stay')}
            >
              {busy === 'stay' ? t('Saving…') : t('Save & continue')}
            </button>
          )}
          {onReopen && (
            <button
              type="button"
              className="secondary-button"
              data-save="another"
              disabled={Boolean(busy)}
              onClick={() => submitVia('another')}
            >
              {busy === 'another' ? t('Saving…') : t('Save & create another')}
            </button>
          )}
          <button className="primary-button" disabled={Boolean(busy)}>
            {busy === 'close' ? 'Saving…' : 'Save'} <Icon name="arrow" size={14} />
          </button>
        </div>
      </form>
    </div>
  )
}
