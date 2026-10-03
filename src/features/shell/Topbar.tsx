// The top bar: page title, search, create menu, theme.
import { hasPermission, enabledPages } from '../../lib/settings'
import { translateUiText, t } from '../../lib/i18n'
import { Icon, Logo } from '../../ui/icons'

export const SEARCH_HINT =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'

export function Topbar({
  page,
  user,
  setPage,
  onCreate,
  onSearch,
  onToggleTheme,
  onOpenNav,
  canCreate = true,
  settings
}) {
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
