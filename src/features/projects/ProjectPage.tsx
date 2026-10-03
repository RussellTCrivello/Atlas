// The page a click on a project opens: its numbers, a status bar you can click to filter, and every one of its tasks (found,
// sorted and paged by the database). Add a task right there, change a status in place, print or export the project's report.
import { useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { colorFor, initials } from '../../lib/format'
import { tr, uiLanguage } from '../../lib/i18n'
import { deadlineText } from '../../lib/labels'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { Avatar, EmptyState, ProgressBar, StatusPill } from '../../ui/primitives'
import { ExportMenu } from '../export/ExportMenu'
import { TaskGrid, type TaskGridHandle } from '../records/TaskGrid'
import { useProjectDetail } from './use-project-data'
import type { ColumnFilters, FilterValue } from '../../lib/grid-model'

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
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const grid = useRef<TaskGridHandle>(null)
  // What the grid is filtered by, as it reports it: the numbers on top highlight themselves from this and change it through the handle.
  const [filtered, setFiltered] = useState<{ filters: ColumnFilters; hasFilters: boolean }>({
    filters: {},
    hasFilters: false
  })
  const setFilter = (key: string, value: FilterValue) => grid.current?.setFilter(key, value)
  const clearFilters = () => grid.current?.clearFilters()
  const detail = useProjectDetail(projectId, data.revision)
  const project = detail.data?.project
  const totals = detail.data?.totals
  const afterChange = () => {
    detail.reload()
    refresh()
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
  // The numbers on top and the status bar are shortcuts into the grid's filters: they read and set them, they do not keep their own.
  const numbers = (() => {
    const { filters, hasFilters } = filtered
    const state = typeof filters.state === 'string' ? filters.state : ''
    const blocked = filters.blocked === 'true'
    const chosen = Array.isArray(filters.status) ? (filters.status as string[]) : []
    const toggleStatus = (status: string) =>
      setFilter('status', chosen.includes(status) ? chosen.filter(item => item !== status) : [...chosen, status])
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
      <>
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
          {tile('all', tr(settings, 'All tasks'), totals.total, !hasFilters, clearFilters)}
          {tile('open', tr(settings, 'Open tasks'), totals.open, state === 'open', () =>
            setFilter('state', state === 'open' ? '' : 'open')
          )}
          {tile(
            'done',
            tr(settings, 'Done'),
            totals.done,
            state === 'done',
            () => setFilter('state', state === 'done' ? '' : 'done'),
            'good'
          )}
          {tile(
            'overdue',
            tr(settings, 'Overdue'),
            totals.overdue,
            state === 'overdue',
            () => setFilter('state', state === 'overdue' ? '' : 'overdue'),
            totals.overdue ? 'bad' : ''
          )}
          {tile(
            'blocked',
            tr(settings, 'Blocked'),
            totals.blocked,
            blocked,
            () => setFilter('blocked', blocked ? '' : 'true'),
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
                className={`status-segment ${entry.done ? 'done' : ''} ${chosen.includes(entry.status) ? 'selected' : ''}`}
                style={{ flexGrow: entry.count / statusTotal }}
                aria-pressed={chosen.includes(entry.status)}
                title={`${entry.status}: ${entry.count}`}
                onClick={() => toggleStatus(entry.status)}
              >
                <span>{entry.status}</span>
                <strong>{entry.count}</strong>
              </button>
            ))}
        </section>
      </>
    )
  })()
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

      {numbers}

      <div className="project-layout">
        <section className="panel project-tasks-panel">
          <div className="section-head">
            <div>
              <h2>{tr(settings, 'Tasks')}</h2>
              <p>{tr(settings, 'Every task of this project, straight from the database.')}</p>
            </div>
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
          <TaskGrid
            ref={grid}
            scope="project-tasks"
            fixed={{ project: String(projectId) }}
            fullScope={{ projectId }}
            data={data}
            canWrite={canWriteTasks}
            canManage={canManage}
            openModal={openModal}
            refresh={afterChange}
            highlight={highlight}
            hiddenColumns={['project']}
            searchLabel={tr(settings, 'Search this project')}
            tableClass="project-tasks-table"
            exportTitle={`${project.name} · ${tr(settings, 'Tasks')}`}
            addPreset={{ projectId }}
            importProjectId={projectId}
            onFiltersChange={(filters, hasFilters) => setFiltered({ filters, hasFilters })}
          />
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
                      onClick={() => grid.current?.setFilter('assignee', [person.personId || 'none'])}
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
