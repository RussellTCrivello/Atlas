// Changing a password: the form, and the screen shown when a change is required before anything else.
import { useState } from 'react'
import { validatePassword, passwordStrength } from '../../../shared/password'
import { api, errorMessage } from '../../lib/api'
import { tr } from '../../lib/i18n'
import { Icon } from '../../ui/icons'
import { useApp } from '../../ui/app-context'

export function PasswordForm({ user, minLength, onDone, submitLabel = 'Change password' }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const problem = next ? validatePassword(next, { minLength, email: user?.email, name: user?.name }) : null
  const mismatch = confirm && next !== confirm
  const strength = passwordStrength(next)
  const submit = async e => {
    e.preventDefault()
    if (problem || mismatch) return
    setBusy(true)
    setError('')
    try {
      const result = await api.post('/api/auth/password', { currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setConfirm('')
      onDone?.(result)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="password-form" onSubmit={submit}>
      <label>
        Current password
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          required
        />
      </label>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={e => setNext(e.target.value)}
          required
          aria-describedby="new-password-help"
        />
      </label>
      <div className={`password-meter strength-${next ? strength : 'none'}`} aria-hidden="true">
        <span style={{ width: `${next ? { weak: 33, fair: 66, strong: 100 }[strength] : 0}%` }} />
      </div>
      <small className="setup-small" id="new-password-help" role="status">
        {problem || `At least ${minLength || 8} characters. A longer passphrase is stronger.`}
      </small>
      <label>
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          required
        />
      </label>
      {mismatch && (
        <small className="setup-small" role="status">
          The two passwords do not match.
        </small>
      )}
      {error && (
        <div className="form-error" role="alert">
          <Icon name="warning" size={15} />
          {error}
        </div>
      )}
      <button className="primary-button" disabled={busy || !current || !next || Boolean(problem) || Boolean(mismatch)}>
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  )
}

export function PasswordChangeScreen({ user, minLength, onDone, onLogout }) {
  const { settings } = useApp()
  return (
    <div className="login-shell">
      <div className="login-panel" style={{ margin: 'auto' }}>
        <div className="login-form">
          <span className="eyebrow">
            <span className="eyebrow-dot" /> One more step
          </span>
          <h2>Choose a new password</h2>
          <p>
            {tr(settings, 'An administrator set the password for {email}. Choose your own before continuing.', {
              email: user?.email
            })}
          </p>
          <PasswordForm user={user} minLength={minLength} onDone={onDone} submitLabel="Save and continue" />
          <button type="button" className="text-button" onClick={onLogout}>
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  )
}
