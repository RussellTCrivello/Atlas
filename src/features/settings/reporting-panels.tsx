// Settings > Notifications, reports and exports, integrations.
import { useState } from 'react'
import { slug } from '../../lib/format'
import { PermissionNotice } from '../../ui/primitives'
import {
  AdvancedJsonConfigEditor,
  AdvancedSettingSelect,
  AdvancedTextListSetting,
  AdvancedToggleSetting,
  SettingInput
} from './fields'
import { Icon } from '../../ui/icons'

export function AdvancedNotificationsAdmin({ form, patch, canAdmin }) {
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

export function AdvancedReportExportAdmin({ form, patch, canAdmin }) {
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

export function AdvancedIntegrationsAdmin({ form, patch, canAdmin }) {
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
