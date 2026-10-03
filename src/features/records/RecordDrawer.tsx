// Opening a record: a panel beside the list that shows one task with everything about it (its details, tags and history) and
// the things you do to one record: edit, duplicate, print, delete. Arrow buttons step through the rows of the list behind it.
import { useEffect, useId, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { localDate } from '../../lib/format'
import { tr, uiLanguage } from '../../lib/i18n'
import { dueText } from '../../lib/labels'
import { projectHash } from '../../app/routes'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { Avatar, StatusPill } from '../../ui/primitives'
import { useDialogKeys } from '../../ui/use-dialog'
import { slug } from '../../lib/format'

interface Props {
  taskId: number
  /** Changes whenever the workspace changes, so the panel never shows stale details. */
  revision: number
  canWrite: boolean
  canManage: boolean
  onClose: () => void
  onEdit: (task: any) => void
  onDuplicate: (task: any) => void
  onPrint: (task: any) => void
  onDelete: (task: any) => void
  previous?: number
  next?: number
  onNavigate: (taskId: number) => void
}

export function RecordDrawer({
  taskId,
  revision,
  canWrite,
  canManage,
  onClose,
  onEdit,
  onDuplicate,
  onPrint,
  onDelete,
  previous,
  next,
  onNavigate
}: Props) {
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const language = uiLanguage(settings)
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const [detail, setDetail] = useState<any>(null)
  const [error, setError] = useState('')
  const onKeyDown = useDialogKeys(panel, true, onClose)
  useEffect(() => {
    let alive = true
    setError('')
    api
      .get(`/api/tasks/${taskId}`)
      .then(result => alive && setDetail(result))
      .catch(failure => alive && setError(errorMessage(failure)))
    return () => {
      alive = false
    }
  }, [taskId, revision])
  const task = detail?.task && detail.task.numericId === taskId ? detail.task : null
  const field = (label: string, value: React.ReactNode) => (
    <div className="drawer-field">
      <dt>{label}</dt>
      <dd>{value || <span className="muted">—</span>}</dd>
    </div>
  )
  return (
    <div className="drawer-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <aside
        ref={panel}
        className="record-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={onKeyDown}
      >
        <header className="drawer-head">
          <div>
            <span className="task-id">{task?.id || ''}</span>
            <h2 id={`${id}-title`}>{task?.title || t('Task')}</h2>
          </div>
          <div className="drawer-nav">
            <button
              type="button"
              className="icon-button"
              disabled={!previous}
              aria-label={t('Previous task in the list')}
              onClick={() => previous && onNavigate(previous)}
            >
              <Icon name="sortUp" size={16} />
            </button>
            <button
              type="button"
              className="icon-button"
              disabled={!next}
              aria-label={t('Next task in the list')}
              onClick={() => next && onNavigate(next)}
            >
              <Icon name="sortDown" size={16} />
            </button>
            <button type="button" className="icon-button" aria-label={t('Close')} onClick={onClose}>
              <Icon name="close" size={17} />
            </button>
          </div>
        </header>
        <div className="drawer-body" aria-busy={!task && !error}>
          {error && (
            <div className="form-error" role="alert">
              <Icon name="warning" size={15} /> {error}
            </div>
          )}
          {!task && !error && <p className="muted">{t('Loading task…')}</p>}
          {task && (
            <>
              <div className="drawer-status">
                <StatusPill tone={slug(task.status)}>{task.status}</StatusPill>
                <span className={`priority priority-${String(task.priority).toLowerCase()}`}>{task.priority}</span>
                {task.blocked && <span className="blocked-chip">{t('Blocked')}</span>}
              </div>
              <dl className="drawer-fields">
                {field(
                  t('Project'),
                  detail.project ? (
                    <a href={projectHash(detail.project.id)} onClick={onClose}>
                      {detail.project.name} <span className="muted">({detail.project.code})</span>
                    </a>
                  ) : (
                    task.project
                  )
                )}
                {field(
                  t('Owner'),
                  task.assignee !== 'Unassigned' ? (
                    <span className="owner-cell">
                      <Avatar name={task.assignee} color={task.assigneeColor} small /> {task.assignee}
                    </span>
                  ) : (
                    t('Unassigned')
                  )
                )}
                {field(
                  t('Due date'),
                  task.dueDate ? (
                    <span className={`due-${task.dueTone}`}>
                      {dueText(task, language, settings) || localDate(task.dueDate, language)} · {task.dueDate}
                    </span>
                  ) : (
                    t('No date')
                  )
                )}
                {field(t('Type'), task.type)}
                {field(t('Created'), task.createdAt && localDate(task.createdAt, language))}
                {field(t('Completed'), task.completedAt && localDate(task.completedAt, language))}
                {field(
                  t('Tags'),
                  task.tags?.length ? (
                    <span className="tag-list">
                      {task.tags.map((tag: any) => (
                        <span className="tag-chip" key={tag.id}>
                          {tag.name}
                        </span>
                      ))}
                    </span>
                  ) : null
                )}
              </dl>
              <h3>{t('History')}</h3>
              {detail.history.length ? (
                <ol className="drawer-history">
                  {detail.history.map((event: any) => (
                    <li key={event.id}>
                      <strong>{event.action}</strong>
                      {event.statusFrom && event.statusTo && event.statusFrom !== event.statusTo
                        ? ` · ${event.statusFrom} → ${event.statusTo}`
                        : ''}
                      <span className="side-meta">
                        {event.person} · {event.date}
                        {event.time ? ` ${event.time}` : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">{t('Nothing has happened to this task yet.')}</p>
              )}
            </>
          )}
        </div>
        <footer className="drawer-foot">
          {canManage && (
            <button
              type="button"
              className="secondary-button danger-button"
              disabled={!task}
              onClick={() => task && onDelete(task)}
            >
              <Icon name="trash" size={14} /> {t('Delete')}
            </button>
          )}
          <span />
          <button type="button" className="secondary-button" disabled={!task} onClick={() => task && onPrint(task)}>
            <Icon name="print" size={14} /> {t('Print')}
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                className="secondary-button"
                disabled={!task}
                onClick={() => task && onDuplicate(task)}
              >
                <Icon name="copy" size={14} /> {t('Duplicate')}
              </button>
              <button type="button" className="primary-button" disabled={!task} onClick={() => task && onEdit(task)}>
                <Icon name="edit" size={14} /> {t('Edit')}
              </button>
            </>
          )}
        </footer>
      </aside>
    </div>
  )
}
