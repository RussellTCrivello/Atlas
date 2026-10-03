// The user directory with roles.
import { Icon } from '../../ui/icons'
import { Avatar, EmptyState, RoleBadge, StatusPill } from '../../ui/primitives'
import { ExportMenu } from '../export/ExportMenu'

export function AccessControlPanel({ users = [], people = [], openModal, onDelete, canAdmin, settings }) {
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
      <ExportMenu dataset="users" title="Atlas users" primary={false} rowsHint={users.length} />
    </section>
  )
}
