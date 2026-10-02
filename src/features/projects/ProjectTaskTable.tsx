// The table of a project's tasks: sortable columns, a status you can change in place, and paging. The rows are one page of what the
// server found; nothing here filters or sorts by itself.
import { slug } from '../../lib/format'
import { tr, uiLanguage } from '../../lib/i18n'
import { dueText } from '../../lib/labels'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { Avatar, StatusPill } from '../../ui/primitives'
import type { TaskPage, TaskSortState } from './use-project-data'

const COLUMNS: { key: string; label: string; sortable: boolean }[] = [
  { key: 'key', label: 'Task ID', sortable: true },
  { key: 'title', label: 'Task', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'priority', label: 'Priority', sortable: true },
  { key: 'assignee', label: 'Owner', sortable: true },
  { key: 'due', label: 'Due date', sortable: true }
]

interface Props {
  page: TaskPage
  statuses: string[]
  sort: TaskSortState
  onSort: (key: string) => void
  onPage: (page: number) => void
  canWrite: boolean
  highlight: number | null
  onStatus: (task: any, status: string) => void
  onEdit: (task: any) => void
}

export function ProjectTaskTable({
  page,
  statuses,
  sort,
  onSort,
  onPage,
  canWrite,
  highlight,
  onStatus,
  onEdit
}: Props) {
  const { settings } = useApp()
  const language = uiLanguage(settings)
  const first = page.total ? (page.page - 1) * page.pageSize + 1 : 0
  const last = Math.min(page.total, page.page * page.pageSize)
  return (
    <div className="project-tasks-table">
      <div className="table-scroll">
        <table>
          <caption className="sr-only">{tr(settings, 'Tasks of this project')}</caption>
          <thead>
            <tr>
              {COLUMNS.map(column => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={sort.key === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button type="button" className="sort-button" onClick={() => onSort(column.key)}>
                    {tr(settings, column.label)}
                    {sort.key === column.key && <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span>}
                  </button>
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">{tr(settings, 'Actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map(task => (
              <tr
                key={task.numericId}
                className={highlight === task.numericId ? 'row-highlight' : ''}
                data-task-id={task.numericId}
              >
                <td className="task-id">{task.id}</td>
                <td className="task-title-cell">
                  <strong>{task.title}</strong>
                  {task.blocked && <span className="blocked-chip">{tr(settings, 'Blocked')}</span>}
                </td>
                <td>
                  {canWrite ? (
                    <select
                      className={`status-select task-${slug(task.status)}`}
                      aria-label={`${tr(settings, 'Status')}: ${task.title}`}
                      value={task.status}
                      onChange={event => onStatus(task, event.target.value)}
                    >
                      {[...new Set([...statuses, task.status])].map(status => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  ) : (
                    <StatusPill tone={slug(task.status)}>{task.status}</StatusPill>
                  )}
                </td>
                <td>
                  <span className={`priority priority-${String(task.priority).toLowerCase()}`}>{task.priority}</span>
                </td>
                <td className="owner-cell">
                  <Avatar name={task.assignee} color={task.assigneeColor} small /> <span>{task.assignee}</span>
                </td>
                <td className={`task-due due-${task.dueTone}`}>
                  {dueText(task, language, settings) || tr(settings, 'No date')}
                </td>
                <td className="row-actions">
                  <button
                    type="button"
                    className="icon-button row-more"
                    aria-label={`${tr(settings, 'Edit')} ${task.title}`}
                    onClick={() => onEdit(task)}
                  >
                    <Icon name="more" size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!page.rows.length && <div className="empty-mini">{tr(settings, 'No tasks match these filters.')}</div>}
      <div className="table-pager" role="navigation" aria-label={tr(settings, 'Pages')}>
        <span className="results-meta">
          {page.total
            ? tr(settings, 'Showing {first}–{last} of {total} tasks', { first, last, total: page.total })
            : ''}
        </span>
        <button
          type="button"
          className="secondary-button"
          disabled={page.page <= 1}
          onClick={() => onPage(page.page - 1)}
        >
          {tr(settings, 'Previous')}
        </button>
        <span aria-live="polite">{tr(settings, 'Page {page} of {pages}', { page: page.page, pages: page.pages })}</span>
        <button
          type="button"
          className="secondary-button"
          disabled={page.page >= page.pages}
          onClick={() => onPage(page.page + 1)}
        >
          {tr(settings, 'Next')}
        </button>
      </div>
    </div>
  )
}
