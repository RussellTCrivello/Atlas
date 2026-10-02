// Small presentational pieces used all over: avatars, status pills, progress bars, notices, stat cards, empty states, toasts.
import { colorFor, initials, slug } from '../lib/format'
import { Icon, Logo } from './icons'

export function Avatar({ name, color = undefined, small = false }: { name: string; color?: string; small?: boolean }) {
  return (
    <span className={`avatar ${small ? 'avatar-small' : ''} avatar-${color || colorFor(name)}`} title={name}>
      {initials(name)}
    </span>
  )
}

export function StatusPill({ children, tone }) {
  return <span className={`status-pill ${tone || slug(children)}`}>{children}</span>
}

export function ProgressBar({ value, color = 'purple' }) {
  return (
    <div className="progress-track">
      <span className={`progress-fill fill-${color}`} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  )
}

export function RoleBadge({ role }) {
  return <span className={`role-badge role-${slug(role || 'viewer')}`}>{role || 'Viewer'}</span>
}

export function PermissionNotice({ children }) {
  return (
    <div className="permission-notice">
      <Icon name="warning" size={15} />
      <span>{children}</span>
    </div>
  )
}

export function LoadingScreen({ message = 'Connecting to your local workspace…' }) {
  return (
    <div className="loading-screen">
      <Logo />
      <strong>Loading Atlas</strong>
      <span>{message}</span>
    </div>
  )
}

export function ToastHost({ toasts, dismiss }) {
  return (
    <div className="toast-host" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map(t => (
        <div className={`toast toast-${t.tone || 'info'}`} key={t.id} role={t.tone === 'warning' ? 'alert' : 'status'}>
          <Icon name={t.tone === 'success' ? 'check' : t.tone === 'warning' ? 'warning' : 'spark'} size={15} />
          <div>
            <strong>{t.title}</strong>
            {t.body && <span>{t.body}</span>}
          </div>
          <button
            type="button"
            aria-label="Dismiss notification"
            className="icon-button subtle"
            onClick={() => dismiss(t.id)}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function StatCard({ label, value, detail, icon, color, onClick }) {
  return (
    <button className="stat-card" onClick={onClick}>
      <div className="stat-card-top">
        <span className={`stat-icon stat-${color}`}>
          <Icon name={icon} size={18} />
        </span>
        <span className="stat-kicker">{label}</span>
        <Icon name="arrow" size={14} className="stat-arrow" />
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        <span>{detail}</span>
      </div>
    </button>
  )
}

export function EmptyState({
  title,
  message,
  action = '',
  onAction = undefined
}: {
  title: string
  message: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon name="spark" size={22} />
      </span>
      <h3>{title}</h3>
      <p>{message}</p>
      {action && (
        <button className="text-button" onClick={onAction}>
          {action}
          <Icon name="arrow" size={13} />
        </button>
      )}
    </div>
  )
}
