import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { detectDisplayMode } from './desktop.js'
import { ApiError, PASSWORD_CHANGE_EVENT, UNAUTHENTICATED_EVENT, api, errorMessage } from './lib/api'
import { toCsv } from './lib/csv'
import { downloadBlob, exportPdf, makeXlsx, recordExport } from './lib/export'
import {
  FIELD_OPERATORS,
  VALUELESS_OPERATORS,
  applyAdvancedFilters,
  isActive,
  readValue,
  sortRows
} from './lib/filters'
import { passwordStrength, validatePassword } from '../shared/password'
import { NOT_APPLIED_HINT, isNotApplied } from './lib/settings-status'
import { colorFor, initials, localDate, relativeDays, safeFilename, slug } from './lib/format'
import { deadlineText, dueText } from './lib/labels'
import {
  collectProtectedStrings,
  setMissingKeyReporting,
  t,
  textDirection,
  tr,
  translateUiText,
  uiLanguage,
  useUiLocalization
} from './lib/i18n'
import {
  clearSessionStorage,
  clientSettings,
  customFieldDefinitions,
  defaultSettings,
  diffPatch,
  enabledPages,
  hasPermission,
  languageOptions,
  loadPreferences,
  mergeDeep,
  savePreferences,
  updateByPath,
  withPreferences,
  workflowStateLabels
} from './lib/settings'

const emptyData: any = {
  today: '',
  revision: 0,
  settings: defaultSettings,
  teams: [],
  people: [],
  users: [],
  projects: [],
  tasks: [],
  activity: [],
  alerts: [],
  dashboard: { stats: {}, dailyPulse: {}, myTasks: [] },
  reports: { series: [] }
}
const icons = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.4" />
      <rect x="14" y="3" width="7" height="7" rx="1.4" />
      <rect x="3" y="14" width="7" height="7" rx="1.4" />
      <rect x="14" y="14" width="7" height="7" rx="1.4" />
    </>
  ),
  projects: (
    <>
      <path d="M3 7.5h18v12H3z" />
      <path d="M3 7.5 5.5 4h5l2 3.5" />
      <path d="M3 11h18" />
    </>
  ),
  tasks: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="10" cy="18" r="1.5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c.5-3.6 2.4-5.5 5.5-5.5s5 1.9 5.5 5.5" />
      <path d="M16 6a3 3 0 0 1 0 5.8M17 15c2.6.6 3.9 2.2 4.5 5" />
    </>
  ),
  activity: <path d="M3 12h4l2.1-6 4.2 12 2.2-6H21" />,
  reports: (
    <>
      <path d="M4 19V5M4 19h17" />
      <path d="m7 15 3-4 3 2 5-7" />
      <path d="M18 6h1.5v1.5" />
    </>
  ),
  alerts: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.7 1.7-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L8 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6.7v-2.4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L8 8.6l1.7-1.7.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.7 1.7-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12M18 6 6 18" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  down: <path d="m6 9 6 6 6-6" />,
  filter: (
    <>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  warning: (
    <>
      <path d="m12 3 9 17H3L12 3Z" />
      <path d="M12 9v4M12 16h.01" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.2 5.8L19 10l-5.8 1.2L12 17l-1.2-5.8L5 10l5.8-1.2L12 3Z" />
      <path d="M19 16l.5 2.5L22 19l-2.5.5L19 22l-.5-2.5L16 19l2.5-.5L19 16Z" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  moon: <path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z" />,
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  logout: (
    <>
      <path d="M10 17l5-5-5-5M15 12H3M21 4v16" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
    </>
  ),
  bolt: <path d="m13 2-8 12h6l-1 8 8-12h-6l1-8Z" />,
  team: (
    <>
      <circle cx="8" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M2.5 20c.5-3.6 2.4-5.5 5.5-5.5s5 1.9 5.5 5M14 15c3.2-.2 5.4 1.5 6 5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5l3 2" />
    </>
  )
}
function Icon({ name, size = 18, className = '' }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name]}
    </svg>
  )
}
function Logo() {
  return (
    <div className="brand-mark">
      <span className="brand-orbit orbit-one" />
      <span className="brand-orbit orbit-two" />
      <span className="brand-dot" />
    </div>
  )
}
function Avatar({ name, color = undefined, small = false }: { name: string; color?: string; small?: boolean }) {
  return (
    <span className={`avatar ${small ? 'avatar-small' : ''} avatar-${color || colorFor(name)}`} title={name}>
      {initials(name)}
    </span>
  )
}
function StatusPill({ children, tone }) {
  return <span className={`status-pill ${tone || slug(children)}`}>{children}</span>
}
function ProgressBar({ value, color = 'purple' }) {
  return (
    <div className="progress-track">
      <span className={`progress-fill fill-${color}`} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  )
}
function RoleBadge({ role }) {
  return <span className={`role-badge role-${slug(role || 'viewer')}`}>{role || 'Viewer'}</span>
}
function PermissionNotice({ children }) {
  return (
    <div className="permission-notice">
      <Icon name="warning" size={15} />
      <span>{children}</span>
    </div>
  )
}

function roleDefinitions(settings) {
  return settings?.permissions?.roles || {}
}
function CustomFieldInputs({ definitions = [], values = {}, onChange }) {
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

function LoadingScreen({ message = 'Connecting to your local workspace…' }) {
  return (
    <div className="loading-screen">
      <Logo />
      <strong>Loading Atlas</strong>
      <span>{message}</span>
    </div>
  )
}
function LoginScreen({ onLogin, setup, notice = '' }) {
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
function SetupWizard({ onComplete, setup, onPreviewLanguage }) {
  const demoAllowed = Boolean(setup?.demoAllowed)
  const moduleDefaults = {
    overview: true,
    projects: true,
    tasks: true,
    people: true,
    activity: true,
    reports: true,
    alerts: true
  }
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    token: '',
    includeDemo: false,
    workspaceName: 'Atlas Workspace',
    workspaceUnit: 'Operations',
    applicationName: 'Atlas Workspace',
    organizationName: '',
    contactEmail: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
    language: 'en',
    currency: 'USD',
    dateFormat: 'MMM d, yyyy',
    theme: 'light',
    accent: 'purple',
    density: 'comfortable',
    modules: moduleDefaults,
    workflowName: 'Default task workflow',
    workflowStates: 'To do\nIn progress\nReview\nTesting\nDone'
  })
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    onPreviewLanguage?.(form.language)
  }, [form.language, onPreviewLanguage])
  useEffect(() => () => onPreviewLanguage?.(''), [onPreviewLanguage])
  // The desktop app knows the one-time setup token and fills it in; a server operator copies it from the console.
  useEffect(() => {
    ;(window as any).atlasDesktop
      ?.getSetupToken?.()
      .then(token => token && setForm(current => ({ ...current, token })))
      .catch(() => {})
  }, [])
  const steps = ['Workspace', 'Region & appearance', 'Operations', 'Administrator']
  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const toggleModule = (key, value) =>
    setForm(current => ({ ...current, modules: { ...current.modules, [key]: value } }))
  const workflowLabels = form.workflowStates
    .split('\n')
    .map(item => item.trim())
    .filter(Boolean)
  const selectedModules = Object.entries(form.modules)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key)
  const passwordProblem = form.password ? validatePassword(form.password, { email: form.email, name: form.name }) : null
  const strength = passwordStrength(form.password)
  const strengthWidth = form.password ? { weak: 33, fair: 66, strong: 100 }[strength] : 0
  const canContinue =
    step === 0
      ? form.workspaceName.trim() && form.workspaceUnit.trim()
      : step === 1
        ? form.timezone.trim() && form.language
        : step === 2
          ? selectedModules.length && workflowLabels.length >= 2
          : form.name.trim() && form.email.trim() && form.password && !passwordProblem && form.token.trim()
  const buildSettings = () => {
    const states = workflowLabels.map((label, index) => ({
      id: slug(label),
      label,
      color: index === workflowLabels.length - 1 ? 'green' : ['blue', 'purple', 'orange'][index % 3],
      terminal: index === workflowLabels.length - 1
    }))
    return mergeDeep(defaultSettings, {
      workspaceName: form.workspaceName,
      workspaceUnit: form.workspaceUnit,
      language: form.language,
      dateFormat: form.dateFormat,
      theme: form.theme,
      accentColor: form.accent,
      density: form.density,
      enabledPages: selectedModules,
      workspace: {
        name: form.workspaceName,
        unit: form.workspaceUnit,
        applicationName: form.applicationName || form.workspaceName,
        organization: { legalName: form.organizationName, contactEmail: form.contactEmail },
        defaultTimezone: form.timezone,
        defaultLanguage: form.language,
        regionalFormats: { date: form.dateFormat, currency: form.currency }
      },
      interface: {
        theme: form.theme,
        colors: { accent: form.accent },
        density: form.density,
        navigationVisibility: form.modules,
        defaultLandingPage: selectedModules.includes('overview') ? 'overview' : selectedModules[0] || 'overview'
      },
      localization: {
        defaultLanguage: form.language,
        fallbackLanguage: 'en',
        activeLanguages: [...new Set(['en', form.language, 'ar', 'fa', 'he'])].filter(Boolean)
      },
      modules: Object.fromEntries(
        Object.entries(form.modules).map(([key, enabled]) => [
          key,
          { ...(defaultSettings.modules[key] || {}), enabled }
        ])
      ),
      workflows: {
        task: {
          name: form.workflowName,
          states,
          transitions: states
            .slice(0, -1)
            .map((state, index) => ({ from: state.label, to: states[index + 1].label, permission: 'writeTasks' })),
          approvalSteps: [],
          automatedActions: []
        }
      }
    })
  }
  const submit = async e => {
    e.preventDefault()
    if (step < steps.length - 1) {
      setStep(step + 1)
      return
    }
    setLoading(true)
    setError('')
    try {
      // Only what the administrator chose is sent; the server layers it over its own defaults.
      const { password, ...rest } = form
      await onComplete(
        await api.post('/api/setup', {
          ...rest,
          password,
          settings: diffPatch(defaultSettings, buildSettings())
        })
      )
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }
  const moduleLabels = {
    overview: 'Overview',
    projects: 'Projects',
    tasks: 'Tasks',
    people: 'People',
    activity: 'Activity',
    reports: 'Reports',
    alerts: 'Alerts'
  }
  return (
    <div className="setup-shell setup-shell-advanced">
      <div className="setup-layout setup-layout-advanced">
        <aside className="setup-preview">
          <div className="setup-brand">
            <Logo />
            <strong>atlas</strong>
          </div>
          <label className="setup-language-picker">
            Interface language
            <select value={form.language} onChange={e => update('language', e.target.value)}>
              {languageOptions(defaultSettings).map(lang => (
                <option value={lang.code} key={lang.code}>
                  {lang.code} · {lang.name}
                </option>
              ))}
            </select>
          </label>
          <span className="eyebrow">
            <span className="eyebrow-dot" /> First run
          </span>
          <h1>{steps[step]}</h1>
          <p>Configure the workspace before inviting the team.</p>
          <div className="setup-steps setup-steps-vertical">
            {steps.map((label, index) => (
              <button
                type="button"
                key={label}
                className={step === index ? 'active' : index < step ? 'done' : ''}
                onClick={() => index < step && setStep(index)}
              >
                <span>{index + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <div className="setup-summary">
            <div>
              <strong>{form.workspaceName}</strong>
              <span>{form.workspaceUnit}</span>
            </div>
            <div>
              <strong>
                {form.language.toUpperCase()} ·{' '}
                {textDirection({
                  localization: {
                    defaultLanguage: form.language,
                    textDirectionByLanguage: defaultSettings.localization.textDirectionByLanguage
                  }
                }).toUpperCase()}
              </strong>
              <span>{form.timezone}</span>
            </div>
            <div>
              <strong>{selectedModules.length} modules</strong>
              <span>{workflowLabels.length} workflow states</span>
            </div>
          </div>
        </aside>
        <form className="setup-card setup-card-wide setup-card-advanced" onSubmit={submit}>
          <span className="eyebrow">
            <span className="eyebrow-dot" /> Setup
          </span>
          {step === 0 && (
            <>
              <h1>Workspace</h1>
              <p>Name the workspace and organization.</p>
              <div className="setup-grid">
                <label>
                  Workspace name
                  <input
                    value={form.workspaceName}
                    onChange={e => update('workspaceName', e.target.value)}
                    required
                    autoFocus
                  />
                </label>
                <label>
                  Unit
                  <input value={form.workspaceUnit} onChange={e => update('workspaceUnit', e.target.value)} required />
                </label>
                <label>
                  Application name
                  <input value={form.applicationName} onChange={e => update('applicationName', e.target.value)} />
                </label>
                <label>
                  Organization
                  <input value={form.organizationName} onChange={e => update('organizationName', e.target.value)} />
                </label>
                <label>
                  Contact email
                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={e => update('contactEmail', e.target.value)}
                  />
                </label>
              </div>
              {demoAllowed && (
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.includeDemo}
                    onChange={e => update('includeDemo', e.target.checked)}
                  />{' '}
                  Install development sample data
                </label>
              )}
            </>
          )}
          {step === 1 && (
            <>
              <h1>Region & appearance</h1>
              <p>Choose language, timezone, and layout defaults.</p>
              <div className="setup-grid">
                <label>
                  Default language
                  <select value={form.language} onChange={e => update('language', e.target.value)}>
                    {languageOptions(defaultSettings).map(lang => (
                      <option value={lang.code} key={lang.code}>
                        {lang.code} · {lang.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Timezone
                  <input value={form.timezone} onChange={e => update('timezone', e.target.value)} required />
                </label>
                <label>
                  Date format
                  <input value={form.dateFormat} onChange={e => update('dateFormat', e.target.value)} />
                </label>
                <label>
                  Currency
                  <input value={form.currency} onChange={e => update('currency', e.target.value)} />
                </label>
                <label>
                  Theme
                  <select value={form.theme} onChange={e => update('theme', e.target.value)}>
                    <option>light</option>
                    <option>dark</option>
                    <option>system</option>
                  </select>
                </label>
                <label>
                  Accent
                  <select value={form.accent} onChange={e => update('accent', e.target.value)}>
                    <option>purple</option>
                    <option>blue</option>
                    <option>green</option>
                    <option>orange</option>
                  </select>
                </label>
                <label>
                  Density
                  <select value={form.density} onChange={e => update('density', e.target.value)}>
                    <option>comfortable</option>
                    <option>compact</option>
                  </select>
                </label>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <h1>Operations</h1>
              <p>Select modules and workflow states.</p>
              <div className="setup-module-grid">
                {Object.entries(moduleLabels).map(([key, label]) => (
                  <label className="interface-toggle" key={key}>
                    <input
                      type="checkbox"
                      checked={Boolean(form.modules[key])}
                      disabled={key === 'overview'}
                      onChange={e => toggleModule(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
              </div>
              <label>
                Workflow name
                <input value={form.workflowName} onChange={e => update('workflowName', e.target.value)} />
              </label>
              <label>
                Task workflow states
                <textarea
                  value={form.workflowStates}
                  onChange={e => update('workflowStates', e.target.value)}
                  rows={6}
                />
              </label>
              <div className="workflow-preview">
                {workflowLabels.map((label, index) => (
                  <span key={label}>
                    {label}
                    {index < workflowLabels.length - 1 && <Icon name="arrow" size={12} />}
                  </span>
                ))}
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h1>Administrator</h1>
              <p>Create the first owner account.</p>
              <div className="setup-grid">
                <label>
                  Administrator name
                  <input value={form.name} onChange={e => update('name', e.target.value)} required autoFocus />
                </label>
                <label>
                  Email
                  <input value={form.email} onChange={e => update('email', e.target.value)} type="email" required />
                </label>
                <label>
                  Password
                  <input
                    value={form.password}
                    onChange={e => update('password', e.target.value)}
                    type="password"
                    autoComplete="new-password"
                    required
                    aria-describedby="password-help"
                  />
                </label>
                <label>
                  Setup token
                  <input
                    value={form.token}
                    onChange={e => update('token', e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    required
                    aria-describedby="token-help"
                  />
                </label>
              </div>
              <div className={`password-meter strength-${form.password ? strength : 'none'}`} aria-hidden="true">
                <span style={{ width: `${strengthWidth}%` }} />
              </div>
              <small className="setup-small" id="password-help" role="status">
                {passwordProblem || 'Use at least 8 characters; a longer passphrase is stronger.'}
              </small>
              <small className="setup-small" id="token-help">
                The setup token proves you control this server. It was printed in the console where Atlas was started
                (or is the value of ATLAS_SETUP_TOKEN). The desktop app fills it in for you.
              </small>
              <div className="setup-review">
                <strong>Ready to initialize</strong>
                <span>
                  {form.workspaceName} · {form.language.toUpperCase()} · {selectedModules.length} modules ·{' '}
                  {workflowLabels.length} workflow states
                </span>
              </div>
            </>
          )}
          {error && (
            <div className="form-error">
              <Icon name="warning" size={15} />
              {error}
            </div>
          )}
          <div className="setup-actions">
            {step > 0 && (
              <button type="button" className="secondary-button" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button className="primary-button setup-submit" disabled={loading || !canContinue}>
              {loading ? 'Preparing…' : step === steps.length - 1 ? 'Initialize workspace' : 'Continue'}
              <Icon name="arrow" size={15} />
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const AppContext = React.createContext<{ user: any; settings: any; notify: (toast: any) => void }>({
  user: null,
  settings: defaultSettings,
  notify: () => {}
})
const useApp = () => React.useContext(AppContext)
function AdvancedFilter({ filterKey, fields, onApply }) {
  const { user } = useApp()
  const storageKey = `atlas-filter-${user?.id || 'anonymous'}-${filterKey}`
  const [open, setOpen] = useState(false)
  const [conditions, setConditions] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]')
    } catch {
      return []
    }
  })
  useEffect(() => {
    onApply(conditions.filter(isActive))
  }, [])
  const update = (i, key, value) =>
    setConditions(current => current.map((c, index) => (index === i ? { ...c, [key]: value } : c)))
  const add = () =>
    setConditions(current => [
      ...current,
      { join: 'AND', field: fields[0]?.key || '', operator: 'contains', value: '' }
    ])
  const apply = () => {
    const active = conditions.filter(isActive)
    try {
      localStorage.setItem(storageKey, JSON.stringify(active))
    } catch {
      /* storage unavailable: the filter still applies for this session */
    }
    onApply(active)
    setOpen(false)
  }
  const clear = () => {
    setConditions([])
    try {
      localStorage.removeItem(storageKey)
    } catch {
      /* ignore */
    }
    onApply([])
  }
  const fieldType = key => fields.find(f => f.key === key)?.type || 'text'
  return (
    <div className="advanced-filter-wrap">
      <button
        type="button"
        className={`secondary-button ${conditions.length ? 'filter-active' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <Icon name="filter" size={15} /> Advanced filter{' '}
        {conditions.length > 0 && <span className="filter-badge">{conditions.length}</span>}
      </button>
      {open && (
        <div className="advanced-filter-panel" role="group" aria-label="Advanced query builder">
          <div className="advanced-filter-head">
            <strong>Advanced query builder</strong>
            <button
              type="button"
              className="icon-button subtle"
              aria-label="Close filter panel"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          {conditions.map((c, i) => (
            <div className="filter-condition" key={i}>
              {i > 0 && (
                <select
                  aria-label="Join with previous condition"
                  value={c.join}
                  onChange={e => update(i, 'join', e.target.value)}
                >
                  <option>AND</option>
                  <option>OR</option>
                </select>
              )}
              <select aria-label="Field" value={c.field} onChange={e => update(i, 'field', e.target.value)}>
                {fields.map(f => (
                  <option value={f.key} key={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select aria-label="Operator" value={c.operator} onChange={e => update(i, 'operator', e.target.value)}>
                {FIELD_OPERATORS.map(([key, label]) => (
                  <option value={key} key={key}>
                    {label}
                  </option>
                ))}
              </select>
              {!VALUELESS_OPERATORS.has(c.operator) && (
                <input
                  aria-label="Value"
                  type={fieldType(c.field) === 'date' ? 'date' : fieldType(c.field) === 'number' ? 'number' : 'text'}
                  value={c.value}
                  onChange={e => update(i, 'value', e.target.value)}
                  placeholder="Value"
                />
              )}
              <button
                type="button"
                className="icon-button subtle"
                aria-label="Remove condition"
                onClick={() => setConditions(current => current.filter((_, idx) => idx !== i))}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}
          <div className="advanced-filter-actions">
            <button type="button" className="text-button" onClick={add}>
              <Icon name="plus" size={13} /> Add condition
            </button>
            <span />
            <button type="button" className="secondary-button" onClick={clear}>
              Clear
            </button>
            <button type="button" className="primary-button" onClick={apply}>
              Apply
            </button>
          </div>
          <p className="filter-hint">
            AND binds tighter than OR: “A AND B OR C” means “(A AND B) OR C”. Conditions without a value are ignored.
          </p>
        </div>
      )}
    </div>
  )
}
function FilterChips({ conditions, fields, onClear, onRemove }) {
  if (!conditions?.length) return null
  const operatorLabel = key => FIELD_OPERATORS.find(([k]) => k === key)?.[1] || key
  return (
    <div className="filter-chips">
      <span>Active filters</span>
      {conditions.map((c, i) => (
        <button
          type="button"
          className="filter-chip"
          key={i}
          aria-label={`Remove filter ${fields.find(f => f.key === c.field)?.label || c.field}`}
          onClick={() => onRemove(i)}
        >
          {i > 0 && <small>{c.join} </small>}
          <strong>{fields.find(f => f.key === c.field)?.label || c.field}</strong> {operatorLabel(c.operator)}{' '}
          {!VALUELESS_OPERATORS.has(c.operator) && <em>{c.value}</em>}
          <Icon name="close" size={11} />
        </button>
      ))}
      <button type="button" className="text-button" onClick={onClear}>
        Clear all
      </button>
    </div>
  )
}
function ExportMenu({ rows, columns, title, settings, page = 'data', customFields = [] }) {
  const { user, notify } = useApp()
  const allowed = hasPermission(user, 'exportData') && settings?.interface?.actionVisibility?.export !== false
  const extraColumns = customFields
    .filter(field => field.visible !== false)
    .map(field => ({ key: `customFields.${field.key}`, label: field.label || field.key }))
  const allColumns = [...columns, ...extraColumns]
  // The administrator decides which export targets exist (Settings > Reports & exports) and the PDF defaults.
  const configured = settings?.exports?.formats?.length
    ? settings.exports.formats
    : ['csv', 'xlsx', 'json', 'pdf', 'print']
  const formats = ['pdf', 'xlsx', 'csv', 'json'].filter(f => configured.includes(f))
  const canPrint = configured.includes('print') && settings?.interface?.actionVisibility?.print !== false
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(columns.map(c => c.key))
  const [format, setFormat] = useState(formats[0] || 'csv')
  const [orientation, setOrientation] = useState(
    settings?.exports?.pdf?.orientation === 'portrait' ? 'portrait' : 'landscape'
  )
  const [margin, setMargin] = useState(
    { narrow: '10', standard: '14', wide: '20' }[settings?.exports?.pdf?.margins] || '14'
  )
  const [fileTitle, setFileTitle] = useState(title)
  const [busy, setBusy] = useState(false)
  if (!allowed) return null
  const activeColumns = allColumns.filter(c => selected.includes(c.key))
  const flatRows = rows.map(row => Object.fromEntries(activeColumns.map(col => [col.key, readValue(row, col.key)])))
  const guarded = async (action: () => Promise<void> | void, kind: string) => {
    if (!activeColumns.length) {
      notify({ title: 'Choose at least one column', tone: 'warning' })
      return
    }
    setBusy(true)
    try {
      // The server enforces the exportData permission and records the export before anything is generated.
      await recordExport(page, kind, flatRows.length, activeColumns.length)
      await action()
    } catch (error) {
      notify({ title: 'Export failed', body: errorMessage(error), tone: 'warning' })
    } finally {
      setBusy(false)
    }
  }
  const doExport = () =>
    guarded(async () => {
      const name = safeFilename(fileTitle)
      if (format === 'csv')
        downloadBlob(
          new Blob(['\ufeff', toCsv(activeColumns, flatRows)], { type: 'text/csv;charset=utf-8' }),
          `${name}.csv`
        )
      if (format === 'xlsx') downloadBlob(await makeXlsx(flatRows, activeColumns), `${name}.xlsx`)
      if (format === 'json')
        downloadBlob(new Blob([JSON.stringify(flatRows, null, 2)], { type: 'application/json' }), `${name}.json`)
      if (format === 'pdf') {
        const { unicodeFont } = await exportPdf(flatRows, activeColumns, fileTitle, orientation as any, settings)
        if (!unicodeFont)
          notify({
            title: 'PDF created with a basic font',
            body: 'The Unicode font could not be loaded, so Arabic, Persian and Hebrew text may not display correctly. Try again or export to XLSX.',
            tone: 'warning'
          })
      }
    }, format)
  const print = () =>
    guarded(() => {
      document.body.dataset.printTemplate = settings?.printTemplate || 'executive'
      const style = document.createElement('style')
      style.textContent = `@page{size:${orientation};margin:${margin}mm}`
      document.head.appendChild(style)
      window.print()
      setTimeout(() => {
        delete document.body.dataset.printTemplate
        style.remove()
      }, 700)
    }, 'print')
  return (
    <div className="export-wrap">
      <button
        type="button"
        className="secondary-button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
      >
        <Icon name="external" size={15} /> Export / print
      </button>
      {open && (
        <div className="export-panel" role="group" aria-label="Customize export">
          <div className="advanced-filter-head">
            <strong>Customize export</strong>
            <button
              type="button"
              className="icon-button subtle"
              aria-label="Close export panel"
              onClick={() => setOpen(false)}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          <label className="tiny-label">
            Report title
            <input value={fileTitle} onChange={e => setFileTitle(e.target.value)} />
          </label>
          <div className="column-checks">
            {allColumns.map(c => (
              <label key={c.key}>
                <input
                  type="checkbox"
                  checked={selected.includes(c.key)}
                  onChange={e =>
                    setSelected(current =>
                      e.target.checked ? [...current, c.key] : current.filter(key => key !== c.key)
                    )
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
          <div className="print-options">
            <label>
              Format
              <select value={format} onChange={e => setFormat(e.target.value)}>
                {formats.includes('pdf') && <option value="pdf">PDF</option>}
                {formats.includes('xlsx') && <option value="xlsx">Excel</option>}
                {formats.includes('csv') && <option value="csv">CSV</option>}
                {formats.includes('json') && <option value="json">JSON</option>}
              </select>
            </label>
            <label>
              Orientation
              <select value={orientation} onChange={e => setOrientation(e.target.value)}>
                <option>landscape</option>
                <option>portrait</option>
              </select>
            </label>
            <label>
              Margins
              <select value={margin} onChange={e => setMargin(e.target.value)}>
                <option value="10">Narrow</option>
                <option value="14">Standard</option>
                <option value="20">Wide</option>
              </select>
            </label>
            <label>
              Rows
              <input value={flatRows.length} readOnly />
            </label>
          </div>
          <p className="filter-hint">
            Exports contain every row that matches your current filters, not only the rows on screen.
          </p>
          <div className="export-actions">
            {formats.length > 0 && (
              <button type="button" className="secondary-button" disabled={busy} onClick={doExport}>
                Export
              </button>
            )}
            {canPrint && (
              <button type="button" className="primary-button" disabled={busy} onClick={print}>
                Print
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ToastHost({ toasts, dismiss }) {
  return (
    <div className="toast-host" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map(t => (
        <div className={`toast toast-${t.tone || 'info'}`} key={t.id} role={t.tone === 'warning' ? 'alert' : 'status'}>
          <Icon name={t.tone === 'success' ? 'check' : t.tone === 'warning' ? 'warning' : 'spark'} size={15} />
          <div>
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            className="icon-button subtle"
            onClick={() => dismiss(t.id)}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
function Sidebar({ page, setPage, user, settings, onLogout, mobileOpen, onClose }) {
  const canAdmin = hasPermission(user, 'manageSettings')
  const pageLabels = {
    overview: 'Overview',
    projects: 'Projects',
    tasks: 'My work',
    people: 'People',
    activity: 'Activity',
    reports: 'Reports',
    alerts: 'Alerts',
    settings: canAdmin ? 'Settings' : 'My account'
  }
  const pages = [
    ['overview', 'Overview'],
    ['projects', 'Projects'],
    ['tasks', 'My work'],
    ['people', 'People'],
    ['activity', 'Activity'],
    ['reports', 'Reports'],
    ['alerts', 'Alerts'],
    ['settings', pageLabels.settings]
  ].filter(([id]) => id === 'settings' || enabledPages(settings).includes(id))
  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`} aria-label="Primary">
      <div className="brand">
        <Logo />
        <span>{settings.workspace?.applicationName || 'atlas'}</span>
        <span className="brand-beta">workspace</span>
        <button type="button" className="icon-button mobile-close" aria-label="Close navigation" onClick={onClose}>
          <Icon name="close" size={15} />
        </button>
      </div>
      <div className="workspace-switcher">
        <div className="workspace-logo" translate="no">
          {[...(settings.workspaceName || 'A')][0]}
        </div>
        <div>
          <strong translate="no">{settings.workspaceName}</strong>
          <small translate="no">{settings.workspaceUnit}</small>
        </div>
      </div>
      <div className="sidebar-section-label">Workspace</div>
      <nav className="nav-list" aria-label="Pages">
        {pages.map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={`nav-item ${page === id ? 'active' : ''}`}
            aria-current={page === id ? 'page' : undefined}
            onClick={() => {
              setPage(id)
              onClose?.()
            }}
          >
            <Icon name={id === 'settings' ? 'settings' : id} size={18} />
            <span>
              {id === 'settings' && !canAdmin
                ? translateUiText(settings, 'My account')
                : t(settings, `nav.${id}`, pageLabels[id] || label)}
            </span>
            {id === 'tasks' && (
              <span
                className="nav-count"
                title="Open tasks assigned to you"
                aria-label={`${user?.openTasks || 0} open tasks assigned to you`}
              >
                {user?.openTasks || 0}
              </span>
            )}
            {id === 'alerts' && user?.openAlerts > 0 && <span className="alert-dot" aria-label="Open alerts" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="profile-row">
        <Avatar name={user?.name} color={user?.avatarColor} />
        <div>
          <strong translate="no">{user?.name}</strong>
          <small>{user?.role}</small>
        </div>
        <button type="button" className="logout-button" aria-label="Sign out" title="Sign out" onClick={onLogout}>
          <Icon name="logout" size={15} />
        </button>
      </div>
    </aside>
  )
}
const SEARCH_HINT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'
function Topbar({ page, user, setPage, onCreate, onSearch, onToggleTheme, onOpenNav, canCreate = true, settings }) {
  const canAdmin = hasPermission(user, 'manageSettings')
  const titles = {
    overview: ['Overview', 'Key metrics and attention items.'],
    projects: ['Projects', 'Health, owners, milestones.'],
    tasks: ['My work', 'Manage workflow state.'],
    people: ['People', 'Teams and capacity.'],
    activity: ['Activity', 'Updates and blockers.'],
    reports: ['Reports', 'Trends, activity log, exports.'],
    alerts: ['Alerts', 'Risks and deadlines.'],
    settings: canAdmin ? ['Settings', 'Workspace administration.'] : ['My account', 'Your profile and preferences.']
  }
  const [rawTitle, subtitle] = titles[page] || titles.overview
  const title =
    page === 'settings' && !canAdmin ? translateUiText(settings, 'My account') : t(settings, `nav.${page}`, rawTitle)
  return (
    <header className="topbar">
      <div className="mobile-brand">
        <Logo />
        <span>atlas</span>
      </div>
      <div className="page-heading">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="top-actions">
        <button type="button" className="search-box" onClick={onSearch}>
          <Icon name="search" size={16} />
          <span>{t(settings, 'actions.search', 'Search anything')}</span>
          <kbd>{SEARCH_HINT}</kbd>
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          aria-label="Toggle theme"
          title="Switch between light and dark (only for you)"
        >
          <Icon name="moon" size={18} />
        </button>
        {enabledPages(settings).includes('alerts') && (
          <button
            type="button"
            className="notification-button"
            aria-label="Open alerts"
            onClick={() => setPage('alerts')}
          >
            <Icon name="alerts" size={18} />
            {user?.openAlerts > 0 && <span />}
          </button>
        )}
        {page !== 'settings' && canCreate && (
          <button type="button" className="primary-button top-add" onClick={onCreate}>
            <Icon name="plus" size={16} />
            <span>{t(settings, 'actions.new', 'New')}</span>
          </button>
        )}
        <button type="button" className="mobile-menu" aria-label="Open navigation" onClick={onOpenNav}>
          <Icon name="menu" />
        </button>
      </div>
    </header>
  )
}
function CommandSearch({ open, onClose, data, setPage, openModal }) {
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  if (!open) return null
  const q = query.toLowerCase()
  const pages = [
    ['overview', 'Overview'],
    ['projects', 'Projects'],
    ['tasks', 'My work'],
    ['people', 'People'],
    ['activity', 'Activity'],
    ['reports', 'Reports'],
    ['alerts', 'Alerts'],
    ['settings', 'Settings']
  ].filter(x => x[1].toLowerCase().includes(q))
  const tasks = data.tasks.filter(t => `${t.title} ${t.project} ${t.id}`.toLowerCase().includes(q)).slice(0, 6)
  const projects = data.projects.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(q)).slice(0, 6)
  const people = data.people.filter(p => `${p.name} ${p.email}`.toLowerCase().includes(q)).slice(0, 6)
  const go = (page, fn = undefined) => {
    setPage(page)
    fn?.()
    onClose()
  }
  return (
    <div className="command-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="command-panel" role="dialog" aria-modal="true" aria-label="Search">
        <div className="command-input">
          <Icon name="search" size={17} />
          <input
            autoFocus
            aria-label="Search pages, tasks, people and projects"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search pages, tasks, people, projects…"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-sections">
          <section>
            <h4>Pages</h4>
            {pages.map(([id, label]) => (
              <button type="button" key={id} onClick={() => go(id)}>
                <Icon name={id === 'settings' ? 'settings' : id} size={15} />
                <span>{label}</span>
              </button>
            ))}
          </section>
          {projects.length > 0 && (
            <section>
              <h4>Projects</h4>
              {projects.map(p => (
                <button key={p.numericId} onClick={() => go('projects', () => openModal('project', p))}>
                  <Icon name="projects" size={15} />
                  <span>{p.name}</span>
                  <small>{p.code}</small>
                </button>
              ))}
            </section>
          )}
          {tasks.length > 0 && (
            <section>
              <h4>Tasks</h4>
              {tasks.map(t => (
                <button key={t.numericId} onClick={() => go('tasks', () => openModal('task', t))}>
                  <Icon name="tasks" size={15} />
                  <span>{t.title}</span>
                  <small>{t.id}</small>
                </button>
              ))}
            </section>
          )}
          {people.length > 0 && (
            <section>
              <h4>People</h4>
              {people.map(p => (
                <button key={p.id} onClick={() => go('people', () => openModal('person', p))}>
                  <Icon name="people" size={15} />
                  <span>{p.name}</span>
                  <small>{p.team}</small>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
function QuickActionRail({ openModal, setPage, canManage, canWriteTasks = true, canLogActivity = true, onSearch }) {
  const actions = []
  if (canWriteTasks) actions.push(['New task', 'tasks', () => openModal('task')])
  if (canManage) actions.push(['New project', 'projects', () => openModal('project')])
  if (canLogActivity) actions.push(['Log update', 'activity', () => openModal('activity')])
  actions.push(
    ['Reports', 'reports', () => setPage('reports')],
    ['Alerts', 'alerts', () => setPage('alerts')],
    ['Search', 'search', onSearch]
  )
  return (
    <div className="quick-action-rail">
      {actions.map(([label, icon, run]) => (
        <button type="button" key={label} onClick={run}>
          <Icon name={icon} size={14} />
          {label}
        </button>
      ))}
    </div>
  )
}
function StatCard({ label, value, detail, icon, color, onClick }) {
  return (
    <button className="stat-card" onClick={onClick}>
      <div className="stat-card-top">
        <span className={`stat-icon stat-${color}`}>
          <Icon name={icon} size={18} />
        </span>
        <span className="stat-kicker">{label}</span>
        <Icon name="arrow" size={14} className="stat-arrow" />
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        <span>{detail}</span>
      </div>
    </button>
  )
}
function EmptyState({
  title,
  message,
  action = '',
  onAction = undefined
}: {
  title: string
  message: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon name="spark" size={22} />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <Icon name="arrow" size={13} />
        </button>
      )}
    </div>
  )
}
function Overview({ data, setPage }) {
  const { settings } = useApp()
  const language = uiLanguage(settings)
  const s = data.dashboard.stats || {}
  const pulse = data.dashboard.dailyPulse || {}
  const widgets = data.settings?.interface?.dashboardLayouts?.overview || [
    'stats',
    'dailyPulse',
    'projectHealth',
    'myFocus'
  ]
  const enabled = key => widgets.includes(key)
  return (
    <>
      <div className="welcome-row">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-dot" />{' '}
            {localDate(data.today, language, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          <h2>Today at a glance.</h2>
        </div>
        <button className="secondary-button" onClick={() => setPage('activity')}>
          <Icon name="activity" size={16} /> View activity
        </button>
      </div>
      {enabled('stats') && (
        <div className="stat-grid">
          <StatCard
            label="Active projects"
            value={s.activeProjects || 0}
            detail="not completed"
            icon="projects"
            color="purple"
            onClick={() => setPage('projects')}
          />
          <StatCard
            label="Open tasks"
            value={s.openTasks || 0}
            detail={tr(settings, '{count} assigned to you', { count: s.myOpenTasks || 0 })}
            icon="tasks"
            color="blue"
            onClick={() => setPage('tasks')}
          />
          <StatCard
            label="Needs attention"
            value={s.needsAttention || 0}
            detail="open alerts"
            icon="alerts"
            color="orange"
            onClick={() => setPage('alerts')}
          />
          <StatCard
            label="On track"
            value={`${s.onTrack || 0}%`}
            detail="healthy projects"
            icon="bolt"
            color="green"
            onClick={() => setPage('reports')}
          />
        </div>
      )}
      {enabled('dailyPulse') && (
        <>
          <div className="section-head dashboard-section-head">
            <div>
              <h2>Daily pulse</h2>
              <p>Updates, blockers, and next steps.</p>
            </div>
            <span className="date-select">
              <Icon name="calendar" size={15} /> Today
            </span>
          </div>
          <div className="daily-grid">
            <ActivityCard title="Yesterday" subtitle="From daily updates" tone="blue" items={pulse.yesterday || []} />
            <ActivityCard
              title="Today"
              subtitle={`${(pulse.today || []).length} focus items`}
              tone="purple"
              items={pulse.today || []}
            />
            <ActivityCard
              title="Blocked"
              subtitle={`${(pulse.blocked || []).length} blockers`}
              tone="orange"
              items={pulse.blocked || []}
            />
          </div>
        </>
      )}
      {(enabled('projectHealth') || enabled('myFocus')) && (
        <div className="split-section">
          {enabled('projectHealth') && (
            <section className="panel project-panel">
              <div className="section-head">
                <div>
                  <h2>Project health</h2>
                  <p>Current plan.</p>
                </div>
                <button className="text-button" onClick={() => setPage('projects')}>
                  View all <Icon name="arrow" size={13} />
                </button>
              </div>
              <div className="project-list">
                {data.projects.slice(0, 4).map(project => (
                  <ProjectHealthRow project={project} key={project.numericId} />
                ))}
              </div>
            </section>
          )}
          {enabled('myFocus') && (
            <section className="panel focus-panel">
              <div className="section-head">
                <div>
                  <h2>My focus</h2>
                  <p>Next actions.</p>
                </div>
                <Icon name="spark" size={17} className="muted-icon" />
              </div>
              <div className="focus-list">
                {data.dashboard.myTasks?.slice(0, 5).map(task => (
                  <TaskRow task={task} key={task.numericId} compact />
                ))}
                {!data.dashboard.myTasks?.length && (
                  <div className="empty-mini">Nothing is assigned to you right now.</div>
                )}
              </div>
              <button className="full-width-button" onClick={() => setPage('tasks')}>
                Open my work <Icon name="arrow" size={13} />
              </button>
            </section>
          )}
        </div>
      )}
      {!widgets.length && (
        <EmptyState title="Dashboard is empty" message="Enable widgets from Settings → Appearance." />
      )}
    </>
  )
}

function ActivityCard({ title, subtitle, items, tone }) {
  return (
    <section className={`activity-card activity-${tone}`}>
      <div className="section-head compact">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="activity-items">
        {items.map((item, i) => (
          <div className="activity-item" key={i}>
            <span className="activity-marker">
              <Icon name={item.icon || 'check'} size={13} />
            </span>
            <div className="activity-copy">
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
            <span className="activity-time">{item.time}</span>
          </div>
        ))}
      </div>
      {!items.length && <div className="empty-mini">Nothing here yet.</div>}
    </section>
  )
}
function ProjectHealthRow({ project }) {
  const { settings } = useApp()
  return (
    <div className="project-health-row">
      <div className={`project-symbol symbol-${project.color}`}>{initials(project.name)}</div>
      <div className="project-health-main">
        <div className="project-row-title">
          <strong>{project.name}</strong>
          <StatusPill tone={project.health === 'At risk' ? 'at-risk' : 'on-track'}>{project.health}</StatusPill>
        </div>
        <ProgressBar value={project.progress} color={project.color} />
      </div>
      <div className="project-percent">{project.progress}%</div>
      <div className="project-deadline">
        <span>Deadline</span>
        <strong>
          {project.deadlineDate ? localDate(project.deadlineDate, uiLanguage(settings)) : project.deadline}
        </strong>
      </div>
    </div>
  )
}
function TaskRow({ task, compact = false, onAdvance = undefined, onEdit = undefined }) {
  const { settings } = useApp()
  const language = uiLanguage(settings)
  const advance = onAdvance
  return (
    <div className={`task-row ${compact ? 'task-row-compact' : ''}`}>
      <button
        type="button"
        className={`task-check task-${slug(task.status)}`}
        disabled={!advance}
        aria-label={tr(settings, 'Advance {title} to the next status', { title: task.title })}
        title={tr(settings, 'Advance to the next status')}
        onClick={() => advance?.(task)}
      >
        <Icon name={task.done ? 'check' : 'bolt'} size={13} />
      </button>
      <div className="task-row-main">
        <strong>{task.title}</strong>
        <div>
          <span className="task-project">{task.project}</span>
          <span className="task-id">{task.id}</span>
        </div>
      </div>
      {!compact && <span className={`priority priority-${task.priority.toLowerCase()}`}>{task.priority}</span>}
      <StatusPill tone={slug(task.status)}>{task.status}</StatusPill>
      <span className={`task-due due-${task.dueTone}`}>{dueText(task, language, settings)}</span>
      {!compact && <Avatar name={task.assignee} color={task.assigneeColor} small />}
      {!compact && onEdit && (
        <button
          type="button"
          className="icon-button row-more"
          aria-label={`Edit ${task.title}`}
          onClick={() => onEdit?.(task)}
        >
          <Icon name="more" size={16} />
        </button>
      )}
    </div>
  )
}

function Projects({ data, openModal, canManage }) {
  const { settings } = useApp()
  const columns = [
    { key: 'name', label: 'Project' },
    { key: 'code', label: 'Code' },
    { key: 'team', label: 'Team' },
    { key: 'health', label: 'Health' },
    { key: 'progress', label: 'Progress' },
    { key: 'deadline', label: 'Deadline' }
  ]
  const milestoneColumns = [
    { key: 'name', label: 'Milestone' },
    { key: 'project.name', label: 'Project' },
    { key: 'status', label: 'Status' },
    { key: 'dueDate', label: 'Due date' }
  ]
  const [filter, setFilter] = useState('All projects')
  const [advanced, setAdvanced] = useState([])
  const rows = applyAdvancedFilters(
    data.projects.filter(p => filter === 'All projects' || p.health === filter),
    advanced
  )
  const milestones = data.projects.flatMap(p => p.milestoneRows.map(m => ({ ...m, project: p })))
  const milestoneClosed = m => m.status === 'Complete' || m.status === 'Completed'
  // Open milestones first, soonest due date first (undated last); finished ones after them.
  const orderedMilestones = [...milestones].sort(
    (a, b) =>
      Number(milestoneClosed(a)) - Number(milestoneClosed(b)) ||
      (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') ||
      String(a.name).localeCompare(String(b.name))
  )
  const [visibleMilestones, setVisibleMilestones] = useState(8)
  return (
    <div className="page-content">
      <div className="toolbar">
        <div className="filter-tabs">
          {['All projects', 'On track', 'At risk', 'Completed'].map(tab => (
            <button key={tab} className={filter === tab ? 'selected' : ''} onClick={() => setFilter(tab)}>
              {tab}
              <span>
                {tab === 'All projects' ? data.projects.length : data.projects.filter(p => p.health === tab).length}
              </span>
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <AdvancedFilter filterKey="projects" fields={columns} onApply={setAdvanced} />
          <ExportMenu rows={rows} columns={columns} title="Atlas projects" settings={data.settings} />
          {canManage && (
            <button className="primary-button" onClick={() => openModal('project')}>
              <Icon name="plus" size={15} /> New project
            </button>
          )}
        </div>
      </div>
      <FilterChips
        conditions={advanced}
        fields={columns}
        onClear={() => setAdvanced([])}
        onRemove={i => setAdvanced(c => c.filter((_, idx) => idx !== i))}
      />
      <div className="results-meta">
        <strong>{rows.length}</strong> projects · {filter}
      </div>
      <div className="project-grid">
        {rows.map(p => (
          <ProjectCard project={p} key={p.numericId} onEdit={canManage ? () => openModal('project', p) : null} />
        ))}
      </div>
      {!rows.length && (
        <EmptyState
          title="No projects match"
          message="Clear filters or create a new project."
          action="Create project"
          onAction={() => openModal('project')}
        />
      )}
      <section className="panel project-table">
        <div className="section-head">
          <div>
            <h2>Upcoming milestones</h2>
            <p>Keep meaningful moments in sight.</p>
          </div>
          <div className="milestone-actions">
            <ExportMenu
              rows={milestones.map(m => ({ ...m, 'project.name': m.project.name }))}
              columns={milestoneColumns}
              title="Atlas milestones"
              settings={data.settings}
            />
            {canManage && (
              <button className="text-button" onClick={() => openModal('milestone')}>
                Add milestone <Icon name="plus" size={13} />
              </button>
            )}
          </div>
        </div>
        <div className="milestone-list">
          {orderedMilestones.slice(0, visibleMilestones).map(m => (
            <div
              className="milestone-row"
              key={m.id}
              {...(canManage
                ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => openModal('milestone', m),
                    onKeyDown: e =>
                      (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openModal('milestone', m))
                  }
                : {})}
            >
              <div className={`milestone-date ${m.status === 'At risk' ? 'date-warning' : ''}`}>
                <strong>{m.dueDate?.slice(-2) || '—'}</strong>
                <span>{localDate(m.dueDate, uiLanguage(settings), { month: 'short' })}</span>
              </div>
              <div className="milestone-copy">
                <strong>{m.name}</strong>
                <span>
                  {m.project.name} · {m.project.owner}
                </span>
              </div>
              <StatusPill tone={m.status === 'At risk' ? 'at-risk' : m.status === 'Complete' ? 'done' : 'on-track'}>
                {m.status}
              </StatusPill>
            </div>
          ))}
        </div>
        {orderedMilestones.length > visibleMilestones && (
          <button type="button" className="text-button show-more" onClick={() => setVisibleMilestones(v => v + 8)}>
            {tr(settings, 'Show {count} more ({remaining} left)', {
              count: Math.min(8, orderedMilestones.length - visibleMilestones),
              remaining: orderedMilestones.length - visibleMilestones
            })}
          </button>
        )}
      </section>
    </div>
  )
}
function ProjectCard({ project, onEdit }) {
  const { settings } = useApp()
  return (
    <article className="project-card">
      <div className="project-card-top">
        <div className={`project-symbol symbol-${project.color}`}>{initials(project.name)}</div>
        {onEdit && (
          <button aria-label="Edit" className="icon-button subtle" onClick={onEdit}>
            <Icon name="more" size={16} />
          </button>
        )}
      </div>
      <div className="project-card-code">
        {project.code} · {project.team}
      </div>
      <h3>{project.name}</h3>
      <p>{project.description}</p>
      <div className="project-card-meta">
        <StatusPill tone={project.health === 'At risk' ? 'at-risk' : 'on-track'}>{project.health}</StatusPill>
        <span>{project.progress}% complete</span>
      </div>
      <ProgressBar value={project.progress} color={project.color} />
      <div className="project-card-bottom">
        <span>
          <Icon name="calendar" size={13} /> {deadlineText(project, uiLanguage(settings), settings)}
        </span>
        <span className="avatar-stack">
          {project.members.map(m => (
            <Avatar name={m} key={m} color={project.memberColors?.[m]} small />
          ))}
        </span>
      </div>
    </article>
  )
}
function MyWork({ data, openModal, refresh, notify, canWriteTasks = true }) {
  const { user, settings } = useApp()
  const pageSize = Math.max(10, Number(settings.pageSize) || 50)
  const hasPerson = Boolean(user?.personId)
  const [view, setView] = useState(settings.defaultTaskView || 'board')
  const [scope, setScope] = useState(hasPerson ? 'mine' : 'all')
  const [filter, setFilter] = useState('All tasks')
  const [query, setQuery] = useState('')
  const [advanced, setAdvanced] = useState([])
  const [sort, setSort] = useState({ key: 'dueDate', dir: 'asc' })
  const [dragId, setDragId] = useState(null)
  const [dragOver, setDragOver] = useState('')
  const [listLimit, setListLimit] = useState(pageSize)
  const [columnLimits, setColumnLimits] = useState({})
  const taskStatuses = workflowStateLabels(settings)
  const fields = [
    { key: 'id', label: 'Task ID' },
    { key: 'title', label: 'Task' },
    { key: 'project', label: 'Project' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'assignee', label: 'Owner' },
    { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'due', label: 'Due' }
  ]
  const mine = useMemo(
    () => (hasPerson ? data.tasks.filter(t => t.assigneeId === user.personId).length : 0),
    [data.tasks, hasPerson, user?.personId]
  )
  // `filtered` is the complete result: what is on screen is a window onto it, and exports use all of it.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const base = data.tasks.filter(
      t =>
        (scope === 'all' || t.assigneeId === user?.personId) &&
        (filter === 'All tasks' || t.priority === filter) &&
        (!needle || `${t.title} ${t.project} ${t.assignee} ${t.id}`.toLowerCase().includes(needle))
    )
    return sortRows(applyAdvancedFilters(base, advanced), sort)
  }, [data.tasks, scope, filter, query, advanced, sort, user?.personId])
  useEffect(() => {
    setListLimit(pageSize)
    setColumnLimits({})
  }, [scope, filter, query, advanced, sort, pageSize])
  const byStatus = useMemo(() => {
    const groups = Object.fromEntries(taskStatuses.map(status => [status, []]))
    for (const task of filtered as any[]) (groups[task.status] ||= []).push(task)
    return groups
  }, [filtered, taskStatuses.join('|')])
  // Tasks whose status is not (or no longer) part of the workflow still get a column, so nothing silently disappears.
  const columns = [...taskStatuses, ...Object.keys(byStatus).filter(status => !taskStatuses.includes(status))]
  const shown =
    view === 'board'
      ? columns.reduce(
          (sum, status) => sum + Math.min((byStatus[status] || []).length, columnLimits[status] ?? pageSize),
          0
        )
      : Math.min(filtered.length, listLimit)

  const changeStatus = async (task, payload, successTitle) => {
    if (!canWriteTasks) {
      notify({ title: 'Read-only role', body: 'You can view tasks but cannot change workflow state.', tone: 'warning' })
      return
    }
    try {
      await api.patch(`/api/tasks/${task.numericId}/status`, payload)
      notify({ title: successTitle, body: task.title, tone: 'success' })
    } catch (error) {
      notify({ title: 'Could not update the task', body: errorMessage(error), tone: 'warning' })
    } finally {
      refresh()
    }
  }
  const advance = task => changeStatus(task, { advance: true }, 'Task advanced')
  const moveTo = (task, status) =>
    status && status !== task.status ? changeStatus(task, { status }, `Moved to ${status}`) : undefined
  const dropTask = status => {
    const task = data.tasks.find(t => String(t.numericId) === String(dragId))
    setDragId(null)
    setDragOver('')
    if (task) moveTo(task, status)
  }
  const toggleSort = key =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const customFields = customFieldDefinitions(settings, 'task')
  return (
    <div className="page-content">
      <div className="work-toolbar">
        <div className="view-toggle" role="group" aria-label="View">
          <button
            type="button"
            className={view === 'board' ? 'selected' : ''}
            aria-pressed={view === 'board'}
            onClick={() => setView('board')}
          >
            <Icon name="overview" size={15} /> Board
          </button>
          <button
            type="button"
            className={view === 'list' ? 'selected' : ''}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <Icon name="tasks" size={15} /> List
          </button>
        </div>
        {hasPerson && (
          <div className="view-toggle" role="group" aria-label="Whose tasks">
            <button
              type="button"
              className={scope === 'mine' ? 'selected' : ''}
              aria-pressed={scope === 'mine'}
              onClick={() => setScope('mine')}
            >
              {tr(settings, 'Assigned to me')} ({mine})
            </button>
            <button
              type="button"
              className={scope === 'all' ? 'selected' : ''}
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              {tr(settings, 'Everyone')} ({data.tasks.length})
            </button>
          </div>
        )}
        <div className="work-search">
          <Icon name="search" size={15} />
          <input
            aria-label="Filter tasks"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter tasks"
          />
        </div>
        <select aria-label="Priority" value={filter} onChange={e => setFilter(e.target.value)}>
          <option>All tasks</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>
        <AdvancedFilter filterKey="tasks" fields={fields} onApply={setAdvanced} />
        <ExportMenu
          rows={filtered}
          columns={fields}
          title="Atlas tasks"
          settings={settings}
          page="tasks"
          customFields={customFields}
        />
        {canWriteTasks ? (
          <button type="button" className="primary-button" onClick={() => openModal('task')}>
            <Icon name="plus" size={15} /> Add task
          </button>
        ) : (
          <span className="readonly-pill">Read-only</span>
        )}
      </div>
      <FilterChips
        conditions={advanced}
        fields={fields}
        onClear={() => setAdvanced([])}
        onRemove={i => setAdvanced(c => c.filter((_, idx) => idx !== i))}
      />
      <div className="results-meta" role="status" aria-live="polite">
        {tr(settings, 'Showing {shown} of {total} matching tasks', { shown, total: filtered.length })}
        {filtered.length !== data.tasks.length &&
          ` · ${tr(settings, '{total} in the workspace', { total: data.tasks.length })}`}
        {canWriteTasks &&
          view === 'board' &&
          ` · ${tr(settings, 'drag cards or use “Move to” to change workflow state')}`}
      </div>
      {view === 'board' ? (
        <div className="board">
          {columns.map(status => {
            const list = byStatus[status] || []
            const limit = columnLimits[status] ?? pageSize
            return (
              <section
                className={`board-column column-${slug(status)} ${dragOver === status ? 'drag-over' : ''}`}
                key={status}
                aria-label={`${status}: ${list.length}`}
                onDragOver={e => {
                  e.preventDefault()
                  setDragOver(status)
                }}
                onDragLeave={() => setDragOver('')}
                onDrop={() => dropTask(status)}
              >
                <div className="board-column-head">
                  <span className="column-dot" />
                  <strong>{status}</strong>
                  <span className="column-count">{list.length}</span>
                </div>
                <div className="board-cards">
                  {list.slice(0, limit).map(t => (
                    <TaskCard
                      task={t}
                      key={t.numericId}
                      statuses={taskStatuses}
                      onAdvance={canWriteTasks ? () => advance(t) : null}
                      onMove={canWriteTasks ? next => moveTo(t, next) : null}
                      onEdit={canWriteTasks ? () => openModal('task', t) : null}
                      onDragStart={canWriteTasks ? () => setDragId(t.numericId) : null}
                      dragging={String(dragId) === String(t.numericId)}
                    />
                  ))}
                  {list.length > limit && (
                    <button
                      type="button"
                      className="text-button show-more"
                      onClick={() => setColumnLimits(c => ({ ...c, [status]: limit + pageSize }))}
                    >
                      {tr(settings, 'Show {count} more ({remaining} left)', {
                        count: Math.min(pageSize, list.length - limit),
                        remaining: list.length - limit
                      })}
                    </button>
                  )}
                </div>
                {canWriteTasks && (
                  <button type="button" className="add-column-task" onClick={() => openModal('task', { status })}>
                    <Icon name="plus" size={13} /> Add task
                  </button>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <div className="panel task-table-panel">
          <div className="table-head sortable-head">
            {['title', 'priority', 'status', 'dueDate', 'assignee'].map(key => (
              <button
                type="button"
                key={key}
                className={sort.key === key ? 'sorted' : ''}
                onClick={() => toggleSort(key)}
              >
                {fields.find(f => f.key === key)?.label || key}
                <Icon name="down" size={11} />
              </button>
            ))}
          </div>
          {filtered.slice(0, listLimit).map(t => (
            <TaskRow
              key={t.numericId}
              task={t}
              onAdvance={canWriteTasks ? advance : undefined}
              onEdit={canWriteTasks ? () => openModal('task', t) : undefined}
            />
          ))}
          {filtered.length > listLimit && (
            <button
              type="button"
              className="text-button show-more"
              onClick={() => setListLimit(limit => limit + pageSize)}
            >
              {tr(settings, 'Show {count} more ({remaining} left)', {
                count: Math.min(pageSize, filtered.length - listLimit),
                remaining: filtered.length - listLimit
              })}
            </button>
          )}
        </div>
      )}
      {!canWriteTasks && (
        <PermissionNotice>
          Your role can inspect tasks, filters, exports, and reports, but cannot change workflow state.
        </PermissionNotice>
      )}
      {!filtered.length && (
        <EmptyState
          title="No tasks match"
          message={
            scope === 'mine' && data.tasks.length > 0
              ? 'Nothing is assigned to you. Switch to “Everyone” to see the whole workspace.'
              : canWriteTasks
                ? 'Clear filters or add a new task.'
                : 'Clear filters to see more tasks.'
          }
          action={canWriteTasks ? 'Add task' : ''}
          onAction={canWriteTasks ? () => openModal('task') : undefined}
        />
      )}
    </div>
  )
}
function TaskCard({ task, statuses = [], onAdvance, onMove, onEdit, onDragStart, dragging }) {
  const { settings } = useApp()
  const language = uiLanguage(settings)
  return (
    <article
      className={`board-card ${dragging ? 'dragging' : ''}`}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      tabIndex={0}
      aria-label={`${task.id}: ${task.title}`}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && onEdit) {
          e.preventDefault()
          onEdit()
        }
      }}
    >
      <div className="board-card-top">
        <span className={`priority-dot priority-dot-${task.priority.toLowerCase()}`} title={task.priority} />
        <span className="task-id">{task.id}</span>
        {onAdvance && !task.done && (
          <button
            type="button"
            className="icon-button subtle"
            aria-label={tr(settings, 'Advance {title} to the next status', { title: task.title })}
            title={tr(settings, 'Advance to the next status')}
            onClick={onAdvance}
          >
            <Icon name="arrow" size={14} />
          </button>
        )}
        {onEdit && (
          <button type="button" className="icon-button subtle" aria-label={`Edit ${task.title}`} onClick={onEdit}>
            <Icon name="more" size={15} />
          </button>
        )}
      </div>
      <h3>{task.title}</h3>
      <div className="board-card-project">
        <span className="mini-project" />
        {task.project}
      </div>
      <div className="board-card-bottom">
        <span className={`due-${task.dueTone}`}>
          <Icon name="calendar" size={13} /> {dueText(task, language, settings)}
        </span>
        <Avatar name={task.assignee} color={task.assigneeColor} small />
      </div>
      {onMove && (
        <select
          className="card-move"
          aria-label={tr(settings, 'Move {title} to', { title: task.title })}
          value={task.status}
          onChange={e => onMove(e.target.value)}
        >
          {statuses.map(status => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      )}
    </article>
  )
}
function People({ data, openModal, canManage }) {
  const [team, setTeam] = useState('Everyone')
  const [advanced, setAdvanced] = useState([])
  const fields = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'team', label: 'Team' },
    { key: 'status', label: 'Status' },
    { key: 'load', label: 'Planned capacity' }
  ]
  const rows = applyAdvancedFilters(
    data.people.filter(p => team === 'Everyone' || p.team === team),
    advanced
  )
  const avg = data.people.length ? Math.round(data.people.reduce((s, p) => s + p.load, 0) / data.people.length) : 0
  return (
    <div className="page-content">
      <div className="people-summary">
        <div className="people-summary-main">
          <span className="eyebrow">
            <span className="eyebrow-dot green" /> Team pulse
          </span>
          <h2>{data.people.length} people, one clear view.</h2>
          <p>Planned capacity is entered by hand on each profile; it is not calculated from assigned work.</p>
        </div>
        <div className="people-stats">
          <div>
            <strong>{avg}%</strong>
            <span>Avg. planned capacity</span>
          </div>
          <div>
            <strong>{data.activity.filter(a => a.date === data.today).length}</strong>
            <span>Updates today</span>
          </div>
          <div>
            <strong>{data.people.filter(p => p.status !== 'On track').length}</strong>
            <span>Need support</span>
          </div>
        </div>
      </div>
      <div className="toolbar">
        <div className="filter-tabs">
          {['Everyone', ...data.teams.map(t => t.name)].map(tab => (
            <button className={team === tab ? 'selected' : ''} onClick={() => setTeam(tab)} key={tab}>
              {tab}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <AdvancedFilter filterKey="people" fields={fields} onApply={setAdvanced} />
          <ExportMenu rows={rows} columns={fields} title="Atlas people" settings={data.settings} />
          {canManage && (
            <button className="secondary-button" onClick={() => openModal('team')}>
              <Icon name="team" size={15} /> Manage teams
            </button>
          )}
          {canManage && (
            <button className="primary-button" onClick={() => openModal('person')}>
              <Icon name="plus" size={15} /> Add person
            </button>
          )}
        </div>
      </div>
      <div className="team-strip">
        {data.teams.map(t => (
          <button className="team-chip" key={t.id} onClick={() => canManage && openModal('team', t)}>
            <span className={`team-chip-dot team-chip-${t.color}`} />
            {t.name}
            <small>{t.peopleCount}</small>
          </button>
        ))}
      </div>
      <div className="people-grid">
        {rows.map(p => (
          <PersonCard person={p} key={p.id} onEdit={canManage ? () => openModal('person', p) : null} />
        ))}
      </div>
      {!rows.length && <EmptyState title="No people match" message="Clear filters or add a person." />}
    </div>
  )
}
function PersonCard({ person, onEdit }) {
  return (
    <article className="person-card">
      <div className="person-card-head">
        <Avatar name={person.name} color={person.color} />
        <span className={`online-status ${person.status !== 'On track' ? 'attention' : ''}`}>
          <i /> {person.status}
        </span>
        {onEdit && (
          <button aria-label="Edit" className="icon-button subtle" onClick={onEdit}>
            <Icon name="more" size={16} />
          </button>
        )}
      </div>
      <div className="person-name">
        <h3>{person.name}</h3>
        <p>{person.role}</p>
      </div>
      <div className="person-focus">
        <span>Current focus</span>
        <strong>{person.focus}</strong>
      </div>
      <div className="person-card-foot">
        <span>{person.team}</span>
        <div className="capacity">
          <span>Planned capacity</span>
          <strong>{person.load}%</strong>
          <div className="capacity-track">
            <i style={{ width: `${person.load}%` }} />
          </div>
        </div>
      </div>
    </article>
  )
}
const shiftIsoDate = (iso, days) => {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
function ActivityLog({ data, openModal, setPage, canLogActivity = true }) {
  const { settings } = useApp()
  const [visible, setVisible] = useState(16)
  const [range, setRange] = useState('All activity')
  const [advanced, setAdvanced] = useState([])
  const fields = [
    { key: 'person', label: 'Person' },
    { key: 'date', label: 'Date' },
    { key: 'today', label: 'Today' },
    { key: 'blocked', label: 'Blocked' }
  ]
  const rows = applyAdvancedFilters(
    range === 'Today'
      ? data.activity.filter(a => a.date === data.today)
      : range === 'Yesterday'
        ? data.activity.filter(a => a.date === shiftIsoDate(data.today, -1))
        : data.activity,
    advanced
  )
  const allTimeline = rows.flatMap(a =>
    [
      a.today && {
        a,
        action: 'is working on',
        detail: a.today,
        tone: a.blocked ? 'orange' : 'purple',
        icon: a.blocked ? 'warning' : 'bolt'
      },
      a.yesterday && { a, action: 'completed', detail: a.yesterday, tone: 'green', icon: 'check' }
    ].filter(Boolean)
  )
  const timeline = allTimeline.slice(0, visible)
  return (
    <div className="page-content">
      <div className="toolbar">
        <div className="filter-tabs">
          {['All activity', 'Today', 'Yesterday'].map(tab => (
            <button className={range === tab ? 'selected' : ''} key={tab} onClick={() => setRange(tab)}>
              {tab}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <AdvancedFilter filterKey="activity" fields={fields} onApply={setAdvanced} />
          <ExportMenu
            rows={rows}
            columns={[
              { key: 'person', label: 'Person' },
              { key: 'date', label: 'Date' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: 'today', label: 'Today' },
              { key: 'blocked', label: 'Blocked' },
              { key: 'upcoming', label: 'Upcoming' }
            ]}
            title="Atlas activity"
            settings={data.settings}
          />
          {canLogActivity ? (
            <button className="secondary-button" onClick={() => openModal('activity')}>
              <Icon name="plus" size={15} /> Log update
            </button>
          ) : (
            <span className="readonly-pill">Read-only</span>
          )}
        </div>
      </div>
      {!canLogActivity && (
        <PermissionNotice>Your role can view activity and reports, but cannot log updates.</PermissionNotice>
      )}
      <p className="filter-hint" role="note">
        {tr(settings, 'Daily updates are visible to everyone in this workspace.')}{' '}
        {tr(
          settings,
          settings?.reports?.activityVisibility === 'everyone'
            ? 'Per-person activity reports are visible to everyone in this workspace.'
            : 'Per-person activity reports are limited to managers and administrators; everyone can see their own.'
        )}
      </p>
      <div className="activity-layout">
        <section className="panel timeline-panel">
          <div className="section-head">
            <div>
              <h2>Workspace timeline</h2>
              <p>Everything important, in context.</p>
            </div>
            <span className="live-label" title="This page checks for changes every 20 seconds">
              <i /> Updates automatically
            </span>
          </div>
          <div className="timeline">
            {timeline.map((item, i) => (
              <div className="timeline-row" key={`${item.a.id}-${i}`}>
                <div className="timeline-time">
                  <strong>{item.a.time}</strong>
                  <span>{item.a.date === data.today ? 'Today' : item.a.date}</span>
                </div>
                <div className={`timeline-line tone-${item.tone}`}>
                  <span>
                    <Icon name={item.icon} size={14} />
                  </span>
                </div>
                <div className="timeline-content">
                  <div>
                    <Avatar name={item.a.person} color={item.a.personColor} small />
                    <strong>{item.a.person}</strong>
                    <span>{item.action}</span>
                    <b>{item.detail}</b>
                  </div>
                  <p>{item.a.blocked ? `Blocked: ${item.a.blocked}` : 'Daily update confirmed'}</p>
                </div>
              </div>
            ))}
          </div>
          {allTimeline.length > visible && (
            <button type="button" className="text-button show-more" onClick={() => setVisible(v => v + 16)}>
              {tr(settings, 'Show {count} more ({remaining} left)', {
                count: Math.min(16, allTimeline.length - visible),
                remaining: allTimeline.length - visible
              })}
            </button>
          )}
        </section>
        <aside className="activity-aside">
          <section className="panel insight-card">
            <span className="insight-spark">
              <Icon name="spark" size={16} />
            </span>
            <h3>One thing to notice</h3>
            <p>
              Daily updates become operational intelligence: blockers surface in alerts, exports, and reports
              automatically.
            </p>
            <button className="text-button" onClick={() => setPage('reports')}>
              See trend <Icon name="arrow" size={13} />
            </button>
          </section>
          {data.dashboard.mostActive && (
            <section className="panel contributor-card">
              <div className="section-head compact">
                <div>
                  <h3>Most active this week</h3>
                  <p>By daily updates</p>
                </div>
              </div>
              {data.dashboard.mostActive.map((p, i) => (
                <div className="contributor-row" key={p.personId}>
                  <span className="rank">0{i + 1}</span>
                  <Avatar name={p.name} color={p.color} small />
                  <strong>{p.name}</strong>
                  <span>{p.updates} updates</span>
                </div>
              ))}
              {!data.dashboard.mostActive.length && <p className="filter-hint">No updates logged this week yet.</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
function Reports({ report, onPeriodChange, settings, setPage }) {
  const { notify } = useApp()
  const [period, setPeriod] = useState('Weekly')
  const [metric, setMetric] = useState('rate')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const columns = [
    { key: 'label', label: 'Period' },
    { key: 'created', label: 'Created' },
    { key: 'completed', label: 'Completed' },
    { key: 'planned', label: 'Due' },
    { key: 'delivered', label: 'Delivered on time' },
    { key: 'rate', label: 'On-time rate %' }
  ]
  const series = report?.series || []
  const rated = series.filter(p => p.rate !== null && p.rate !== undefined)
  const peak = rated.reduce((best, p) => (p.rate > (best?.rate ?? -1) ? p : best), null)
  const maxCount = Math.max(1, ...series.map(p => Math.max(p.completed || 0, p.created || 0)))
  const deliveryRate = report?.deliveryRate
  const hasRate = deliveryRate !== null && deliveryRate !== undefined
  const change = async p => {
    setPeriod(p)
    setLoading(true)
    setSelected(null)
    try {
      await onPeriodChange(p.toLowerCase())
    } catch (error) {
      notify({ title: 'Could not load the report', body: errorMessage(error), tone: 'warning' })
    } finally {
      setLoading(false)
    }
  }
  const barHeight = p => (metric === 'rate' ? (p.rate ?? 0) : Math.round(((p.completed || 0) / maxCount) * 100))
  const lineHeight = p => (metric === 'rate' ? 0 : Math.round(((p.created || 0) / maxCount) * 100))
  const yAxis =
    metric === 'rate'
      ? ['100%', '75%', '50%', '25%', '0%']
      : [maxCount, Math.round(maxCount * 0.75), Math.round(maxCount * 0.5), Math.round(maxCount * 0.25), 0].map(String)
  return (
    <div className="page-content">
      <div className="report-hero">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-dot" /> Delivery intelligence
          </span>
          <h2>A clearer picture of momentum.</h2>
          <p>
            Daily, weekly, monthly, quarterly and annual reports are built from the work ledger (what was created and
            completed, and when) and from current task due dates. History does not change when a task is later edited,
            re-opened or deleted.
          </p>
        </div>
        <div className="report-hero-actions">
          <button type="button" className="secondary-button" onClick={() => setPage('tasks')}>
            <Icon name="tasks" size={14} /> Open tasks
          </button>
          <ExportMenu
            rows={series}
            columns={columns}
            title={`${period} Atlas report`}
            settings={settings}
            page="report"
          />
        </div>
      </div>
      <div className="report-tabs" role="group" aria-label="Report period">
        {['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'].map(p => (
          <button
            type="button"
            key={p}
            className={period === p ? 'selected' : ''}
            aria-pressed={period === p}
            onClick={() => change(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {loading && (
        <div className="report-loading" role="status">
          Refreshing report…
        </div>
      )}
      <div className="report-insight-strip">
        <div>
          <strong>{hasRate ? `${deliveryRate}%` : '—'}</strong>
          <span>On-time delivery</span>
        </div>
        <div>
          <strong>{report?.completed || 0}</strong>
          <span>Completed</span>
        </div>
        <div>
          <strong>{report?.blockedTasks || 0}</strong>
          <span>Blocked now</span>
        </div>
        <div>
          <strong>{peak?.label || '—'}</strong>
          <span>Best period{peak ? ` · ${peak.rate}%` : ''}</span>
        </div>
      </div>
      <div className="report-grid">
        <section className="panel chart-panel">
          <div className="section-head">
            <div>
              <h2>{metric === 'rate' ? `${period} on-time delivery rate` : `${period} throughput`}</h2>
              <p>Select a bar for details. Export includes every period shown.</p>
            </div>
            <div className="view-toggle" role="group" aria-label="Metric">
              <button
                type="button"
                className={metric === 'rate' ? 'selected' : ''}
                aria-pressed={metric === 'rate'}
                onClick={() => setMetric('rate')}
              >
                On-time rate
              </button>
              <button
                type="button"
                className={metric === 'count' ? 'selected' : ''}
                aria-pressed={metric === 'count'}
                onClick={() => setMetric('count')}
              >
                Throughput
              </button>
            </div>
          </div>
          <div className="chart-legend">
            {metric === 'rate' ? (
              <span>
                <i className="legend-purple" /> Delivered on time ÷ due
              </span>
            ) : (
              <>
                <span>
                  <i className="legend-purple" /> Completed
                </span>
                <span>
                  <i className="legend-muted" /> Created
                </span>
              </>
            )}
          </div>
          <div className="chart-area">
            <div className="y-axis" aria-hidden="true">
              {yAxis.map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
            <div className="chart">
              <div className="grid-lines">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="bars">
                {series.map((p, i) => (
                  <button
                    type="button"
                    className={`bar-group ${selected?.label === p.label ? 'selected' : ''}`}
                    key={`${p.label}-${i}`}
                    aria-label={`${p.label}: ${p.created} created, ${p.completed} completed, ${p.planned} due, ${p.rate === null ? 'no rate' : `${p.rate}% on time`}`}
                    onClick={() => setSelected(p)}
                  >
                    <div
                      className="bar-value"
                      style={{ height: `${Math.max(barHeight(p), p.completed || p.rate ? 4 : 1)}%` }}
                    >
                      <span>{metric === 'rate' ? (p.rate === null ? '—' : `${p.rate}%`) : p.completed}</span>
                    </div>
                    {metric === 'count' && (
                      <div className="planned-line" style={{ height: `${Math.max(lineHeight(p), 2)}%` }} />
                    )}
                    <label>{p.label}</label>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="chart-footer">
            <span>
              <strong>{report?.completed || 0}</strong> completed · <strong>{report?.created || 0}</strong> created
            </span>
            <span>{report?.activities || 0} activity updates</span>
          </div>
          {selected && (
            <div className="report-drilldown">
              <div>
                <strong>{selected.label}</strong>
                <span>
                  {tr(
                    settings,
                    '{created} created · {completed} completed · {planned} due · {delivered} on time · {rate}',
                    {
                      created: selected.created,
                      completed: selected.completed,
                      planned: selected.planned,
                      delivered: selected.delivered,
                      rate:
                        selected.rate === null
                          ? translateUiText(settings, 'no rate (nothing was due)')
                          : `${selected.rate}%`
                    }
                  )}
                </span>
              </div>
              <button type="button" className="text-button" onClick={() => setSelected(null)}>
                Clear
              </button>
            </div>
          )}
        </section>
        <section className="panel report-score">
          <div className="section-head">
            <div>
              <h2>On-time delivery</h2>
              <p>Tasks that came due in this window</p>
            </div>
          </div>
          <div
            className="score-ring"
            role="img"
            aria-label={hasRate ? `${deliveryRate} percent delivered on time` : 'No tasks came due in this window'}
            style={{
              background: `conic-gradient(var(--purple) 0 ${hasRate ? deliveryRate : 0}%, #ecebf8 ${hasRate ? deliveryRate : 0}% 100%)`
            }}
          >
            <div>
              <strong>{hasRate ? deliveryRate : '—'}</strong>
              <span>{hasRate ? '%' : ''}</span>
            </div>
          </div>
          <p>
            {hasRate
              ? `${report?.delivered || 0} of ${report?.planned || 0} tasks that came due were completed on or before their due date.`
              : 'No task came due in this window, so there is nothing to measure yet.'}
          </p>
          <button type="button" className="full-width-button" onClick={() => setPage('alerts')}>
            View attention items <Icon name="arrow" size={13} />
          </button>
        </section>
      </div>
      <div className="report-highlights">
        <div>
          <span className="highlight-icon green">
            <Icon name="check" size={16} />
          </span>
          <div>
            <strong>{report?.completed || 0} tasks completed</strong>
            <span>Selected period</span>
          </div>
        </div>
        <div>
          <span className="highlight-icon blue">
            <Icon name="clock" size={16} />
          </span>
          <div>
            <strong>{report?.remainingTasks || 0} tasks remaining</strong>
            <span>{report?.activeProjects || 0} active projects (now)</span>
          </div>
        </div>
        <div>
          <span className="highlight-icon orange">
            <Icon name="warning" size={16} />
          </span>
          <div>
            <strong>{report?.blockedTasks || 0} blocked tasks</strong>
            <span>
              {report?.overdue || 0} overdue · {report?.alerts || 0} open alerts (now)
            </span>
          </div>
        </div>
      </div>
      {report?.definitions && (
        <details className="report-definitions">
          <summary>How these numbers are calculated</summary>
          <dl>
            {Object.entries(report.definitions).map(([key, text]) => (
              <React.Fragment key={key}>
                <dt>{key}</dt>
                <dd>{String(text)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}
function UserActivityReports({ people = [], settings }) {
  const { user } = useApp()
  const [period, setPeriod] = useState('weekly')
  const [scope, setScope] = useState('all')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedRow, setSelectedRow] = useState(null)
  const [visible, setVisible] = useState(25)
  const seesEveryone =
    hasPermission(user, 'managePeople') ||
    hasPermission(user, 'manageSettings') ||
    settings?.reports?.activityVisibility === 'everyone'
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReport(
        await api.get(`/api/reports/activity/${period}?userId=${encodeURIComponent(seesEveryone ? scope : 'all')}`)
      )
      setVisible(25)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [period, scope, seesEveryone])
  useEffect(() => {
    load()
  }, [load])
  const rowColumns = [
    { key: 'date', label: 'Date' },
    { key: 'time', label: 'Time' },
    { key: 'person', label: 'Person' },
    { key: 'project', label: 'Project' },
    { key: 'taskId', label: 'Task ID' },
    { key: 'task', label: 'Task / Update' },
    { key: 'action', label: 'Action' },
    { key: 'status', label: 'Status' },
    { key: 'summary', label: 'Details' }
  ]
  const userColumns = [
    { key: 'person', label: 'Person' },
    { key: 'role', label: 'Job title' },
    { key: 'team', label: 'Team' },
    { key: 'tasksTouched', label: 'Tasks touched' },
    { key: 'completedTasks', label: 'Completed' },
    { key: 'projects', label: 'Projects' },
    { key: 'updates', label: 'Updates' },
    { key: 'blockers', label: 'Blockers' },
    { key: 'events', label: 'Events' }
  ]
  const projectColumns = [
    { key: 'project', label: 'Project' },
    { key: 'projectCode', label: 'Code' },
    { key: 'tasksTouched', label: 'Tasks touched' },
    { key: 'completedTasks', label: 'Completed' },
    { key: 'users', label: 'People' },
    { key: 'events', label: 'Events' }
  ]
  const totals = report?.totals || {}
  const rows = report?.rows || []
  const maxCompleted = Math.max(1, ...(report?.projects || []).map(p => p.completedTasks))
  return (
    <section className="page-content activity-report-lab">
      <div className="activity-report-hero">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-dot green" /> Activity log
          </span>
          <h2>Who did what, when, and inside which project.</h2>
          <p>
            Every row is something that was recorded: a task created, moved or completed, an update posted, a blocker
            raised. Atlas records what happened, not how long it took, so no time-spent figures are produced.
          </p>
        </div>
        <div className="report-builder-controls">
          <label>
            Timeframe
            <select value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="daily">Day</option>
              <option value="weekly">Week</option>
              <option value="monthly">Month</option>
            </select>
          </label>
          {seesEveryone && (
            <label>
              Scope
              <select value={scope} onChange={e => setScope(e.target.value)}>
                <option value="all">Everyone (aggregate)</option>
                {people.map(person => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.jobTitle || person.role}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="secondary-button" onClick={load}>
            <Icon name="activity" size={15} /> Refresh
          </button>
        </div>
      </div>
      {!seesEveryone && (
        <PermissionNotice>
          You can see your own activity here. Workspace managers can see the whole team (an administrator can change
          this in Settings → Reports).
        </PermissionNotice>
      )}
      {error && (
        <div className="global-error" role="alert">
          <Icon name="warning" size={15} />
          {error}
          <button type="button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {loading && (
        <div className="report-loading" role="status">
          Loading the activity log…
        </div>
      )}
      <div className="activity-report-totals">
        <div>
          <strong>{totals.tasksTouched || 0}</strong>
          <span>Tasks touched</span>
        </div>
        <div>
          <strong>{totals.completedTasks || 0}</strong>
          <span>Completed tasks</span>
        </div>
        <div>
          <strong>{totals.activeUsers || 0}</strong>
          <span>People active</span>
        </div>
        <div>
          <strong>{totals.projects || 0}</strong>
          <span>Projects</span>
        </div>
        <div>
          <strong>{totals.updates || 0}</strong>
          <span>Daily updates</span>
        </div>
        <div>
          <strong>{totals.blockers || 0}</strong>
          <span>Blockers raised</span>
        </div>
      </div>
      <div className="activity-report-grid">
        <section className="panel report-evidence-panel">
          <div className="section-head">
            <div>
              <h2>Activity events</h2>
              <p>
                {report?.scope || 'Everyone'} · {period} breakdown
              </p>
            </div>
            <ExportMenu
              rows={rows}
              columns={rowColumns}
              title={`${report?.scope || 'Everyone'} ${period} activity log`}
              settings={settings}
              page="activity-log"
            />
          </div>
          <div className="evidence-list">
            {rows.slice(0, visible).map(row => (
              <button
                type="button"
                className={`evidence-row ${selectedRow?.id === row.id ? 'selected' : ''}`}
                key={row.id}
                onClick={() => setSelectedRow(row)}
              >
                <div className="evidence-date">
                  <strong>{row.date}</strong>
                  <span>{row.time}</span>
                </div>
                <div className="evidence-main">
                  <div>
                    <Avatar name={row.person} small />
                    <strong>{row.person}</strong>
                    {row.role && <small className="muted-text">{row.role}</small>}
                  </div>
                  <p>
                    {row.taskId ? `${row.taskId} · ` : ''}
                    {row.task}
                  </p>
                  <small>
                    {row.project} · {row.action} · {row.status}
                  </small>
                </div>
                <span className="effort-chip">{row.derived ? 'from task record' : row.source}</span>
              </button>
            ))}
            {!rows.length && !loading && (
              <EmptyState title="No activity in this period" message="Try another timeframe or choose everyone." />
            )}
          </div>
          {rows.length > visible && (
            <button type="button" className="text-button show-more" onClick={() => setVisible(v => v + 25)}>
              {tr(settings, 'Show {count} more ({remaining} left)', { count: 25, remaining: rows.length - visible })}
            </button>
          )}
          {report?.rowsTruncated && (
            <p className="filter-hint">
              {tr(
                settings,
                'Showing the newest {shown} of {total} events. The summaries above count all of them; pick a person or a shorter timeframe to see the rest.',
                { shown: rows.length, total: report.rowsTotal }
              )}
            </p>
          )}
          {selectedRow && (
            <div className="report-drilldown">
              <div>
                <strong>{selectedRow.task}</strong>
                <span>
                  {selectedRow.summary || 'No additional details'} · {selectedRow.project}
                </span>
              </div>
              <button type="button" className="text-button" onClick={() => setSelectedRow(null)}>
                Clear
              </button>
            </div>
          )}
        </section>
        <aside className="panel report-score user-summary-panel">
          <div className="section-head">
            <div>
              <h2>People summary</h2>
              <p>Aggregated by selected timeframe</p>
            </div>
            <ExportMenu
              rows={report?.users || []}
              columns={userColumns}
              title={`${report?.scope || 'Everyone'} ${period} summary`}
              settings={settings}
              page="activity-summary"
            />
          </div>
          <div className="user-summary-list">
            {(report?.users || []).map(person => (
              <div className="user-summary-row" key={person.personId}>
                <div>
                  <Avatar name={person.person} small />
                  <strong>{person.person}</strong>
                </div>
                <span>
                  {person.completedTasks}/{person.tasksTouched} tasks
                </span>
                <span>{person.projects} projects</span>
                <span>{person.events} events</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <section className="panel project-table activity-project-panel">
        <div className="section-head">
          <div>
            <h2>Project contribution</h2>
            <p>Tasks completed per project, relative to the busiest project.</p>
          </div>
          <ExportMenu
            rows={report?.projects || []}
            columns={projectColumns}
            title={`${period} project contribution`}
            settings={settings}
            page="activity-projects"
          />
        </div>
        <div className="project-contribution-grid">
          {(report?.projects || []).map(project => (
            <div key={project.project} className="project-contribution-card">
              <strong>{project.project}</strong>
              <span>{project.projectCode}</span>
              <ProgressBar value={(project.completedTasks / maxCompleted) * 100} color="purple" />
              <p>
                {tr(settings, '{completed} completed · {touched} touched · {people} people · {events} events', {
                  completed: project.completedTasks,
                  touched: project.tasksTouched,
                  people: project.users,
                  events: project.events
                })}
              </p>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}
function Alerts({ data, refresh, openModal, canManage, canResolve = false }) {
  const { notify } = useApp()
  const [filter, setFilter] = useState('Open')
  const [advanced, setAdvanced] = useState([])
  const fields = [
    { key: 'title', label: 'Alert' },
    { key: 'type', label: 'Type' },
    { key: 'project', label: 'Project' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'time', label: 'Created' }
  ]
  const rows = applyAdvancedFilters(
    data.alerts.filter(a => filter === 'All' || (filter === 'Open' ? !a.resolved : a.resolved)),
    advanced
  )
  const toggle = async alert => {
    if (!canResolve) return
    try {
      await api.patch(`/api/alerts/${alert.id}`, { resolved: !alert.resolved })
    } catch (error) {
      notify({ title: 'Could not update the alert', body: errorMessage(error), tone: 'warning' })
    } finally {
      refresh()
    }
  }
  return (
    <div className="page-content">
      <div className="alerts-summary">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-dot orange" /> Attention center
          </span>
          <h2>Nothing should surprise you.</h2>
          <p>Risks and blockers are linked to work and included in exportable reporting.</p>
        </div>
        <div className="alert-count">
          <strong>{data.alerts.filter(a => !a.resolved).length}</strong>
          <span>open alerts</span>
        </div>
      </div>
      <div className="toolbar">
        <div className="filter-tabs">
          {['Open', 'All', 'Resolved'].map(tab => (
            <button className={filter === tab ? 'selected' : ''} key={tab} onClick={() => setFilter(tab)}>
              {tab}
              <span>
                {tab === 'Open'
                  ? data.alerts.filter(a => !a.resolved).length
                  : tab === 'Resolved'
                    ? data.alerts.filter(a => a.resolved).length
                    : data.alerts.length}
              </span>
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <AdvancedFilter filterKey="alerts" fields={fields} onApply={setAdvanced} />
          <ExportMenu rows={rows} columns={fields} title="Atlas alerts" settings={data.settings} />
          {canManage && (
            <button className="primary-button" onClick={() => openModal('alert')}>
              <Icon name="plus" size={15} /> New alert
            </button>
          )}
        </div>
      </div>
      <div className="alert-list">
        {rows.map(alert => (
          <div className={`alert-row ${alert.resolved ? 'alert-resolved' : ''}`} key={alert.id}>
            <span className={`alert-type alert-${alert.tone}`}>
              <Icon
                name={
                  alert.type === 'blocker' || alert.type === 'risk' || alert.type === 'overdue' ? 'warning' : 'alerts'
                }
                size={18}
              />
            </span>
            <div className="alert-content">
              <div className="alert-title-row">
                <h3>{alert.title}</h3>
                <span>{alert.time}</span>
              </div>
              <p>{alert.body}</p>
              <div className="alert-meta">
                <span>{alert.project}</span>
                {alert.resolved && <StatusPill tone="resolved">Resolved</StatusPill>}
              </div>
            </div>
            {canResolve && (
              <button className={alert.resolved ? 'secondary-button' : 'resolve-button'} onClick={() => toggle(alert)}>
                {alert.resolved ? 'Re-open' : 'Mark resolved'}
                {!alert.resolved && <Icon name="check" size={14} />}
              </button>
            )}
            {canManage && (
              <button aria-label="Edit" className="icon-button subtle" onClick={() => openModal('alert', alert)}>
                <Icon name="more" size={16} />
              </button>
            )}
          </div>
        ))}
        {!rows.length && <EmptyState title="All clear" message="No alerts in this view." />}
      </div>
    </div>
  )
}
function AccessControlPanel({ users = [], people = [], openModal, onDelete, canAdmin, settings }) {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'team', label: 'Team' },
    { key: 'active', label: 'Active' }
  ]
  const safeUsers = users.map(user => ({ ...user, active: user.active === false ? 'No' : 'Yes' }))
  return (
    <section className="panel settings-card access-card">
      <div className="section-head">
        <div>
          <h2>Users</h2>
        </div>
        {canAdmin && (
          <button className="primary-button" onClick={() => openModal('user')}>
            <Icon name="plus" size={15} /> Add user
          </button>
        )}
      </div>
      <div className="access-table">
        <div className="access-table-head">
          <span>User</span>
          <span>Role</span>
          <span>Team</span>
          <span>Status</span>
          <span />
        </div>
        {users.map(user => (
          <div className="access-row" key={user.id}>
            <div>
              <Avatar name={user.name} color={user.avatarColor} small />
              <div>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </div>
            </div>
            <RoleBadge role={user.role} />
            <span>{user.team}</span>
            <StatusPill tone={user.active === false ? 'at-risk' : 'on-track'}>
              {user.active === false ? 'Disabled' : 'Active'}
            </StatusPill>
            <div>
              {canAdmin && (
                <button aria-label="Edit" className="icon-button subtle" onClick={() => openModal('user', user)}>
                  <Icon name="more" size={16} />
                </button>
              )}
              {canAdmin && (
                <button
                  aria-label="Delete"
                  className="icon-button subtle danger-icon"
                  onClick={() => onDelete('user', user)}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {!users.length && <EmptyState title="No users yet." message="Add the first user when setup is complete." />}
      </div>
      <ExportMenu
        rows={safeUsers}
        columns={columns}
        title="Atlas users"
        settings={settings || { printTemplate: 'compact' }}
      />
    </section>
  )
}
function timeZoneOptions(current) {
  let zones = ['UTC']
  try {
    zones = ['UTC', ...(Intl as any).supportedValuesOf('timeZone')]
  } catch {
    /* older engines: fall back to the current value only */
  }
  return [...new Set([current, ...zones].filter(Boolean))]
}
function SettingsPanel({ title, description = '', children, wide = false }) {
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
function NotAppliedBadge({ path }) {
  return isNotApplied(path) ? (
    <span className="setting-badge" title={NOT_APPLIED_HINT}>
      Not applied yet
    </span>
  ) : null
}
function SettingInput({
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

function AdvancedI18nIntegrationAdmin({ form, patch, canAdmin }) {
  const localization = form.localization || {}
  const interfaces = localization.interfaces || {}
  const translations = localization.translations || {}
  const activeLanguages = localization.activeLanguages || []
  const [draft, setDraft] = useState({ namespace: '', label: '', version: '1.0.0', owner: '', route: '' })
  const add = () => {
    const namespace = slug(draft.namespace).replaceAll('-', '_')
    if (!namespace) return
    patch('localization.interfaces', {
      ...interfaces,
      [namespace]: {
        namespace,
        label: draft.label || namespace,
        version: draft.version || '1.0.0',
        owner: draft.owner || 'custom',
        route: draft.route || '',
        status: 'active',
        registeredAt: new Date().toISOString(),
        keys: []
      }
    })
    setDraft({ namespace: '', label: '', version: '1.0.0', owner: '', route: '' })
  }
  const updateInterface = (namespace, row) =>
    patch('localization.interfaces', { ...interfaces, [namespace]: { ...(interfaces[namespace] || {}), ...row } })
  // Runtime missing-key reports are diagnostics held in server memory (never saved with settings).
  const [missing, setMissing] = useState([])
  useEffect(() => {
    api
      .get('/api/i18n/missing')
      .then(result => setMissing(result.keys || []))
      .catch(() => {})
  }, [])
  const catalogKeyCount = (Object.values(translations) as any[]).reduce((set: Set<string>, catalog) => {
    Object.keys(catalog || {}).forEach(key => set.add(key))
    return set
  }, new Set<string>()).size
  const sample =
    "window.AtlasI18n.t('billing.invoice_due', 'Invoice {number} is due', { number: 'INV-42' })\nwindow.AtlasI18n.registerInterface('billing', { en: { 'billing.invoice_due': 'Invoice {number} is due' }, ar: { 'billing.invoice_due': 'الفاتورة {number} مستحقة' } }, { label: 'Billing' })"
  return (
    <div className="i18n-integration-admin">
      <div className="config-stat-grid i18n-stat-grid">
        <div>
          <strong>{catalogKeyCount}</strong>
          <span>catalog keys</span>
        </div>
        <div>
          <strong>{activeLanguages.length}</strong>
          <span>active languages</span>
        </div>
        <div>
          <strong>{Object.keys(interfaces).length}</strong>
          <span>registered interfaces</span>
        </div>
        <div>
          <strong>{missing.length}</strong>
          <span>missing translations</span>
        </div>
      </div>
      <div className="settings-note">
        <Icon name="spark" size={15} />
        <span>Expose AtlasI18n to extensions, dynamic screens, and embedded widgets.</span>
      </div>
      <div className="interface-registry-list">
        {(Object.entries(interfaces) as [string, any][]).map(([namespace, meta]) => (
          <div className="interface-registry-row" key={namespace}>
            <code>{namespace}</code>
            <input
              disabled={!canAdmin}
              value={meta.label || ''}
              onChange={e => updateInterface(namespace, { label: e.target.value })}
              placeholder="Label"
            />
            <input
              disabled={!canAdmin}
              value={meta.version || ''}
              onChange={e => updateInterface(namespace, { version: e.target.value })}
              placeholder="Version"
            />
            <input
              disabled={!canAdmin}
              value={meta.owner || ''}
              onChange={e => updateInterface(namespace, { owner: e.target.value })}
              placeholder="Owner"
            />
            <input
              disabled={!canAdmin}
              value={meta.route || ''}
              onChange={e => updateInterface(namespace, { route: e.target.value })}
              placeholder="Route"
            />
          </div>
        ))}
      </div>
      <div className="admin-toolbar">
        <input
          disabled={!canAdmin}
          value={draft.namespace}
          onChange={e => setDraft({ ...draft, namespace: e.target.value })}
          placeholder="Namespace"
        />
        <input
          disabled={!canAdmin}
          value={draft.label}
          onChange={e => setDraft({ ...draft, label: e.target.value })}
          placeholder="Label"
        />
        <input
          disabled={!canAdmin}
          value={draft.version}
          onChange={e => setDraft({ ...draft, version: e.target.value })}
          placeholder="Version"
        />
        <input
          disabled={!canAdmin}
          value={draft.owner}
          onChange={e => setDraft({ ...draft, owner: e.target.value })}
          placeholder="Owner"
        />
        <input
          disabled={!canAdmin}
          value={draft.route}
          onChange={e => setDraft({ ...draft, route: e.target.value })}
          placeholder="Route"
        />
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={add}>
          Add namespace
        </button>
      </div>
      <div className="developer-i18n-snippet">
        <div>
          <strong>Developer integration</strong>
          <span>Use the global engine in any frontend interface.</span>
        </div>
        <pre data-no-i18n>{sample}</pre>
      </div>
      <div className="settings-fields compact-fields">
        <AdvancedJsonConfigEditor
          disabled
          label="Missing key log (collected while people use the app; kept in server memory)"
          value={missing}
          onChange={() => {}}
        />
        <AdvancedJsonConfigEditor
          path="localization.translationMemory"
          disabled={!canAdmin}
          label="Translation memory"
          value={localization.translationMemory || []}
          onChange={v => patch('localization.translationMemory', Array.isArray(v) ? v : [])}
        />
        <AdvancedJsonConfigEditor
          path="localization.keyPolicy"
          disabled={!canAdmin}
          label="Key policy"
          value={localization.keyPolicy || {}}
          onChange={v => patch('localization.keyPolicy', v)}
        />
        <AdvancedJsonConfigEditor
          path="localization.runtime"
          disabled={!canAdmin}
          label="Runtime controls"
          value={localization.runtime || {}}
          onChange={v => patch('localization.runtime', v)}
        />
      </div>
    </div>
  )
}

function TranslationManager({ form, patch, canAdmin }) {
  const [language, setLanguage] = useState(form.localization?.defaultLanguage || 'en')
  const [query, setQuery] = useState('')
  const [newKey, setNewKey] = useState('')
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState('')
  const [missingServer, setMissingServer] = useState(null)
  const active = form.localization?.activeLanguages || ['en']
  const fallback = form.localization?.fallbackLanguage || 'en'
  const translations = form.localization?.translations || {}
  const approval = form.localization?.approvalWorkflow?.statusByKey || {}
  const keys = [...new Set(Object.values(translations).flatMap(catalog => Object.keys(catalog || {})))].sort()
  const visible = keys.filter(
    key =>
      key.toLowerCase().includes(query.toLowerCase()) ||
      String(translations?.[language]?.[key] || '')
        .toLowerCase()
        .includes(query.toLowerCase())
  )
  const setTranslation = (key, value) =>
    patch('localization.translations', {
      ...translations,
      [language]: { ...(translations[language] || {}), [key]: value }
    })
  const addKey = () => {
    if (!newKey.trim()) return
    setTranslation(newKey.trim(), translations?.[language]?.[newKey.trim()] || '')
    patch(`localization.approvalWorkflow.statusByKey.${newKey.trim()}`, 'draft')
    setNewKey('')
  }
  const exportLanguage = () =>
    downloadBlob(
      new Blob([JSON.stringify(translations[language] || {}, null, 2)], { type: 'application/json' }),
      `atlas-${language}-translations.json`
    )
  const importLanguage = () => {
    try {
      const parsed = JSON.parse(importText)
      patch('localization.translations', {
        ...translations,
        [language]: { ...(translations[language] || {}), ...parsed }
      })
      setImportText('')
      setImportError('')
    } catch {
      setImportError('Invalid translation JSON.')
    }
  }
  const scanMissing = async () => {
    try {
      setMissingServer(await api.get('/api/settings/translations/missing'))
    } catch {
      setMissingServer({ error: 'Unable to scan saved settings. Save first, then scan again.' })
    }
  }
  const missing = keys.filter(key => !translations?.[language]?.[key]).length
  return (
    <div className="translation-manager">
      <div className="admin-toolbar">
        <label>
          Language
          <select disabled={!canAdmin} value={language} onChange={e => setLanguage(e.target.value)}>
            {active.map(code => (
              <option key={code}>{code}</option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="settings.projects.create_button" />
        </label>
        <button type="button" className="secondary-button" onClick={exportLanguage}>
          Export JSON
        </button>
        <button type="button" className="secondary-button" onClick={scanMissing}>
          Scan saved missing keys
        </button>
      </div>
      <div className="settings-note">
        <Icon name="warning" size={15} />
        <span>
          {missing} missing keys for {language}; fallback language is {fallback}. Approval workflow is{' '}
          {form.localization?.approvalWorkflow?.enabled ? 'enabled' : 'disabled'}.
        </span>
      </div>
      {missingServer && (
        <div className="settings-note">
          <Icon name={missingServer.error ? 'warning' : 'check'} size={15} />
          <span>
            {missingServer.error ||
              `${missingServer.totalMissing || 0} missing saved translations across ${Object.keys(missingServer.byLanguage || {}).length} language(s).`}
          </span>
        </div>
      )}
      <div className="translation-import">
        <textarea
          disabled={!canAdmin}
          value={importText}
          onChange={e => setImportText(e.target.value)}
          rows={3}
          placeholder="Paste translation JSON for selected language"
        />
        <button
          type="button"
          className="secondary-button"
          disabled={!canAdmin || !importText.trim()}
          onClick={importLanguage}
        >
          Import language JSON
        </button>
      </div>
      {importError && (
        <div className="form-error">
          <Icon name="warning" size={15} />
          {importError}
        </div>
      )}
      <div className="translation-add">
        <input
          disabled={!canAdmin}
          value={newKey}
          onChange={e => setNewKey(e.target.value)}
          placeholder="translation.key"
        />
        <button type="button" className="secondary-button" onClick={addKey} disabled={!canAdmin}>
          Add key
        </button>
      </div>
      <div className="translation-list advanced-translation-list">
        {visible.slice(0, 160).map(key => (
          <div className="translation-row" key={key}>
            <code>{key}</code>
            <small>{translations?.[fallback]?.[key] || 'No fallback'}</small>
            <input
              disabled={!canAdmin}
              dir={textDirection({
                localization: {
                  defaultLanguage: language,
                  textDirectionByLanguage: form.localization?.textDirectionByLanguage
                }
              })}
              value={translations?.[language]?.[key] || ''}
              onChange={e => setTranslation(key, e.target.value)}
              placeholder="Missing translation"
            />
            <select
              disabled={!canAdmin}
              value={approval[key] || 'approved'}
              onChange={e => patch(`localization.approvalWorkflow.statusByKey.${key}`, e.target.value)}
            >
              <option>approved</option>
              <option>draft</option>
              <option>review</option>
              <option>rejected</option>
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

function SettingsImportExport({ form, canAdmin, updateSettings, setForm }) {
  const [json, setJson] = useState('')
  const [error, setError] = useState('')
  const exportSettings = () =>
    downloadBlob(new Blob([JSON.stringify(form, null, 2)], { type: 'application/json' }), 'atlas-settings-export.json')
  const importSettings = async () => {
    try {
      const parsed = JSON.parse(json)
      const settings = parsed.settings || parsed
      setForm(settings)
      if (canAdmin) await updateSettings(settings)
      setError('')
    } catch {
      setError('Invalid settings JSON.')
    }
  }
  return (
    <div className="settings-fields">
      <div className="admin-toolbar">
        <button type="button" className="secondary-button" onClick={exportSettings}>
          Export settings JSON
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={!canAdmin || !json.trim()}
          onClick={importSettings}
        >
          Import settings JSON
        </button>
      </div>
      <label>
        Import JSON
        <textarea
          disabled={!canAdmin}
          value={json}
          onChange={e => setJson(e.target.value)}
          rows={5}
          placeholder='{"workspace":{"name":"..."}}'
        />
      </label>
      {error && (
        <div className="form-error">
          <Icon name="warning" size={15} />
          {error}
        </div>
      )}
    </div>
  )
}
function AdvancedSettingSelect({ label, value, onChange, disabled: disabledProp, options, hint = '', path = '' }) {
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
function AdvancedToggleSetting({ label, checked, onChange, disabled: disabledProp, description = '', path = '' }) {
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
function AdvancedTextListSetting({
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
function AdvancedJsonConfigEditor({
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
function advancedMissingTranslations(form) {
  const translations = form.localization?.translations || {}
  const keys = [...new Set(Object.values(translations).flatMap(catalog => Object.keys(catalog || {})))]
  return (form.localization?.activeLanguages || []).reduce(
    (sum, language) => sum + keys.filter(key => !translations?.[language]?.[key]).length,
    0
  )
}
function AdvancedConfigHealth({ form, system, runtime, saved, canAdmin, onSave }) {
  const enabledModuleCount = enabledPages(form).length
  const roles = Object.keys(form.permissions?.roles || {}).length
  const customFields = (Object.values(form.customFields || {}) as any[]).reduce(
    (sum: number, rows) => sum + (rows?.length || 0),
    0
  )
  const missing = advancedMissingTranslations(form)
  return (
    <div className="config-command-center">
      <div className="config-command-copy">
        <span className="eyebrow">
          <span className="eyebrow-dot" /> Configuration command center
        </span>
        <h2>{form.workspace?.name || form.workspaceName}</h2>
        <p>
          Review workspace setup, localization, permissions, operational workflows, exports, integrations, storage
          controls, and production safety from one place.
        </p>
      </div>
      <div className="config-command-actions">
        {canAdmin ? (
          <button type="button" className="primary-button" onClick={onSave}>
            {saved ? 'Saved' : 'Save all changes'} <Icon name="check" size={14} />
          </button>
        ) : (
          <span className="readonly-pill">Read-only</span>
        )}
        <span className={`config-status ${system?.ok === false ? 'warning' : 'ok'}`}>
          <Icon name={system?.ok === false ? 'warning' : 'check'} size={14} />
          {system?.integrity || 'Integrity ready'}
        </span>
      </div>
      <div className="config-stat-grid">
        <div>
          <strong>{enabledModuleCount}</strong>
          <span>visible modules</span>
        </div>
        <div>
          <strong>{roles}</strong>
          <span>roles</span>
        </div>
        <div>
          <strong>{customFields}</strong>
          <span>custom fields</span>
        </div>
        <div>
          <strong>{missing}</strong>
          <span>missing translations</span>
        </div>
        <div>
          <strong>{runtime?.database?.schemaVersion || system?.store?.schemaVersion || '3.0.0'}</strong>
          <span>schema</span>
        </div>
        <div>
          <strong>{system?.store?.backupCount ?? '—'}</strong>
          <span>backups</span>
        </div>
      </div>
    </div>
  )
}
function AdvancedNavigationAdmin({ form, patch, canAdmin }) {
  const labels = {
    overview: 'Overview',
    projects: 'Projects',
    tasks: 'Tasks',
    people: 'People',
    activity: 'Activity',
    reports: 'Reports',
    alerts: 'Alerts'
  }
  const pages = defaultSettings.enabledPages
  const visibility = form.interface?.navigationVisibility || {}
  const order = [...new Set([...(form.interface?.navigationOrder || pages), ...pages])].filter(page =>
    pages.includes(page)
  )
  const [drag, setDrag] = useState('')
  const apply = (nextOrder = order, nextVisibility = visibility, nextModules = form.modules || {}) => {
    patch('interface.navigationOrder', nextOrder)
    patch('interface.navigationVisibility', nextVisibility)
    patch('modules', nextModules)
    patch(
      'enabledPages',
      nextOrder.filter(page => nextVisibility[page] !== false && nextModules?.[page]?.enabled !== false)
    )
  }
  const move = (key, direction) => {
    const index = order.indexOf(key)
    const target = index + direction
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    apply(next)
  }
  const drop = key => {
    if (!drag || drag === key) return
    const next = order.filter(page => page !== drag)
    next.splice(next.indexOf(key), 0, drag)
    apply(next)
    setDrag('')
  }
  const toggle = (key, checked) =>
    apply(
      order,
      { ...visibility, [key]: checked },
      { ...(form.modules || {}), [key]: { ...((form.modules || {})[key] || {}), enabled: checked } }
    )
  return (
    <div className="navigation-admin">
      <div className="settings-note">
        <Icon name="menu" size={15} />
        <span>
          Drag sections, use arrows, or toggle visibility. Saved order is used by the sidebar and default landing
          choices.
        </span>
      </div>
      <div className="nav-builder-list">
        {order.map((key, index) => (
          <div
            className="nav-builder-row"
            key={key}
            draggable={canAdmin}
            onDragStart={() => setDrag(key)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => drop(key)}
          >
            <span className="drag-handle">⋮⋮</span>
            <Icon name={key} size={16} />
            <strong>{labels[key]}</strong>
            <small>{(form.modules || {})[key]?.labelKey || `nav.${key}`}</small>
            <label className="switch-inline">
              <input
                disabled={!canAdmin || key === 'overview'}
                type="checkbox"
                checked={visibility[key] !== false && (form.modules || {})[key]?.enabled !== false}
                onChange={e => toggle(key, e.target.checked)}
              />{' '}
              Visible
            </label>
            <button
              type="button"
              className="icon-button subtle"
              disabled={!canAdmin || index === 0}
              onClick={() => move(key, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-button subtle"
              disabled={!canAdmin || index === order.length - 1}
              onClick={() => move(key, 1)}
            >
              ↓
            </button>
          </div>
        ))}
      </div>
      <div className="settings-fields compact-fields">
        <AdvancedSettingSelect
          path="interface.defaultLandingPage"
          disabled={!canAdmin}
          label="Default landing page"
          value={form.interface?.defaultLandingPage || 'overview'}
          onChange={v => {
            patch('interface.defaultLandingPage', v)
            patch('defaultPage', v)
          }}
          options={enabledPages(form).map(page => [page, labels[page] || page])}
        />
      </div>
    </div>
  )
}
function AdvancedDashboardAdmin({ form, patch, canAdmin }) {
  const widgets = {
    stats: 'Workspace metrics',
    dailyPulse: 'Daily pulse',
    projectHealth: 'Project health',
    myFocus: 'My focus'
  }
  const active = form.interface?.dashboardLayouts?.overview || Object.keys(widgets)
  const all = [...new Set([...active, ...Object.keys(widgets)])]
  const [drag, setDrag] = useState('')
  const commit = next => patch('interface.dashboardLayouts.overview', next)
  const move = (key, direction) => {
    const index = active.indexOf(key)
    const target = index + direction
    if (target < 0 || target >= active.length) return
    const next = [...active]
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }
  const toggle = (key, checked) =>
    commit(
      checked
        ? [...active, key].filter((item, index, rows) => rows.indexOf(item) === index)
        : active.filter(item => item !== key)
    )
  const drop = key => {
    if (!drag || drag === key || !active.includes(drag) || !active.includes(key)) return
    const next = active.filter(item => item !== drag)
    next.splice(next.indexOf(key), 0, drag)
    commit(next)
    setDrag('')
  }
  return (
    <div className="dashboard-layout-admin">
      {all.map(key => (
        <div
          className="config-row config-row-draggable"
          key={key}
          draggable={canAdmin && active.includes(key)}
          onDragStart={() => setDrag(key)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => drop(key)}
        >
          <span className="drag-handle">⋮⋮</span>
          <label className="switch-inline">
            <input
              disabled={!canAdmin}
              type="checkbox"
              checked={active.includes(key)}
              onChange={e => toggle(key, e.target.checked)}
            />{' '}
            {widgets[key]}
          </label>
          <span>{active.includes(key) ? `Position ${active.indexOf(key) + 1}` : 'Hidden'}</span>
          <button
            type="button"
            className="icon-button subtle"
            disabled={!canAdmin || !active.includes(key) || active.indexOf(key) === 0}
            onClick={() => move(key, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-button subtle"
            disabled={!canAdmin || !active.includes(key) || active.indexOf(key) === active.length - 1}
            onClick={() => move(key, 1)}
          >
            ↓
          </button>
        </div>
      ))}
    </div>
  )
}
function AdvancedSurfaceAdmin({ form, patch, canAdmin }) {
  const [entity, setEntity] = useState('tasks')
  const tableColumns = form.interface?.tableColumns || {}
  const formLayouts = form.interface?.formLayouts || {}
  const actions = form.interface?.actionVisibility || {}
  return (
    <div className="settings-fields">
      <div className="admin-toolbar">
        <label>
          Surface
          <select value={entity} onChange={e => setEntity(e.target.value)}>
            {['projects', 'tasks', 'people', 'activity', 'alerts', 'users'].map(item => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="settings-fields compact-fields">
        <AdvancedTextListSetting
          disabled={!canAdmin}
          path="interface.tableColumns"
          label="Visible table columns"
          value={tableColumns[entity] || []}
          onChange={rows => patch(`interface.tableColumns.${entity}`, rows)}
          hint="One field key per line."
        />
        <AdvancedTextListSetting
          disabled={!canAdmin}
          path="interface.formLayouts"
          label="Form field order"
          value={formLayouts[entity] || []}
          onChange={rows => patch(`interface.formLayouts.${entity}`, rows)}
          hint="One form key per line; custom fields are appended."
        />
      </div>
      <div className="permission-grid">
        {['create', 'edit', 'delete', 'export', 'print'].map(action => (
          <AdvancedToggleSetting
            key={action}
            disabled={!canAdmin}
            path={`interface.actionVisibility.${action}`}
            label={`${action} action`}
            checked={actions[action] !== false}
            onChange={value => patch(`interface.actionVisibility.${action}`, value)}
            description="Controls whether this action should be offered in configurable UI surfaces."
          />
        ))}
      </div>
    </div>
  )
}
function AdvancedLanguagePackagesAdmin({ form, patch, canAdmin }) {
  const packages = form.localization?.languagePackages || []
  const [draft, setDraft] = useState({ code: '', name: '', direction: 'ltr' })
  const commit = rows => {
    patch('localization.languagePackages', rows)
    patch(
      'localization.activeLanguages',
      rows.filter(row => row.enabled !== false).map(row => row.code)
    )
  }
  const updatePackage = (index, patchRow) =>
    commit(packages.map((row, i) => (i === index ? { ...row, ...patchRow } : row)))
  const add = () => {
    const code = draft.code.trim().toLowerCase()
    if (!code || packages.some(row => row.code === code)) return
    commit([
      ...packages,
      { code, name: draft.name || code, direction: draft.direction, enabled: true, version: '1.0.0', status: 'draft' }
    ])
    patch(`localization.textDirectionByLanguage.${code}`, draft.direction)
    patch('localization.translations', { ...(form.localization?.translations || {}), [code]: {} })
    setDraft({ code: '', name: '', direction: 'ltr' })
  }
  return (
    <div className="language-package-admin">
      <div className="language-package-list">
        {packages.map((language, index) => (
          <div className="language-package-row" key={language.code}>
            <label className="switch-inline">
              <input
                disabled={!canAdmin || language.code === 'en'}
                type="checkbox"
                checked={language.enabled !== false}
                onChange={e => updatePackage(index, { enabled: e.target.checked })}
              />
              {language.code}
            </label>
            <input
              disabled={!canAdmin}
              value={language.name || ''}
              onChange={e => updatePackage(index, { name: e.target.value })}
            />
            <select
              disabled={!canAdmin}
              value={language.direction || 'ltr'}
              onChange={e => {
                updatePackage(index, { direction: e.target.value })
                patch(`localization.textDirectionByLanguage.${language.code}`, e.target.value)
              }}
            >
              <option value="ltr">LTR</option>
              <option value="rtl">RTL</option>
            </select>
            <input
              disabled={!canAdmin}
              value={language.version || '1.0.0'}
              onChange={e => updatePackage(index, { version: e.target.value })}
              aria-label={`${language.code} version`}
            />
            <select
              disabled={!canAdmin}
              value={language.status || 'approved'}
              onChange={e => updatePackage(index, { status: e.target.value })}
            >
              <option>approved</option>
              <option>draft</option>
              <option>review</option>
            </select>
          </div>
        ))}
      </div>
      <div className="admin-toolbar">
        <input
          disabled={!canAdmin}
          value={draft.code}
          onChange={e => setDraft({ ...draft, code: e.target.value })}
          placeholder="locale code"
        />
        <input
          disabled={!canAdmin}
          value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })}
          placeholder="Language name"
        />
        <select
          disabled={!canAdmin}
          value={draft.direction}
          onChange={e => setDraft({ ...draft, direction: e.target.value })}
        >
          <option value="ltr">LTR</option>
          <option value="rtl">RTL</option>
        </select>
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={add}>
          Add package
        </button>
      </div>
    </div>
  )
}
function AdvancedModulesAdmin({ form, patch, canAdmin }) {
  const modules = form.modules || {}
  const [draft, setDraft] = useState({ key: '', labelKey: '', icon: 'spark' })
  const updateModule = (key, patchRow) => {
    const nextModules = { ...modules, [key]: { ...(modules[key] || {}), ...patchRow } }
    patch('modules', nextModules)
    if ('enabled' in patchRow) {
      patch(`interface.navigationVisibility.${key}`, patchRow.enabled)
      const order = form.interface?.navigationOrder || defaultSettings.enabledPages
      patch(
        'enabledPages',
        order.filter(
          page =>
            (page === key ? patchRow.enabled : nextModules?.[page]?.enabled !== false) &&
            form.interface?.navigationVisibility?.[page] !== false
        )
      )
    }
  }
  const add = () => {
    const key = slug(draft.key).replaceAll('-', '_')
    if (!key || modules[key]) return
    patch('modules', {
      ...modules,
      [key]: {
        enabled: true,
        labelKey: draft.labelKey || `nav.${key}`,
        icon: draft.icon || 'spark',
        permissions: ['viewReports'],
        extension: true
      }
    })
    setDraft({ key: '', labelKey: '', icon: 'spark' })
  }
  return (
    <div className="module-admin">
      <div className="module-admin-grid advanced-module-grid">
        {Object.keys(modules).map(key => (
          <div className="module-config-card" key={key}>
            <div className="module-config-head">
              <label className="switch-inline">
                <input
                  disabled={!canAdmin || key === 'overview'}
                  type="checkbox"
                  checked={modules?.[key]?.enabled !== false}
                  onChange={e => updateModule(key, { enabled: e.target.checked })}
                />
                <strong>{key}</strong>
              </label>
              <Icon name={icons[modules[key]?.icon] ? modules[key].icon : 'spark'} size={16} />
            </div>
            <div className="settings-fields compact-fields">
              <SettingInput
                disabled={!canAdmin}
                path="modules.metadata"
                label="Label key"
                value={modules[key]?.labelKey || ''}
                onChange={v => updateModule(key, { labelKey: v })}
              />
              <SettingInput
                disabled={!canAdmin}
                path="modules.metadata"
                label="Icon"
                value={modules[key]?.icon || ''}
                onChange={v => updateModule(key, { icon: v })}
              />
              <SettingInput
                disabled={!canAdmin}
                path="modules.metadata"
                label="Route"
                value={modules[key]?.route || key}
                onChange={v => updateModule(key, { route: v })}
              />
              <SettingInput
                disabled={!canAdmin}
                path="modules.metadata"
                label="Permissions"
                value={(modules[key]?.permissions || []).join(', ')}
                onChange={v =>
                  updateModule(key, {
                    permissions: v
                      .split(',')
                      .map(x => x.trim())
                      .filter(Boolean)
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>
      <div className="admin-toolbar">
        <input
          disabled={!canAdmin}
          value={draft.key}
          onChange={e => setDraft({ ...draft, key: e.target.value })}
          placeholder="module_key"
        />
        <input
          disabled={!canAdmin}
          value={draft.labelKey}
          onChange={e => setDraft({ ...draft, labelKey: e.target.value })}
          placeholder="nav.module_key"
        />
        <input
          disabled={!canAdmin}
          value={draft.icon}
          onChange={e => setDraft({ ...draft, icon: e.target.value })}
          placeholder="icon"
        />
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={add}>
          Register module metadata
        </button>
      </div>
    </div>
  )
}
function AdvancedWorkflowAdmin({ form, patch, canAdmin }) {
  const workflow = form.workflows?.task || {}
  const states = workflow.states || []
  const transitions = workflow.transitions || []
  const [newState, setNewState] = useState('')
  const setWorkflow = next => patch('workflows.task', next)
  const updateStates = nextStates =>
    setWorkflow({
      ...workflow,
      states: nextStates,
      transitions: transitions.filter(
        t => nextStates.some(s => s.label === t.from) && nextStates.some(s => s.label === t.to)
      )
    })
  const updateState = (index, row) => {
    // The state's id never changes when it is renamed: tasks are matched to their state by id, so a rename carries them along.
    const previous = states[index]
    const nextStates = states.map((state, i) => (i === index ? { ...state, ...row } : state))
    const renamed = row.label !== undefined && row.label !== previous.label
    const nextTransitions = (
      renamed
        ? transitions.map(t => ({
            ...t,
            from: t.from === previous.label ? row.label : t.from,
            to: t.to === previous.label ? row.label : t.to
          }))
        : transitions
    ).filter(t => nextStates.some(s => s.label === t.from) && nextStates.some(s => s.label === t.to))
    setWorkflow({ ...workflow, states: nextStates, transitions: nextTransitions })
  }
  const moveState = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= states.length) return
    const next = [...states]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateStates(next)
  }
  const addState = () => {
    if (!newState.trim()) return
    updateStates([...states, { id: slug(newState), label: newState.trim(), color: 'blue', terminal: false }])
    setNewState('')
  }
  const addTransition = () =>
    states.length > 1 &&
    setWorkflow({
      ...workflow,
      transitions: [
        ...transitions,
        { from: states[0].label, to: states[1].label, permission: 'writeTasks', approvalRequired: false }
      ]
    })
  const updateTransition = (index, row) =>
    setWorkflow({
      ...workflow,
      transitions: transitions.map((transition, i) => (i === index ? { ...transition, ...row } : transition))
    })
  return (
    <div className="workflow-admin advanced-workflow-admin">
      <div className="settings-fields compact-fields">
        <SettingInput
          path="workflows.task.name"
          disabled={!canAdmin}
          label="Workflow name"
          value={workflow.name || ''}
          onChange={v => patch('workflows.task.name', v)}
        />
        <AdvancedToggleSetting
          path="workflows.task.enforceTransitions"
          disabled={!canAdmin}
          label="Enforce transitions"
          checked={Boolean(workflow.enforceTransitions)}
          onChange={v => patch('workflows.task.enforceTransitions', v)}
          description="When on, a task can only move along the transitions listed below (and only by people with the listed permission). When off, any status can be chosen."
        />
        <AdvancedTextListSetting
          path="workflows.task.approvalSteps"
          disabled={!canAdmin}
          label="Approval steps"
          value={workflow.approvalSteps || []}
          onChange={rows => patch('workflows.task.approvalSteps', rows)}
        />
        <AdvancedTextListSetting
          path="workflows.task.automatedActions"
          disabled={!canAdmin}
          label="Automated actions"
          value={workflow.automatedActions || []}
          onChange={rows => patch('workflows.task.automatedActions', rows)}
        />
      </div>
      <div className="workflow-state-table">
        {states.map((state, index) => (
          <div className="workflow-state-row" key={state.id || index}>
            <span className="drag-handle">{index + 1}</span>
            <input
              disabled={!canAdmin}
              value={state.label || ''}
              onChange={e => updateState(index, { label: e.target.value })}
            />
            <select
              disabled={!canAdmin}
              value={state.color || 'blue'}
              onChange={e => updateState(index, { color: e.target.value })}
            >
              {['blue', 'purple', 'orange', 'green', 'pink', 'teal'].map(color => (
                <option key={color}>{color}</option>
              ))}
            </select>
            <label className="switch-inline">
              <input
                disabled={!canAdmin}
                type="checkbox"
                checked={Boolean(state.terminal)}
                onChange={e => updateState(index, { terminal: e.target.checked })}
              />{' '}
              Terminal
            </label>
            <button
              type="button"
              className="icon-button subtle"
              disabled={!canAdmin || index === 0}
              onClick={() => moveState(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-button subtle"
              disabled={!canAdmin || index === states.length - 1}
              onClick={() => moveState(index, 1)}
            >
              ↓
            </button>
            <button
              aria-label="Delete"
              type="button"
              className="icon-button subtle danger-icon"
              disabled={!canAdmin || states.length <= 2}
              onClick={() => updateStates(states.filter((_, i) => i !== index))}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="admin-toolbar">
        <input
          disabled={!canAdmin}
          value={newState}
          onChange={e => setNewState(e.target.value)}
          placeholder="New workflow state"
        />
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={addState}>
          Add state
        </button>
      </div>
      <div className="workflow-preview">
        {states.map((state, index) => (
          <span key={state.id || state.label}>
            {state.label}
            {index < states.length - 1 && <Icon name="arrow" size={12} />}
          </span>
        ))}
      </div>
      <div className="section-subhead">
        <h3>Transitions and approvals</h3>
        <button
          type="button"
          className="secondary-button"
          disabled={!canAdmin || states.length < 2}
          onClick={addTransition}
        >
          Add transition
        </button>
      </div>
      <div className="transition-list">
        {transitions.map((transition, index) => (
          <div className="transition-row" key={`${transition.from}-${transition.to}-${index}`}>
            <select
              disabled={!canAdmin}
              value={transition.from || ''}
              onChange={e => updateTransition(index, { from: e.target.value })}
            >
              {states.map(state => (
                <option key={state.id || state.label}>{state.label}</option>
              ))}
            </select>
            <Icon name="arrow" size={13} />
            <select
              disabled={!canAdmin}
              value={transition.to || ''}
              onChange={e => updateTransition(index, { to: e.target.value })}
            >
              {states.map(state => (
                <option key={state.id || state.label}>{state.label}</option>
              ))}
            </select>
            <input
              disabled={!canAdmin}
              value={transition.permission || ''}
              onChange={e => updateTransition(index, { permission: e.target.value })}
              placeholder="permission"
            />
            <label className="switch-inline">
              <input
                disabled={!canAdmin}
                type="checkbox"
                checked={Boolean(transition.approvalRequired)}
                onChange={e => updateTransition(index, { approvalRequired: e.target.checked })}
              />{' '}
              Approval
            </label>
            <button
              aria-label="Delete"
              type="button"
              className="icon-button subtle danger-icon"
              disabled={!canAdmin}
              onClick={() => setWorkflow({ ...workflow, transitions: transitions.filter((_, i) => i !== index) })}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
function AdvancedCustomFieldsAdmin({ form, patch, canAdmin }) {
  const [entity, setEntity] = useState('tasks')
  const [draft, setDraft] = useState({ key: '', label: '', type: 'text' })
  const fields = form.customFields?.[entity] || []
  const updateFields = rows =>
    patch(
      `customFields.${entity}`,
      rows.map((row, index) => ({ ...row, order: index + 1 }))
    )
  const add = () => {
    const key = slug(draft.key).replaceAll('-', '_')
    if (!key || fields.some(field => field.key === key)) return
    updateFields([
      ...fields,
      {
        ...draft,
        key,
        label: draft.label || draft.key,
        visible: true,
        required: false,
        validation: '',
        permissions: [],
        order: fields.length + 1
      }
    ])
    setDraft({ key: '', label: '', type: 'text' })
  }
  const updateField = (index, row) =>
    updateFields(fields.map((field, i) => (i === index ? { ...field, ...row } : field)))
  const moveField = (index, direction) => {
    const target = index + direction
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    ;[next[index], next[target]] = [next[target], next[index]]
    updateFields(next)
  }
  return (
    <div className="custom-fields-admin advanced-custom-fields">
      <div className="admin-toolbar">
        <label>
          Entity
          <select value={entity} onChange={e => setEntity(e.target.value)}>
            {Object.keys(form.customFields || {}).map(key => (
              <option key={key}>{key}</option>
            ))}
          </select>
        </label>
        <input
          disabled={!canAdmin}
          value={draft.key}
          onChange={e => setDraft({ ...draft, key: e.target.value })}
          placeholder="field_key"
        />
        <input
          disabled={!canAdmin}
          value={draft.label}
          onChange={e => setDraft({ ...draft, label: e.target.value })}
          placeholder="Field label"
        />
        <select disabled={!canAdmin} value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>
          {[
            'text',
            'number',
            'date',
            'datetime',
            'checkbox',
            'dropdown',
            'multi-select',
            'user',
            'attachment',
            'url',
            'calculated'
          ].map(type => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={add}>
          Add field
        </button>
      </div>
      <div className="custom-field-table">
        <div className="custom-field-head">
          <span>Key</span>
          <span>Label</span>
          <span>Type</span>
          <span>Rules</span>
          <span>Permissions</span>
          <span />
        </div>
        {fields.map((field, index) => (
          <div className="custom-field-row" key={field.key}>
            <code>{field.key}</code>
            <input
              disabled={!canAdmin}
              value={field.label || ''}
              onChange={e => updateField(index, { label: e.target.value })}
            />
            <select
              disabled={!canAdmin}
              value={field.type || 'text'}
              onChange={e => updateField(index, { type: e.target.value })}
            >
              {[
                'text',
                'number',
                'date',
                'datetime',
                'checkbox',
                'dropdown',
                'multi-select',
                'user',
                'attachment',
                'url',
                'calculated'
              ].map(type => (
                <option key={type}>{type}</option>
              ))}
            </select>
            <div className="field-rules">
              <label>
                <input
                  disabled={!canAdmin}
                  type="checkbox"
                  checked={field.visible !== false}
                  onChange={e => updateField(index, { visible: e.target.checked })}
                />{' '}
                visible
              </label>
              <label>
                <input
                  disabled={!canAdmin}
                  type="checkbox"
                  checked={field.required === true}
                  onChange={e => updateField(index, { required: e.target.checked })}
                />{' '}
                required
              </label>
              <input
                disabled={!canAdmin}
                value={field.validation || ''}
                onChange={e => updateField(index, { validation: e.target.value })}
                placeholder="validation rule"
              />
            </div>
            <input
              disabled={!canAdmin}
              value={(field.permissions || []).join(', ')}
              onChange={e =>
                updateField(index, {
                  permissions: e.target.value
                    .split(',')
                    .map(x => x.trim())
                    .filter(Boolean)
                })
              }
              placeholder="permissions"
            />
            <div>
              <button
                type="button"
                className="icon-button subtle"
                disabled={!canAdmin || index === 0}
                onClick={() => moveField(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button subtle"
                disabled={!canAdmin || index === fields.length - 1}
                onClick={() => moveField(index, 1)}
              >
                ↓
              </button>
              <button
                aria-label="Delete"
                type="button"
                className="icon-button subtle danger-icon"
                disabled={!canAdmin}
                onClick={() => updateFields(fields.filter((_, i) => i !== index))}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
function AdvancedPermissionsAdmin({ form, patch, canAdmin }) {
  const [role, setRole] = useState('Administrator')
  const [newRole, setNewRole] = useState('')
  const permissions = [
    'manageSettings',
    'manageUsers',
    'manageProjects',
    'managePeople',
    'manageAlerts',
    'manageTasks',
    'writeTasks',
    'logActivity',
    'viewReports',
    'exportData',
    'removeDemoData'
  ]
  const roles = form.permissions?.roles || {}
  const current = roles[role] || Object.values(roles)[0] || { permissions: [] }
  const updateRole = row => patch('permissions.roles', { ...roles, [role]: { ...current, ...row } })
  const togglePermission = permission => {
    const set = new Set(current.permissions || [])
    set.has(permission) ? set.delete(permission) : set.add(permission)
    updateRole({ permissions: [...set] })
  }
  const addRole = () => {
    if (!newRole.trim()) return
    const name = newRole.trim()
    patch('permissions.roles', {
      ...roles,
      [name]: {
        name,
        summary: 'Custom role',
        description: 'Custom role',
        permissions: ['viewReports'],
        rank: Object.keys(roles).length + 1
      }
    })
    setRole(name)
    setNewRole('')
  }
  const deleteRole = () => {
    if (role === 'Administrator') return
    const next = { ...roles }
    delete next[role]
    patch('permissions.roles', next)
    setRole(Object.keys(next)[0] || 'Administrator')
  }
  return (
    <div className="permissions-admin advanced-permissions">
      <div className="admin-toolbar">
        <label>
          Role
          <select disabled={!canAdmin} value={role} onChange={e => setRole(e.target.value)}>
            {Object.keys(roles).map(name => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <input
          disabled={!canAdmin}
          value={newRole}
          onChange={e => setNewRole(e.target.value)}
          placeholder="Add custom role"
        />
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={addRole}>
          Add role
        </button>
        <button
          type="button"
          className="secondary-button danger-button"
          disabled={!canAdmin || role === 'Administrator'}
          onClick={deleteRole}
        >
          Delete role
        </button>
      </div>
      <div className="settings-fields compact-fields">
        <SettingInput
          disabled={!canAdmin || role === 'Administrator'}
          label="Role display name"
          value={current.name || role}
          onChange={v => updateRole({ name: v })}
        />
        <SettingInput
          disabled={!canAdmin}
          type="number"
          label="Rank"
          value={current.rank || 1}
          onChange={v => updateRole({ rank: v })}
        />
        <SettingInput
          disabled={!canAdmin}
          label="Summary"
          value={current.summary || current.description || ''}
          onChange={v => updateRole({ summary: v, description: v })}
        />
      </div>
      <div className="permission-grid">
        {permissions.map(permission => (
          <label key={permission} className="interface-toggle">
            <input
              type="checkbox"
              disabled={
                !canAdmin || (role === 'Administrator' && ['manageSettings', 'manageUsers'].includes(permission))
              }
              checked={(current.permissions || []).includes(permission)}
              onChange={() => togglePermission(permission)}
            />
            <span>
              <strong>{permission}</strong>
              <small>{permission.includes('manage') ? 'Administrative capability' : 'Operational capability'}</small>
            </span>
          </label>
        ))}
      </div>
      <AdvancedJsonConfigEditor
        path="permissions.moduleAccess"
        disabled={!canAdmin}
        label="Role policy maps"
        value={{
          moduleAccess: form.permissions?.moduleAccess || {},
          fieldAccess: form.permissions?.fieldAccess || {},
          actionAccess: form.permissions?.actionAccess || {},
          exportPermissions: form.permissions?.exportPermissions || {},
          reportingPermissions: form.permissions?.reportingPermissions || {}
        }}
        onChange={v => {
          patch('permissions.moduleAccess', v.moduleAccess || {})
          patch('permissions.fieldAccess', v.fieldAccess || {})
          patch('permissions.actionAccess', v.actionAccess || {})
          patch('permissions.exportPermissions', v.exportPermissions || {})
          patch('permissions.reportingPermissions', v.reportingPermissions || {})
        }}
        rows={7}
      />
    </div>
  )
}
function AdvancedNotificationsAdmin({ form, patch, canAdmin }) {
  const channels = form.notifications?.channels || {}
  const events = form.notifications?.events || {}
  const eventKeys = [...new Set(['taskAssigned', 'alertCreated', 'reportReady', ...Object.keys(events)])]
  return (
    <div className="settings-fields">
      <PermissionNotice>
        Atlas does not send notifications yet. These values are stored for a future release and have no effect today.
      </PermissionNotice>
      <div className="permission-grid">
        <AdvancedToggleSetting
          path="notifications.enabled"
          disabled={!canAdmin}
          label="Notifications enabled"
          checked={form.notifications?.enabled !== false}
          onChange={v => patch('notifications.enabled', v)}
          description="Master switch for in-app, email metadata, and webhook delivery."
        />
        {Object.keys(channels).map(channel => (
          <AdvancedToggleSetting
            key={channel}
            disabled={!canAdmin}
            path={`notifications.channels.${channel}`}
            label={`${channel} channel`}
            checked={Boolean(channels[channel])}
            onChange={v => patch(`notifications.channels.${channel}`, v)}
            description="Channel registration metadata."
          />
        ))}
      </div>
      <div className="permission-grid">
        {eventKeys.map(event => (
          <AdvancedToggleSetting
            key={event}
            disabled={!canAdmin}
            path={`notifications.events.${event}`}
            label={event}
            checked={events[event] !== false}
            onChange={v => patch(`notifications.events.${event}`, v)}
            description="Notify when this event is emitted."
          />
        ))}
      </div>
      <SettingInput
        path="notifications.webhookEndpoint"
        disabled={!canAdmin}
        label="Webhook endpoint metadata"
        value={form.notifications?.webhookEndpoint || ''}
        onChange={v => patch('notifications.webhookEndpoint', v)}
        placeholder="https://internal.example/webhook"
      />
    </div>
  )
}
function AdvancedReportExportAdmin({ form, patch, canAdmin }) {
  const formats = ['csv', 'xlsx', 'json', 'pdf', 'print']
  const selected = form.exports?.formats || formats
  const toggleFormat = format =>
    patch(
      'exports.formats',
      selected.includes(format) ? selected.filter(item => item !== format) : [...selected, format]
    )
  return (
    <div className="settings-fields">
      <div className="settings-fields compact-fields">
        <AdvancedSettingSelect
          path="reports.activityVisibility"
          disabled={!canAdmin}
          label="Who can see per-person activity"
          value={form.reports?.activityVisibility || 'managers'}
          onChange={v => patch('reports.activityVisibility', v)}
          options={[
            ['managers', 'Managers and administrators (everyone else sees only their own)'],
            ['everyone', 'Everyone can see everyone']
          ]}
          hint="Decide this together with your privacy and works-council obligations before using activity reports to evaluate people."
        />
        <AdvancedSettingSelect
          path="reports.defaultTemplate"
          disabled={!canAdmin}
          label="Default report template"
          value={form.reports?.defaultTemplate || 'executive'}
          onChange={v => {
            patch('reports.defaultTemplate', v)
            patch('printTemplate', v)
          }}
          options={form.reports?.templates || ['standard', 'compact', 'executive']}
        />
        <AdvancedTextListSetting
          path="reports.templates"
          disabled={!canAdmin}
          label="Available templates"
          value={form.reports?.templates || []}
          onChange={rows => patch('reports.templates', rows)}
          hint="One template id per line."
        />
        <AdvancedSettingSelect
          path="exports.pdf.orientation"
          disabled={!canAdmin}
          label="PDF orientation"
          value={form.exports?.pdf?.orientation || 'landscape'}
          onChange={v => patch('exports.pdf.orientation', v)}
          options={['landscape', 'portrait']}
        />
        <AdvancedSettingSelect
          path="exports.pdf.margins"
          disabled={!canAdmin}
          label="PDF margins"
          value={form.exports?.pdf?.margins || 'standard'}
          onChange={v => patch('exports.pdf.margins', v)}
          options={['narrow', 'standard', 'wide']}
        />
        <SettingInput
          path="reports.branding.footerText"
          disabled={!canAdmin}
          label="Report footer"
          value={form.reports?.branding?.footerText || ''}
          onChange={v => patch('reports.branding.footerText', v)}
        />
      </div>
      <div className="permission-grid">
        {formats.map(format => (
          <AdvancedToggleSetting
            key={format}
            disabled={!canAdmin}
            path={`exports.formats.${format}`}
            label={`${format.toUpperCase()} export`}
            checked={selected.includes(format)}
            onChange={() => toggleFormat(format)}
            description="Allow this export target in report/export panels."
          />
        ))}
        <AdvancedToggleSetting
          path="reports.localizedOutput"
          disabled={!canAdmin}
          label="Localized output"
          checked={form.reports?.localizedOutput !== false}
          onChange={v => patch('reports.localizedOutput', v)}
          description="Use selected workspace language and locale formats."
        />
        <AdvancedToggleSetting
          path="exports.respectDirection"
          disabled={!canAdmin}
          label="Respect text direction"
          checked={form.exports?.respectDirection !== false}
          onChange={v => patch('exports.respectDirection', v)}
          description="Apply RTL/LTR direction to printable and PDF exports."
        />
        <AdvancedToggleSetting
          path="exports.includeBranding"
          disabled={!canAdmin}
          label="Include branding"
          checked={form.exports?.includeBranding !== false}
          onChange={v => patch('exports.includeBranding', v)}
          description="Include workspace/report brand elements when supported."
        />
      </div>
      <AdvancedJsonConfigEditor
        path="reports.customColumns"
        disabled={!canAdmin}
        label="Report templates, columns, filters, and calculations"
        value={{
          customColumns: form.reports?.customColumns || {},
          customFilters: form.reports?.customFilters || {},
          customCalculations: form.reports?.customCalculations || {}
        }}
        onChange={v => {
          patch('reports.customColumns', v.customColumns || {})
          patch('reports.customFilters', v.customFilters || {})
          patch('reports.customCalculations', v.customCalculations || {})
        }}
        rows={7}
      />
    </div>
  )
}
function AdvancedIntegrationsAdmin({ form, patch, canAdmin }) {
  const registry = form.integrations?.registry || []
  const [draft, setDraft] = useState({ name: '', type: 'webhook', endpoint: '' })
  const updateRegistry = rows => patch('integrations.registry', rows)
  const add = () => {
    if (!draft.name.trim()) return
    updateRegistry([
      ...registry,
      {
        id: slug(draft.name),
        name: draft.name.trim(),
        type: draft.type,
        endpoint: draft.endpoint,
        enabled: true,
        permissions: ['manageSettings']
      }
    ])
    setDraft({ name: '', type: 'webhook', endpoint: '' })
  }
  return (
    <div className="integrations-admin">
      <PermissionNotice>
        Integrations are not connected yet: the registry below is a list for documentation only, and Atlas never calls
        the endpoints entered here.
      </PermissionNotice>
      <div className="permission-grid">
        <AdvancedToggleSetting
          path="integrations.apiAccess"
          disabled={!canAdmin}
          label="API access metadata"
          checked={Boolean(form.integrations?.apiAccess)}
          onChange={v => patch('integrations.apiAccess', v)}
          description="Tracks whether local API integrations are enabled by policy."
        />
        <AdvancedToggleSetting
          path="notifications.channels.webhook"
          disabled={!canAdmin}
          label="Webhook channel"
          checked={Boolean(form.notifications?.channels?.webhook)}
          onChange={v => patch('notifications.channels.webhook', v)}
          description="Allow registered integrations to receive event notifications."
        />
      </div>
      <div className="integration-list">
        {registry.map((integration, index) => (
          <div className="integration-row" key={integration.id || index}>
            <label className="switch-inline">
              <input
                disabled={!canAdmin}
                type="checkbox"
                checked={integration.enabled !== false}
                onChange={e =>
                  updateRegistry(registry.map((row, i) => (i === index ? { ...row, enabled: e.target.checked } : row)))
                }
              />
              {integration.name}
            </label>
            <span>{integration.type}</span>
            <code>{integration.endpoint || integration.route || 'local'}</code>
            <button
              aria-label="Delete"
              type="button"
              className="icon-button subtle danger-icon"
              disabled={!canAdmin}
              onClick={() => updateRegistry(registry.filter((_, i) => i !== index))}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="admin-toolbar">
        <input
          disabled={!canAdmin}
          value={draft.name}
          onChange={e => setDraft({ ...draft, name: e.target.value })}
          placeholder="Integration name"
        />
        <select disabled={!canAdmin} value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value })}>
          <option>webhook</option>
          <option>storage</option>
          <option>identity</option>
          <option>reporting</option>
          <option>module</option>
        </select>
        <input
          disabled={!canAdmin}
          value={draft.endpoint}
          onChange={e => setDraft({ ...draft, endpoint: e.target.value })}
          placeholder="Endpoint or local route"
        />
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={add}>
          Register integration
        </button>
      </div>
      <AdvancedJsonConfigEditor
        path="integrations.webhooks"
        disabled={!canAdmin}
        label="Webhook registry"
        value={form.integrations?.webhooks || []}
        onChange={v => patch('integrations.webhooks', Array.isArray(v) ? v : [])}
        description="Array of webhook descriptors with event filters and secrets metadata."
      />
    </div>
  )
}
function AuditTrail({ canAdmin }) {
  const [state, setState] = useState({ rows: [], total: 0, chain: null, error: '' })
  const [open, setOpen] = useState(false)
  const load = useCallback(async () => {
    try {
      const result = await api.get('/api/audit?limit=50')
      setState({ rows: result.rows, total: result.total, chain: result.chain, error: '' })
    } catch (error) {
      setState(current => ({ ...current, error: errorMessage(error) }))
    }
  }, [])
  useEffect(() => {
    if (open && canAdmin) load()
  }, [open, canAdmin, load])
  if (!canAdmin) return null
  return (
    <div className="audit-trail">
      <button type="button" className="secondary-button" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide audit trail' : 'Show audit trail'}
      </button>
      {open && (
        <>
          {state.error && <div className="form-error">{state.error}</div>}
          {state.chain && (
            <div className="settings-note">
              <Icon name={state.chain.ok ? 'check' : 'warning'} size={15} />
              <span>
                {state.chain.ok
                  ? `Tamper check passed: ${state.chain.checked} chained entries verified (${state.total} kept in total).`
                  : `Tamper check FAILED at entry ${state.chain.brokenAt}: the trail was edited or damaged.`}
              </span>
            </div>
          )}
          <div className="audit-table" role="table" aria-label="Recent audit entries">
            {state.rows.map(row => (
              <div className="audit-row" role="row" key={row.id}>
                <span role="cell">{new Date(row.createdAt).toLocaleString()}</span>
                <strong role="cell" translate="no">
                  {row.action}
                </strong>
                <span role="cell" translate="no">
                  {row.actor}
                </span>
                <small role="cell" translate="no">
                  {row.ip}
                </small>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
function AdvancedSystemPanel({
  form,
  patch,
  canAdmin,
  runtime,
  system,
  displayMode,
  backup,
  createBackup,
  onRemoveDemo,
  user
}) {
  return (
    <div className="settings-fields">
      <div className="settings-note">
        <Icon name={system?.ok ? 'check' : 'warning'} size={15} />
        <span>
          Integrity {system?.integrity || '…'} · schema{' '}
          {system?.store?.schemaVersion || runtime?.database?.schemaVersion || '…'} · mode{' '}
          {displayMode || runtime?.packagingMode || 'web'} · backups {system?.store?.backupCount ?? '…'}
        </span>
      </div>
      {system?.counts && (
        <div className="system-counts compact-counts">
          {Object.entries(system.counts).map(([key, value]) => (
            <div key={key}>
              <strong>{String(value)}</strong>
              <span>{key}</span>
            </div>
          ))}
        </div>
      )}
      <div className="settings-fields compact-fields">
        <SettingInput
          disabled
          type="number"
          label="Backups kept (set by ATLAS_BACKUP_RETENTION)"
          value={runtime?.database?.backupRetention ?? ''}
          onChange={() => {}}
        />
        <SettingInput
          disabled
          label="Storage model (fixed)"
          value={runtime?.database?.storeModel || 'embedded-json-document-store'}
          onChange={() => {}}
        />
        <AdvancedToggleSetting
          path="storage.importExportEnabled"
          disabled={!canAdmin}
          label="Configuration import/export"
          checked={form.storage?.importExportEnabled !== false}
          onChange={v => patch('storage.importExportEnabled', v)}
          description="Allow administrators to move complete configuration packages."
        />
      </div>
      <div className="admin-toolbar">
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={createBackup}>
          Create backup
        </button>
        {hasPermission(user, 'removeDemoData') && (
          <button type="button" className="secondary-button danger-button" onClick={onRemoveDemo}>
            Remove demo data
          </button>
        )}
      </div>
      {backup && (
        <div className="settings-note">
          <Icon name="check" size={15} />
          <span>{backup}</span>
        </div>
      )}
      {system?.storage && (
        <div className="settings-note">
          <Icon name={system.storage.writable ? 'check' : 'warning'} size={15} />
          <span>
            Storage is {system.storage.writable ? 'writable' : 'NOT writable'}
            {system.storage.lastSavedAt ? ` · last saved ${new Date(system.storage.lastSavedAt).toLocaleString()}` : ''}
            {system.storage.error ? ` · ${system.storage.error}` : ''}
          </span>
        </div>
      )}
      {system?.store?.backups?.length > 0 && (
        <div className="backup-list">
          <strong>Recent backups</strong>
          <ul>
            {system.store.backups.map(item => (
              <li key={item.file}>
                <code>{item.file}</code> · {item.reason} · {Math.round(item.size / 1024)} KB
              </li>
            ))}
          </ul>
          <small>
            To restore, stop Atlas and run <code>npm run restore:data -- latest</code> (or a file name above). Restoring
            while the server runs is deliberately not possible.
          </small>
        </div>
      )}
      <AuditTrail canAdmin={canAdmin} />
      <AdvancedJsonConfigEditor
        disabled
        label="Runtime metadata snapshot"
        value={runtime || {}}
        onChange={() => {}}
        description="Read-only reference; runtime metadata is not imported from settings."
      />
    </div>
  )
}
function AdvancedSecurityAuditPanel({ form, patch, canAdmin }) {
  return (
    <div className="settings-fields">
      <div className="settings-fields compact-fields">
        <SettingInput
          path="security.passwordMinLength"
          disabled={!canAdmin}
          type="number"
          label="Password minimum length"
          value={form.security?.passwordMinLength || 8}
          onChange={v => patch('security.passwordMinLength', v)}
        />
        <SettingInput
          path="security.sessionDays"
          disabled={!canAdmin}
          type="number"
          label="Session duration (days)"
          value={form.security?.sessionDays || 14}
          onChange={v => patch('security.sessionDays', v)}
        />
        <SettingInput
          path="audit.retentionDays"
          disabled={!canAdmin}
          type="number"
          label="Audit retention (days)"
          value={form.audit?.retentionDays || 365}
          onChange={v => patch('audit.retentionDays', v)}
        />
      </div>
      <div className="permission-grid">
        <AdvancedToggleSetting
          path="security.requireApprovalForRoleChanges"
          disabled={!canAdmin}
          label="Require approval for role changes"
          checked={Boolean(form.security?.requireApprovalForRoleChanges)}
          onChange={v => patch('security.requireApprovalForRoleChanges', v)}
          description="Policy metadata for future role-change approval workflows."
        />
        <AdvancedToggleSetting
          path="audit.enabled"
          disabled={!canAdmin}
          label="Audit logging"
          checked={form.audit?.enabled !== false}
          onChange={v => patch('audit.enabled', v)}
          description="Record configuration and operational changes."
        />
        <AdvancedToggleSetting
          path="audit.trackWrites"
          disabled={!canAdmin}
          label="Track write operations"
          checked={form.audit?.trackWrites !== false}
          onChange={v => patch('audit.trackWrites', v)}
          description="Audit creates, updates, deletes, and status moves."
        />
        <AdvancedToggleSetting
          path="audit.trackExports"
          disabled={!canAdmin}
          label="Track exports"
          checked={form.audit?.trackExports !== false}
          onChange={v => patch('audit.trackExports', v)}
          description="Audit export/download activity where supported."
        />
        <AdvancedToggleSetting
          path="audit.trackReads"
          disabled={!canAdmin}
          label="Track reads"
          checked={Boolean(form.audit?.trackReads)}
          onChange={v => patch('audit.trackReads', v)}
          description="Optional high-volume read audit setting."
        />
      </div>
    </div>
  )
}

function SettingsSection({ active, id, children }) {
  return active === id ? <div className="settings-section-body">{children}</div> : null
}
function SettingsPage({
  data,
  user,
  updateSettings,
  onRemoveDemo,
  runtime,
  system,
  refreshSystem,
  displayMode,
  openModal,
  onDelete,
  onPreviewLanguage,
  account
}) {
  const { notify } = useApp()
  // `data.settings` is already normalised by the shell; the form is a working copy of it.
  const [form, setForm] = useState(() => data.settings)
  const [section, setSection] = useState('account')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [backup, setBackup] = useState('')
  const canAdmin = hasPermission(user, 'manageSettings')
  const unsaved = useMemo(() => Object.keys(diffPatch(data.settings, form)).length > 0, [data.settings, form])
  useEffect(() => setForm(data.settings), [data.settings])
  useEffect(() => {
    if (!unsaved) return
    const warn = event => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])
  useEffect(() => {
    onPreviewLanguage?.(form.localization?.defaultLanguage || form.language || 'en')
  }, [form.localization?.defaultLanguage, form.language, onPreviewLanguage])
  useEffect(() => () => onPreviewLanguage?.(''), [onPreviewLanguage])
  const patch = (path, value) => setForm(current => updateByPath(current, path, value))
  const save = async () => {
    if (!canAdmin) return
    setSaveError('')
    try {
      await updateSettings(form)
      setSaved(true)
      setTimeout(() => setSaved(false), 1400)
    } catch (error) {
      setSaveError(errorMessage(error))
      notify({ title: 'Settings were not saved', body: errorMessage(error), tone: 'warning' })
    }
  }
  const createBackup = async () => {
    try {
      const result = await api.post('/api/system/backup', {})
      setBackup(result.backup || 'Backup created')
      refreshSystem?.()
    } catch (error) {
      notify({ title: 'Backup failed', body: errorMessage(error), tone: 'warning' })
    }
  }
  const nav = [
    ['account', 'My account', 'Profile, password, preferences'],
    ['overview', 'Overview', 'Health and coverage'],
    ['workspace', 'Workspace', 'Identity, brand, region'],
    ['interface', 'Interface', 'Navigation, widgets, UX'],
    ['localization', 'Localization', 'Languages, RTL, translations'],
    ['operations', 'Operations', 'Modules, workflows, fields'],
    ['access', 'Access', 'Users, roles, policies'],
    ['reports', 'Reports & exports', 'Templates and outputs'],
    ['integrations', 'Integrations', 'Registry and webhooks'],
    ['system', 'System', 'Storage, audit, maintenance']
  ]
  return (
    <div className="page-content settings-page refined-settings advanced-settings-page">
      <div className="settings-hero compact-hero">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-dot" /> Settings
          </span>
          <h2>Workspace administration</h2>
          <p>Configure the full Atlas platform without a rebuild.</p>
        </div>
        {canAdmin ? (
          <div className="save-cluster">
            {unsaved && !saved && <span className="unsaved-note">Unsaved changes</span>}
            <button type="button" className="primary-button" onClick={save}>
              {saved ? 'Saved' : 'Save changes'} <Icon name="check" size={14} />
            </button>
          </div>
        ) : (
          <span className="readonly-pill">Read-only</span>
        )}
      </div>
      {!canAdmin && <PermissionNotice>Only Administrators can change settings.</PermissionNotice>}
      {saveError && (
        <div className="global-error" role="alert">
          <Icon name="warning" size={15} />
          {saveError}
        </div>
      )}
      <div className="settings-layout advanced-settings-layout">
        <aside className="settings-nav-rail advanced-settings-nav">
          {nav.map(([id, label, hint]) => (
            <button type="button" key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>
              <strong>{label}</strong>
              <span>{hint}</span>
            </button>
          ))}
        </aside>
        <main className="settings-detail">
          <SettingsSection active={section} id="account">
            <AccountPanel
              user={user}
              settings={form}
              prefs={account.prefs}
              setPrefs={account.setPrefs}
              onLogout={account.onLogout}
              notify={notify}
            />
          </SettingsSection>
          <SettingsSection active={section} id="overview">
            <AdvancedConfigHealth
              form={form}
              system={system}
              runtime={runtime}
              saved={saved}
              canAdmin={canAdmin}
              onSave={save}
            />
            <SettingsPanel
              title="Configuration coverage"
              description="Settings marked “Not applied yet” are stored for future use: nothing in Atlas reads them, so they are shown disabled."
            >
              <div className="coverage-grid">
                {nav.slice(2).map(([id, label, hint]) => (
                  <button type="button" key={id} onClick={() => setSection(id)}>
                    <strong>{label}</strong>
                    <span>{hint}</span>
                    <Icon name="arrow" size={13} />
                  </button>
                ))}
              </div>
            </SettingsPanel>
            <SettingsPanel
              title="Advanced settings map"
              description="Use this editor for controlled, versioned configuration package changes."
              wide
            >
              <AdvancedJsonConfigEditor
                disabled={!canAdmin}
                label="Current normalized settings"
                value={form}
                onChange={setForm}
                rows={10}
              />
            </SettingsPanel>
          </SettingsSection>
          <SettingsSection active={section} id="workspace">
            <SettingsPanel title="General" description="Workspace, organization, and owner metadata.">
              <div className="settings-fields compact-fields">
                <SettingInput
                  path="workspace.name"
                  disabled={!canAdmin}
                  label="Workspace name"
                  value={form.workspace?.name}
                  onChange={v => {
                    patch('workspace.name', v)
                    patch('workspaceName', v)
                  }}
                />
                <SettingInput
                  path="workspace.unit"
                  disabled={!canAdmin}
                  label="Unit"
                  value={form.workspace?.unit}
                  onChange={v => {
                    patch('workspace.unit', v)
                    patch('workspaceUnit', v)
                  }}
                />
                <SettingInput
                  path="workspace.applicationName"
                  disabled={!canAdmin}
                  label="Application name"
                  value={form.workspace?.applicationName}
                  onChange={v => patch('workspace.applicationName', v)}
                />
                <SettingInput
                  path="workspace.organization.legalName"
                  disabled={!canAdmin}
                  label="Legal organization"
                  value={form.workspace?.organization?.legalName}
                  onChange={v => patch('workspace.organization.legalName', v)}
                />
                <SettingInput
                  path="workspace.organization.website"
                  disabled={!canAdmin}
                  label="Website"
                  value={form.workspace?.organization?.website}
                  onChange={v => patch('workspace.organization.website', v)}
                />
                <SettingInput
                  path="workspace.organization.contactEmail"
                  disabled={!canAdmin}
                  label="Contact email"
                  value={form.workspace?.organization?.contactEmail}
                  onChange={v => patch('workspace.organization.contactEmail', v)}
                />
                <SettingInput
                  path="workspace.organization.address"
                  disabled={!canAdmin}
                  textarea
                  label="Address"
                  value={form.workspace?.organization?.address}
                  onChange={v => patch('workspace.organization.address', v)}
                />
              </div>
            </SettingsPanel>
            <SettingsPanel title="Branding" description="Local paths, palette, login, and report brand settings.">
              <div className="settings-fields compact-fields">
                <SettingInput
                  path="workspace.logo"
                  disabled={!canAdmin}
                  label="Logo path"
                  value={form.workspace?.logo}
                  onChange={v => patch('workspace.logo', v)}
                />
                <SettingInput
                  path="workspace.branding.reportLogo"
                  disabled={!canAdmin}
                  label="Report logo"
                  value={form.workspace?.branding?.reportLogo}
                  onChange={v => patch('workspace.branding.reportLogo', v)}
                />
                <SettingInput
                  path="workspace.branding.loginHeadline"
                  disabled={!canAdmin}
                  label="Login headline"
                  value={form.workspace?.branding?.loginHeadline}
                  onChange={v => patch('workspace.branding.loginHeadline', v)}
                />
                <SettingInput
                  path="interface.colors.primary"
                  disabled={!canAdmin}
                  label="Primary color"
                  value={form.interface?.colors?.primary || form.workspace?.branding?.primaryColor || '#6d5dfc'}
                  onChange={v => {
                    patch('interface.colors.primary', v)
                    patch('workspace.branding.primaryColor', v)
                  }}
                />
                <AdvancedSettingSelect
                  path="interface.colors.accent"
                  disabled={!canAdmin}
                  label="Accent"
                  value={form.interface?.colors?.accent || 'purple'}
                  onChange={v => {
                    patch('interface.colors.accent', v)
                    patch('accentColor', v)
                    patch('workspace.branding.accentColor', v)
                  }}
                  options={['purple', 'blue', 'green', 'orange']}
                />
              </div>
              <div className="brand-preview">
                <Logo />
                <div>
                  <strong>{form.workspace?.applicationName || form.workspaceName}</strong>
                  <span>{form.workspace?.branding?.loginHeadline || 'Operate with clarity.'}</span>
                </div>
              </div>
            </SettingsPanel>
            <SettingsPanel
              title="Regional preferences"
              description="Locale defaults used by reports, exports, print views, and work schedules."
            >
              <div className="settings-fields compact-fields">
                <AdvancedSettingSelect
                  path="workspace.defaultTimezone"
                  disabled={!canAdmin}
                  label="Timezone"
                  value={form.workspace?.defaultTimezone}
                  onChange={v => patch('workspace.defaultTimezone', v)}
                  options={timeZoneOptions(form.workspace?.defaultTimezone)}
                  hint="Decides which calendar day it is for due dates, reports and the activity log."
                />
                <AdvancedSettingSelect
                  path="workspace.weekStartsOn"
                  disabled={!canAdmin}
                  label="Week starts on"
                  value={form.workspace?.weekStartsOn || 'monday'}
                  onChange={v => patch('workspace.weekStartsOn', v)}
                  options={[
                    ['monday', 'Monday'],
                    ['sunday', 'Sunday'],
                    ['saturday', 'Saturday']
                  ]}
                  hint="Weekly reports group days into weeks starting on this day."
                />
                <SettingInput
                  path="workspace.regionalFormats.date"
                  disabled={!canAdmin}
                  label="Date format"
                  value={form.workspace?.regionalFormats?.date}
                  onChange={v => {
                    patch('workspace.regionalFormats.date', v)
                    patch('dateFormat', v)
                  }}
                />
                <SettingInput
                  path="workspace.regionalFormats.number"
                  disabled={!canAdmin}
                  label="Number system"
                  value={form.workspace?.regionalFormats?.number}
                  onChange={v => patch('workspace.regionalFormats.number', v)}
                />
                <SettingInput
                  path="workspace.regionalFormats.currency"
                  disabled={!canAdmin}
                  label="Currency"
                  value={form.workspace?.regionalFormats?.currency}
                  onChange={v => patch('workspace.regionalFormats.currency', v)}
                />
                <AdvancedTextListSetting
                  path="workspace.workingDays"
                  disabled={!canAdmin}
                  label="Working days"
                  value={form.workspace?.workingDays || []}
                  onChange={v => patch('workspace.workingDays', v)}
                  separator="comma"
                />
                <div className="form-row">
                  <SettingInput
                    path="workspace.workingHours.start"
                    disabled={!canAdmin}
                    label="Start"
                    type="time"
                    value={form.workspace?.workingHours?.start}
                    onChange={v => patch('workspace.workingHours.start', v)}
                  />
                  <SettingInput
                    path="workspace.workingHours.end"
                    disabled={!canAdmin}
                    label="End"
                    type="time"
                    value={form.workspace?.workingHours?.end}
                    onChange={v => patch('workspace.workingHours.end', v)}
                  />
                </div>
                <AdvancedTextListSetting
                  path="workspace.holidays"
                  disabled={!canAdmin}
                  label="Holidays"
                  value={form.workspace?.holidays || []}
                  onChange={v => patch('workspace.holidays', v)}
                  separator="comma"
                />
              </div>
            </SettingsPanel>
          </SettingsSection>
          <SettingsSection active={section} id="interface">
            <SettingsPanel
              title="Theme and layout"
              description="Visual system, density, spacing, typography, and default routes."
            >
              <div className="settings-fields compact-fields">
                <AdvancedSettingSelect
                  path="interface.theme"
                  disabled={!canAdmin}
                  label="Theme"
                  value={form.interface?.theme || 'light'}
                  onChange={v => {
                    patch('interface.theme', v)
                    patch('theme', v)
                  }}
                  options={['light', 'dark', 'system']}
                />
                <AdvancedSettingSelect
                  path="interface.density"
                  disabled={!canAdmin}
                  label="Density"
                  value={form.interface?.density || 'comfortable'}
                  onChange={v => {
                    patch('interface.density', v)
                    patch('density', v)
                  }}
                  options={['comfortable', 'compact']}
                />
                <AdvancedSettingSelect
                  path="interface.spacing"
                  disabled={!canAdmin}
                  label="Spacing"
                  value={form.interface?.spacing || 'comfortable'}
                  onChange={v => patch('interface.spacing', v)}
                  options={['compact', 'comfortable', 'spacious']}
                />
                <SettingInput
                  path="interface.typography.scale"
                  disabled={!canAdmin}
                  type="number"
                  label="Text scale"
                  value={form.interface?.typography?.scale || 100}
                  onChange={v => {
                    patch('interface.typography.scale', v)
                    patch('interface.accessibility.scalableText', v)
                  }}
                />
                <SettingInput
                  path="interface.typography.family"
                  disabled={!canAdmin}
                  label="Font family"
                  value={form.interface?.typography?.family || 'Atlas Sans'}
                  onChange={v => patch('interface.typography.family', v)}
                  hint="Use local bundled or installed fonts only."
                />
                <AdvancedSettingSelect
                  path="interface.sidebarBehavior"
                  disabled={!canAdmin}
                  label="Sidebar"
                  value={form.interface?.sidebarBehavior || 'expanded'}
                  onChange={v => {
                    patch('interface.sidebarBehavior', v)
                    patch('sidebarMode', v)
                  }}
                  options={['expanded', 'collapsed']}
                />
                <AdvancedSettingSelect
                  path="interface.tableBehavior.pageSize"
                  disabled={!canAdmin}
                  label="Page size"
                  value={String(form.interface?.tableBehavior?.pageSize || 50)}
                  onChange={v => {
                    patch('interface.tableBehavior.pageSize', Number(v))
                    patch('pageSize', Number(v))
                  }}
                  options={[
                    ['25', '25 rows'],
                    ['50', '50 rows'],
                    ['100', '100 rows']
                  ]}
                />
                <AdvancedSettingSelect
                  path="interface.cardLayouts.tasks"
                  disabled={!canAdmin}
                  label="Task default view"
                  value={form.interface?.cardLayouts?.tasks || 'board'}
                  onChange={v => {
                    patch('interface.cardLayouts.tasks', v)
                    patch('defaultTaskView', v)
                  }}
                  options={['board', 'list']}
                />
              </div>
            </SettingsPanel>
            <SettingsPanel title="Navigation builder" description="Visible sections and sidebar order." wide>
              <AdvancedNavigationAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel
              title="Dashboard widgets"
              description="Configure Overview widgets with drag-and-drop ordering."
            >
              <AdvancedDashboardAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel
              title="Tables, forms, and actions"
              description="Configure visible columns, form order, and major UI actions."
              wide
            >
              <AdvancedSurfaceAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel title="Accessibility">
              <div className="permission-grid">
                <AdvancedToggleSetting
                  path="interface.animations"
                  disabled={!canAdmin}
                  label="Motion"
                  checked={form.interface?.animations !== false}
                  onChange={v => {
                    patch('interface.animations', v)
                    patch('showAnimations', v)
                  }}
                  description="Enable lightweight transitions and animations."
                />
                <AdvancedToggleSetting
                  path="interface.accessibility.reducedMotion"
                  disabled={!canAdmin}
                  label="Reduced motion"
                  checked={Boolean(form.interface?.accessibility?.reducedMotion)}
                  onChange={v => patch('interface.accessibility.reducedMotion', v)}
                  description="Prefer minimal movement for accessibility."
                />
                <AdvancedToggleSetting
                  path="interface.accessibility.highContrast"
                  disabled={!canAdmin}
                  label="High contrast"
                  checked={Boolean(form.interface?.accessibility?.highContrast)}
                  onChange={v => patch('interface.accessibility.highContrast', v)}
                  description="Increase contrast for low-vision users."
                />
                <AdvancedToggleSetting
                  path="interface.accessibility.screenReaderLabels"
                  disabled={!canAdmin}
                  label="Screen reader labels"
                  checked={form.interface?.accessibility?.screenReaderLabels !== false}
                  onChange={v => patch('interface.accessibility.screenReaderLabels', v)}
                  description="Retain verbose accessible labels."
                />
              </div>
            </SettingsPanel>
          </SettingsSection>
          <SettingsSection active={section} id="localization">
            <SettingsPanel
              title="Language defaults"
              description="Runtime language and direction can change without rebuilding."
            >
              <div className="settings-fields compact-fields">
                <AdvancedSettingSelect
                  path="localization.defaultLanguage"
                  disabled={!canAdmin}
                  label="Default language"
                  value={form.localization?.defaultLanguage || 'en'}
                  onChange={v => {
                    patch('localization.defaultLanguage', v)
                    patch('workspace.defaultLanguage', v)
                    patch('language', v)
                  }}
                  options={languageOptions(form).map(lang => [lang.code, `${lang.code} · ${lang.name}`])}
                />
                <AdvancedSettingSelect
                  path="localization.fallbackLanguage"
                  disabled={!canAdmin}
                  label="Fallback language"
                  value={form.localization?.fallbackLanguage || 'en'}
                  onChange={v => patch('localization.fallbackLanguage', v)}
                  options={languageOptions(form).map(lang => [lang.code, lang.code])}
                />
                <AdvancedTextListSetting
                  path="localization.activeLanguages"
                  disabled={!canAdmin}
                  label="Active languages"
                  value={form.localization?.activeLanguages || []}
                  onChange={v => patch('localization.activeLanguages', v)}
                  separator="comma"
                />
                <AdvancedToggleSetting
                  path="localization.userLanguagePreference"
                  disabled={!canAdmin}
                  label="User language preference"
                  checked={form.localization?.userLanguagePreference !== false}
                  onChange={v => patch('localization.userLanguagePreference', v)}
                  description="Allow future per-user language preferences."
                />
                <AdvancedToggleSetting
                  path="localization.approvalWorkflow.enabled"
                  disabled={!canAdmin}
                  label="Translation approval workflow"
                  checked={Boolean(form.localization?.approvalWorkflow?.enabled)}
                  onChange={v => patch('localization.approvalWorkflow.enabled', v)}
                  description="Track draft/review/approved status per key."
                />
              </div>
            </SettingsPanel>
            <SettingsPanel title="Language packages" wide>
              <AdvancedLanguagePackagesAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel
              title="Interface integration"
              description="Expose AtlasI18n to extensions, dynamic screens, and embedded widgets."
              wide
            >
              <AdvancedI18nIntegrationAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel title="Translations" wide>
              <TranslationManager form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel title="Formatting maps" wide>
              <div className="settings-fields compact-fields">
                <AdvancedJsonConfigEditor
                  path="localization.dateFormats"
                  disabled={!canAdmin}
                  label="Date formats"
                  value={form.localization?.dateFormats || {}}
                  onChange={v => patch('localization.dateFormats', v)}
                />
                <AdvancedJsonConfigEditor
                  path="localization.numberFormats"
                  disabled={!canAdmin}
                  label="Number formats"
                  value={form.localization?.numberFormats || {}}
                  onChange={v => patch('localization.numberFormats', v)}
                />
                <AdvancedJsonConfigEditor
                  path="localization.currencyFormats"
                  disabled={!canAdmin}
                  label="Currency formats"
                  value={form.localization?.currencyFormats || {}}
                  onChange={v => patch('localization.currencyFormats', v)}
                />
                <AdvancedJsonConfigEditor
                  path="localization.textDirectionByLanguage"
                  disabled={!canAdmin}
                  label="Text direction map"
                  value={form.localization?.textDirectionByLanguage || {}}
                  onChange={v => patch('localization.textDirectionByLanguage', v)}
                />
              </div>
            </SettingsPanel>
          </SettingsSection>
          <SettingsSection active={section} id="operations">
            <SettingsPanel
              title="Module registry"
              description="Enable modules and edit module metadata, labels, icons, routes, and permissions."
              wide
            >
              <AdvancedModulesAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel
              title="Task workflow"
              description="States, transitions, approvals, and automation metadata."
              wide
            >
              <AdvancedWorkflowAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel
              title="Custom fields"
              description="Entity field extensions with ordering, validation, visibility, and permissions."
              wide
            >
              <AdvancedCustomFieldsAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel title="Notifications" description="Channels, events, and webhook metadata.">
              <AdvancedNotificationsAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
          </SettingsSection>
          <SettingsSection active={section} id="access">
            <AccessControlPanel
              users={data.users || []}
              people={data.people || []}
              openModal={openModal}
              onDelete={onDelete}
              canAdmin={hasPermission(user, 'manageUsers')}
              settings={form}
            />
            <SettingsPanel
              title="Roles and permission policies"
              description="Role capability matrix plus module, field, action, export, and reporting policy maps."
              wide
            >
              <AdvancedPermissionsAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
          </SettingsSection>
          <SettingsSection active={section} id="reports">
            <SettingsPanel
              title="Reports and exports"
              description="Templates, formats, localization, branding, PDF defaults, and custom report metadata."
              wide
            >
              <AdvancedReportExportAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
          </SettingsSection>
          <SettingsSection active={section} id="integrations">
            <SettingsPanel
              title="Integration registry"
              description="Register integration metadata, webhook descriptors, API access policy, and extension points."
              wide
            >
              <AdvancedIntegrationsAdmin form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
          </SettingsSection>
          <SettingsSection active={section} id="system">
            <SettingsPanel
              title="Storage and maintenance"
              description="Integrity, backup retention, data counts, and maintenance actions."
              wide
            >
              <AdvancedSystemPanel
                form={form}
                patch={patch}
                canAdmin={canAdmin}
                runtime={runtime}
                system={system}
                displayMode={displayMode}
                backup={backup}
                createBackup={createBackup}
                onRemoveDemo={onRemoveDemo}
                user={user}
              />
            </SettingsPanel>
            <SettingsPanel
              title="Security and audit controls"
              description="Session, password, audit, and policy switches."
              wide
            >
              <AdvancedSecurityAuditPanel form={form} patch={patch} canAdmin={canAdmin} />
            </SettingsPanel>
            <SettingsPanel
              title="Configuration import/export"
              description="Validated JSON export and replace-import for versioned configuration packages."
              wide
            >
              <SettingsImportExport form={form} canAdmin={canAdmin} updateSettings={updateSettings} setForm={setForm} />
            </SettingsPanel>
          </SettingsSection>
        </main>
      </div>
    </div>
  )
}

function FormModal({ modal, data, user, onClose, onSave, onDelete }) {
  const type = modal?.type
  const record = modal?.record
  const { settings } = useApp()
  const [form, setForm] = useState<any>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const initialForm = useRef('')
  const dialogRef = useRef(null)
  const dirty = JSON.stringify(form) !== initialForm.current
  const requestClose = () => {
    if (dirty && !window.confirm(tr(settings, 'Discard your changes?'))) return
    onClose()
  }
  // Keyboard: Escape closes (asking first if there are unsaved edits), Tab stays inside the dialog.
  const onDialogKeyDown = event => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      requestClose()
    }
    if (event.key === 'Tab' && dialogRef.current) {
      const focusable = [
        ...dialogRef.current.querySelectorAll(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      ].filter(el => el.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }
  useEffect(() => {
    if (!type) return
    const opener = document.activeElement as HTMLElement | null
    return () => {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) (opener as HTMLElement).focus()
    }
  }, [type])
  useEffect(() => {
    if (!type) return
    const firstProject = data.projects[0]?.numericId || ''
    const firstPerson = data.people[0]?.id || user?.personId || ''
    const firstTeam = data.teams[0]?.id || ''
    const taskStatuses = workflowStateLabels(data.settings)
    const presets = {
      task: {
        title: record?.title || '',
        projectId: record?.projectId || firstProject,
        assigneeId: record?.assigneeId || user?.personId || firstPerson,
        priority: record?.priority || 'Medium',
        dueDate: record?.dueDate || data.today,
        status: record?.status || taskStatuses[0] || 'To do',
        type: record?.type || 'Development',
        blocked: Boolean(record?.blocked),
        customFields: record?.customFields || {}
      },
      project: {
        name: record?.name || '',
        code: record?.code || '',
        description: record?.description || '',
        teamId: record?.teamId || firstTeam,
        ownerId: record?.ownerId || user?.personId || firstPerson,
        color: record?.color || 'purple',
        status: record?.status || 'On track',
        deadline: record?.deadlineDate || data.today,
        customFields: record?.customFields || {}
      },
      person: {
        name: record?.name || '',
        email: record?.email || '',
        jobTitle: record?.jobTitle || record?.role || 'Contributor',
        teamId: record?.teamId || firstTeam,
        focus: record?.focus || 'Workspace priorities',
        capacity: record?.capacity ?? record?.load ?? 70,
        status: record?.status || 'On track',
        color: record?.color || 'purple',
        customFields: record?.customFields || {}
      },
      team: { name: record?.name || '', color: record?.color || 'purple', customFields: record?.customFields || {} },
      milestone: {
        name: record?.name || '',
        projectId: record?.projectId || record?.project?.numericId || firstProject,
        dueDate: record?.dueDate || data.today,
        status: record?.status || 'Upcoming',
        customFields: record?.customFields || {}
      },
      activity: {
        personId: record?.personId || user?.personId || firstPerson,
        yesterday: '',
        today: '',
        blocked: '',
        upcoming: '',
        status: 'Confirmed',
        customFields: record?.customFields || {}
      },
      alert: {
        title: record?.title || '',
        body: record?.body || '',
        type: record?.type || 'info',
        tone: record?.tone || 'blue',
        projectId: record?.projectId || '',
        taskId: record?.taskId || '',
        customFields: record?.customFields || {}
      },
      user: {
        name: record?.name || '',
        email: record?.email || '',
        password: '',
        role: record?.role || 'Viewer',
        personId: record?.personId || '',
        avatarColor: record?.avatarColor || 'purple',
        active: record?.active !== false,
        mustChangePassword: true
      }
    }
    initialForm.current = JSON.stringify(presets[type] || {})
    setForm(presets[type] || {})
    setError('')
  }, [type, record?.numericId, record?.id])
  if (!type) return null
  const isEdit = Boolean(record?.numericId || record?.id)
  const taskStatuses = workflowStateLabels(data.settings)
  const roles = roleDefinitions(data.settings)
  const fieldDefs = customFieldDefinitions(data.settings, type)
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const submit = async e => {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await onSave(type, record, form)
      initialForm.current = JSON.stringify(form)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const fields = () => {
    if (type === 'task')
      return (
        <>
          <label>
            Task title
            <input autoFocus value={form.title || ''} onChange={e => set('title', e.target.value)} required />
          </label>
          <div className="form-row">
            <label>
              Project
              <select value={form.projectId || ''} onChange={e => set('projectId', e.target.value)}>
                {data.projects.map(p => (
                  <option key={p.numericId} value={p.numericId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select value={form.assigneeId || ''} onChange={e => set('assigneeId', e.target.value)}>
                {data.people.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Priority
              <select value={form.priority || 'Medium'} onChange={e => set('priority', e.target.value)}>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </label>
            <label>
              Due date
              <input type="date" value={form.dueDate || ''} onChange={e => set('dueDate', e.target.value)} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Status
              <select value={form.status || 'To do'} onChange={e => set('status', e.target.value)}>
                {taskStatuses.map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select value={form.type || 'Development'} onChange={e => set('type', e.target.value)}>
                <option>Development</option>
                <option>Design</option>
                <option>Testing</option>
                <option>Documentation</option>
              </select>
            </label>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={Boolean(form.blocked)} onChange={e => set('blocked', e.target.checked)} />{' '}
            This task is blocked
          </label>
        </>
      )
    if (type === 'project')
      return (
        <>
          <div className="form-row">
            <label>
              Project name
              <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
            </label>
            <label>
              Code
              <input value={form.code || ''} onChange={e => set('code', e.target.value.toUpperCase())} required />
            </label>
          </div>
          <label>
            Objective
            <textarea value={form.description || ''} onChange={e => set('description', e.target.value)} rows={3} />
          </label>
          <div className="form-row">
            <label>
              Team
              <select value={form.teamId || ''} onChange={e => set('teamId', e.target.value)}>
                {data.teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select value={form.ownerId || ''} onChange={e => set('ownerId', e.target.value)}>
                {data.people.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Status
              <select value={form.status || 'On track'} onChange={e => set('status', e.target.value)}>
                <option>On track</option>
                <option>At risk</option>
                <option>Completed</option>
              </select>
            </label>
            <label>
              Deadline
              <input type="date" value={form.deadline || ''} onChange={e => set('deadline', e.target.value)} />
            </label>
          </div>
        </>
      )
    if (type === 'person')
      return (
        <>
          <div className="form-row">
            <label>
              Full name
              <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Job title
              <input value={form.jobTitle || ''} onChange={e => set('jobTitle', e.target.value)} />
            </label>
            <label>
              Team
              <select value={form.teamId || ''} onChange={e => set('teamId', e.target.value)}>
                {data.teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Current focus
            <input value={form.focus || ''} onChange={e => set('focus', e.target.value)} />
          </label>
          <div className="form-row">
            <label>
              Planned capacity (%)
              <input
                type="number"
                min="0"
                max="100"
                value={form.capacity ?? 70}
                onChange={e => set('capacity', e.target.value)}
              />
            </label>
            <label>
              Status
              <select value={form.status || 'On track'} onChange={e => set('status', e.target.value)}>
                <option>On track</option>
                <option>Needs attention</option>
              </select>
            </label>
          </div>
        </>
      )
    if (type === 'team')
      return (
        <>
          <label>
            Team name
            <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
          </label>
          <label>
            Color
            <select value={form.color || 'purple'} onChange={e => set('color', e.target.value)}>
              <option>purple</option>
              <option>blue</option>
              <option>orange</option>
              <option>green</option>
              <option>teal</option>
            </select>
          </label>
        </>
      )
    if (type === 'milestone')
      return (
        <>
          <label>
            Milestone name
            <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
          </label>
          <label>
            Project
            <select value={form.projectId || ''} onChange={e => set('projectId', e.target.value)}>
              {data.projects.map(p => (
                <option key={p.numericId} value={p.numericId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Due date
              <input type="date" value={form.dueDate || ''} onChange={e => set('dueDate', e.target.value)} />
            </label>
            <label>
              Status
              <select value={form.status || 'Upcoming'} onChange={e => set('status', e.target.value)}>
                <option>Upcoming</option>
                <option>At risk</option>
                <option>Complete</option>
              </select>
            </label>
          </div>
        </>
      )
    if (type === 'activity')
      return (
        <>
          <label>
            Person
            <select value={form.personId || ''} onChange={e => set('personId', e.target.value)}>
              {data.people.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Yesterday
            <textarea
              autoFocus
              value={form.yesterday || ''}
              onChange={e => set('yesterday', e.target.value)}
              rows={2}
            />
          </label>
          <label>
            Today
            <textarea value={form.today || ''} onChange={e => set('today', e.target.value)} rows={2} />
          </label>
          <label>
            Blocked
            <textarea value={form.blocked || ''} onChange={e => set('blocked', e.target.value)} rows={2} />
          </label>
          <label>
            Upcoming
            <textarea value={form.upcoming || ''} onChange={e => set('upcoming', e.target.value)} rows={2} />
          </label>
        </>
      )
    if (type === 'user')
      return (
        <>
          <div className="form-row">
            <label>
              Full name
              <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Role
              <select value={form.role || 'Viewer'} onChange={e => set('role', e.target.value)}>
                {Object.keys(roles).map(role => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <label>
              Linked person
              <select value={form.personId || ''} onChange={e => set('personId', e.target.value)}>
                {!record && <option value="">Create a new person profile</option>}
                {data.people
                  .filter(p => p.id === record?.personId || !(data.users || []).some(u => u.personId === p.id))
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            {record ? 'New password (optional)' : 'Password'}
            <input
              type="password"
              value={form.password || ''}
              onChange={e => set('password', e.target.value)}
              minLength={record ? undefined : Number(settings.security?.passwordMinLength) || 8}
              required={!record}
              autoComplete="new-password"
            />
          </label>
          {(form.password || !record) && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.mustChangePassword !== false}
                onChange={e => set('mustChangePassword', e.target.checked)}
              />{' '}
              Require a new password at next sign-in
            </label>
          )}
          <div className="form-row">
            <label>
              Avatar color
              <select value={form.avatarColor || 'purple'} onChange={e => set('avatarColor', e.target.value)}>
                <option>purple</option>
                <option>blue</option>
                <option>orange</option>
                <option>green</option>
                <option>pink</option>
                <option>teal</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.active !== false} onChange={e => set('active', e.target.checked)} />{' '}
              Account active
            </label>
          </div>
          <div className="settings-note">
            <Icon name="check" size={15} />
            <span>{roles[form.role || 'Viewer']?.summary || roles[form.role || 'Viewer']?.description}</span>
          </div>
        </>
      )
    return (
      <>
        <label>
          Alert title
          <input autoFocus value={form.title || ''} onChange={e => set('title', e.target.value)} required />
        </label>
        <label>
          Details
          <textarea value={form.body || ''} onChange={e => set('body', e.target.value)} rows={3} />
        </label>
        <div className="form-row">
          <label>
            Type
            <select value={form.type || 'info'} onChange={e => set('type', e.target.value)}>
              <option value="info">Info</option>
              <option value="deadline">Deadline</option>
              <option value="blocker">Blocker</option>
              <option value="risk">Risk</option>
            </select>
          </label>
          <label>
            Project
            <select value={form.projectId || ''} onChange={e => set('projectId', e.target.value)}>
              <option value="">Workspace</option>
              {data.projects.map(p => (
                <option key={p.numericId} value={p.numericId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </>
    )
  }
  const title = `${isEdit ? 'Edit' : type === 'activity' ? 'Log' : 'Create'} ${type}`
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !dirty && onClose()}>
      <form
        className="modal"
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-dialog-title"
        onKeyDown={onDialogKeyDown}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">
              <span className="eyebrow-dot" /> Atlas record
            </span>
            <h2 id="record-dialog-title">{title}</h2>
            <p>Changes are saved to this workspace's data store when you press Save.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={requestClose}>
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="form-fields">
          {fields()}
          <CustomFieldInputs
            definitions={fieldDefs}
            values={form.customFields || {}}
            onChange={value => set('customFields', value)}
          />
          {error && (
            <div className="form-error">
              <Icon name="warning" size={15} />
              {error}
            </div>
          )}
        </div>
        <div className="modal-foot">
          {isEdit && onDelete && (
            <button type="button" className="secondary-button danger-button" onClick={() => onDelete(type, record)}>
              Delete
            </button>
          )}
          <span />
          <button type="button" className="secondary-button" onClick={requestClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Save'} <Icon name="arrow" size={14} />
          </button>
        </div>
      </form>
    </div>
  )
}

class ErrorBoundary extends React.Component<{ children: any; label?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: any) {
    console.error('Render error:', error, info?.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page-content" role="alert">
        <EmptyState
          title="This page could not be displayed"
          message="Something unexpected went wrong while drawing this screen. Your data is safe. Try again, or go back to the overview."
        />
        <div className="error-actions">
          <button type="button" className="secondary-button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              window.location.hash = '/overview'
              this.setState({ error: null })
            }}
          >
            Go to overview
          </button>
        </div>
        <details className="error-details">
          <summary>Technical details</summary>
          <pre translate="no">{String(this.state.error?.stack || this.state.error?.message || this.state.error)}</pre>
        </details>
      </div>
    )
  }
}

function LoadErrorScreen({ message, onRetry, onLogout }) {
  return (
    <div className="loading-screen" role="alert">
      <Logo />
      <strong>Atlas could not load your workspace</strong>
      <span>{message}</span>
      <div className="error-actions">
        <button type="button" className="primary-button" onClick={onRetry}>
          Try again
        </button>
        {onLogout && (
          <button type="button" className="secondary-button" onClick={onLogout}>
            Sign out
          </button>
        )}
      </div>
    </div>
  )
}

function PasswordForm({ user, minLength, onDone, submitLabel = 'Change password' }) {
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

function PasswordChangeScreen({ user, minLength, onDone, onLogout }) {
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

function AccountPanel({ user, settings, prefs, setPrefs, onLogout, notify }) {
  const languages = languageOptions(settings).filter(lang => lang.enabled !== false)
  const canChooseLanguage = settings.localization?.userLanguagePreference !== false && languages.length > 1
  const role = user?.role
  return (
    <div className="settings-fields">
      <SettingsPanel title="Your account" description="Who you are signed in as.">
        <div className="settings-note">
          <Icon name="check" size={15} />
          <span>
            <strong translate="no">{user?.name}</strong> · <span translate="no">{user?.email}</span> · {role}
          </span>
        </div>
        <p className="setup-small">
          {tr(settings, 'Your role decides what you can do. You have {count} permission(s): {list}.', {
            count: user?.permissions?.length || 0,
            list: (user?.permissions || []).join(', ') || '—'
          })}
        </p>
      </SettingsPanel>
      <SettingsPanel
        title="Your preferences"
        description="These apply only to you, on this browser. They never change anything for other people."
      >
        <div className="form-row">
          <label>
            Theme
            <select
              value={prefs.theme || ''}
              onChange={e => setPrefs(p => ({ ...p, theme: e.target.value || undefined }))}
            >
              <option value="">
                {tr(settings, 'Workspace default ({value})', { value: settings.interface?.theme || 'light' })}
              </option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">Follow my system</option>
            </select>
          </label>
          <label>
            Density
            <select
              value={prefs.density || ''}
              onChange={e => setPrefs(p => ({ ...p, density: e.target.value || undefined }))}
            >
              <option value="">
                {tr(settings, 'Workspace default ({value})', { value: settings.interface?.density || 'comfortable' })}
              </option>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </div>
        {canChooseLanguage && (
          <label>
            Language
            <select
              value={prefs.language || ''}
              onChange={e => setPrefs(p => ({ ...p, language: e.target.value || undefined }))}
            >
              <option value="">Workspace default</option>
              {languages.map(lang => (
                <option key={lang.code} value={lang.code}>
                  {lang.name} ({lang.code})
                </option>
              ))}
            </select>
          </label>
        )}
      </SettingsPanel>
      <SettingsPanel title="Password" description="Choose a password only you know.">
        <PasswordForm
          user={user}
          minLength={settings.security?.passwordMinLength}
          onDone={result =>
            notify({
              title: 'Password changed',
              body: result.signedOutElsewhere ? 'Other devices were signed out.' : '',
              tone: 'success'
            })
          }
        />
        <button
          type="button"
          className="secondary-button"
          onClick={async () => {
            try {
              await api.post('/api/auth/logout-all')
            } catch (error) {
              notify({ title: 'Could not sign out everywhere', body: errorMessage(error), tone: 'warning' })
              return
            }
            onLogout(false)
          }}
        >
          Sign out of every device
        </button>
      </SettingsPanel>
    </div>
  )
}

const PAGE_IDS = ['overview', 'projects', 'tasks', 'people', 'activity', 'reports', 'alerts', 'settings']
const pageFromHash = () => {
  const id = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return PAGE_IDS.includes(id) ? id : ''
}
declare const __ATLAS_BUILD__: string
declare const __ATLAS_DEV__: boolean

function App() {
  const [setup, setSetup] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [data, setData] = useState(emptyData)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [page, setPageState] = useState(() => pageFromHash() || 'overview')
  const [modal, setModal] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [runtime, setRuntime] = useState(null)
  const [system, setSystem] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [toasts, setToasts] = useState([])
  const [displayMode, setDisplayMode] = useState(() => detectDisplayMode())
  const [languagePreview, setLanguagePreview] = useState('')
  const [prefs, setPrefs] = useState({})
  const defaultPageApplied = useRef(Boolean(pageFromHash()))
  const revision = useRef(0)
  const setPage = useCallback(next => {
    setPageState(next)
    if (window.location.hash !== `#/${next}`) window.location.hash = `/${next}`
  }, [])
  const baseSettings = useMemo(() => clientSettings(data.settings), [data.settings])
  const settings = useMemo(() => {
    let next = withPreferences(baseSettings, prefs)
    if (languagePreview) {
      next = {
        ...next,
        language: languagePreview,
        localization: { ...(next.localization || {}), defaultLanguage: languagePreview },
        workspace: { ...(next.workspace || {}), defaultLanguage: languagePreview }
      }
    }
    return next
  }, [baseSettings, prefs, languagePreview])
  useUiLocalization(settings, data)
  const canManage =
    hasPermission(user, 'manageProjects') || hasPermission(user, 'managePeople') || hasPermission(user, 'manageAlerts')
  const canWriteTasks = hasPermission(user, 'writeTasks')
  const canLogActivity = hasPermission(user, 'logActivity')
  const canAdmin = hasPermission(user, 'manageSettings')
  const notify = useCallback(toast => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts(t => [...t.slice(-4), { id, ...toast }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), toast.tone === 'warning' ? 8000 : 4200)
  }, [])
  const signedOut = useCallback((message = '') => {
    setUser(null)
    setData(emptyData)
    setLoaded(false)
    setLoadError('')
    revision.current = 0
    defaultPageApplied.current = false
    setMissingKeyReporting(false)
    clearSessionStorage()
    setNotice(message)
  }, [])

  const loadData = useCallback(async (silent = false) => {
    try {
      const next = await api.get('/api/bootstrap')
      revision.current = next.revision
      setData(next)
      setUser(next.user)
      setLoaded(true)
      setLoadError('')
      setError('')
      if (!defaultPageApplied.current && next.settings?.defaultPage) {
        setPage(next.settings.defaultPage)
        defaultPageApplied.current = true
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === 'PASSWORD_CHANGE_REQUIRED')) return
      // First load failed: say so (never show an empty workspace that looks like lost data). Later refresh: keep what we have.
      if (silent) setError(`${errorMessage(err)} Showing the last data we received.`)
      else setLoadError(errorMessage(err))
    }
  }, [])

  // ---- boot: is the workspace set up? who am I? ----
  useEffect(() => {
    api
      .get('/api/setup/status')
      .then(status => {
        setSetup(status)
        if (!status.configured) setAuthChecked(true)
      })
      .catch(err => setError(errorMessage(err)))
    api
      .get('/api/runtime-config')
      .then(setRuntime)
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!setup?.configured) return
    api
      .get('/api/auth/me')
      .then(result => {
        setUser(result.user)
        setMissingKeyReporting(true)
      })
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true))
  }, [setup])
  useEffect(() => {
    if (user && !user.mustChangePassword) loadData()
  }, [user?.id, user?.mustChangePassword, loadData])
  useEffect(() => {
    setPrefs(user?.id ? loadPreferences(user.id) : {})
  }, [user?.id])
  useEffect(() => {
    if (user?.id) savePreferences(user.id, prefs)
  }, [prefs, user?.id])

  // ---- global events: expired session, forced password change, connectivity, navigation ----
  useEffect(() => {
    const onUnauthenticated = () => signedOut('Your session ended. Please sign in again.')
    const onPasswordRequired = () => setUser(u => (u ? { ...u, mustChangePassword: true } : u))
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const onHash = () => {
      const next = pageFromHash()
      if (next) setPageState(next)
    }
    const onNavigate = event => {
      if (PAGE_IDS.includes(event.detail)) setPage(event.detail)
    }
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated)
    window.addEventListener(PASSWORD_CHANGE_EVENT, onPasswordRequired)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('atlas:navigate', onNavigate)
    return () => {
      window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated)
      window.removeEventListener(PASSWORD_CHANGE_EVENT, onPasswordRequired)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('atlas:navigate', onNavigate)
    }
  }, [signedOut, setPage])

  // ---- keep several people's screens in step: cheap revision check, full reload only when something changed ----
  useEffect(() => {
    if (!user || user.mustChangePassword) return
    let alive = true
    const check = async () => {
      if (document.visibilityState !== 'visible' || !revision.current) return
      try {
        const result = await api.get('/api/revision')
        if (alive && result.revision !== revision.current) await loadData(true)
        else if (alive) setError('')
      } catch (err) {
        if (alive && err instanceof ApiError && err.status === 0) setError(errorMessage(err))
      }
    }
    const timer = setInterval(check, 20000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [user?.id, user?.mustChangePassword, loadData])

  // ---- administrator-only diagnostics, fetched when needed rather than on every data change ----
  const refreshSystem = useCallback(() => {
    if (!canAdmin) return setSystem(null)
    api
      .get('/api/system')
      .then(setSystem)
      .catch(() => setSystem(null))
    api
      .get('/api/runtime-config')
      .then(setRuntime)
      .catch(() => {})
  }, [canAdmin])
  useEffect(() => {
    if (page === 'settings') refreshSystem()
  }, [page, refreshSystem, data.revision])
  useEffect(() => {
    const desktop = Boolean((window as any).atlasDesktop)
    if (!('serviceWorker' in navigator)) return
    if (desktop || __ATLAS_DEV__) {
      // The desktop shell and the dev server do not need (and must not be confused by) a cached shell.
      navigator.serviceWorker
        .getRegistrations()
        .then(list => list.forEach(r => r.unregister()))
        .catch(() => {})
      return
    }
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__ATLAS_BUILD__)}`).catch(() => {})
  }, [])
  useEffect(() => {
    const detect = () => setDisplayMode(detectDisplayMode())
    const media = window.matchMedia?.('(display-mode: standalone)')
    media?.addEventListener?.('change', detect)
    return () => media?.removeEventListener?.('change', detect)
  }, [])
  useEffect(() => {
    const onKey = event => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(v => !v)
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setModal({ type: 'task' })
      }
      // Escape closes the palette and the mobile menu; an open record dialog handles Escape itself (it may have unsaved edits).
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setNavOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const accentName = settings.interface?.colors?.accent || settings.accentColor || 'purple'
    const accent = {
      purple: ['#6d5dfc', '#5144dd', '#f0eeff'],
      blue: ['#3b82f6', '#2563c7', '#ebf3ff'],
      green: ['#28a778', '#20835e', '#e9f8f2'],
      orange: ['#f2994a', '#c87825', '#fff4e9']
    }[accentName] || ['#6d5dfc', '#5144dd', '#f0eeff']
    const theme = settings.theme || settings.interface?.theme || 'light'
    document.documentElement.dataset.theme =
      theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
    document.documentElement.style.setProperty('--purple', accent[0])
    document.documentElement.style.setProperty('--purple-deep', accent[1])
    document.documentElement.style.setProperty('--purple-pale', accent[2])
    document.body.dataset.density = settings.density || settings.interface?.density || 'comfortable'
    document.body.dataset.sidebar = settings.sidebarMode || settings.interface?.sidebarBehavior || 'expanded'
    document.body.dataset.motion =
      settings.showAnimations === false || settings.interface?.accessibility?.reducedMotion ? 'off' : 'on'
    document.body.dataset.contrast = settings.interface?.accessibility?.highContrast ? 'high' : 'normal'
  }, [settings])

  const login = async (email, password) => {
    const result = await api.post('/api/auth/login', { email, password })
    setNotice('')
    setMissingKeyReporting(true)
    setUser(result.user)
  }
  const logout = async (callServer = true) => {
    if (callServer) {
      try {
        await api.post('/api/auth/logout', {})
      } catch {
        /* the cookie is cleared client-side by the server response; nothing else to do */
      }
    }
    signedOut('')
    setPage('overview')
  }
  const openModal = (type, record = null) => setModal({ type, record })
  const saveEntity = async (type, record, form) => {
    if (type === 'task')
      await (record?.numericId ? api.put(`/api/tasks/${record.numericId}`, form) : api.post('/api/tasks', form))
    if (type === 'project')
      await (record?.numericId ? api.put(`/api/projects/${record.numericId}`, form) : api.post('/api/projects', form))
    if (type === 'person')
      await (record?.id ? api.put(`/api/people/${record.id}`, form) : api.post('/api/people', form))
    if (type === 'team') await (record?.id ? api.put(`/api/teams/${record.id}`, form) : api.post('/api/teams', form))
    if (type === 'milestone')
      await (record?.id ? api.put(`/api/milestones/${record.id}`, form) : api.post('/api/milestones', form))
    if (type === 'activity') await api.post('/api/activity', form)
    if (type === 'alert')
      await (record?.id ? api.patch(`/api/alerts/${record.id}`, form) : api.post('/api/alerts', form))
    if (type === 'user') await (record?.id ? api.put(`/api/users/${record.id}`, form) : api.post('/api/users', form))
    notify({ title: record?.numericId || record?.id ? 'Changes saved' : 'Record created', tone: 'success' })
    await loadData(true)
  }
  const deleteEntity = async (type, record) => {
    const paths = {
      task: 'tasks',
      project: 'projects',
      person: 'people',
      team: 'teams',
      milestone: 'milestones',
      activity: 'activity',
      alert: 'alerts',
      user: 'users'
    }
    let query = ''
    let message = tr(settings, 'Delete this {type}? This cannot be undone.', { type })
    if (type === 'task')
      message = tr(settings, 'Delete task {id}: “{title}”? This cannot be undone.', {
        id: record.id,
        title: record.title
      })
    if (type === 'project') {
      const tasks = data.tasks.filter(task => task.projectId === record.numericId).length
      const milestones = (record.milestoneRows || []).length
      if (tasks || milestones) {
        query = '?cascade=true'
        message = tr(
          settings,
          'Delete project “{name}” together with its {tasks} task(s) and {milestones} milestone(s)? This cannot be undone. A backup is taken first.',
          { name: record.name, tasks, milestones }
        )
      } else message = tr(settings, 'Delete project “{name}”? This cannot be undone.', { name: record.name })
    }
    if (type === 'person') {
      const tasks = data.tasks.filter(task => task.assigneeId === record.id).length
      message = tr(settings, 'Delete {name}? Their {tasks} assigned task(s) will become unassigned.', {
        name: record.name,
        tasks
      })
    }
    if (type === 'user')
      message = tr(settings, 'Delete the account for {name}? Their person profile stays.', { name: record.name })
    if (!window.confirm(message)) return
    const key = type === 'task' || type === 'project' ? record.numericId : record.id
    try {
      await api.delete(`/api/${paths[type]}/${key}${query}`)
      notify({ title: 'Deleted', tone: 'success' })
      setModal(null)
      await loadData(true)
    } catch (err) {
      notify({ title: 'Could not delete', body: errorMessage(err), tone: 'warning' })
    }
  }
  const updateSettings = async values => {
    // Send only what changed (as a merge patch); never re-send the built-in translation catalog or other people's edits.
    const patch = diffPatch(baseSettings, values)
    delete patch.localization?.missingKeys
    delete patch.localization?.missingKeyCount
    if (!Object.keys(patch).length) return data.settings
    const next = await api.put('/api/settings', patch)
    setData(current => ({ ...current, settings: next }))
    setLanguagePreview('')
    if (next.enabledPages && !next.enabledPages.includes(page) && page !== 'settings') setPage('overview')
    return next
  }
  const removeDemo = async () => {
    if (
      !window.confirm(
        tr(
          settings,
          'Remove all sample rows and the demo sign-in accounts, keeping your live data? A backup is taken first.'
        )
      )
    )
      return
    try {
      await api.delete('/api/setup/seed')
      notify({ title: 'Demo data removed', tone: 'success' })
      await loadData(true)
      refreshSystem()
    } catch (err) {
      notify({ title: 'Could not remove demo data', body: errorMessage(err), tone: 'warning' })
    }
  }
  const toggleTheme = () => {
    const current = settings.theme === 'dark' ? 'dark' : 'light'
    setPrefs(p => ({ ...p, theme: current === 'dark' ? 'light' : 'dark' }))
  }
  const periodChange = async period => {
    const report = await api.get(`/api/reports/${period}`)
    setData(current => ({ ...current, reports: report }))
  }
  const createForPage = () => {
    if (page === 'projects' && hasPermission(user, 'manageProjects')) openModal('project')
    else if (page === 'people' && hasPermission(user, 'managePeople')) openModal('person')
    else if (page === 'activity' && canLogActivity) openModal('activity')
    else if (page === 'alerts' && hasPermission(user, 'manageAlerts')) openModal('alert')
    else if (canWriteTasks) openModal('task')
    else notify({ title: 'Read-only role', body: 'Your role does not permit creating records here.', tone: 'warning' })
  }
  const canCreate =
    page === 'projects'
      ? hasPermission(user, 'manageProjects')
      : page === 'people'
        ? hasPermission(user, 'managePeople')
        : page === 'activity'
          ? canLogActivity
          : page === 'alerts'
            ? hasPermission(user, 'manageAlerts')
            : ['overview', 'tasks'].includes(page)
              ? canWriteTasks
              : false
  const context = useMemo(() => ({ user, settings, notify }), [user, settings, notify])

  if (!setup && !error) return <LoadingScreen />
  if (!setup) return <LoadErrorScreen message={error} onRetry={() => window.location.reload()} onLogout={null} />
  if (setup && !setup.configured)
    return (
      <AppContext.Provider value={context}>
        <SetupWizard
          setup={setup}
          onPreviewLanguage={setLanguagePreview}
          onComplete={result => {
            setSetup(result.setup)
            setUser(result.user)
            setAuthChecked(true)
            setLanguagePreview('')
            setMissingKeyReporting(true)
          }}
        />
      </AppContext.Provider>
    )
  if (!authChecked) return <LoadingScreen />
  if (!user)
    return (
      <AppContext.Provider value={context}>
        <LoginScreen onLogin={login} setup={setup} notice={notice} />
      </AppContext.Provider>
    )
  if (user.mustChangePassword)
    return (
      <AppContext.Provider value={context}>
        <PasswordChangeScreen
          user={user}
          minLength={8}
          onDone={() => setUser(u => ({ ...u, mustChangePassword: false }))}
          onLogout={() => logout()}
        />
      </AppContext.Provider>
    )
  if (!loaded)
    return loadError ? (
      <LoadErrorScreen message={loadError} onRetry={() => loadData()} onLogout={() => logout()} />
    ) : (
      <LoadingScreen />
    )
  const shellUser = {
    ...user,
    openTasks: data.dashboard.stats?.myOpenTasks ?? 0,
    openAlerts: data.alerts.filter(a => !a.resolved).length
  }
  return (
    <AppContext.Provider value={context}>
      <div className={`app-shell ${navOpen ? 'nav-open' : ''}`}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="nav-backdrop" aria-hidden="true" onClick={() => setNavOpen(false)} />
        <Sidebar
          page={page}
          setPage={setPage}
          user={shellUser}
          settings={settings}
          onLogout={() => logout()}
          mobileOpen={navOpen}
          onClose={() => setNavOpen(false)}
        />
        <main className="main" id="main-content" tabIndex={-1}>
          <Topbar
            page={page}
            user={shellUser}
            setPage={setPage}
            onCreate={createForPage}
            onSearch={() => setSearchOpen(true)}
            onToggleTheme={toggleTheme}
            onOpenNav={() => setNavOpen(true)}
            canCreate={canCreate}
            settings={settings}
          />
          <div className="content">
            {!online && (
              <div className="global-error" role="status">
                <Icon name="warning" size={15} />
                You appear to be offline. Changes cannot be saved until the connection returns.
              </div>
            )}
            {page === 'overview' && (
              <QuickActionRail
                openModal={openModal}
                setPage={setPage}
                canManage={hasPermission(user, 'manageProjects')}
                canWriteTasks={canWriteTasks}
                canLogActivity={canLogActivity}
                onSearch={() => setSearchOpen(true)}
              />
            )}
            {error && (
              <div className="global-error" role="alert">
                <Icon name="warning" size={15} />
                {error}
                <button type="button" onClick={() => loadData(true)}>
                  Retry
                </button>
              </div>
            )}
            <ErrorBoundary key={page}>
              {page === 'overview' && <Overview data={data} setPage={setPage} />}
              {page === 'projects' && (
                <Projects data={data} openModal={openModal} canManage={hasPermission(user, 'manageProjects')} />
              )}
              {page === 'tasks' && (
                <MyWork
                  data={data}
                  openModal={openModal}
                  refresh={() => loadData(true)}
                  notify={notify}
                  canWriteTasks={canWriteTasks}
                />
              )}
              {page === 'people' && (
                <People data={data} openModal={openModal} canManage={hasPermission(user, 'managePeople')} />
              )}
              {page === 'activity' && (
                <ActivityLog data={data} openModal={openModal} setPage={setPage} canLogActivity={canLogActivity} />
              )}
              {page === 'reports' && (
                <>
                  {hasPermission(user, 'viewReports') ? (
                    <>
                      <Reports
                        report={data.reports}
                        onPeriodChange={periodChange}
                        settings={settings}
                        setPage={setPage}
                      />
                      <UserActivityReports people={data.people || []} settings={settings} />
                    </>
                  ) : (
                    <EmptyState title="Reports are not available" message="Your role does not include report access." />
                  )}
                </>
              )}
              {page === 'alerts' && (
                <Alerts
                  data={data}
                  refresh={() => loadData(true)}
                  openModal={openModal}
                  canManage={hasPermission(user, 'manageAlerts')}
                  canResolve={hasPermission(user, 'writeTasks') || hasPermission(user, 'manageAlerts')}
                />
              )}
              {page === 'settings' &&
                (canAdmin ? (
                  <SettingsPage
                    data={{ ...data, settings: baseSettings }}
                    user={user}
                    updateSettings={updateSettings}
                    onRemoveDemo={removeDemo}
                    runtime={runtime}
                    system={system}
                    refreshSystem={refreshSystem}
                    displayMode={displayMode}
                    openModal={openModal}
                    onDelete={deleteEntity}
                    onPreviewLanguage={setLanguagePreview}
                    account={{ prefs, setPrefs, onLogout: logout }}
                  />
                ) : (
                  <div className="page-content">
                    <AccountPanel
                      user={user}
                      settings={settings}
                      prefs={prefs}
                      setPrefs={setPrefs}
                      onLogout={logout}
                      notify={notify}
                    />
                  </div>
                ))}
            </ErrorBoundary>
          </div>
        </main>
        <CommandSearch
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          data={data}
          setPage={setPage}
          openModal={openModal}
        />
        <FormModal
          modal={modal}
          data={{ ...data, settings }}
          user={user}
          onClose={() => setModal(null)}
          onSave={saveEntity}
          onDelete={deleteEntity}
        />
        <ToastHost toasts={toasts} dismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
      </div>
    </AppContext.Provider>
  )
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
