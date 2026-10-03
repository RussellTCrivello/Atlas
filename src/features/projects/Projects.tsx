// The projects page: the list of project cards and milestones, or (when a project is open) that project's page.
import { useState } from 'react'
import { applyAdvancedFilters } from '../../lib/filters'
import { localDate, initials } from '../../lib/format'
import { uiLanguage, tr } from '../../lib/i18n'
import { deadlineText } from '../../lib/labels'
import { useApp } from '../../ui/app-context'
import { AdvancedFilter, FilterChips } from '../export/AdvancedFilter'
import { ExportMenu } from '../export/ExportMenu'
import { Icon } from '../../ui/icons'
import { Avatar, EmptyState, ProgressBar, StatusPill } from '../../ui/primitives'
import { projectHash } from '../../app/routes'
import { EntityGrid } from '../records/EntityGrid'
import { type EntityContext, projectActions, projectKind } from '../records/entities'
import { ViewSwitch, useViewMode } from '../records/ViewSwitch'
import { ProjectPage } from './ProjectPage'

/** `#/projects` shows the list; `#/projects/12` shows project 12 with all of its tasks. */
export function Projects({
  data,
  openModal,
  canManage,
  projectId = null,
  highlight = null,
  canWriteTasks = false,
  refresh = () => {},
  onBack = () => {},
  onDelete = () => {}
}: any) {
  return projectId ? (
    <ProjectPage
      projectId={projectId}
      data={data}
      highlight={highlight}
      canManage={canManage}
      canWriteTasks={canWriteTasks}
      openModal={openModal}
      refresh={refresh}
      onBack={onBack}
    />
  ) : (
    <ProjectList data={data} openModal={openModal} canManage={canManage} refresh={refresh} onDelete={onDelete} />
  )
}

function ProjectList({ data, openModal, canManage, refresh, onDelete }) {
  const { settings, notify } = useApp()
  const [mode, setMode] = useViewMode('projects')
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const entity: EntityContext = {
    data,
    settings,
    t,
    notify,
    openModal,
    deleteOne: (_type, record) => onDelete('project', record),
    refresh,
    can: { manageProjects: canManage }
  }
  const columns = [
    { key: 'name', label: 'Project' },
    { key: 'code', label: 'Code' },
    { key: 'team', label: 'Team' },
    { key: 'health', label: 'Health' },
    { key: 'progress', label: 'Progress' },
    { key: 'deadline', label: 'Deadline' }
  ]
  const milestoneColumns = [
    { key: 'name', label: 'Milestone' },
    { key: 'project.name', label: 'Project' },
    { key: 'status', label: 'Status' },
    { key: 'dueDate', label: 'Due date' }
  ]
  const [filter, setFilter] = useState('All projects')
  const [advanced, setAdvanced] = useState([])
  const rows = applyAdvancedFilters(
    data.projects.filter(p => filter === 'All projects' || p.health === filter),
    advanced
  )
  const milestones = data.projects.flatMap(p => p.milestoneRows.map(m => ({ ...m, project: p })))
  const milestoneClosed = m => m.status === 'Complete' || m.status === 'Completed'
  // Open milestones first, soonest due date first (undated last); finished ones after them.
  const orderedMilestones = [...milestones].sort(
    (a, b) =>
      Number(milestoneClosed(a)) - Number(milestoneClosed(b)) ||
      (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') ||
      String(a.name).localeCompare(String(b.name))
  )
  const [visibleMilestones, setVisibleMilestones] = useState(8)
  return (
    <div className="page-content">
      <div className="toolbar view-switch-bar">
        <ViewSwitch mode={mode} onChange={setMode} />
      </div>
      {mode === 'table' ? (
        <EntityGrid kind={projectKind(entity)} rows={data.projects} actions={projectActions(entity, () => refresh())} />
      ) : (
        <>
          <div className="toolbar">
            <div className="filter-tabs">
              {['All projects', 'On track', 'At risk', 'Completed'].map(tab => (
                <button key={tab} className={filter === tab ? 'selected' : ''} onClick={() => setFilter(tab)}>
                  {tab}
                  <span>
                    {tab === 'All projects' ? data.projects.length : data.projects.filter(p => p.health === tab).length}
                  </span>
                </button>
              ))}
            </div>
            <div className="toolbar-actions">
              <AdvancedFilter filterKey="projects" fields={columns} onApply={setAdvanced} />
              <ExportMenu
                dataset="projects"
                title="Atlas projects"
                scope={filter === 'All projects' ? {} : { health: filter }}
                filters={advanced}
                rowsHint={rows.length}
              />
              {canManage && (
                <button className="primary-button" onClick={() => openModal('project')}>
                  <Icon name="plus" size={15} /> New project
                </button>
              )}
            </div>
          </div>
          <FilterChips
            conditions={advanced}
            fields={columns}
            onClear={() => setAdvanced([])}
            onRemove={i => setAdvanced(c => c.filter((_, idx) => idx !== i))}
          />
          <div className="results-meta">
            <strong>{rows.length}</strong> projects · {filter}
          </div>
          <div className="project-grid">
            {rows.map(p => (
              <ProjectCard project={p} key={p.numericId} onEdit={canManage ? () => openModal('project', p) : null} />
            ))}
          </div>
          {!rows.length && (
            <EmptyState
              title="No projects match"
              message="Clear filters or create a new project."
              action="Create project"
              onAction={() => openModal('project')}
            />
          )}
        </>
      )}
      <section className="panel project-table">
        <div className="section-head">
          <div>
            <h2>Upcoming milestones</h2>
            <p>Keep meaningful moments in sight.</p>
          </div>
          <div className="milestone-actions">
            <ExportMenu dataset="milestones" title="Atlas milestones" primary={false} rowsHint={milestones.length} />
            {canManage && (
              <button className="text-button" onClick={() => openModal('milestone')}>
                Add milestone <Icon name="plus" size={13} />
              </button>
            )}
          </div>
        </div>
        <div className="milestone-list">
          {orderedMilestones.slice(0, visibleMilestones).map(m => (
            <div
              className="milestone-row"
              key={m.id}
              {...(canManage
                ? {
                    role: 'button',
                    tabIndex: 0,
                    onClick: () => openModal('milestone', m),
                    onKeyDown: e =>
                      (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openModal('milestone', m))
                  }
                : {})}
            >
              <div className={`milestone-date ${m.status === 'At risk' ? 'date-warning' : ''}`}>
                <strong>{m.dueDate?.slice(-2) || '—'}</strong>
                <span>{localDate(m.dueDate, uiLanguage(settings), { month: 'short' })}</span>
              </div>
              <div className="milestone-copy">
                <strong>{m.name}</strong>
                <span>
                  {m.project.name} · {m.project.owner}
                </span>
              </div>
              <StatusPill tone={m.status === 'At risk' ? 'at-risk' : m.status === 'Complete' ? 'done' : 'on-track'}>
                {m.status}
              </StatusPill>
            </div>
          ))}
        </div>
        {orderedMilestones.length > visibleMilestones && (
          <button type="button" className="text-button show-more" onClick={() => setVisibleMilestones(v => v + 8)}>
            {tr(settings, 'Show {count} more ({remaining} left)', {
              count: Math.min(8, orderedMilestones.length - visibleMilestones),
              remaining: orderedMilestones.length - visibleMilestones
            })}
          </button>
        )}
      </section>
    </div>
  )
}

export function ProjectCard({ project, onEdit }) {
  const { settings } = useApp()
  return (
    <article className="project-card">
      <div className="project-card-top">
        <div className={`project-symbol symbol-${project.color}`}>{initials(project.name)}</div>
        {onEdit && (
          <button aria-label="Edit" className="icon-button subtle" onClick={onEdit}>
            <Icon name="more" size={16} />
          </button>
        )}
      </div>
      <div className="project-card-code">
        {project.code} · {project.team}
      </div>
      <h3>
        <a
          className="project-card-link"
          href={projectHash(project.numericId)}
          aria-label={`${project.name}: ${tr(settings, 'Open project')}`}
        >
          {project.name}
        </a>
      </h3>
      <p>{project.description}</p>
      <div className="project-card-meta">
        <StatusPill tone={project.health === 'At risk' ? 'at-risk' : 'on-track'}>{project.health}</StatusPill>
        <span>{project.progress}% complete</span>
      </div>
      <ProgressBar value={project.progress} color={project.color} />
      <div className="project-card-bottom">
        <span>
          <Icon name="calendar" size={13} /> {deadlineText(project, uiLanguage(settings), settings)}
        </span>
        <span className="avatar-stack">
          {project.members.map(m => (
            <Avatar name={m} key={m} color={project.memberColors?.[m]} small />
          ))}
        </span>
      </div>
    </article>
  )
}
