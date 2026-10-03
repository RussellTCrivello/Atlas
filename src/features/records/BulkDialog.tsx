// Doing one thing to many records. The dialog says how many records it will touch (and that nothing else is touched), asks for
// what the action needs, runs it in batches with a progress bar the person can stop, and ends with an exact report: how many
// changed, which ones could not be and why, and how many were never attempted. Used for tasks, projects, people and alerts.
import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { type BulkProgress, type BulkResult, newBatchId, runBulk, summarize } from '../../lib/bulk'
import { tr } from '../../lib/i18n'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { useDialogKeys } from '../../ui/use-dialog'
import { TagInput } from './TagInput'

export interface BulkField {
  name: string
  label: string
  kind: 'select' | 'text' | 'date' | 'tags' | 'checkbox'
  options?: { value: string; label: string }[]
  required?: boolean
  hint?: string
}
export interface BulkSpec {
  title: string
  noun: string
  endpoint: string
  ids: (string | number)[]
  /** The fixed part of every request: `{ action: 'status' }`. */
  action: Record<string, unknown>
  fields: BulkField[]
  /** Turn the form into the rest of the request, or refuse it with a message (per field, or '' for the form as a whole). */
  build?: (values: Record<string, any>) => { body?: Record<string, unknown>; errors?: Record<string, string> }
  confirmLabel: (count: number) => string
  /** Past tense for the notification: "Changed". */
  verb: string
  danger?: boolean
  irreversible?: boolean
  undoHint?: string
  /** For deletes: all chunks share one batch so one Undo restores them. */
  groupAsOneUndo?: boolean
  intro?: ReactNode
  suggestions?: string[]
  /** Called as soon as the run ends, so the list behind the dialog can refresh while the report is still showing. */
  onDone: (result: BulkResult, spec: BulkSpec) => void
}

const TYPE_TO_CONFIRM_FROM = 50

export function BulkDialog({ spec, onClose }: { spec: BulkSpec; onClose: () => void }) {
  const { settings, notify } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const id = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const [values, setValues] = useState<Record<string, any>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [phase, setPhase] = useState<'form' | 'running' | 'done'>('form')
  const [progress, setProgress] = useState<BulkProgress>({ done: 0, total: spec.ids.length, succeeded: 0, failed: 0 })
  const [result, setResult] = useState<BulkResult | null>(null)
  const [typed, setTyped] = useState('')
  const stop = useRef({ aborted: false })
  const count = new Set(spec.ids).size
  const mustType = spec.danger && count >= TYPE_TO_CONFIRM_FROM
  const locked = Boolean(mustType) && typed.trim() !== String(count)
  const onKeyDown = useDialogKeys(dialog, true, () => phase !== 'running' && onClose())

  const set = (name: string, value: any) => {
    setValues(current => ({ ...current, [name]: value }))
    setErrors(current => ({ ...current, [name]: '', '': '' }))
  }
  const run = async () => {
    const found: Record<string, string> = {}
    for (const field of spec.fields)
      if (field.required && !String(values[field.name] ?? '').trim()) found[field.name] = t('This field is required')
    const built = spec.build?.(values)
    Object.assign(found, built?.errors || {})
    if (Object.values(found).some(Boolean)) {
      setErrors(found)
      return
    }
    stop.current = { aborted: false }
    setPhase('running')
    const batch = spec.groupAsOneUndo ? newBatchId() : undefined
    const outcome = await runBulk({
      endpoint: spec.endpoint,
      ids: spec.ids,
      body: { ...spec.action, ...(built?.body || {}) },
      signal: stop.current,
      onProgress: setProgress,
      batch
    })
    setResult(outcome)
    setPhase('done')
    spec.onDone(outcome, spec)
    if (!outcome.error && !outcome.failed.length && !outcome.notAttempted)
      notify({ title: summarize(outcome, spec.noun, spec.verb), tone: 'success' })
  }

  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const fieldControl = (field: BulkField) => {
    const fid = `${id}-${field.name}`
    const error = errors[field.name]
    const aria = { 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${fid}-error` : undefined }
    let control: ReactNode
    if (field.kind === 'select')
      control = (
        <select
          id={fid}
          {...aria}
          value={values[field.name] ?? ''}
          onChange={event => set(field.name, event.target.value)}
        >
          {(field.options || []).map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    else if (field.kind === 'tags')
      control = (
        <TagInput
          inputId={fid}
          value={values[field.name] || []}
          onChange={tags => set(field.name, tags)}
          suggestions={spec.suggestions}
          describedBy={aria['aria-describedby']}
          invalid={Boolean(error)}
        />
      )
    else if (field.kind === 'checkbox')
      return (
        <label className="checkbox-label" key={field.name}>
          <input
            type="checkbox"
            checked={Boolean(values[field.name])}
            onChange={event => set(field.name, event.target.checked)}
          />{' '}
          {field.label}
        </label>
      )
    else
      control = (
        <input
          id={fid}
          {...aria}
          type={field.kind === 'date' ? 'date' : 'text'}
          value={values[field.name] ?? ''}
          onChange={event => set(field.name, event.target.value)}
        />
      )
    return (
      <div className="field" key={field.name} data-invalid={error ? 'true' : undefined}>
        <label htmlFor={fid}>
          {field.label}
          {field.required && (
            <span className="req" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
        {control}
        {field.hint && !error && <span className="field-hint">{field.hint}</span>}
        {error && (
          <span className="field-error" id={`${fid}-error`}>
            <Icon name="warning" size={12} /> {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={event => event.target === event.currentTarget && phase !== 'running' && onClose()}
    >
      <div
        ref={dialog}
        className="modal bulk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <div>
            <h2 id={`${id}-title`}>{spec.title}</h2>
          </div>
          {phase !== 'running' && (
            <button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}>
              <Icon name="close" size={17} />
            </button>
          )}
        </div>
        <div className="bulk-body" id={`${id}-body`}>
          {phase === 'form' && (
            <>
              <p className="bulk-scope">
                {t('This applies to {count} {noun}: the ones you selected. Nothing else is touched.', {
                  count: count.toLocaleString('en'),
                  noun: spec.noun
                })}
              </p>
              {spec.intro}
              {spec.fields.length > 0 && <div className="form-fields bulk-fields">{spec.fields.map(fieldControl)}</div>}
              {errors[''] && (
                <div className="form-error" role="alert">
                  <Icon name="warning" size={15} /> {errors['']}
                </div>
              )}
              {spec.irreversible && (
                <p className="confirm-warning">
                  <strong>{t('This cannot be undone.')}</strong>
                </p>
              )}
              {spec.undoHint && <p className="confirm-undo">{spec.undoHint}</p>}
              {mustType && (
                <label className="confirm-type">
                  {t('Type {text} to confirm', { text: String(count) })}
                  <input
                    value={typed}
                    onChange={event => setTyped(event.target.value)}
                    autoComplete="off"
                    inputMode="numeric"
                    aria-label={t('Type {text} to confirm', { text: String(count) })}
                  />
                </label>
              )}
            </>
          )}
          {phase === 'running' && (
            <div className="bulk-progress" role="group" aria-label={t('Progress')}>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-label={t('Progress')}
                className="progress-track"
              >
                <span className="progress-fill fill-purple" style={{ width: `${percent}%` }} />
              </div>
              <p role="status" aria-live="polite">
                {t('{done} of {total} {noun} processed', {
                  done: progress.done.toLocaleString('en'),
                  total: progress.total.toLocaleString('en'),
                  noun: spec.noun
                })}
                {progress.failed > 0 && ` · ${t('{count} could not be changed', { count: progress.failed })}`}
              </p>
            </div>
          )}
          {phase === 'done' && result && <Report result={result} spec={spec} />}
        </div>
        <div className="modal-foot">
          {phase === 'form' && (
            <>
              <button type="button" className="secondary-button" onClick={onClose}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                className={spec.danger ? 'primary-button danger-solid' : 'primary-button'}
                disabled={locked || count === 0}
                onClick={run}
              >
                {spec.confirmLabel(count)}
              </button>
            </>
          )}
          {phase === 'running' && (
            <button type="button" className="secondary-button" onClick={() => (stop.current.aborted = true)}>
              {t('Stop after this batch')}
            </button>
          )}
          {phase === 'done' && (
            <button type="button" className="primary-button" autoFocus onClick={onClose}>
              {t('Close')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Report({ result, spec }: { result: BulkResult; spec: BulkSpec }) {
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const clean = !result.error && !result.failed.length && !result.notAttempted
  return (
    <div className="bulk-report" role="status" aria-live="polite">
      <p className={clean ? 'report-ok' : 'report-warn'}>
        <Icon name={clean ? 'check' : 'warning'} size={15} /> <strong>{summarize(result, spec.noun, spec.verb)}</strong>
      </p>
      {result.cancelled && <p>{t('You stopped the run. The rest were left exactly as they were.')}</p>}
      {result.error && (
        <p className="report-warn">
          {t('The run stopped because: {reason}', { reason: result.error })}{' '}
          {t('Nothing after that point was changed.')}
        </p>
      )}
      {result.failed.length > 0 && (
        <>
          <h3>{t('These could not be changed')}</h3>
          <div className="table-scroll report-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('Record')}</th>
                  <th scope="col">{t('Why')}</th>
                </tr>
              </thead>
              <tbody>
                {result.failed.slice(0, 100).map(failure => (
                  <tr key={String(failure.id)}>
                    <td>{failure.label}</td>
                    <td>{failure.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.failed.length > 100 && (
            <p className="menu-note">{t('…and {count} more.', { count: result.failed.length - 100 })}</p>
          )}
          <p className="menu-note">{t('They stay selected, so you can fix the cause and try again.')}</p>
        </>
      )}
    </div>
  )
}
