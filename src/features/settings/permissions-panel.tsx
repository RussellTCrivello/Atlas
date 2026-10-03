// Settings > Roles and permissions.
import { useState } from 'react'
import { AdvancedJsonConfigEditor, SettingInput } from './fields'

export function AdvancedPermissionsAdmin({ form, patch, canAdmin }) {
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
