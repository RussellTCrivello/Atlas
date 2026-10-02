// The settings page: sections, saving, discarding.
import { useState, useMemo, useEffect } from 'react'
import { hasPermission, diffPatch, updateByPath, languageOptions } from '../../lib/settings'
import { errorMessage, api } from '../../lib/api'
import { useApp } from '../../ui/app-context'
import { Icon, Logo } from '../../ui/icons'
import { PermissionNotice } from '../../ui/primitives'
import { AccountPanel } from '../account/AccountPanel'
import { AdvancedConfigHealth, AdvancedSecurityAuditPanel, AdvancedSystemPanel } from './system-panels'
import {
  AdvancedJsonConfigEditor,
  AdvancedSettingSelect,
  AdvancedTextListSetting,
  AdvancedToggleSetting,
  SettingInput,
  SettingsPanel,
  timeZoneOptions
} from './fields'
import {
  AdvancedDashboardAdmin,
  AdvancedModulesAdmin,
  AdvancedNavigationAdmin,
  AdvancedSurfaceAdmin
} from './interface-panels'
import {
  AdvancedI18nIntegrationAdmin,
  AdvancedLanguagePackagesAdmin,
  SettingsImportExport,
  TranslationManager
} from './localization'
import { AdvancedWorkflowAdmin } from './workflow-panel'
import { AdvancedCustomFieldsAdmin } from './custom-fields-panel'
import { AdvancedIntegrationsAdmin, AdvancedNotificationsAdmin, AdvancedReportExportAdmin } from './reporting-panels'
import { AccessControlPanel } from './AccessControlPanel'
import { AdvancedPermissionsAdmin } from './permissions-panel'

export function SettingsSection({ active, id, children }) {
  return active === id ? <div className="settings-section-body">{children}</div> : null
}

export function SettingsPage({
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
