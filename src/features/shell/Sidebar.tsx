// The navigation sidebar.
import { hasPermission, enabledPages } from '../../lib/settings'
import { translateUiText, t } from '../../lib/i18n'
import { Icon, Logo } from '../../ui/icons'
import { Avatar } from '../../ui/primitives'

export function Sidebar({ page, setPage, user, settings, onLogout, mobileOpen, onClose }) {
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
