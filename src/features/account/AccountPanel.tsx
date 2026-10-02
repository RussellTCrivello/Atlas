// The signed-in person's own account: language, theme, password, sessions.
import { languageOptions } from '../../lib/settings'
import { tr } from '../../lib/i18n'
import { api, errorMessage } from '../../lib/api'
import { SettingsPanel } from '../settings/fields'
import { Icon } from '../../ui/icons'
import { PasswordForm } from '../auth/PasswordScreens'

export function AccountPanel({ user, settings, prefs, setPrefs, onLogout, notify }) {
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
