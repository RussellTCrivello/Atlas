// Settings > System and security: health, audit trail, storage.
import { enabledPages, hasPermission } from '../../lib/settings'
import { useState, useCallback, useEffect } from 'react'
import { api, errorMessage } from '../../lib/api'
import { advancedMissingTranslations } from './localization'
import { Icon } from '../../ui/icons'
import { AdvancedJsonConfigEditor, AdvancedToggleSetting, SettingInput } from './fields'

export function AdvancedConfigHealth({ form, system, runtime, saved, canAdmin, onSave }) {
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

export function AuditTrail({ canAdmin }) {
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

export function AdvancedSystemPanel({
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
          value={runtime?.database?.storeModel || 'sqlite'}
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

export function AdvancedSecurityAuditPanel({ form, patch, canAdmin }) {
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
