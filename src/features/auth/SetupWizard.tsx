// First-run setup: workspace, administrator account, language, optional demo data.
import { useState, useEffect } from 'react'
import { validatePassword, passwordStrength } from '../../../shared/password'
import { slug } from '../../lib/format'
import { mergeDeep, defaultSettings, diffPatch, languageOptions } from '../../lib/settings'
import { api } from '../../lib/api'
import { textDirection } from '../../lib/i18n'
import { Icon, Logo } from '../../ui/icons'

export function SetupWizard({ onComplete, setup, onPreviewLanguage }) {
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
