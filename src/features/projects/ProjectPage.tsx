// The page a click on a project opens: its numbers, a status bar you can click to filter, and every one of its tasks (found,
// sorted and paged by the database). Add a task right there, change a status in place, print or export the project's report.
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { colorFor, initials } from '../../lib/format'
import { tr, uiLanguage } from '../../lib/i18n'
import { deadlineText } from '../../lib/labels'
import { workflowStateLabels } from '../../lib/settings'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { Avatar, EmptyState, ProgressBar, StatusPill } from '../../ui/primitives'
import { ExportMenu } from '../export/ExportMenu'
import { ProjectTaskTable } from './ProjectTaskTable'
import {
  NO_FILTERS,
  type TaskFilters,
  type TaskSortState,
  hasFilters,
  useProjectDetail,
  useProjectTasks
} from './use-project-data'

interface Props {
  projectId: number
  data: any
  highlight: number | null
  canManage: boolean
  canWriteTasks: boolean
  openModal: (type: string, record?: any) => void
  refresh: () => void
  onBack: () => void
}

export function ProjectPage({
  projectId,
  data,
  highlight,
  canManage,
  canWriteTasks,
  openModal,
  refresh,
  onBack
}: Props) {
  const { settings, notify } = useApp()
  const language = uiLanguage(settings)
  const pageSize = Math.max(10, Number(settings.pageSize) || 50)
  const [filters, setFilters] = useState<TaskFilters>(NO_FILTERS)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<TaskSortState>({ key: 'due', dir: 'asc' })
  const [pageNumber, setPageNumber] = useState(1)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const detail = useProjectDetail(projectId, data.revision)
  const tasks = useProjectTasks(projectId, filters, sort, pageNumber, pageSize, data.revision)

  // A new project starts from a clean slate; the search box waits for a pause in typing before asking the server.
  const appliedQuery = useRef('')
  useEffect(() => {
    appliedQuery.current = ''
    setFilters(NO_FILTERS)
    setSearch('')
    setPageNumber(1)
  }, [projectId])
  useEffect(() => {
    if (search === appliedQuery.current) return
    const timer = setTimeout(() => {
      appliedQuery.current = search
      setFilters(current => ({ ...current, q: search }))
      setPageNumber(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [search])

  const statuses = workflowStateLabels(settings)
  const project = detail.data?.project
  const totals = detail.data?.totals
  const change = (patch: Partial<TaskFilters>) => {
    setFilters(current => ({ ...current, ...patch }))
    setPageNumber(1)
  }
  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter(item => item !== value) : [...list, value]
  const onSort = (key: string) => {
    setSort(current =>
      current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
    setPageNumber(1)
  }
  const afterChange = () => {
    detail.reload()
    tasks.reload()
    refresh()
  }
  const setStatus = async (task: any, status: string) => {
    if (status === task.status) return
    try {
      await api.patch(`/api/tasks/${task.numericId}/status`, { status })
      notify({ title: tr(settings, 'Moved to {status}', { status }), body: task.title, tone: 'success' })
    } catch (error) {
      notify({ title: 'Could not update the task', body: errorMessage(error), tone: 'warning' })
    } finally {
      afterChange()
    }
  }
  const addTask = async (event: React.FormEvent) => {
    event.preventDefault()
    const title = draft.trim()
    if (!title || adding) return
    setAdding(true)
    try {
      await api.post('/api/tasks', { title, projectId })
      setDraft('')
      notify({ title: tr(settings, 'Task added'), body: title, tone: 'success' })
      afterChange()
    } catch (error) {
      notify({ title: 'Could not add the task', body: errorMessage(error), tone: 'warning' })
    } finally {
      setAdding(false)
    }
  }

  // The export request carries the scope the page applied; priorities, owner and state go through the dataset's own scope.
  const taskScope = useMemo(
    () => ({
      projectId,
      ...(filters.priority.length ? { priority: filters.priority.join(',') } : {}),
      ...(filters.status.length > 1 ? { status: filters.status.join(',') } : {}),
      ...(filters.assignee ? { assignee: filters.assignee } : {}),
      ...(filters.scope ? { state: filters.scope } : {}),
      ...(filters.blocked ? { blocked: 'true' } : {})
    }),
    [projectId, filters]
  )
  if (detail.error && !project)
    return (
      <div className="page-content">
        <EmptyState
          title={tr(settings, 'Project not found')}
          message={detail.error}
          action={tr(settings, 'Back to projects')}
          onAction={onBack}
        />
      </div>
    )
  if (!project || !totals)
    return (
      <div className="page-content project-page" aria-busy="true">
        <p className="muted">{tr(settings, 'Loading project…')}</p>
      </div>
    )

  const people = detail.data!.people
  const milestones: any[] = project.milestoneRows || []
  const statusTotal = Math.max(
    1,
    detail.data!.byStatus.reduce((sum, entry) => sum + entry.count, 0)
  )
  const tile = (key: string, label: string, value: number, active: boolean, apply: () => void, tone = '') => (
    <button
      type="button"
      key={key}
      className={`kpi-tile ${tone} ${active ? 'selected' : ''}`}
      aria-pressed={active}
      onClick={apply}
    >
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  )
  return (
    <div className="page-content project-page">
      <nav className="breadcrumb" aria-label={tr(settings, 'Breadcrumb')}>
        <a
          href="#/projects"
          onClick={event => {
            event.preventDefault()
            onBack()
          }}
        >
          {tr(settings, 'Projects')}
        </a>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{project.name}</span>
      </nav>

      <header className="project-hero">
        <div className={`project-symbol symbol-${project.color}`}>{initials(project.name)}</div>
        <div className="project-hero-main">
          <div className="project-hero-title">
            <h1>{project.name}</h1>
            <span className="project-code-chip">{project.code}</span>
            <StatusPill tone={project.health === 'At risk' ? 'at-risk' : 'on-track'}>{project.health}</StatusPill>
          </div>
          {project.description && <p>{project.description}</p>}
          <div className="project-hero-meta">
            <span>
              <Icon name="team" size={13} /> {project.team}
            </span>
            <span>
              <Avatar name={project.owner} color={colorFor(project.owner)} small /> {project.owner}
            </span>
            <span>
              <Icon name="calendar" size={13} /> {deadlineText(project, language, settings)}
            </span>
          </div>
        </div>
        <div className="project-hero-actions">
          <ExportMenu
            dataset="tasks"
            title={`${project.name} · ${tr(settings, 'Tasks')}`}
            scope={taskScope}
            query={filters.q}
            rowsHint={tasks.data?.total ?? totals.total}
          />
          <ExportMenu
            dataset="project-report"
            title={`${project.name} · ${tr(settings, 'Project report')}`}
            scope={{ projectId }}
            primary={false}
            label={tr(settings, 'Project report')}
          />
          {canManage && (
            <button type="button" className="secondary-button" onClick={() => openModal('project', project)}>
              {tr(settings, 'Edit')}
            </button>
          )}
          {canWriteTasks && (
            <button type="button" className="primary-button" onClick={() => openModal('task', { projectId })}>
              <Icon name="plus" size={15} /> {tr(settings, 'Add task')}
            </button>
          )}
        </div>
      </header>

      <section className="kpi-strip" aria-label={tr(settings, 'Project numbers')}>
        <div className="kpi-progress">
          <span>{tr(settings, 'Progress')}</span>
          <strong>{project.progress}%</strong>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={project.progress}
            aria-label={tr(settings, 'Progress')}
          >
            <ProgressBar value={project.progress} color={project.color} />
          </div>
        </div>
        {tile('all', tr(settings, 'All tasks'), totals.total, !hasFilters(filters), () => setFilters(NO_FILTERS))}
        {tile('open', tr(settings, 'Open tasks'), totals.open, filters.scope === 'open', () =>
          change({ scope: filters.scope === 'open' ? '' : 'open' })
        )}
        {tile(
          'done',
          tr(settings, 'Done'),
          totals.done,
          filters.scope === 'done',
          () => change({ scope: filters.scope === 'done' ? '' : 'done' }),
          'good'
        )}
        {tile(
          'overdue',
          tr(settings, 'Overdue'),
          totals.overdue,
          filters.scope === 'overdue',
          () => change({ scope: filters.scope === 'overdue' ? '' : 'overdue' }),
          totals.overdue ? 'bad' : ''
        )}
        {tile(
          'blocked',
          tr(settings, 'Blocked'),
          totals.blocked,
          filters.blocked,
          () => change({ blocked: !filters.blocked }),
          totals.blocked ? 'warn' : ''
        )}
      </section>

      <section className="status-bar" aria-label={tr(settings, 'Tasks by status')}>
        {detail
          .data!.byStatus.filter(entry => entry.count > 0)
          .map(entry => (
            <button
              type="button"
              key={entry.status}
              className={`status-segment ${entry.done ? 'done' : ''} ${filters.status.includes(entry.status) ? 'selected' : ''}`}
              style={{ flexGrow: entry.count / statusTotal }}
              aria-pressed={filters.status.includes(entry.status)}
              title={`${entry.status}: ${entry.count}`}
              onClick={() => change({ status: toggle(filters.status, entry.status) })}
            >
              <span>{entry.status}</span>
              <strong>{entry.count}</strong>
            </button>
          ))}
      </section>

      <div className="project-layout">
        <section className="panel project-tasks-panel">
          <div className="section-head">
            <div>
              <h2>{tr(settings, 'Tasks')}</h2>
              <p>{tr(settings, 'Every task of this project, straight from the database.')}</p>
            </div>
          </div>
          <div className="project-task-toolbar">
            <div className="work-search">
              <Icon name="search" size={15} />
              <input
                aria-label={tr(settings, 'Search this project')}
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder={tr(settings, 'Search this project')}
              />
            </div>
            <select
              aria-label={tr(settings, 'Priority')}
              value={filters.priority[0] || ''}
              onChange={event => change({ priority: event.target.value ? [event.target.value] : [] })}
            >
              <option value="">{tr(settings, 'All priorities')}</option>
              {['High', 'Medium', 'Low'].map(priority => (
                <option key={priority}>{priority}</option>
              ))}
            </select>
            <select
              aria-label={tr(settings, 'Owner')}
              value={filters.assignee}
              onChange={event => change({ assignee: event.target.value })}
            >
              <option value="">{tr(settings, 'Everyone')}</option>
              <option value="me">{tr(settings, 'Assigned to me')}</option>
              <option value="none">{tr(settings, 'Unassigned')}</option>
              {people
                .filter(person => person.personId)
                .map(person => (
                  <option key={person.personId} value={person.personId}>
                    {person.name} ({person.open})
                  </option>
                ))}
            </select>
            {hasFilters(filters) && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  appliedQuery.current = ''
                  setSearch('')
                  setFilters(NO_FILTERS)
                  setPageNumber(1)
                }}
              >
                {tr(settings, 'Clear filters')}
              </button>
            )}
          </div>
          {canWriteTasks && (
            <form className="quick-add" onSubmit={addTask}>
              <input
                aria-label={tr(settings, 'Add a task to this project')}
                placeholder={tr(settings, 'Add a task to this project')}
                value={draft}
                onChange={event => setDraft(event.target.value)}
                maxLength={300}
              />
              <button type="submit" className="secondary-button" disabled={!draft.trim() || adding}>
                <Icon name="plus" size={14} /> {tr(settings, 'Add')}
              </button>
            </form>
          )}
          {tasks.error && (
            <div className="global-error" role="alert">
              <Icon name="warning" size={15} /> {tasks.error}{' '}
              <button type="button" className="text-button" onClick={tasks.reload}>
                {tr(settings, 'Retry')}
              </button>
            </div>
          )}
          {tasks.data ? (
            <div aria-busy={tasks.loading}>
              <ProjectTaskTable
                page={tasks.data}
                statuses={statuses}
                sort={sort}
                onSort={onSort}
                onPage={setPageNumber}
                canWrite={canWriteTasks}
                highlight={highlight}
                onStatus={setStatus}
                onEdit={task => openModal('task', task)}
              />
            </div>
          ) : (
            <p className="muted">{tr(settings, 'Loading tasks…')}</p>
          )}
        </section>

        <aside className="project-side">
          <section className="panel">
            <div className="section-head">
              <h2>{tr(settings, 'Milestones')}</h2>
              {canManage && (
                <button type="button" className="text-button" onClick={() => openModal('milestone', { projectId })}>
                  {tr(settings, 'Add milestone')} <Icon name="plus" size={13} />
                </button>
              )}
            </div>
            {milestones.length ? (
              <ul className="side-list">
                {milestones.map(milestone => (
                  <li key={milestone.id}>
                    <span>{milestone.name}</span>
                    <span className="side-meta">{milestone.dueDate || tr(settings, 'No date')}</span>
                    <StatusPill
                      tone={
                        milestone.status === 'At risk'
                          ? 'at-risk'
                          : milestone.status === 'Complete'
                            ? 'done'
                            : 'on-track'
                      }
                    >
                      {milestone.status}
                    </StatusPill>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-mini">{tr(settings, 'No milestones yet.')}</div>
            )}
          </section>
          <section className="panel">
            <div className="section-head">
              <h2>{tr(settings, 'People')}</h2>
            </div>
            {people.length ? (
              <ul className="side-list">
                {people.map(person => (
                  <li key={person.personId || 'none'}>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => change({ assignee: person.personId || 'none' })}
                    >
                      <Avatar name={person.name} color={person.color} small /> {person.name}
                    </button>
                    <span className="side-meta">
                      {person.open} {tr(settings, 'open')} · {person.done} {tr(settings, 'done')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-mini">{tr(settings, 'Nobody is working on this yet.')}</div>
            )}
          </section>
          {detail.data!.alerts.length > 0 && (
            <section className="panel">
              <div className="section-head">
                <h2>{tr(settings, 'Open alerts')}</h2>
              </div>
              <ul className="side-list">
                {detail.data!.alerts.map(alert => (
                  <li key={alert.id}>
                    <span>{alert.title}</span>
                    <span className="side-meta">{alert.time}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="panel">
            <div className="section-head">
              <h2>{tr(settings, 'Recent activity')}</h2>
            </div>
            {detail.data!.recent.length ? (
              <ul className="side-list timeline-mini">
                {detail.data!.recent.map(event => (
                  <li key={event.id}>
                    <span>
                      <strong>{event.person}</strong> {event.action.toLowerCase()}
                      {event.taskId ? ` · ${event.taskId}` : ''}
                    </span>
                    <span className="side-meta">{event.date}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-mini">{tr(settings, 'Nothing has happened here yet.')}</div>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
