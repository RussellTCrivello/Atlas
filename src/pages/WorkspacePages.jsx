import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client.js'
import { Icon } from '../components/Icon.jsx'
import { Avatar, EmptyState, PermissionNotice, ProgressBar, StatusPill } from '../components/common.jsx'
import { LazyExportMenu as ExportMenu } from '../components/exports/LazyExportMenu.jsx'
import { AdvancedFilter } from '../components/filters/AdvancedFilter.jsx'
import { FilterChips } from '../components/filters/FilterChips.jsx'
import { RecordTable } from '../components/table/RecordTable.jsx'
import { actionVisible, applyAdvancedFilters, configuredColumns, sortRows } from '../lib/advanced-filters.js'
import { initials, slug } from '../lib/strings.js'
import { workflowStateLabels } from '../lib/workflows.js'
import { translateUiText } from '../i18n/catalog.js'
import { formatLocalizedDate } from '../lib/localization.js'

const uiText = (settings, value) => translateUiText(settings, value)
const formattedCount = (settings, value) => new Intl.NumberFormat(settings?.localization?.defaultLanguage || 'en').format(Number(value) || 0)
function localizedSystemDate(settings, value, emptyLabel = 'No date', options = {}) {
  if (!value || value === 'No date') return uiText(settings, emptyLabel)
  return formatLocalizedDate(value, settings, options)
}
function localizedDateParts(settings, value) {
  if (!value) return { day: '—', month: '' }
  const raw = String(value)
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const date = dateOnly ? new Date(`${raw}T12:00:00Z`) : new Date(raw)
  if (!Number.isFinite(date.getTime())) return { day: '—', month: '' }
  const locale = settings?.localization?.defaultLanguage || settings?.language || 'en'
  return {
    day: new Intl.NumberFormat(locale).format(date.getUTCDate()),
    month: new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(date)
  }
}
function localizedTaskDue(settings, value, dateValue) {
  const text = String(value || '')
  if (['Today', 'Tomorrow', 'No date'].includes(text)) return uiText(settings, text)
  const late = /^(\d+)d late$/.exec(text)
  if (late) return `${formattedCount(settings, late[1])} ${uiText(settings, 'days late')}`
  if (dateValue) return localizedSystemDate(settings, dateValue)
  return uiText(settings, text)
}
function localizedProjectDays(settings, value) {
  if (value === 'No date') return uiText(settings, value)
  const late = /^(\d+) days late$/.exec(String(value || ''))
  if (late) return `${formattedCount(settings, late[1])} ${uiText(settings, 'days late')}`
  const days = /^(\d+) days$/.exec(String(value || ''))
  if (days) return `${formattedCount(settings, days[1])} ${uiText(settings, 'days')}`
  return uiText(settings, value || '')
}

function StatCard({ settings, label, value, detail, icon, color, onClick }) { const displayValue = typeof value === 'number' ? formattedCount(settings, value) : value; return <button className="stat-card" onClick={onClick}><div className="stat-card-top"><span className={`stat-icon stat-${color}`}><Icon name={icon} size={18}/></span><span className="stat-kicker">{label}</span><Icon name="arrow" size={14} className="stat-arrow"/></div><div className="stat-value" data-no-i18n>{displayValue}</div><div className="stat-foot"><span className="delta">Live</span><span>{detail}</span></div></button> }
function Overview({ data, setPage }) {
  const s = data.dashboard.stats || {}
  const pulse = data.dashboard.dailyPulse || {}
  const widgets = data.settings?.interface?.dashboardLayouts?.overview || ['stats', 'dailyPulse', 'projectHealth', 'myFocus']
  const enabled = key => widgets.includes(key)
  return <><div className="welcome-row"><div><span className="eyebrow"><span className="eyebrow-dot"/> <span data-no-i18n>{formatLocalizedDate(data.today, data.settings)}</span></span><h2>Today at a glance.</h2></div><button className="secondary-button" onClick={() => setPage('activity')}><Icon name="activity" size={16}/> View activity</button></div>
    {enabled('stats') && <div className="stat-grid"><StatCard settings={data.settings} label="Active projects" value={s.activeProjects || 0} detail="from local store" icon="projects" color="purple" onClick={() => setPage('projects')}/><StatCard settings={data.settings} label="Open tasks" value={s.openTasks || 0} detail="not yet done" icon="tasks" color="blue" onClick={() => setPage('tasks')}/><StatCard settings={data.settings} label="Needs attention" value={s.needsAttention || 0} detail="open alerts" icon="alerts" color="orange" onClick={() => setPage('alerts')}/><StatCard settings={data.settings} label="On track" value={`${formattedCount(data.settings, s.onTrack || 0)}%`} detail="healthy projects" icon="bolt" color="green" onClick={() => setPage('reports')}/></div>}
    {enabled('dailyPulse') && <><div className="section-head dashboard-section-head"><div><h2>Daily pulse</h2><p>Updates, blockers, and next steps.</p></div><button className="date-select"><Icon name="calendar" size={15}/> Today</button></div><div className="daily-grid"><ActivityCard title="Yesterday" subtitle="From daily updates" tone="blue" items={pulse.yesterday || []}/><ActivityCard title="Today" subtitle={`${(pulse.today || []).length} focus items`} tone="purple" items={pulse.today || []}/><ActivityCard title="Blocked" subtitle={`${(pulse.blocked || []).length} blockers`} tone="orange" items={pulse.blocked || []}/></div></>}
    {(enabled('projectHealth') || enabled('myFocus')) && <div className="split-section">{enabled('projectHealth') && <section className="panel project-panel"><div className="section-head"><div><h2>Project health</h2><p>Current plan.</p></div><button className="text-button" onClick={() => setPage('projects')}>View all <Icon name="arrow" size={13}/></button></div><div className="project-list">{data.projects.slice(0, 4).map(project => <ProjectHealthRow project={project} settings={data.settings} key={project.numericId}/>)}</div></section>}{enabled('myFocus') && <section className="panel focus-panel"><div className="section-head"><div><h2>My focus</h2><p>Next actions.</p></div><Icon name="spark" size={17} className="muted-icon"/></div><div className="focus-list">{data.dashboard.myTasks?.slice(0, 5).map(task => <TaskRow task={task} settings={data.settings} key={task.numericId} compact/>)}</div><button className="full-width-button" onClick={() => setPage('tasks')}>Open my work <Icon name="arrow" size={13}/></button></section>}</div>}
    {!widgets.length && <EmptyState title="Dashboard is empty" message="Enable widgets from Settings → Appearance."/>}</>
}

function ActivityCard({ title, subtitle, items, tone }) { return <section className={`activity-card activity-${tone}`}><div className="section-head compact"><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="activity-items">{items.map((item, i) => <div className="activity-item" key={i}><span className="activity-marker"><Icon name={item.icon || 'check'} size={13}/></span><div className="activity-copy"><strong data-no-i18n>{item.title}</strong><p data-no-i18n>{item.detail}</p></div><span className="activity-time" data-no-i18n>{item.time}</span></div>)}</div>{!items.length && <div className="empty-mini">Nothing here yet.</div>}</section> }
function ProjectHealthRow({ project, settings }) { return <div className="project-health-row"><div className={`project-symbol symbol-${project.color}`} data-no-i18n>{initials(project.name)}</div><div className="project-health-main"><div className="project-row-title"><strong data-no-i18n>{project.name}</strong><StatusPill tone={project.health === 'At risk' ? 'at-risk' : 'on-track'}>{project.health}</StatusPill></div><ProgressBar value={project.progress} color={project.color}/></div><div className="project-percent">{formattedCount(settings, project.progress)}%</div><div className="project-deadline"><span>Deadline</span><strong data-no-i18n>{localizedSystemDate(settings, project.deadlineDate || project.deadline)}</strong></div></div> }
function taskGridTemplate(columns) {
  const widths = { id: 'minmax(65px,.75fr)', title: 'minmax(150px,2fr)', project: 'minmax(100px,1.2fr)', status: 'minmax(90px,1fr)', priority: 'minmax(70px,.7fr)', assignee: 'minmax(105px,1fr)', due: 'minmax(80px,.8fr)' }
  return ['28px', ...(columns || []).map(column => widths[column.key] || 'minmax(70px,1fr)'), '28px'].join(' ')
}
function TaskRow({ task, compact, onAdvance, onEdit, visibleColumns, settings }) {
  const terminalStatuses = (settings?.workflows?.task?.states || []).filter(state => state?.terminal).map(state => state.label || state.name)
  const isTerminal = terminalStatuses.includes(task.status)
  const status = <StatusPill tone={slug(task.status)}>{task.status}</StatusPill>
  const dueText = localizedTaskDue(settings, task.due, task.dueDate)
  if (compact) return <div className="task-row task-row-compact"><button disabled={!onAdvance} className={`task-check task-${slug(task.status)}`} onClick={() => onAdvance?.(task)} aria-label={`${uiText(settings, 'Advance')} ${task.title}`}><Icon name={isTerminal ? 'check' : 'bolt'} size={13}/></button><div className="task-row-main"><strong data-no-i18n>{task.title}</strong><div><span className="task-project" data-no-i18n>{task.project}</span><span className="task-id" data-no-i18n>{task.id}</span></div></div>{status}<span className={`task-due due-${task.dueTone}`} data-no-i18n>{dueText}</span></div>
  const columns = visibleColumns?.length ? visibleColumns : [{ key: 'title' }, { key: 'project' }, { key: 'status' }, { key: 'priority' }, { key: 'assignee' }, { key: 'due' }, { key: 'id' }]
  const cells = {
    id: <span className="task-id" data-no-i18n>{task.id}</span>,
    title: <strong className="task-row-title" data-no-i18n>{task.title}</strong>,
    project: <span className="task-project" data-no-i18n>{task.project}</span>,
    status,
    priority: <span className={`priority priority-${String(task.priority).toLowerCase()}`}>{task.priority}</span>,
    assignee: <span className="task-assignee"><Avatar name={task.assignee} color={task.assigneeColor} small/><span data-no-i18n>{task.assignee}</span></span>,
    due: <span className={`task-due due-${task.dueTone}`} data-no-i18n>{dueText}</span>
  }
  return <div className="task-row" style={{ gridTemplateColumns: taskGridTemplate(columns) }}><button disabled={!onAdvance} className={`task-check task-${slug(task.status)}`} onClick={() => onAdvance?.(task)} aria-label={`${uiText(settings, 'Advance')} ${task.title}`}><Icon name={isTerminal ? 'check' : 'bolt'} size={13}/></button>{columns.map(column => <span className={`task-row-cell task-cell-${column.key}`} key={column.key}>{cells[column.key] || ''}</span>)}{onEdit && <button className="icon-button row-more" onClick={() => onEdit(task)} aria-label={`${uiText(settings, 'Edit')} ${task.title}`}><Icon name="more" size={16}/></button>}</div>
}
function Projects({ data, openModal, canManage, canManageTasks = false, canExport = true, setPage, userId = '', deleteRecord, bulkEditRecords, bulkDeleteRecords, importRecords, importMilestones, inlineEditRecord, inlineEditMilestone, notify }) {
  const columns = configuredColumns(data.settings, 'projects', [
    { key: 'name', label: 'Project' }, { key: 'code', label: 'Code' }, { key: 'team', label: 'Team' },
    { key: 'health', label: 'Health' }, { key: 'progress', label: 'Progress' }, { key: 'deadline', label: 'Deadline' }
  ])
  const canCreate = canManage && actionVisible(data.settings, 'create')
  const canEdit = canManage && actionVisible(data.settings, 'edit')
  const canCreateTask = canManageTasks && actionVisible(data.settings, 'create')
  const milestoneColumns = [
    { key: 'name', label: 'Milestone' }, { key: 'project.name', label: 'Project' },
    { key: 'status', label: 'Status' }, { key: 'dueDate', label: 'Due date' }
  ]
  const tableColumns = columns.map(column => ({
    ...column,
    type: column.key === 'progress' ? 'percent' : column.key === 'deadline' ? 'date' : 'text',
    getValue: row => column.key === 'deadline' ? row.deadlineDate || '' : row[column.key],
    inlineEditable: column.key === 'status' || column.key === 'health' ? canEdit : false,
    ...(['status', 'health'].includes(column.key) ? { inlineOptions: ['On track', 'At risk', 'Completed'] } : {})
  }))
  const projectBulkFields = [
    { key: 'status', label: 'Status', type: 'select', options: ['On track', 'At risk', 'Completed'] },
    { key: 'teamId', label: 'Team', type: 'select', options: data.teams.map(team => [team.id, team.name]) },
    { key: 'ownerId', label: 'Owner', type: 'select', options: data.people.map(person => [person.id, person.name]) }
  ]
  const projectImportFields = [
    { key: 'name', label: 'Project name' }, { key: 'code', label: 'Project code' }, { key: 'description', label: 'Description' },
    { key: 'teamId', label: 'Team ID' }, { key: 'ownerId', label: 'Owner ID' }, { key: 'status', label: 'Status' },
    { key: 'deadline', label: 'Deadline', type: 'date' }, { key: 'color', label: 'Color' }
  ]
  const milestoneBulkFields = [
    { key: 'status', label: 'Status', type: 'select', options: ['Upcoming', 'At risk', 'Complete'] },
    { key: 'projectId', label: 'Project', type: 'select', options: data.projects.map(project => [project.numericId, project.name]) }
  ]
  const milestoneImportFields = [
    { key: 'name', label: 'Milestone name' }, { key: 'projectId', label: 'Project ID' },
    { key: 'dueDate', label: 'Due date', type: 'date' }, { key: 'status', label: 'Status' }
  ]
  const [filter, setFilter] = useState('All projects')
  const [projectView, setProjectView] = useState('cards')
  const [milestoneView, setMilestoneView] = useState('list')
  const [advanced, setAdvanced] = useState([])
  const [activeProjectId, setActiveProjectId] = useState(null)
  const [projectDetails, setProjectDetails] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [detailRefresh, setDetailRefresh] = useState(0)
  const rows = applyAdvancedFilters(data.projects.filter(project => filter === 'All projects' || project.health === filter), advanced)
  const milestones = data.projects.flatMap(project => project.milestoneRows.map(milestone => ({ ...milestone, project })))
  const taskCountsByProject = new Map()
  data.tasks.forEach(task => {
    const key = String(task.projectId)
    taskCountsByProject.set(key, (taskCountsByProject.get(key) || 0) + 1)
  })
  const selectedProject = data.projects.find(project => String(project.numericId) === String(activeProjectId))

  const showProject = project => {
    setActiveProjectId(project.numericId)
    setProjectDetails(current => String(current?.project?.numericId) === String(project.numericId) ? current : null)
    setDetailError('')
    setDetailRefresh(current => current + 1)
  }
  useEffect(() => {
    if (activeProjectId === null) return undefined
    const project = data.projects.find(row => String(row.numericId) === String(activeProjectId))
    if (!project) {
      setProjectDetails(null)
      setDetailLoading(false)
      setDetailError('This project is no longer available in the database.')
      return undefined
    }
    let current = true
    setDetailLoading(true)
    setDetailError('')
    api.get(`/api/projects/${encodeURIComponent(project.numericId)}/tasks`)
      .then(response => { if (current) setProjectDetails(response) })
      .catch(error => { if (current) setDetailError(error.message || 'Project tasks could not be loaded from the database.') })
      .finally(() => { if (current) setDetailLoading(false) })
    return () => { current = false }
  }, [activeProjectId, detailRefresh, data.projects, data.tasks])

  if (activeProjectId !== null) return <ProjectDetailsView
    project={projectDetails?.project || selectedProject}
    tasks={projectDetails?.tasks || []}
    milestones={projectDetails?.milestones || []}
    loading={detailLoading}
    error={detailError}
    onRetry={() => selectedProject && showProject(selectedProject)}
    onBack={() => { setActiveProjectId(null); setProjectDetails(null); setDetailError('') }}
    onEditProject={canEdit ? project => openModal('project', project) : null}
    onEditTask={canManageTasks && actionVisible(data.settings, 'edit') ? task => openModal('task', task) : null}
    onCreateTask={canCreateTask ? project => openModal('task', { projectId: project.numericId }) : null}
    canExport={canExport}
    settings={data.settings}
    setPage={setPage}
  />

  return <div className="page-content">
    <div className="toolbar"><div className="filter-tabs">{['All projects','On track','At risk','Completed'].map(tab => <button key={tab} className={filter === tab ? 'selected' : ''} onClick={() => setFilter(tab)}>{tab}<span>{tab === 'All projects' ? data.projects.length : data.projects.filter(project => project.health === tab).length}</span></button>)}</div><div className="toolbar-actions"><div className="view-toggle"><button className={projectView === 'cards' ? 'selected' : ''} onClick={() => setProjectView('cards')}>Cards</button><button className={projectView === 'table' ? 'selected' : ''} onClick={() => setProjectView('table')}>Table</button></div><AdvancedFilter settings={data.settings} filterKey="projects" fields={columns} onApply={setAdvanced} appliedConditions={advanced}/>{projectView === 'cards' && <ExportMenu dataset="projects" rows={rows} columns={columns} title="Atlas projects" settings={data.settings} canExport={canExport} canPrint={canExport} exportScopes={{ selected: [], filtered: rows, all: data.projects }}/>}{projectView === 'cards' && canCreate && <button className="primary-button" onClick={() => openModal('project')}><Icon name="plus" size={15}/> New project</button>}</div></div>
    <FilterChips filterKey="projects" conditions={advanced} fields={columns} onChange={setAdvanced}/>
    {projectView === 'cards' && <div className="results-meta"><strong>{rows.length}</strong> projects · {filter}<span>Open a project to see its complete task portfolio.</span></div>}
    {projectView === 'cards' ? <>
      <div className="project-grid">{rows.map(project => <ProjectCard
        project={project}
        key={project.numericId}
        settings={data.settings}
        taskCount={taskCountsByProject.get(String(project.numericId)) || 0}
        onOpen={() => showProject(project)}
        onEdit={canEdit ? () => openModal('project', project) : null}
      />)}</div>
      {!rows.length && <EmptyState title="No projects match" message="Clear filters or create a new project." action={canCreate ? 'Create project' : undefined} onAction={canCreate ? () => openModal('project') : undefined}/>}
    </> : <RecordTable
      entity="projects" title="Projects" totalRecordCount={data.projects.length} records={data.projects.filter(project => filter === 'All projects' || project.health === filter)} columns={tableColumns}
      dataset="projects" settings={data.settings} userId={userId} canCreate={canCreate} canEdit={canEdit}
      canDelete={canManage && actionVisible(data.settings, 'delete')} canImport={canCreate} canExport={canExport}
      onCreate={() => openModal('project')} onOpen={showProject} onEdit={project => openModal('project', project)}
      onDuplicate={project => openModal('project', { ...project, numericId: undefined, id: undefined, name: `Copy of ${project.name}`, code: '' })}
      onDelete={(project, options) => deleteRecord?.('project', project, options)}
      getDeleteImpact={project => `${taskCountsByProject.get(String(project.numericId)) || 0} linked tasks, their work dependencies, and related alerts will also be removed.`}
      getBulkDeleteImpact={projects => { const projectIds = new Set(projects.map(project => String(project.numericId))); const taskIds = new Set(data.tasks.filter(task => projectIds.has(String(task.projectId))).map(task => String(task.numericId))); const taskCount = taskIds.size; const alertCount = data.alerts.filter(alert => projectIds.has(String(alert.projectId || '')) || taskIds.has(String(alert.taskId || ''))).length; return `${taskCount} linked tasks and ${alertCount} related alerts will also be removed with these projects.` }}
      onBulkEdit={payload => bulkEditRecords?.('project', payload)}
      onBulkDelete={payload => bulkDeleteRecords?.('project', payload)}
      onImport={importRecords} onInlineEdit={(project, field, value) => inlineEditRecord?.(project, field === 'health' ? 'status' : field, value)} bulkFields={projectBulkFields} importFields={projectImportFields}
      advancedFilter={false} advancedConditions={advanced} onAdvancedChange={setAdvanced} notify={notify}
      emptyTitle="No projects in this workspace" emptyMessage="Create a project or import project records."/>}
    <section className="panel project-table">
      <div className="section-head"><div><h2>Upcoming milestones</h2><p>Keep meaningful moments in sight.</p></div><div className="milestone-actions"><div className="view-toggle"><button className={milestoneView === 'list' ? 'selected' : ''} onClick={() => setMilestoneView('list')}>List</button><button className={milestoneView === 'table' ? 'selected' : ''} onClick={() => setMilestoneView('table')}>Table</button></div>{milestoneView === 'list' && <ExportMenu dataset="milestones" rows={milestones} columns={milestoneColumns} title="Atlas milestones" settings={data.settings} canExport={canExport} canPrint={canExport} exportScopes={{ selected: [], filtered: milestones, all: milestones }}/>}{milestoneView === 'list' && canCreate && <button className="text-button" onClick={() => openModal('milestone')}>Add milestone <Icon name="plus" size={13}/></button>}</div></div>
      {milestoneView === 'list' ? <div className="milestone-list">{milestones.slice(0, 8).map(milestone => <div className="milestone-row" key={milestone.id} onClick={() => canEdit && openModal('milestone', milestone)}><div className={`milestone-date ${milestone.status === 'At risk' ? 'date-warning' : ''}`}><strong data-no-i18n>{localizedDateParts(data.settings, milestone.dueDate).day}</strong><span data-no-i18n>{localizedDateParts(data.settings, milestone.dueDate).month}</span></div><div className="milestone-copy"><strong data-no-i18n>{milestone.name}</strong><span><span data-no-i18n>{milestone.project.name}</span> · <span data-no-i18n>{milestone.project.owner}</span></span></div><StatusPill tone={milestone.status === 'At risk' ? 'at-risk' : milestone.status === 'Complete' ? 'done' : 'on-track'}>{milestone.status}</StatusPill></div>)}</div> : <RecordTable
        entity="milestones" title="Milestones" advancedFilterKey="projects" totalRecordCount={milestones.length} records={milestones} columns={milestoneColumns.map(column => ({ ...column, type: column.key === 'dueDate' ? 'date' : 'text', inlineEditable: column.key === 'status', ...(column.key === 'status' ? { inlineOptions: ['Upcoming', 'At risk', 'Complete'] } : {}) }))}
        dataset="milestones" settings={data.settings} userId={userId} canCreate={canCreate} canEdit={canEdit} canDelete={canManage && actionVisible(data.settings, 'delete')} canImport={canCreate} canExport={canExport}
        onCreate={() => openModal('milestone')} onEdit={milestone => openModal('milestone', milestone)}
        onDuplicate={milestone => openModal('milestone', { ...milestone, id: undefined, name: `Copy of ${milestone.name}` })}
        onDelete={(milestone, options) => deleteRecord?.('milestone', milestone, options)}
        onBulkEdit={payload => bulkEditRecords?.('milestone', payload)} onBulkDelete={payload => bulkDeleteRecords?.('milestone', payload)}
        onImport={importMilestones} onInlineEdit={inlineEditMilestone} bulkFields={milestoneBulkFields} importFields={milestoneImportFields} notify={notify}
        emptyTitle="No milestones yet" emptyMessage="Add a milestone or import milestone records."/>}
    </section>
  </div>
}

function ProjectCard({ project, taskCount = 0, onOpen, onEdit, settings }) {
  const count = formattedCount(settings, taskCount)
  const progress = formattedCount(settings, project.progress)
  const taskWord = uiText(settings, taskCount === 1 ? 'task' : 'tasks')
  return <article className="project-card project-card-interactive">
    <div className="project-card-top"><div className={`project-symbol symbol-${project.color}`} data-no-i18n>{initials(project.name)}</div>{onEdit && <button className="icon-button subtle" onClick={event => { event.stopPropagation(); onEdit() }} aria-label={`${uiText(settings, 'Edit')} ${project.name}`}><Icon name="more" size={16}/></button>}</div>
    <div className="project-card-code" data-no-i18n>{project.code} · {project.team}</div>
    <button type="button" className="project-card-open" onClick={onOpen} aria-label={`${uiText(settings, 'Open')} ${project.name} ${uiText(settings, 'task portfolio')}`}><span data-no-i18n>{project.name}</span><Icon name="arrow" size={14}/></button>
    <p data-no-i18n>{project.description}</p>
    <div className="project-card-meta"><StatusPill tone={project.health === 'At risk' ? 'at-risk' : 'on-track'}>{project.health}</StatusPill><span>{progress}% {uiText(settings, 'complete')}</span></div>
    <ProgressBar value={project.progress} color={project.color}/>
    <div className="project-card-bottom"><span><Icon name="calendar" size={13}/> <span data-no-i18n>{localizedProjectDays(settings, project.days)}</span></span><span className="project-task-count"><span data-no-i18n>{count}</span> {taskWord}</span><span className="avatar-stack">{project.members.map(member => <Avatar name={member} key={member} color={project.memberColors?.[member]} small/>)}</span></div>
    <button type="button" className="project-card-task-link" onClick={onOpen}>{taskCount ? `${uiText(settings, 'View')} ${count} ${taskWord}` : uiText(settings, 'Open project details')}</button>
  </article>
}

function ProjectDetailsView({ project, tasks, milestones, loading, error, onRetry, onBack, onEditProject, onEditTask, onCreateTask, canExport, settings, setPage }) {
  const [status, setStatus] = useState('All statuses')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState({ key: 'dueDate', dir: 'asc' })
  const [taskPage, setTaskPage] = useState(0)
  const statuses = ['All statuses', ...new Set(tasks.map(task => task.status).filter(Boolean))]
  const priorityRank = { Low: 1, Medium: 2, High: 3 }
  const filteredTasks = tasks.filter(task => (status === 'All statuses' || task.status === status) && `${task.id} ${task.title} ${task.assignee}`.toLowerCase().includes(search.toLowerCase()))
  const sortedTasks = sort.key === 'priority'
    ? [...filteredTasks].sort((left, right) => ((priorityRank[left.priority] || 0) - (priorityRank[right.priority] || 0)) * (sort.dir === 'desc' ? -1 : 1))
    : sortRows(filteredTasks, sort)
  const projectTaskPageSize = 50
  const pageCount = Math.max(1, Math.ceil(sortedTasks.length / projectTaskPageSize))
  const visiblePage = Math.min(taskPage, pageCount - 1)
  const visibleTasks = sortedTasks.slice(visiblePage * projectTaskPageSize, (visiblePage + 1) * projectTaskPageSize)
  useEffect(() => { setTaskPage(0) }, [status, search, sort.key, sort.dir, tasks.length])
  const taskColumns = [
    { key: 'id', label: 'Task ID' }, { key: 'title', label: 'Task' }, { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' }, { key: 'assignee', label: 'Owner' }, { key: 'due', label: 'Due' }
  ]
  const doneCount = tasks.filter(task => task.dueTone === 'done').length
  const blockedCount = tasks.filter(task => task.blocked).length
  const openCount = tasks.length - doneCount
  if (!project) return <div className="page-content"><button className="text-button" onClick={onBack}><Icon name="arrow" size={13}/> Back to projects</button>{loading && <div className="project-detail-loading"><span className="loading-orb"/> Reading project records from SQLite…</div>}{error && <div className="form-error"><Icon name="warning" size={14}/>{error}<button className="text-button" onClick={onRetry}>Retry</button></div>}</div>
  return <div className="page-content project-detail-page">
    <div className="project-detail-nav"><button className="text-button" onClick={onBack}><Icon name="arrow" size={13}/> All projects</button><span>Project workspace</span></div>
    <section className="project-detail-hero panel">
      <div className={`project-detail-mark symbol-${project.color}`}>{initials(project.name)}</div>
      <div className="project-detail-heading"><div className="project-card-code" data-no-i18n>{project.code} · {project.team}</div><h2 data-no-i18n>{project.name}</h2><p>{project.description ? <span data-no-i18n>{project.description}</span> : 'Project details and delivery work from the workspace database.'}</p><div className="project-detail-badges"><StatusPill tone={project.health === 'At risk' ? 'at-risk' : project.health === 'Completed' ? 'done' : 'on-track'}>{project.health}</StatusPill><span>Owner · <span data-no-i18n>{project.owner}</span></span><span>Due · <span data-no-i18n>{localizedSystemDate(settings, project.deadlineDate || project.deadline)}</span></span></div></div>
      <div className="project-detail-actions">{onEditProject && <button className="secondary-button" onClick={() => onEditProject(project)}><Icon name="more" size={14}/> Edit project</button>}{setPage && settings?.interface?.navigationVisibility?.tasks !== false && <button className="secondary-button" onClick={() => setPage('tasks')}><Icon name="tasks" size={14}/> Task board</button>}</div>
      <div className="project-detail-progress"><div><span>Delivery progress</span><strong>{project.progress}%</strong></div><ProgressBar value={project.progress} color={project.color}/></div>
    </section>
    <div className="project-detail-metrics"><div><strong>{tasks.length}</strong><span>All project tasks</span></div><div><strong>{openCount}</strong><span>Open</span></div><div><strong>{doneCount}</strong><span>Completed</span></div><div><strong>{blockedCount}</strong><span>Blocked</span></div></div>
    <section className="panel project-task-section">
      <div className="section-head project-task-heading"><div><span className="eyebrow"><span className="eyebrow-dot"/> Project task portfolio</span><h2>Every task, in one place.</h2><p>Task rows and linked fields were re-read from SQLite for this project.</p></div><div className="project-task-actions"><ExportMenu dataset="tasks" query={{ projectId: project.numericId }} rows={sortedTasks} columns={taskColumns} title={`${project.code} project tasks`} settings={settings} canExport={canExport} canPrint={canExport} exportScopes={{ selected: [], filtered: sortedTasks, all: tasks }}/>{onCreateTask && <button className="primary-button" onClick={() => onCreateTask(project)}><Icon name="plus" size={15}/> Add task</button>}</div></div>
      <div className="project-task-controls"><label className="project-task-search"><Icon name="search" size={15}/><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tasks in this project"/></label><label>Status<select value={status} onChange={event => setStatus(event.target.value)}>{statuses.map(value => <option key={value}>{value}</option>)}</select></label><label>Sort by<select value={sort.key} onChange={event => setSort(current => ({ ...current, key: event.target.value }))}><option value="dueDate">Due date</option><option value="title">Task name</option><option value="priority">Priority</option><option value="status">Status</option></select></label><button className="icon-button subtle" title={`Sort ${sort.dir === 'asc' ? 'descending' : 'ascending'}`} onClick={() => setSort(current => ({ ...current, dir: current.dir === 'asc' ? 'desc' : 'asc' }))}><Icon name="down" size={14}/></button></div>
      <div className="project-task-countline"><strong>{formattedCount(settings, filteredTasks.length)}</strong> {uiText(settings, 'matching of')} <span data-no-i18n>{formattedCount(settings, tasks.length)}</span> {uiText(settings, 'project tasks')} <span>· {uiText(settings, 'Loaded from the database, not a screen snapshot')}</span></div>
      {pageCount > 1 && <div className="task-pagination"><span>{uiText(settings, 'Showing')} {formattedCount(settings, visiblePage * projectTaskPageSize + 1)}–{formattedCount(settings, Math.min((visiblePage + 1) * projectTaskPageSize, sortedTasks.length))} {uiText(settings, 'of')} {formattedCount(settings, sortedTasks.length)} {uiText(settings, 'matching tasks')}</span><div><button className="secondary-button" disabled={visiblePage === 0} onClick={() => setTaskPage(visiblePage - 1)}>{uiText(settings, 'Previous')}</button><span>{uiText(settings, 'Page')} {formattedCount(settings, visiblePage + 1)} {uiText(settings, 'of')} {formattedCount(settings, pageCount)}</span><button className="secondary-button" disabled={visiblePage >= pageCount - 1} onClick={() => setTaskPage(visiblePage + 1)}>{uiText(settings, 'Next')}</button></div></div>}
      <div className="project-task-list"><div className="table-head sortable-head" style={{ gridTemplateColumns: taskGridTemplate(taskColumns) }}><span/>{taskColumns.map(column => <span key={column.key}>{column.label}</span>)}<span/></div>{visibleTasks.map(task => <TaskRow key={task.numericId} task={task} settings={settings} visibleColumns={taskColumns} onEdit={onEditTask}/>)}</div>
      {!loading && !error && !tasks.length && <EmptyState title="No tasks are linked yet" message="Create the first task and it will appear in this project portfolio." action={onCreateTask ? 'Add task' : undefined} onAction={onCreateTask ? () => onCreateTask(project) : undefined}/>}
      {!!milestones.length && <div className="project-detail-milestones"><strong>Linked milestones</strong><div>{milestones.map(milestone => <span key={milestone.id}><Icon name="calendar" size={12}/><span data-no-i18n>{milestone.name}</span> · <span data-no-i18n>{localizedSystemDate(settings, milestone.dueDate)}</span></span>)}</div></div>}
      {loading && <div className="project-detail-loading"><span className="loading-orb"/> Refreshing project tasks from SQLite…</div>}
      {error && <div className="form-error"><Icon name="warning" size={14}/>{error}<button className="text-button" onClick={onRetry}>Retry</button></div>}
    </section>
  </div>
}

function MyWork({ data, openModal, refresh, notify, userId = '', canWriteTasks = true, canManageTasks = false, userPersonId = '', canExport = true, deleteRecord, bulkEditTasks, bulkDeleteTasks, importTasks, inlineEditTask }) {
  const [view, setView] = useState(data.settings?.defaultTaskView || 'board')
  const [filter, setFilter] = useState('All tasks')
  const [query, setQuery] = useState('')
  const [advanced, setAdvanced] = useState([])
  const [sort, setSort] = useState({ key: 'dueDate', dir: 'asc' })
  const [taskPage, setTaskPage] = useState(0)
  const [dragId, setDragId] = useState(null)
  const [dragOver, setDragOver] = useState('')
  const taskStatuses = workflowStateLabels(data.settings)
  const fields = configuredColumns(data.settings, 'tasks', [
    { key: 'id', label: 'Task ID' }, { key: 'title', label: 'Task' }, { key: 'project', label: 'Project' },
    { key: 'status', label: 'Status' }, { key: 'priority', label: 'Priority' }, { key: 'assignee', label: 'Owner' }, { key: 'due', label: 'Due' }
  ]).map(column => ({
    ...column,
    type: column.key === 'due' ? 'date' : column.key === 'blocked' ? 'boolean' : column.key === 'priority' ? 'select' : 'text',
    getValue: row => column.key === 'due' ? row.dueDate || '' : column.key === 'id' ? row.id : row[column.key],
    inlineEditable: ['title', 'status', 'priority', 'due'].includes(column.key),
    ...(column.key === 'status' ? { inlineOptions: workflowStateLabels(data.settings) } : {}),
    ...(column.key === 'priority' ? { inlineOptions: ['High', 'Medium', 'Low'] } : {})
  }))
  const canCreateTask = canManageTasks && actionVisible(data.settings, 'create')
  const canEditTask = canManageTasks && actionVisible(data.settings, 'edit')
  const priorityTasks = data.tasks.filter(task => filter === 'All tasks' || task.priority === filter)
  const base = priorityTasks.filter(task => `${task.title} ${task.project} ${task.assignee}`.toLowerCase().includes(query.toLowerCase()))
  const filteredTasks = sortRows(applyAdvancedFilters(base, advanced), sort)
  const pageSize = Math.max(1, Number(data.settings?.pageSize) || 50)
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / pageSize))
  const visiblePage = Math.min(taskPage, pageCount - 1)
  const visibleTasks = filteredTasks.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize)
  useEffect(() => { setTaskPage(0) }, [filter, query, advanced, sort, pageSize])
  const canChangeTask = task => canWriteTasks && actionVisible(data.settings, 'edit') && (canManageTasks || String(task.assigneeId || '') === String(userPersonId || ''))
  const advance = async task => {
    if (!canChangeTask(task)) { notify({ title: 'Task is outside your scope', body: 'You can update workflow only on tasks assigned to your profile.', tone: 'warning' }); return }
    try {
      await api.patch(`/api/tasks/${task.numericId}/status`, { advance: true })
      notify({ title: 'Task advanced', body: task.title, tone: 'success' })
      await refresh()
    } catch (error) { notify({ title: 'Task update failed', body: error.message, tone: 'warning' }) }
  }
  const dropTask = async status => {
    if (!dragId) return
    const task = data.tasks.find(row => String(row.numericId) === String(dragId))
    setDragId(null); setDragOver('')
    if (!task || !canChangeTask(task) || task.status === status) return
    try {
      await api.patch(`/api/tasks/${task.numericId}/status`, { status })
      notify({ title: 'Task moved', body: `${task.title} → ${status}`, tone: 'success' })
      await refresh()
    } catch (error) { notify({ title: 'Task update failed', body: error.message, tone: 'warning' }) }
  }
  const fieldSortKey = key => key === 'due' ? 'dueDate' : key
  const toggleSort = key => { const sortKey = fieldSortKey(key); setSort(current => current.key === sortKey ? { key: sortKey, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key: sortKey, dir: 'asc' }) }
  const filterFields = [...fields]
  const taskImportFields = [
    { key: 'title', label: 'Task title' }, { key: 'projectId', label: 'Project ID' }, { key: 'assigneeId', label: 'Owner ID' },
    { key: 'priority', label: 'Priority' }, { key: 'dueDate', label: 'Due date', type: 'date' }, { key: 'status', label: 'Status' },
    { key: 'type', label: 'Category' }, { key: 'blocked', label: 'Blocked', type: 'boolean' }, { key: 'tags', label: 'Tags', type: 'tags' }
  ]
  const bulkFields = [
    { key: 'status', label: 'Status', type: 'select', options: taskStatuses },
    ...(canManageTasks ? [
      { key: 'assigneeId', label: 'Owner', type: 'select', options: data.people.map(person => [person.id, person.name]) },
      { key: 'projectId', label: 'Project', type: 'select', options: data.projects.map(project => [project.numericId, project.name]) },
      { key: 'priority', label: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'] },
      { key: 'type', label: 'Category', type: 'select', options: ['Development', 'Design', 'Testing', 'Documentation'] },
      { key: 'dueDate', label: 'Due date', type: 'date' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'tags', label: 'Tags', type: 'tags' }
    ] : [])
  ]
  return <div className="page-content">
    <div className="work-toolbar">
      <div className="view-toggle"><button className={view === 'board' ? 'selected' : ''} onClick={() => setView('board')}><Icon name="overview" size={15}/> Board</button><button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><Icon name="tasks" size={15}/> List</button><button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}><Icon name="tasks" size={15}/> Table</button></div>
      {view !== 'table' && <div className="work-search"><Icon name="search" size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter tasks"/></div>}
      <select value={filter} onChange={event => setFilter(event.target.value)}><option>All tasks</option><option>High</option><option>Medium</option><option>Low</option></select>
      <AdvancedFilter settings={data.settings} filterKey="tasks" fields={filterFields} onApply={setAdvanced} appliedConditions={advanced}/>
      {view !== 'table' && <ExportMenu dataset="tasks" rows={filteredTasks} columns={fields} title="Atlas tasks" settings={data.settings} canExport={canExport} canPrint={canExport} exportScopes={{ selected: [], filtered: filteredTasks, all: data.tasks }}/>}
      {view !== 'table' && (canCreateTask ? <button className="primary-button" onClick={() => openModal('task')}><Icon name="plus" size={15}/> Add task</button> : <span className="readonly-pill">{canWriteTasks ? 'Assigned task progress only' : 'Read-only'}</span>)}
    </div>
    <FilterChips filterKey="tasks" conditions={advanced} fields={filterFields} onChange={setAdvanced}/>
    {view !== 'table' && <div className="results-meta"><strong>{formattedCount(data.settings, filteredTasks.length)}</strong> {uiText(data.settings, canManageTasks ? 'matching tasks · drag cards to change workflow state' : 'matching tasks · status changes are limited to assigned tasks')}</div>}
    {view !== 'table' && pageCount > 1 && <div className="task-pagination"><span>Showing {visiblePage * pageSize + 1}–{Math.min((visiblePage + 1) * pageSize, filteredTasks.length)} of {filteredTasks.length} tasks</span><div><button className="secondary-button" disabled={visiblePage === 0} onClick={() => setTaskPage(visiblePage - 1)}>Previous</button><span>Page {visiblePage + 1} of {pageCount}</span><button className="secondary-button" disabled={visiblePage >= pageCount - 1} onClick={() => setTaskPage(visiblePage + 1)}>Next</button></div></div>}
    {view === 'board' ? <div className="board">{taskStatuses.map(status => <section className={`board-column column-${slug(status)} ${dragOver === status ? 'drag-over' : ''}`} key={status} onDragOver={event => { event.preventDefault(); setDragOver(status) }} onDragLeave={() => setDragOver('')} onDrop={() => dropTask(status)}><div className="board-column-head"><span className="column-dot"/><strong>{status}</strong><span className="column-count">{visibleTasks.filter(task => task.status === status).length} / {filteredTasks.filter(task => task.status === status).length}</span></div><div className="board-cards">{visibleTasks.filter(task => task.status === status).map(task => <TaskCard task={task} settings={data.settings} key={task.numericId} onAdvance={canChangeTask(task) ? () => advance(task) : null} onEdit={canEditTask ? () => openModal('task', task) : null} onDragStart={canChangeTask(task) ? () => setDragId(task.numericId) : null} dragging={String(dragId) === String(task.numericId)}/>)}</div>{canCreateTask && <button className="add-column-task" onClick={() => openModal('task', { status })}><Icon name="plus" size={13}/> Add task</button>}</section>)}</div>  : view === 'table' ? <RecordTable
      entity="tasks" title="Tasks" totalRecordCount={data.tasks.length} records={priorityTasks} columns={fields} dataset="tasks" settings={data.settings} userId={userId}
      canCreate={canCreateTask} canEdit={canEditTask && actionVisible(data.settings, 'edit')}
      canBulkEdit={(canManageTasks || canWriteTasks) && actionVisible(data.settings, 'edit')}
      canDelete={canManageTasks && actionVisible(data.settings, 'delete')} canImport={canCreateTask} canExport={canExport}
      onCreate={() => openModal('task')}
      onEdit={task => openModal('task', task)}
      onDuplicate={task => openModal('task', { ...task, numericId: undefined, id: undefined, title: `Copy of ${task.title}` })}
      onDelete={(task, options) => deleteRecord?.('task', task, options)}
      getDeleteImpact={task => { const count = data.alerts.filter(alert => String(alert.taskId || '') === String(task.numericId)).length; return count ? `${count} linked alert${count === 1 ? '' : 's'} will also be removed.` : '' }}
      getBulkDeleteImpact={tasks => { const ids = new Set(tasks.map(task => String(task.numericId))); const count = data.alerts.filter(alert => ids.has(String(alert.taskId || ''))).length; return count ? `${count} linked alerts will also be removed.` : '' }}
      onBulkEdit={bulkEditTasks} onBulkDelete={bulkDeleteTasks} onImport={importTasks} onInlineEdit={inlineEditTask}
      canInlineEdit={(task, column) => column.key === 'status' ? canChangeTask(task) : canEditTask && actionVisible(data.settings, 'edit')}
      bulkFields={bulkFields} importFields={taskImportFields} advancedFilter={false} advancedConditions={advanced} onAdvancedChange={setAdvanced} notify={notify}
      emptyTitle="No tasks in this workspace" emptyMessage="Create a task or import task rows from CSV or JSON."/>
    : <div className="panel task-table-panel"><div className="table-head sortable-head" style={{ gridTemplateColumns: taskGridTemplate(fields) }}><span/>{fields.map(field => { const sortKey = fieldSortKey(field.key); return <button key={field.key} className={sort.key === sortKey ? 'sorted' : ''} onClick={() => toggleSort(field.key)}>{field.label}<Icon name="down" size={11}/></button> })}<span/></div>{visibleTasks.map(task => <TaskRow key={task.numericId} task={task} settings={data.settings} visibleColumns={fields} onAdvance={canChangeTask(task) ? advance : null} onEdit={canEditTask ? () => openModal('task', task) : null}/>)}</div>}
    {!canWriteTasks && <PermissionNotice>Your role can inspect tasks, filters, exports, and reports, but cannot change workflow state.</PermissionNotice>}
    {canWriteTasks && !actionVisible(data.settings, 'edit') && <PermissionNotice>Workspace action visibility currently hides task workflow changes.</PermissionNotice>}
    {!canManageTasks && canWriteTasks && actionVisible(data.settings, 'edit') && <PermissionNotice>You can advance tasks assigned to your profile. Managers can edit task details and assignments.</PermissionNotice>}
    {!filteredTasks.length && view !== 'table' && <EmptyState title="No tasks match" message={canCreateTask ? 'Clear filters or add a new task.' : 'Clear filters to see more tasks.'} action={canCreateTask ? 'Add task' : ''} onAction={canCreateTask ? () => openModal('task') : undefined}/>}
    <div className="workflow-note"><span className="workflow-icon"><Icon name="bolt" size={16}/></span><div><strong>Professional interaction</strong><p>Drag-and-drop updates are saved through the local API, reflected in activity, reports, exports, and print views.</p></div></div>
  </div>
}
function TaskCard({ task, settings, onAdvance, onEdit, onDragStart, dragging }) {
  return <article className={`board-card ${dragging ? 'dragging' : ''}`} draggable={Boolean(onDragStart)} onDragStart={onDragStart} onClick={onAdvance}>
    <div className="board-card-top"><span className={`priority-dot priority-dot-${task.priority.toLowerCase()}`}/><span className="task-id" data-no-i18n>{task.id}</span>{onEdit && <button className="icon-button subtle" onClick={e => { e.stopPropagation(); onEdit() }}><Icon name="more" size={15}/></button>}</div>
    <h3 data-no-i18n>{task.title}</h3><div className="board-card-project"><span className="mini-project"/><span data-no-i18n>{task.project}</span></div>
    <div className="board-card-bottom"><span className={`due-${task.dueTone}`} data-no-i18n><Icon name="calendar" size={13}/> {localizedTaskDue(settings, task.due, task.dueDate)}</span><Avatar name={task.assignee} color={task.assigneeColor} small/></div>
  </article>
}
function People({ data, openModal, canManage, canExport = true, userId = '', deleteRecord, bulkEditRecords, bulkDeleteRecords, importRecords, inlineEditRecord, notify }) {
  const [team, setTeam] = useState('Everyone')
  const [view, setView] = useState('cards')
  const [advanced, setAdvanced] = useState([])
  const fields = configuredColumns(data.settings, 'people', [
    { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'role', label: 'Job title' },
    { key: 'team', label: 'Team' }, { key: 'status', label: 'Status' }, { key: 'load', label: 'Capacity' }
  ]).map(column => ({
    ...column,
    type: column.key === 'load' ? 'number' : 'text',
    getValue: person => column.key === 'role' ? person.jobTitle || person.role : person[column.key],
    inlineEditable: ['status', 'load'].includes(column.key),
    ...(column.key === 'status' ? { inlineOptions: ['On track', 'Needs attention'] } : {})
  }))
  const canCreate = canManage && actionVisible(data.settings, 'create')
  const canEdit = canManage && actionVisible(data.settings, 'edit')
  const canDelete = canManage && actionVisible(data.settings, 'delete')
  const filteredByTeam = data.people.filter(person => team === 'Everyone' || person.team === team)
  const rows = applyAdvancedFilters(filteredByTeam, advanced)
  const avg = data.people.length ? Math.round(data.people.reduce((sum, person) => sum + person.load, 0) / data.people.length) : 0
  const bulkFields = [
    { key: 'status', label: 'Status', type: 'select', options: ['On track', 'Needs attention'] },
    { key: 'teamId', label: 'Team', type: 'select', options: data.teams.map(item => [item.id, item.name]) },
    { key: 'capacity', label: 'Capacity', type: 'number' }
  ]
  const importFields = [
    { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' }, { key: 'jobTitle', label: 'Job title' },
    { key: 'teamId', label: 'Team ID' }, { key: 'focus', label: 'Focus' }, { key: 'capacity', label: 'Capacity', type: 'number' },
    { key: 'status', label: 'Status' }, { key: 'color', label: 'Color' }
  ]
  return <div className="page-content">
    <div className="people-summary"><div className="people-summary-main"><span className="eyebrow"><span className="eyebrow-dot green"/> Team pulse</span><h2><span data-no-i18n>{formattedCount(data.settings, data.people.length)}</span> people, one clear view.</h2><p>Capacity and focus are shared across dashboards, reports, and exports.</p></div><div className="people-stats"><div><strong data-no-i18n>{formattedCount(data.settings, avg)}%</strong><span>Avg. capacity</span></div><div><strong data-no-i18n>{formattedCount(data.settings, data.activity.filter(activity => activity.date === data.today).length)}</strong><span>Updates today</span></div><div><strong data-no-i18n>{formattedCount(data.settings, data.people.filter(person => person.status !== 'On track').length)}</strong><span>Need support</span></div></div></div>
    <div className="toolbar"><div className="filter-tabs">{['Everyone', ...data.teams.map(item => item.name)].map(tab => <button className={team === tab ? 'selected' : ''} onClick={() => setTeam(tab)} key={tab}>{tab === 'Everyone' ? tab : <span data-no-i18n>{tab}</span>}</button>)}</div><div className="toolbar-actions"><div className="view-toggle"><button className={view === 'cards' ? 'selected' : ''} onClick={() => setView('cards')}>Cards</button><button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}>Table</button></div><AdvancedFilter settings={data.settings} filterKey="people" fields={fields} onApply={setAdvanced} appliedConditions={advanced}/>{view === 'cards' && <ExportMenu dataset="people" rows={rows} columns={fields} title="Atlas people" settings={data.settings} canExport={canExport} canPrint={canExport} exportScopes={{ selected: [], filtered: rows, all: data.people }}/>}{view === 'cards' && canCreate && <><button className="secondary-button" onClick={() => openModal('team')}><Icon name="team" size={15}/> Manage teams</button><button className="primary-button" onClick={() => openModal('person')}><Icon name="plus" size={15}/> Invite person</button></>}</div></div>
    <div className="team-strip">{data.teams.map(item => <button className="team-chip" key={item.id} onClick={() => canEdit && openModal('team', item)}><span className={`team-chip-dot team-chip-${item.color}`}/><span data-no-i18n>{item.name}</span><small data-no-i18n>{formattedCount(data.settings, item.peopleCount)}</small></button>)}</div>
    {view === 'cards' ? <div className="people-grid">{rows.map(person => <PersonCard person={person} settings={data.settings} key={person.id} onEdit={canEdit ? () => openModal('person', person) : null}/>)}</div> : <RecordTable
      entity="people" title="People" totalRecordCount={data.people.length} records={filteredByTeam} columns={fields} dataset="people" settings={data.settings} userId={userId}
      canCreate={canCreate} canEdit={canEdit} canBulkEdit={canEdit} canDelete={canDelete} canImport={canCreate} canExport={canExport}
      onCreate={() => openModal('person')} onEdit={person => openModal('person', person)}
      onDuplicate={person => openModal('person', { ...person, id: undefined, name: `Copy of ${person.name}`, email: '' })}
      onDelete={(person, options) => deleteRecord?.('person', person, options)}
      onBulkEdit={payload => bulkEditRecords?.('person', payload)} onBulkDelete={payload => bulkDeleteRecords?.('person', payload)}
      onImport={importRecords} onInlineEdit={(person, field, value) => inlineEditRecord?.(person, field === 'role' ? 'jobTitle' : field === 'load' ? 'capacity' : field, value)}
      bulkFields={bulkFields} importFields={importFields} advancedFilter={false} advancedConditions={advanced} onAdvancedChange={setAdvanced}
      getDeleteImpact={person => { const tasks = data.tasks.filter(task => String(task.assigneeId || '') === String(person.id)).length; const projects = data.projects.filter(project => String(project.ownerId || '') === String(person.id)).length; const activity = data.activity.filter(row => String(row.personId || '') === String(person.id)).length; return tasks || projects || activity ? `${tasks} assigned tasks, ${projects} owned projects, and ${activity} visible activity records must be reassigned or removed first. User-account and retained work-ledger references may also block deletion.` : 'User-account or retained work-ledger references may block deletion.' }}
      getBulkDeleteImpact={people => { const ids = new Set(people.map(person => String(person.id))); const tasks = data.tasks.filter(task => ids.has(String(task.assigneeId || ''))).length; const projects = data.projects.filter(project => ids.has(String(project.ownerId || ''))).length; const activity = data.activity.filter(row => ids.has(String(row.personId || ''))).length; return `${tasks} assigned tasks, ${projects} owned projects, and ${activity} visible activity records must be reassigned or removed first. User-account and retained work-ledger references may also block deletion.` }}
      emptyTitle="No people in this workspace" emptyMessage="Create a person or import directory records." notify={notify}/>}
    {!rows.length && view === 'cards' && <EmptyState title="No people match" message="Clear filters or invite a person."/>}
  </div>
}
function PersonCard({ person, settings, onEdit }) {
  return <article className="person-card">
    <div className="person-card-head"><Avatar name={person.name} color={person.color}/><span className={`online-status ${person.status !== 'On track' ? 'attention' : ''}`}><i/> {person.status}</span>{onEdit && <button className="icon-button subtle" onClick={onEdit}><Icon name="more" size={16}/></button>}</div>
    <div className="person-name"><h3 data-no-i18n>{person.name}</h3><p data-no-i18n>{person.role}</p></div>
    <div className="person-focus"><span>Current focus</span><strong data-no-i18n>{person.focus}</strong></div>
    <div className="person-card-foot"><span data-no-i18n>{person.team}</span><div className="capacity"><span>Capacity</span><strong data-no-i18n>{formattedCount(settings, person.load)}%</strong><div className="capacity-track"><i style={{ width: `${person.load}%` }}/></div></div></div>
  </article>
}
function ActivityLog({ data, openModal, setPage, canLogActivity = true, canExport = true, canViewAllActivity = false, canManageTasks = false, userId = '', deleteRecord, bulkDeleteRecords, importActivity, notify }) {
  const [range, setRange] = useState('All activity')
  const [view, setView] = useState('timeline')
  const [advanced, setAdvanced] = useState([])
  const fields = configuredColumns(data.settings, 'activity', [
    { key: 'person', label: 'Person' }, { key: 'date', label: 'Date' }, { key: 'today', label: 'Today' }, { key: 'blocked', label: 'Blocked' }
  ])
  const exportColumns = configuredColumns(data.settings, 'activity', [
    { key: 'person', label: 'Person' }, { key: 'date', label: 'Date' }, { key: 'yesterday', label: 'Yesterday' },
    { key: 'today', label: 'Today' }, { key: 'blocked', label: 'Blocked' }, { key: 'upcoming', label: 'Upcoming' }
  ])
  const canCreateActivity = canLogActivity && actionVisible(data.settings, 'create')
  const canEditActivity = canLogActivity && actionVisible(data.settings, 'edit')
  const canDeleteActivity = canManageTasks && actionVisible(data.settings, 'delete')
  const activityImportFields = [
    { key: 'personId', label: 'Person ID' }, { key: 'yesterday', label: 'Yesterday' }, { key: 'today', label: 'Today' },
    { key: 'blocked', label: 'Blocked' }, { key: 'upcoming', label: 'Upcoming' }
  ]
  const rangeRows = range === 'Today' ? data.activity.filter(activity => activity.date === data.today)
    : range === 'Yesterday' ? data.activity.filter(activity => activity.date !== data.today)
      : data.activity
  const rows = applyAdvancedFilters(rangeRows, advanced)
  const timeline = rows.flatMap(activity => [
    activity.today && { activity, action: 'is working on', detail: activity.today, tone: activity.blocked ? 'orange' : 'purple', icon: activity.blocked ? 'warning' : 'bolt' },
    activity.yesterday && { activity, action: 'completed', detail: activity.yesterday, tone: 'green', icon: 'check' }
  ].filter(Boolean)).slice(0, 16)
  const team = data.teamActivitySummary || {}
  const contributors = data.people.map(person => ({
    person,
    updates: data.activity.filter(activity => activity.personId === person.id).length
  })).sort((left, right) => right.updates - left.updates || left.person.name.localeCompare(right.person.name))
  return <div className="page-content">
    <div className="toolbar">
      <div className="filter-tabs">{['All activity','Today','Yesterday'].map(tab => <button className={range === tab ? 'selected' : ''} key={tab} onClick={() => setRange(tab)}>{tab}</button>)}</div>
      <div className="toolbar-actions"><div className="view-toggle"><button className={view === 'timeline' ? 'selected' : ''} onClick={() => setView('timeline')}>Timeline</button><button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}>Table</button></div><AdvancedFilter settings={data.settings} filterKey="activity" fields={fields} onApply={setAdvanced} appliedConditions={advanced}/>{view === 'timeline' && <ExportMenu dataset="activity" rows={rows} columns={exportColumns} title="Atlas activity" settings={data.settings} canExport={canExport} canPrint={canExport} exportScopes={{ selected: [], filtered: rows, all: data.activity }}/>}{view === 'timeline' && (canCreateActivity ? <button className="secondary-button" onClick={() => openModal('activity')}><Icon name="plus" size={15}/> Log update</button> : <span className="readonly-pill">Read-only</span>)}</div>
    </div>
    {!canLogActivity && <PermissionNotice>Your role can view activity and reports, but cannot log updates.</PermissionNotice>}
    {view === 'timeline' ? <div className="activity-layout">
      <section className="panel timeline-panel"><div className="section-head"><div><h2>{canViewAllActivity ? 'Workspace timeline' : 'My timeline'}</h2><p>{canViewAllActivity ? 'Everything important, in context.' : 'Your updates and blockers; other people’s individual activity is private.'}</p></div><span className="live-label"><i/> Live</span></div>
        <div className="timeline">{timeline.map((item, index) => <div className="timeline-row" key={`${item.activity.id}-${index}`}><div className="timeline-time"><strong data-no-i18n>{item.activity.time}</strong><span data-no-i18n>{item.activity.date === data.today ? uiText(data.settings, 'Today') : localizedSystemDate(data.settings, item.activity.date)}</span></div><div className={`timeline-line tone-${item.tone}`}><span><Icon name={item.icon} size={14}/></span></div><div className="timeline-content"><div><Avatar name={item.activity.person} color={item.activity.personColor} small/><strong data-no-i18n>{item.activity.person}</strong><span>{item.action}</span><b data-no-i18n>{item.detail}</b></div><p>{item.activity.blocked ? <>{uiText(data.settings, 'Blocked')}: <span data-no-i18n>{item.activity.blocked}</span></> : uiText(data.settings, 'Daily update confirmed')}</p></div></div>)}</div>
      </section>
      <aside className="activity-aside">
        <section className="panel insight-card"><span className="insight-spark"><Icon name="spark" size={16}/></span><h3>One thing to notice</h3><p>Daily updates become operational intelligence: blockers surface in alerts, exports, and reports automatically.</p><button className="text-button" onClick={() => setPage('reports')}>See trend <Icon name="arrow" size={13}/></button></section>
        {canViewAllActivity ? <section className="panel contributor-card"><div className="section-head compact"><div><h3>Most active this week</h3><p>By daily updates</p></div></div>{contributors.slice(0, 4).map(({ person, updates }, index) => <div className="contributor-row" key={person.id}><span className="rank">{String(index + 1).padStart(2, '0')}</span><Avatar name={person.name} color={person.color} small/><strong data-no-i18n>{person.name}</strong><span>{formattedCount(data.settings, updates)} {uiText(data.settings, 'updates')}</span></div>)}</section>
          : <section className="panel contributor-card team-activity-summary"><div className="section-head compact"><div><h3>Team activity pulse</h3><p>Non-identifying workspace totals</p></div></div><div className="team-pulse-stats"><div><strong>{team.thisWeek || 0}</strong><span>Updates this week</span></div><div><strong>{team.today || 0}</strong><span>Updates today</span></div><div><strong>{team.blockersToday || 0}</strong><span>Blockers today</span></div></div><small>Individual activity and rankings are visible only to administrators.</small></section>}
      </aside>
    </div> : <RecordTable
      entity="activity" title="Activity" totalRecordCount={data.activity.length} records={rangeRows} columns={exportColumns.map(column => ({ ...column, type: column.key === 'date' ? 'date' : 'text' }))}
      dataset="activity" settings={data.settings} userId={userId} canCreate={canCreateActivity} canEdit={canEditActivity}
      canDelete={canDeleteActivity} canImport={canCreateActivity} canExport={canExport}
      onCreate={() => openModal('activity')} onEdit={activity => openModal('activity', activity)}
      onDuplicate={activity => openModal('activity', { ...activity, id: undefined, date: undefined, time: undefined })}
      onDelete={(activity, options) => deleteRecord?.('activity', activity, options)} onImport={importActivity} importFields={activityImportFields}
      onBulkDelete={payload => bulkDeleteRecords?.('activity', payload)} advancedFilter={false}
      getDeleteImpact={activity => { const linkedAlerts = data.alerts.filter(alert => String(alert.activityId || '') === String(activity.id)).length; return linkedAlerts ? `${linkedAlerts} linked alert${linkedAlerts === 1 ? '' : 's'} will remain as historical records.` : '' }}
      getBulkDeleteImpact={activities => { const ids = new Set(activities.map(activity => String(activity.id))); const linkedAlerts = data.alerts.filter(alert => ids.has(String(alert.activityId || ''))).length; return linkedAlerts ? `${linkedAlerts} linked alerts will remain as historical records.` : '' }}
      advancedConditions={advanced} onAdvancedChange={setAdvanced} notify={notify}
      emptyTitle="No activity records" emptyMessage="Log an update to create the first activity record."/>}
  </div>
}
function Reports({ report, onPeriodChange, settings, setPage, canExport = true }) {
  const [period, setPeriod] = useState('Weekly')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const columns = [{ key: 'label', label: 'Period' }, { key: 'completed', label: 'Completions' }, { key: 'created', label: 'New tasks' }, { key: 'rate', label: 'Completions / intake %' }]
  const series = report?.series || []
  const validRates = series.filter(item => Number.isFinite(item.rate))
  const peak = validRates.reduce((best, item) => !best || item.rate > best.rate ? item : best, null)
  const maxRate = Math.max(100, Math.ceil(Math.max(0, ...validRates.map(item => item.rate)) / 25) * 25)
  const maxIntake = Math.max(1, ...series.map(item => Number(item.created ?? item.planned) || 0))
  const ratio = Number.isFinite(report?.deliveryRate) ? report.deliveryRate : null
  const change = async value => {
    setPeriod(value); setLoading(true); setSelected(null)
    try { await onPeriodChange(value.toLowerCase()) } finally { setLoading(false) }
  }
  return <div className="page-content">
    <div className="report-hero"><div><span className="eyebrow"><span className="eyebrow-dot"/> Delivery intelligence</span><h2>A clearer picture of momentum.</h2><p>Daily, weekly, monthly, quarterly, and annual reports show task completions and intake from the local workspace.</p></div><div className="report-hero-actions"><button className="secondary-button" onClick={() => setPage('tasks')}><Icon name="tasks" size={14}/> Open tasks</button><ExportMenu dataset="delivery-report" query={{ period: period.toLowerCase() }} rows={series} columns={columns} title={`${period} Atlas report`} settings={settings} canExport={canExport} canPrint={canExport}/></div></div>
    <div className="report-tabs">{['Daily','Weekly','Monthly','Quarterly','Yearly'].map(value => <button key={value} className={period === value ? 'selected' : ''} onClick={() => change(value)}>{value}</button>)}</div>
    {loading && <div className="report-loading">Refreshing local report…</div>}
    <div className="report-insight-strip"><div><strong>{ratio === null ? '—' : `${ratio}%`}</strong><span>Completions / intake</span></div><div><strong>{report?.completed || 0}</strong><span>Completed in period</span></div><div><strong>{report?.created || 0}</strong><span>Tasks created</span></div><div><strong>{peak?.label || '—'}</strong><span>{peak ? `Peak ratio · ${peak.rate}%` : 'No intake to compare'}</span></div></div>
    <div className="report-grid"><section className="panel chart-panel"><div className="section-head"><div><h2>{period} completions vs task intake</h2><p>Completions and created tasks are separate event counts; the ratio can exceed 100% when backlog work is completed.</p></div><div className="chart-legend"><span><i className="legend-purple"/> Completed / intake ratio</span><span><i className="legend-muted"/> New task intake</span></div></div>
      <div className="chart-area"><div className="y-axis">{[1, .75, .5, .25, 0].map(tick => <span key={tick}>{Math.round(maxRate * tick)}%</span>)}</div><div className="chart"><div className="grid-lines"><i/><i/><i/><i/><i/></div><div className="bars">{series.map((item, index) => {
        const itemRate = Number.isFinite(item.rate) ? item.rate : null
        const rateHeight = itemRate === null ? 3 : Math.max(itemRate ? 5 : 3, Math.min(100, itemRate / maxRate * 100))
        const intake = Number(item.created ?? item.planned) || 0
        return <button className={`bar-group ${selected?.label === item.label ? 'selected' : ''}`} key={`${item.key || item.label}-${index}`} onClick={() => setSelected(item)}><div className="bar-value" style={{ height: `${rateHeight}%` }}><span>{itemRate === null ? 'No intake' : `${itemRate}%`}</span></div><div className="planned-line" style={{ height: `${intake ? Math.max(intake / maxIntake * 100, 4) : 0}%` }}/><label>{item.label}</label></button>
      })}</div></div></div>
      <div className="chart-footer"><span><strong>{report?.completed || 0}</strong> completed</span><span>{report?.created || 0} tasks created · {report?.activities || 0} activity updates</span></div>
      {selected && <div className="report-drilldown"><div><strong>{selected.label}</strong><span>{selected.completed} completed · {selected.created ?? selected.planned ?? 0} created · {Number.isFinite(selected.rate) ? `${selected.rate}% completions / intake` : 'No intake in this period'}</span></div><button className="text-button" onClick={() => setSelected(null)}>Clear</button></div>}
    </section><section className="panel report-score"><div className="section-head"><div><h2>Completion / intake</h2><p>Not a plan-attainment score</p></div></div><div className="score-ring" style={{ background: `conic-gradient(var(--purple) 0 ${Math.min(100, ratio ?? 0)}%, #ecebf8 ${Math.min(100, ratio ?? 0)}% 100%)` }}><div><strong>{ratio ?? '—'}</strong><span>{ratio === null ? '' : '%'}</span></div></div><StatusPill tone={ratio !== null && ratio >= 100 ? 'on-track' : 'at-risk'}>{ratio === null ? 'No intake to compare' : ratio >= 100 ? 'Completions ≥ intake' : 'Completions < intake'}</StatusPill><p>Completed tasks divided by newly created tasks in the same period. It may exceed 100% when earlier tasks are completed and does not represent an SLA.</p><button className="full-width-button" onClick={() => setPage('alerts')}>View attention items <Icon name="arrow" size={13}/></button></section></div>
    <div className="report-highlights"><div><span className="highlight-icon green"><Icon name="check" size={16}/></span><div><strong>{report?.completed || 0} tasks completed</strong><span>Selected period</span></div></div><div><span className="highlight-icon blue"><Icon name="clock" size={16}/></span><div><strong>{report?.remainingTasks || 0} tasks remaining</strong><span>{report?.activeProjects || 0} active projects</span></div></div><div><span className="highlight-icon orange"><Icon name="warning" size={16}/></span><div><strong>{report?.blockedTasks || 0} blocked tasks</strong><span>{report?.overdue || 0} overdue · {report?.alerts || 0} alerts</span></div></div></div>
  </div>
}
function UserActivityReports({ people = [], settings, canExport = true, canViewAllActivity = false, userPersonId = '' }) {
  const [period, setPeriod] = useState('weekly')
  const [scope, setScope] = useState(canViewAllActivity ? 'all' : String(userPersonId || 'unlinked'))
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedRow, setSelectedRow] = useState(null)
  const effectiveScope = canViewAllActivity ? scope : String(userPersonId || 'unlinked')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setReport(await api.get(`/api/reports/activity/${period}?userId=${encodeURIComponent(effectiveScope)}`)) }
    catch (requestError) { setError(requestError.message || 'The activity report could not be loaded.') }
    finally { setLoading(false) }
  }, [period, effectiveScope])
  useEffect(() => { load() }, [load])
  const rowColumns = [{ key: 'date', label: 'Date' }, { key: 'person', label: 'Person' }, { key: 'project', label: 'Project' }, { key: 'taskId', label: 'Task ID' }, { key: 'task', label: 'Task / Update' }, { key: 'action', label: 'Action' }, { key: 'status', label: 'Status' }, { key: 'summary', label: 'Evidence' }]
  const userColumns = [{ key: 'person', label: 'Person' }, { key: 'role', label: 'Job title' }, { key: 'team', label: 'Team' }, { key: 'tasksTouched', label: 'Tasks touched' }, { key: 'completedTasks', label: 'Completed' }, { key: 'projects', label: 'Projects' }, { key: 'updates', label: 'Updates' }, { key: 'blockers', label: 'Blockers' }]
  const projectColumns = [{ key: 'project', label: 'Project' }, { key: 'projectCode', label: 'Code' }, { key: 'tasksTouched', label: 'Tasks touched' }, { key: 'completedTasks', label: 'Completed' }, { key: 'users', label: 'Users' }]
  const totals = report?.totals || {}
  const reportScope = canViewAllActivity ? (report?.scope || 'All people') : 'My activity'
  return <section className="page-content activity-report-lab"><div className="activity-report-hero"><div><span className="eyebrow"><span className="eyebrow-dot green"/> {canViewAllActivity ? 'People activity intelligence' : 'Personal activity report'}</span><h2>{canViewAllActivity ? 'Who did what, when, and inside which project.' : 'Your work activity, evidence, and progress.'}</h2><p>{canViewAllActivity ? 'Generate detailed per-person or all-person reports by day, week, or month. Every row connects a person to the exact task, project, action, status movement, and evidence source.' : 'Review your individual activity by day, week, or month. Team-wide operational trends remain available as non-identifying aggregates above.'}</p></div><div className="report-builder-controls"><label>Timeframe<select value={period} onChange={event => setPeriod(event.target.value)}><option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option></select></label>{canViewAllActivity ? <label>Scope<select value={scope} onChange={event => setScope(event.target.value)}><option value="all">All people aggregate</option>{people.map(person => <option key={person.id} value={person.id} data-no-i18n>{person.name}</option>)}</select></label> : <label>Scope<span className="readonly-pill">My activity</span></label>}<button className="secondary-button" onClick={load}><Icon name="activity" size={15}/> Refresh</button></div></div>{loading && <div className="report-loading">Generating evidence-backed activity report…</div>}{error && <div className="form-error"><Icon name="warning" size={14}/>{error}<button type="button" className="text-button" onClick={load}>Retry</button></div>}<div className="activity-report-totals"><div><strong>{totals.tasksTouched || 0}</strong><span>Tasks touched</span></div><div><strong>{totals.completedTasks || 0}</strong><span>Completed tasks</span></div><div><strong>{totals.activeUsers || 0}</strong><span>{canViewAllActivity ? 'Active people' : 'Your activity'}</span></div><div><strong>{totals.projects || 0}</strong><span>Projects</span></div><div><strong>{totals.updates || 0}</strong><span>Daily updates</span></div><div><strong>—</strong><span>Time tracking not enabled</span></div></div><div className="activity-report-grid"><section className="panel report-evidence-panel"><div className="section-head"><div><h2>Evidence ledger</h2><p>{reportScope} · {period} breakdown · task and activity events</p></div><ExportMenu dataset="activity-evidence" query={{ period, personId: effectiveScope }} rows={report?.rows || []} columns={rowColumns} title={`${reportScope} ${period} activity evidence`} settings={settings} canExport={canExport} canPrint={canExport}/></div><div className="evidence-list">{(report?.rows || []).slice(0, 12).map(row => <button className={`evidence-row ${selectedRow?.id === row.id ? 'selected' : ''}`} key={row.id} onClick={() => setSelectedRow(row)}><div className="evidence-date"><strong data-no-i18n>{localizedSystemDate(settings, row.date)}</strong><span data-no-i18n>{row.time}</span></div><div className="evidence-main"><div><Avatar name={row.person} small/><strong data-no-i18n>{row.person}</strong></div><p data-no-i18n>{row.taskId ? `${row.taskId} · ` : ''}{row.task}</p><small><span data-no-i18n>{row.project}</span> · {uiText(settings, row.action)} · {uiText(settings, row.status)}</small></div><span className="effort-chip" data-no-i18n>{row.minutes ? `${row.minutes}m` : row.source}</span></button>)}{!(report?.rows || []).length && <EmptyState title="No activity in this period" message="Try another timeframe."/>}</div>{selectedRow && <div className="report-drilldown"><div><strong data-no-i18n>{selectedRow.task}</strong><span>{selectedRow.summary ? <><span data-no-i18n>{selectedRow.summary}</span> · </> : uiText(settings, 'No additional evidence')}<span data-no-i18n>{selectedRow.project}</span></span></div><button className="text-button" onClick={() => setSelectedRow(null)}>Clear</button></div>}</section><aside className="panel report-score user-summary-panel"><div className="section-head"><div><h2>{canViewAllActivity ? 'People summary' : 'Your summary'}</h2><p>{canViewAllActivity ? 'Aggregated by selected timeframe' : 'Your selected timeframe'}</p></div><ExportMenu dataset="activity-summary" query={{ period, personId: effectiveScope }} rows={report?.users || []} columns={userColumns} title={`${reportScope} ${period} people summary`} settings={settings} canExport={canExport} canPrint={canExport}/></div><div className="user-summary-list">{(report?.users || []).map(user => <div className="user-summary-row" key={user.personId}><div><Avatar name={user.person} small/><strong data-no-i18n>{user.person}</strong></div><span>{formattedCount(settings, user.completedTasks)}/{formattedCount(settings, user.tasksTouched)} {uiText(settings, 'tasks')}</span><span>{formattedCount(settings, user.projects)} {uiText(settings, 'projects')}</span><span>{uiText(settings, 'Not tracked')}</span></div>)}</div></aside></div><section className="panel project-table activity-project-panel"><div className="section-head"><div><h2>Project contribution matrix</h2><p>{canViewAllActivity ? 'Aggregated task performance by project.' : 'Your task contribution by project.'}</p></div><ExportMenu dataset="project-contributions" query={{ period, personId: canViewAllActivity ? effectiveScope : 'all' }} rows={report?.projects || []} columns={projectColumns} title={`${period} project contribution matrix`} settings={settings} canExport={canExport} canPrint={canExport}/></div><div className="project-contribution-grid">{(report?.projects || []).map(project => <div key={project.project} className="project-contribution-card"><strong data-no-i18n>{project.project}</strong><span data-no-i18n>{project.projectCode}</span><ProgressBar value={Math.min(100, project.completedTasks * 18)} color="purple"/><p>{formattedCount(settings, project.completedTasks)} {uiText(settings, 'completed')} · {formattedCount(settings, project.tasksTouched)} {uiText(settings, 'touched')} · {formattedCount(settings, project.users)} {uiText(settings, 'users')} · {uiText(settings, 'effort not tracked')}</p></div>)}</div></section></section>
}
function Alerts({ data, refresh, openModal, canManage, canManageTasks = false, userPersonId = '', canResolve = false, canExport = true, userId = '', deleteRecord, bulkEditRecords, bulkDeleteRecords, importRecords, inlineEditRecord, notify }) {
  const [filter, setFilter] = useState('Open')
  const [view, setView] = useState('list')
  const [advanced, setAdvanced] = useState([])
  const fields = configuredColumns(data.settings, 'alerts', [
    { key: 'title', label: 'Alert' }, { key: 'type', label: 'Type' }, { key: 'project', label: 'Project' },
    { key: 'resolved', label: 'Resolved' }, { key: 'time', label: 'Created' }
  ]).map(column => ({
    ...column,
    type: column.key === 'time' ? 'date' : column.key === 'resolved' ? 'boolean' : 'text',
    getValue: alert => column.key === 'time' ? alert.createdAt || alert.time : alert[column.key],
    inlineEditable: column.key === 'resolved',
    ...(column.key === 'resolved' ? { inlineOptions: [['true', 'Resolved'], ['false', 'Open']] } : {})
  }))
  const canCreate = canManage && actionVisible(data.settings, 'create')
  const canEdit = canManage && actionVisible(data.settings, 'edit')
  const canDelete = canManage && actionVisible(data.settings, 'delete')
  const canResolveAlert = alert => canResolve && actionVisible(data.settings, 'edit') && (canManageTasks || Boolean(alert.taskId && data.tasks.some(task => String(task.numericId) === String(alert.taskId) && String(task.assigneeId || '') === String(userPersonId || ''))))
  const filteredRows = data.alerts.filter(alert => filter === 'All' || (filter === 'Open' ? !alert.resolved : alert.resolved))
  const rows = applyAdvancedFilters(filteredRows, advanced)
  const toggle = async alert => { if (!canResolveAlert(alert)) return; await api.patch(`/api/alerts/${alert.id}`, { resolved: !alert.resolved }); refresh() }
  const bulkFields = canManage ? [{ key: 'resolved', label: 'Resolution', type: 'boolean', options: [['true', 'Resolved'], ['false', 'Open']] }] : canResolve ? [{ key: 'resolved', label: 'Resolution', type: 'boolean', options: [['true', 'Resolved'], ['false', 'Open']] }] : []
  const importFields = [
    { key: 'title', label: 'Title' }, { key: 'body', label: 'Details' }, { key: 'type', label: 'Type' }, { key: 'tone', label: 'Tone' },
    { key: 'projectId', label: 'Project ID' }, { key: 'taskId', label: 'Task ID' }
  ]
  return <div className="page-content">
    <div className="alerts-summary"><div><span className="eyebrow"><span className="eyebrow-dot orange"/> Attention center</span><h2>Nothing should surprise you.</h2><p>Risks and blockers are linked to work and included in exportable reporting.</p></div><div className="alert-count"><strong data-no-i18n>{formattedCount(data.settings, data.alerts.filter(alert => !alert.resolved).length)}</strong><span>open alerts</span></div></div>
    <div className="toolbar"><div className="filter-tabs">{['Open', 'All', 'Resolved'].map(tab => <button className={filter === tab ? 'selected' : ''} key={tab} onClick={() => setFilter(tab)}>{tab}<span data-no-i18n>{formattedCount(data.settings, tab === 'Open' ? data.alerts.filter(alert => !alert.resolved).length : tab === 'Resolved' ? data.alerts.filter(alert => alert.resolved).length : data.alerts.length)}</span></button>)}</div><div className="toolbar-actions"><div className="view-toggle"><button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}>List</button><button className={view === 'table' ? 'selected' : ''} onClick={() => setView('table')}>Table</button></div><AdvancedFilter settings={data.settings} filterKey="alerts" fields={fields} onApply={setAdvanced} appliedConditions={advanced}/>{view === 'list' && <ExportMenu dataset="alerts" rows={rows} columns={fields} title="Atlas alerts" settings={data.settings} canExport={canExport} canPrint={canExport} exportScopes={{ selected: [], filtered: rows, all: data.alerts }}/>}{view === 'list' && canCreate && <button className="primary-button" onClick={() => openModal('alert')}><Icon name="plus" size={15}/> New alert</button>}</div></div>
    {view === 'table' ? <RecordTable
      entity="alerts" title="Alerts" totalRecordCount={data.alerts.length} records={filteredRows} columns={fields} dataset="alerts" settings={data.settings} userId={userId}
      canCreate={canCreate} canEdit={canEdit} canBulkEdit={canManage || canResolve} canDelete={canDelete} canImport={canCreate} canExport={canExport}
      onCreate={() => openModal('alert')} onEdit={alert => openModal('alert', alert)} onDuplicate={alert => openModal('alert', { ...alert, id: undefined, title: `Copy of ${alert.title}` })}
      onDelete={(alert, options) => deleteRecord?.('alert', alert, options)}
      onBulkEdit={payload => bulkEditRecords?.('alert', payload)} onBulkDelete={payload => bulkDeleteRecords?.('alert', payload)}
      onImport={importRecords} onInlineEdit={(alert, field, value) => inlineEditRecord?.(alert, field, value)}
      canInlineEdit={(alert, column) => column.key === 'resolved' && canResolveAlert(alert)}
      bulkFields={bulkFields} importFields={importFields} advancedFilter={false} advancedConditions={advanced} onAdvancedChange={setAdvanced} notify={notify}
      emptyTitle="No alerts in this workspace" emptyMessage="Create an alert or import alert records."/>
      : <div className="alert-list">{rows.map(alert => <div className={`alert-row ${alert.resolved ? 'alert-resolved' : ''}`} key={alert.id}><span className={`alert-type alert-${alert.tone}`}><Icon name={alert.type === 'blocker' || alert.type === 'risk' || alert.type === 'overdue' ? 'warning' : 'alerts'} size={18}/></span><div className="alert-content"><div className="alert-title-row"><h3 data-no-i18n>{alert.title}</h3><span data-no-i18n>{alert.createdAt ? formatLocalizedDate(alert.createdAt, data.settings, { dateStyle: 'short', timeStyle: 'short' }) : uiText(data.settings, alert.time)}</span></div><p data-no-i18n>{alert.body}</p><div className="alert-meta"><span data-no-i18n>{alert.project}</span>{alert.resolved && <StatusPill tone="resolved">Resolved</StatusPill>}</div></div>{canResolveAlert(alert) && <button className={alert.resolved ? 'secondary-button' : 'resolve-button'} onClick={() => toggle(alert)}>{alert.resolved ? 'Re-open' : 'Mark resolved'}{!alert.resolved && <Icon name="check" size={14}/>}</button>}{(canEdit || canDelete) && <button className="icon-button subtle" onClick={() => openModal('alert', alert)}><Icon name="more" size={16}/></button>}</div>)}{!rows.length && <EmptyState title="All clear" message="No alerts in this view."/>}</div>}
  </div>
}

export { Overview, Projects, MyWork, People, ActivityLog, Reports, UserActivityReports, Alerts }
