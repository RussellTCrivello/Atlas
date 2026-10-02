// The sign-in screen.
import { useState } from 'react'
import { errorMessage } from '../../lib/api'
import { Icon, Logo } from '../../ui/icons'
import { RoleBadge } from '../../ui/primitives'

export function LoginScreen({ onLogin, setup, notice = '' }) {
  const demoAccounts = setup?.demoAllowed ? setup?.demo?.accounts || [] : []
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async e => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await onLogin(email, password)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }
  const choose = account => {
    setEmail(account.email)
    setPassword(account.password)
  }
  return (
    <div className="login-shell">
      <div className="login-art">
        <div className="login-art-inner">
          <div className="brand login-brand">
            <Logo />
            <span>atlas</span>
          </div>
          <div className="login-quote">
            <span className="eyebrow">
              <span className="eyebrow-dot" /> Production workspace access
            </span>
            <h1>
              Sign in with
              <br />
              <em>confidence.</em>
            </h1>
            <p>Secure access for your workspace.</p>
          </div>
          <div className="login-art-footer">
            <span>Atlas Workspace</span>
            <span>Production workspace</span>
          </div>
        </div>
      </div>
      <div className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <span className="eyebrow">
            <span className="eyebrow-dot" /> Secure access
          </span>
          <h2>Sign in to Atlas</h2>
          <p>Sign in with your workspace account.</p>
          <label>
            Email address
            <input
              value={email}
              onChange={e => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              required
              autoFocus
            />
          </label>
          <label>
            Password
            <input
              value={password}
              onChange={e => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          {notice && !error && (
            <div className="form-notice" role="status">
              <Icon name="warning" size={15} />
              {notice}
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              <Icon name="warning" size={15} />
              {error}
            </div>
          )}
          <button className="primary-button login-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Continue'}
            <Icon name="arrow" size={15} />
          </button>
          {demoAccounts.length > 0 ? (
            <div className="demo-accounts">
              <strong>Development demo roles</strong>
              <div className="demo-account-grid">
                {demoAccounts.map(account => (
                  <button
                    type="button"
                    key={account.email}
                    onClick={() => choose(account)}
                    className={email === account.email ? 'selected' : ''}
                  >
                    <RoleBadge role={account.role} />
                    <span>{account.name || account.email}</span>
                    <small>{account.email}</small>
                  </button>
                ))}
              </div>
              <small>Demo access appears only when ATLAS_ALLOW_DEMO_DATA=true.</small>
            </div>
          ) : (
            <div className="demo-accounts production-note">
              <strong>Production mode</strong>
              <span>No sample credentials are exposed.</span>
              <small>Ask a workspace administrator for access if you do not have an account.</small>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
