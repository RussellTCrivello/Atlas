// One task as a compact row.
import { uiLanguage, tr } from '../../lib/i18n'
import { slug } from '../../lib/format'
import { dueText } from '../../lib/labels'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { Avatar, StatusPill } from '../../ui/primitives'

export function TaskRow({ task, compact = false, onAdvance = undefined, onEdit = undefined }) {
  const { settings } = useApp()
  const language = uiLanguage(settings)
  const advance = onAdvance
  return (
    <div className={`task-row ${compact ? 'task-row-compact' : ''}`}>
      <button
        type="button"
        className={`task-check task-${slug(task.status)}`}
        disabled={!advance}
        aria-label={tr(settings, 'Advance {title} to the next status', { title: task.title })}
        title={tr(settings, 'Advance to the next status')}
        onClick={() => advance?.(task)}
      >
        <Icon name={task.done ? 'check' : 'bolt'} size={13} />
      </button>
      <div className="task-row-main">
        <strong>{task.title}</strong>
        <div>
          <span className="task-project">{task.project}</span>
          <span className="task-id">{task.id}</span>
        </div>
      </div>
      {!compact && <span className={`priority priority-${task.priority.toLowerCase()}`}>{task.priority}</span>}
      <StatusPill tone={slug(task.status)}>{task.status}</StatusPill>
      <span className={`task-due due-${task.dueTone}`}>{dueText(task, language, settings)}</span>
      {!compact && <Avatar name={task.assignee} color={task.assigneeColor} small />}
      {!compact && onEdit && (
        <button
          type="button"
          className="icon-button row-more"
          aria-label={`Edit ${task.title}`}
          onClick={() => onEdit?.(task)}
        >
          <Icon name="more" size={16} />
        </button>
      )}
    </div>
  )
}
