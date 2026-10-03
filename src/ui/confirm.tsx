// Confirmation before something that cannot be taken back lightly. It replaces the browser's own confirm() with a real dialog:
// labelled, with the safe choice focused first, Escape to cancel, focus returned to where it came from, and a message that says
// how many records are affected and whether the action can be undone. Called as a function so that any code can ask:
//   if (await confirmAction({ title: 'Delete 3 tasks?', tone: 'danger', ... })) ...
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { tr } from '../lib/i18n'
import { useApp } from './app-context'
import { Icon } from './icons'
import { useDialogKeys } from './use-dialog'

export interface ConfirmOptions {
  title: string
  message?: ReactNode
  /** Lines that spell out what goes with it ("12 tasks", "3 milestones"). */
  details?: string[]
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  /** Says plainly that there is no way back. */
  irreversible?: boolean
  /** Says plainly how it can be undone ("You can undo this for 30 days."). */
  undoHint?: string
  /** An extra choice shown with the question ("Also copy its tasks"); its answer comes back from `askAction`. */
  checkbox?: { label: string; checked?: boolean }
  /** The person must type this (usually the number of records) before the button works: for the largest destructive actions. */
  typeToConfirm?: string
}

export interface Answer {
  confirmed: boolean
  /** The state of the extra checkbox, if the question had one. */
  checked: boolean
}
interface Pending extends ConfirmOptions {
  resolve: (answer: Answer) => void
}

let host: ((options: Pending) => void) | null = null

/** Ask, and get the answer together with the state of the extra checkbox (if the question has one). */
export function askAction(options: ConfirmOptions): Promise<Answer> {
  if (!host) {
    // The host is mounted with the app; if something asks before that, fall back to the browser rather than act unasked.
    const confirmed = window.confirm([options.title, options.message].filter(x => typeof x === 'string').join('\n'))
    return Promise.resolve({ confirmed, checked: Boolean(options.checkbox?.checked) })
  }
  return new Promise(resolve => host!({ ...options, resolve }))
}

/** Ask. Resolves true when the person confirms, false when they cancel (button, Escape or backdrop). */
export const confirmAction = async (options: ConfirmOptions): Promise<boolean> => (await askAction(options)).confirmed
export const useConfirm = () => confirmAction

export function ConfirmHost() {
  const { settings } = useApp()
  const [queue, setQueue] = useState<Pending[]>([])
  useEffect(() => {
    host = pending => setQueue(current => [...current, pending])
    return () => {
      host = null
    }
  }, [])
  const current = queue[0]
  if (!current) return null
  const answer = (value: Answer) => {
    current.resolve(value)
    setQueue(list => list.slice(1))
  }
  return (
    <ConfirmDialog
      key={queue.length + (current.title || '')}
      options={current}
      onAnswer={answer}
      t={(phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)}
    />
  )
}

function ConfirmDialog({
  options,
  onAnswer,
  t
}: {
  options: Pending
  onAnswer: (value: Answer) => void
  t: (phrase: string, values?: Record<string, unknown>) => string
}) {
  const id = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const [typed, setTyped] = useState('')
  const [checked, setChecked] = useState(Boolean(options.checkbox?.checked))
  const say = (confirmed: boolean) => onAnswer({ confirmed, checked })
  const danger = options.tone === 'danger'
  const locked = Boolean(options.typeToConfirm) && typed.trim() !== options.typeToConfirm
  // The safe choice has focus: Enter on a destructive prompt cancels, it never deletes by accident.
  const onKeyDown = useDialogKeys(dialog, true, () => say(false), danger ? cancel : confirm)
  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={event => event.target === event.currentTarget && say(false)}
    >
      <div
        ref={dialog}
        className={`modal confirm-dialog ${danger ? 'confirm-danger' : ''}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        onKeyDown={onKeyDown}
      >
        <div className="confirm-head">
          <span className={`confirm-icon ${danger ? 'danger' : ''}`} aria-hidden="true">
            <Icon name={danger ? 'warning' : 'check'} size={18} />
          </span>
          <h2 id={`${id}-title`}>{options.title}</h2>
        </div>
        <div className="confirm-body" id={`${id}-body`}>
          {options.message && <p>{options.message}</p>}
          {options.details?.length ? (
            <ul className="confirm-details">
              {options.details.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {options.irreversible && (
            <p className="confirm-warning">
              <strong>{t('This cannot be undone.')}</strong>
            </p>
          )}
          {options.undoHint && <p className="confirm-undo">{options.undoHint}</p>}
          {options.checkbox && (
            <label className="checkbox-label confirm-check">
              <input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />{' '}
              {options.checkbox.label}
            </label>
          )}
          {options.typeToConfirm && (
            <label className="confirm-type">
              {t('Type {text} to confirm', { text: options.typeToConfirm })}
              <input
                value={typed}
                onChange={event => setTyped(event.target.value)}
                autoComplete="off"
                inputMode="numeric"
                aria-label={t('Type {text} to confirm', { text: options.typeToConfirm })}
              />
            </label>
          )}
        </div>
        <div className="modal-foot">
          <button ref={cancel} type="button" className="secondary-button" onClick={() => say(false)}>
            {options.cancelLabel || t('Cancel')}
          </button>
          <button
            ref={confirm}
            type="button"
            className={danger ? 'primary-button danger-solid' : 'primary-button'}
            disabled={locked}
            onClick={() => say(true)}
          >
            {options.confirmLabel || t('Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
