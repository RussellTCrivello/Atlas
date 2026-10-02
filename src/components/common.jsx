import { Icon } from './Icon.jsx'
import { colorFor, initials, slug } from '../lib/strings.js'

export { initials }

export function Logo() {
  return <div className="brand-mark"><span className="brand-orbit orbit-one"/><span className="brand-orbit orbit-two"/><span className="brand-dot"/></div>
}

export function Avatar({ name, color, small = false }) {
  return <span className={`avatar ${small ? 'avatar-small' : ''} avatar-${color || colorFor(name)}`} title={name}>{initials(name)}</span>
}

export function StatusPill({ children, tone }) {
  return <span className={`status-pill ${tone || slug(children)}`}>{children}</span>
}

export function ProgressBar({ value, color = 'purple' }) {
  return <div className="progress-track"><span className={`progress-fill fill-${color}`} style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }}/></div>
}

export function RoleBadge({ role }) {
  return <span className={`role-badge role-${slug(role || 'viewer')}`}>{role || 'Viewer'}</span>
}

export function PermissionNotice({ children }) {
  return <div className="permission-notice"><Icon name="warning" size={15}/><span>{children}</span></div>
}

export function EmptyState({ title, message, action, onAction }) {
  return <div className="empty-state"><span><Icon name="spark" size={22}/></span><h3>{title}</h3><p>{message}</p>{action && <button className="text-button" onClick={onAction}>{action}<Icon name="arrow" size={13}/></button>}</div>
}

export function LoadingScreen({ message = 'Connecting to your local workspace…' }) {
  return <div className="loading-screen"><Logo/><strong>Loading Atlas</strong><span>{message}</span></div>
}

export function ToastHost({ toasts, dismiss }) {
  return <div className="toast-host">{toasts.map((toast) => <div className={`toast toast-${toast.tone || 'info'}`} key={toast.id}>
    <Icon name={toast.tone === 'success' ? 'check' : toast.tone === 'warning' ? 'warning' : 'spark'} size={15}/>
    <div><strong>{toast.title}</strong>{toast.body && <span>{toast.body}</span>}</div>
    <button className="icon-button subtle" onClick={() => dismiss(toast.id)}><Icon name="close" size={13}/></button>
  </div>)}</div>
}
