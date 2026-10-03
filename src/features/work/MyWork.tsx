// The tasks page: board and list views, drag and drop, filters.
import { useState, useMemo, useEffect } from 'react'
import { workflowStateLabels, customFieldDefinitions, hasPermission } from '../../lib/settings'
import { sortRows, applyAdvancedFilters } from '../../lib/filters'
import { api, errorMessage } from '../../lib/api'
import { tr, uiLanguage } from '../../lib/i18n'
import { slug } from '../../lib/format'
import { dueText } from '../../lib/labels'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { AdvancedFilter, FilterChips } from '../export/AdvancedFilter'
import { ExportMenu } from '../export/ExportMenu'
import { TaskGrid } from '../records/TaskGrid'
import { Avatar, EmptyState, PermissionNotice } from '../../ui/primitives'

export function MyWork({ data, openModal, refresh, notify, canWriteTasks = true }) {
  const { user, settings } = useApp()
  const canManageTasks = hasPermission(user, 'manageTasks')
  const pageSize = Math.max(10, Number(settings.pageSize) || 50)
  const hasPerson = Boolean(user?.personId)
  const [view, setView] = useState(settings.defaultTaskView || 'board')
  const [scope, setScope] = useState(hasPerson ? 'mine' : 'all')
  const [filter, setFilter] = useState('All tasks')
  const [query, setQuery] = useState('')
  const [advanced, setAdvanced] = useState([])
  const [sort, setSort] = useState({ key: 'dueDate', dir: 'asc' })
  const [dragId, setDragId] = useState(null)
  const [dragOver, setDragOver] = useState('')
  const [listLimit, setListLimit] = useState(pageSize)
  const [columnLimits, setColumnLimits] = useState({})
  const taskStatuses = workflowStateLabels(settings)
  const fields = [
    { key: 'id', label: 'Task ID' },
    { key: 'title', label: 'Task' },
    { key: 'project', label: 'Project' },
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'assignee', label: 'Owner' },
    { key: 'dueDate', label: 'Due date', type: 'date' },
    { key: 'due', label: 'Due' }
  ]
  const mine = useMemo(
    () => (hasPerson ? data.tasks.filter(t => t.assigneeId === user.personId).length : 0),
    [data.tasks, hasPerson, user?.personId]
  )
  // `filtered` is the complete result: what is on screen is a window onto it, and exports use all of it.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const base = data.tasks.filter(
      t =>
        (scope === 'all' || t.assigneeId === user?.personId) &&
        (filter === 'All tasks' || t.priority === filter) &&
        (!needle || `${t.title} ${t.project} ${t.assignee} ${t.id}`.toLowerCase().includes(needle))
    )
    return sortRows(applyAdvancedFilters(base, advanced), sort)
  }, [data.tasks, scope, filter, query, advanced, sort, user?.personId])
  useEffect(() => {
    setListLimit(pageSize)
    setColumnLimits({})
  }, [scope, filter, query, advanced, sort, pageSize])
  const byStatus = useMemo(() => {
    const groups = Object.fromEntries(taskStatuses.map(status => [status, []]))
    for (const task of filtered as any[]) (groups[task.status] ||= []).push(task)
    return groups
  }, [filtered, taskStatuses.join('|')])
  // Tasks whose status is not (or no longer) part of the workflow still get a column, so nothing silently disappears.
  const columns = [...taskStatuses, ...Object.keys(byStatus).filter(status => !taskStatuses.includes(status))]
  const shown =
    view === 'board'
      ? columns.reduce(
          (sum, status) => sum + Math.min((byStatus[status] || []).length, columnLimits[status] ?? pageSize),
          0
        )
      : Math.min(filtered.length, listLimit)

  const changeStatus = async (task, payload, successTitle) => {
    if (!canWriteTasks) {
      notify({ title: 'Read-only role', body: 'You can view tasks but cannot change workflow state.', tone: 'warning' })
      return
    }
    try {
      await api.patch(`/api/tasks/${task.numericId}/status`, payload)
      notify({ title: successTitle, body: task.title, tone: 'success' })
    } catch (error) {
      notify({ title: 'Could not update the task', body: errorMessage(error), tone: 'warning' })
    } finally {
      refresh()
    }
  }
  const advance = task => changeStatus(task, { advance: true }, 'Task advanced')
  const moveTo = (task, status) =>
    status && status !== task.status ? changeStatus(task, { status }, `Moved to ${status}`) : undefined
  const dropTask = status => {
    const task = data.tasks.find(t => String(t.numericId) === String(dragId))
    setDragId(null)
    setDragOver('')
    if (task) moveTo(task, status)
  }
  const toggleSort = key =>
    setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const customFields = customFieldDefinitions(settings, 'task')
  return (
    <div className="page-content">
      <div className="work-toolbar">
        <div className="view-toggle" role="group" aria-label="View">
          <button
            type="button"
            className={view === 'board' ? 'selected' : ''}
            aria-pressed={view === 'board'}
            onClick={() => setView('board')}
          >
            <Icon name="overview" size={15} /> Board
          </button>
          <button
            type="button"
            className={view === 'list' ? 'selected' : ''}
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
          >
            <Icon name="tasks" size={15} /> List
          </button>
        </div>
        {hasPerson && (
          <div className="view-toggle" role="group" aria-label="Whose tasks">
            <button
              type="button"
              className={scope === 'mine' ? 'selected' : ''}
              aria-pressed={scope === 'mine'}
              onClick={() => setScope('mine')}
            >
              {tr(settings, 'Assigned to me')} ({mine})
            </button>
            <button
              type="button"
              className={scope === 'all' ? 'selected' : ''}
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              {tr(settings, 'Everyone')} ({data.tasks.length})
            </button>
          </div>
        )}
        {view === 'board' && (
          <>
            <div className="work-search">
              <Icon name="search" size={15} />
              <input
                aria-label="Filter tasks"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filter tasks"
              />
            </div>
            <select aria-label="Priority" value={filter} onChange={e => setFilter(e.target.value)}>
              <option>All tasks</option>
              <option>High</option>
              <option>Medium</option>
              <option>Low</option>
            </select>
            <AdvancedFilter filterKey="tasks" fields={fields} onApply={setAdvanced} />
            <ExportMenu
              dataset="tasks"
              title="Atlas tasks"
              scope={{
                ...(scope === 'mine' ? { assignee: 'me' } : {}),
                ...(filter !== 'All tasks' ? { priority: filter } : {})
              }}
              filters={advanced}
              query={query}
              sort={sort}
              rowsHint={filtered.length}
            />
          </>
        )}
        {canWriteTasks ? (
          <button type="button" className="primary-button" onClick={() => openModal('task')}>
            <Icon name="plus" size={15} /> Add task
          </button>
        ) : (
          <span className="readonly-pill">Read-only</span>
        )}
      </div>
      {view === 'board' && (
        <>
          <FilterChips
            conditions={advanced}
            fields={fields}
            onClear={() => setAdvanced([])}
            onRemove={i => setAdvanced(c => c.filter((_, idx) => idx !== i))}
          />
          <div className="results-meta" role="status" aria-live="polite">
            {tr(settings, 'Showing {shown} of {total} matching tasks', { shown, total: filtered.length })}
            {filtered.length !== data.tasks.length &&
              ` · ${tr(settings, '{total} in the workspace', { total: data.tasks.length })}`}
            {canWriteTasks &&
              view === 'board' &&
              ` · ${tr(settings, 'drag cards or use “Move to” to change workflow state')}`}
          </div>
        </>
      )}
      {view === 'board' ? (
        <div className="board">
          {columns.map(status => {
            const list = byStatus[status] || []
            const limit = columnLimits[status] ?? pageSize
            return (
              <section
                className={`board-column column-${slug(status)} ${dragOver === status ? 'drag-over' : ''}`}
                key={status}
                aria-label={`${status}: ${list.length}`}
                onDragOver={e => {
                  e.preventDefault()
                  setDragOver(status)
                }}
                onDragLeave={() => setDragOver('')}
                onDrop={() => dropTask(status)}
              >
                <div className="board-column-head">
                  <span className="column-dot" />
                  <strong>{status}</strong>
                  <span className="column-count">{list.length}</span>
                </div>
                <div className="board-cards">
                  {list.slice(0, limit).map(t => (
                    <TaskCard
                      task={t}
                      key={t.numericId}
                      statuses={taskStatuses}
                      onAdvance={canWriteTasks ? () => advance(t) : null}
                      onMove={canWriteTasks ? next => moveTo(t, next) : null}
                      onEdit={canWriteTasks ? () => openModal('task', t) : null}
                      onDragStart={canWriteTasks ? () => setDragId(t.numericId) : null}
                      dragging={String(dragId) === String(t.numericId)}
                    />
                  ))}
                  {list.length > limit && (
                    <button
                      type="button"
                      className="text-button show-more"
                      onClick={() => setColumnLimits(c => ({ ...c, [status]: limit + pageSize }))}
                    >
                      {tr(settings, 'Show {count} more ({remaining} left)', {
                        count: Math.min(pageSize, list.length - limit),
                        remaining: list.length - limit
                      })}
                    </button>
                  )}
                </div>
                {canWriteTasks && (
                  <button type="button" className="add-column-task" onClick={() => openModal('task', { status })}>
                    <Icon name="plus" size={13} /> Add task
                  </button>
                )}
              </section>
            )
          })}
        </div>
      ) : (
        <TaskGrid
          scope="my-work"
          fixed={scope === 'mine' ? { assignee: 'me' } : {}}
          fullScope={{}}
          data={data}
          canWrite={canWriteTasks}
          canManage={canManageTasks}
          openModal={openModal}
          refresh={refresh}
          exportTitle={scope === 'mine' ? 'My tasks' : 'Atlas tasks'}
          tableClass="task-table-panel"
        />
      )}
      {!canWriteTasks && (
        <PermissionNotice>
          Your role can inspect tasks, filters, exports, and reports, but cannot change workflow state.
        </PermissionNotice>
      )}
      {view === 'board' && !filtered.length && (
        <EmptyState
          title="No tasks match"
          message={
            scope === 'mine' && data.tasks.length > 0
              ? 'Nothing is assigned to you. Switch to “Everyone” to see the whole workspace.'
              : canWriteTasks
                ? 'Clear filters or add a new task.'
                : 'Clear filters to see more tasks.'
          }
          action={canWriteTasks ? 'Add task' : ''}
          onAction={canWriteTasks ? () => openModal('task') : undefined}
        />
      )}
    </div>
  )
}

export function TaskCard({ task, statuses = [], onAdvance, onMove, onEdit, onDragStart, dragging }) {
  const { settings } = useApp()
  const language = uiLanguage(settings)
  return (
    <article
      className={`board-card ${dragging ? 'dragging' : ''}`}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      tabIndex={0}
      aria-label={`${task.id}: ${task.title}`}
      onKeyDown={e => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && onEdit) {
          e.preventDefault()
          onEdit()
        }
      }}
    >
      <div className="board-card-top">
        <span className={`priority-dot priority-dot-${task.priority.toLowerCase()}`} title={task.priority} />
        <span className="task-id">{task.id}</span>
        {onAdvance && !task.done && (
          <button
            type="button"
            className="icon-button subtle"
            aria-label={tr(settings, 'Advance {title} to the next status', { title: task.title })}
            title={tr(settings, 'Advance to the next status')}
            onClick={onAdvance}
          >
            <Icon name="arrow" size={14} />
          </button>
        )}
        {onEdit && (
          <button type="button" className="icon-button subtle" aria-label={`Edit ${task.title}`} onClick={onEdit}>
            <Icon name="more" size={15} />
          </button>
        )}
      </div>
      <h3>{task.title}</h3>
      <div className="board-card-project">
        <span className="mini-project" />
        {task.project}
      </div>
      <div className="board-card-bottom">
        <span className={`due-${task.dueTone}`}>
          <Icon name="calendar" size={13} /> {dueText(task, language, settings)}
        </span>
        <Avatar name={task.assignee} color={task.assigneeColor} small />
      </div>
      {onMove && (
        <select
          className="card-move"
          aria-label={tr(settings, 'Move {title} to', { title: task.title })}
          value={task.status}
          onChange={e => onMove(e.target.value)}
        >
          {statuses.map(status => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      )}
    </article>
  )
}
