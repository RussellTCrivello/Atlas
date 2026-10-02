// Quick actions on the overview.
import { Icon } from '../../ui/icons'

export function QuickActionRail({
  openModal,
  setPage,
  canManage,
  canWriteTasks = true,
  canLogActivity = true,
  onSearch
}) {
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
