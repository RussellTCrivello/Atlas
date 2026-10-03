export function createWorkspaceServices({ getStore, todayLA, addDays, fmt, daysBetween, isPlainObject, validIsoDate, permissionsFor, can, isDone, terminalTaskStates }) {
  const store = new Proxy(Object.create(null), {
    get(_target, property) { const current = getStore(); return current == null ? undefined : Reflect.get(current, property) },
    set(_target, property, value) { const current = getStore(); if (current == null) throw new Error('Workspace state is not initialized'); return Reflect.set(current, property, value) }
  })
function taskCode(task) {
  const project = store?.projects?.find(project => String(project.id) === String(task.projectId)) || {}
  return `${project.code || 'TASK'}-${String(task.id).padStart(3, '0')}`
}
function teamById(id) { return store.teams.find(t => t.id === id) }
function personById(id) { return store.people.find(p => p.id === id) }
function projectById(id) { return store.projects.find(p => String(p.id) === String(id)) }
function taskById(id) { return store.tasks.find(t => String(t.id) === String(id)) }
function validText(value, maxLength = 200) { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength }
function validEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) }
function validDateValue(value) { return validIsoDate(value) }
function validOptionalDate(value) { return value === '' || value === undefined || value === null || validDateValue(value) }
function validCustomFields(value, depth = 0) {
  if (value === undefined || value === null) return true
  if (depth > 8) return false
  if (typeof value === 'string') return value.length <= 8000
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value === 'boolean') return true
  if (Array.isArray(value)) return value.length <= 1000 && value.every(item => validCustomFields(item, depth + 1))
  if (!isPlainObject(value)) return false
  return Object.entries(value).length <= 1000 && Object.entries(value).every(([key, item]) => key.length <= 200 && !['__proto__', 'prototype', 'constructor'].includes(key) && validCustomFields(item, depth + 1))
}
function customFieldInputError(entity, value) {
  const label = ({ projects: 'Project', tasks: 'Task', people: 'Person', teams: 'Team', milestones: 'Milestone', activities: 'Activity', alerts: 'Alert' })[entity] || 'Record'
  if (!validCustomFields(value)) return `${label} custom fields contain invalid data`
  const fields = store.settings?.customFields?.[entity] || []
  for (const field of fields) {
    if (!isPlainObject(field) || !field.key) continue
    const current = value?.[field.key]
    const empty = current === undefined || current === null || (typeof current === 'string' && !current.trim()) || (Array.isArray(current) && current.length === 0)
    if (field.required && empty) return `${field.label || field.key} is required`
    if (empty) continue
    if (field.type === 'number' && (typeof current !== 'number' && typeof current !== 'string' || !Number.isFinite(Number(current)))) return `${field.label || field.key} must be a valid number`
    if (field.type === 'date' && !validIsoDate(current)) return `${field.label || field.key} must be a valid calendar date`
    if (field.type === 'datetime' && (typeof current !== 'string' || !Number.isFinite(Date.parse(current)))) return `${field.label || field.key} must be a valid date and time`
    if (field.type === 'checkbox' && typeof current !== 'boolean') return `${field.label || field.key} must be true or false`
  }
  return ''
}
function personReferenceExists(value) { return value === '' || value === null || value === undefined || Boolean(personById(value)) }
function teamReferenceExists(value) { return value === '' || value === null || value === undefined || Boolean(teamById(value)) }
function projectReferenceExists(value) { return value === '' || value === null || value === undefined || Boolean(projectById(value)) }
function taskReferenceExists(value) { return value === '' || value === null || value === undefined || Boolean(taskById(value)) }
function publicUser(user) { return user && { id: user.id, name: user.name, email: user.email, role: user.role, personId: user.personId, avatarColor: user.avatarColor, active: user.active !== false, permissions: permissionsFor(user.role) } }
function publicAccessUser(user) {
  const person = personById(user.personId) || {}
  return { ...publicUser(user), personName: person.name || user.name, team: teamById(person.teamId)?.name || 'Workspace', lastLoginAt: user.lastLoginAt || '', createdAt: user.createdAt || '', sample: Boolean(user.sample) }
}

function dueTone(task, today) { if (isDone(task)) return 'done'; if (task.dueDate === today) return 'today'; if (task.dueDate && task.dueDate < today) return 'overdue'; return 'soon' }
function dueLabel(task, today) {
  if (!task.dueDate) return 'No date'
  const diff = daysBetween(today, task.dueDate)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d late`
  return fmt(task.dueDate)
}
function projectProgress(project, projectTasks = store.tasks.filter(task => String(task.projectId) === String(project.id))) {
  if (!projectTasks.length) return 0
  return Math.round(projectTasks.filter(isDone).length / projectTasks.length * 100)
}
function projectHealth(project, today, projectTasks = store.tasks.filter(task => String(task.projectId) === String(project.id))) {
  if (project.status === 'Completed') return 'Completed'
  if (project.status === 'At risk') return 'At risk'
  const overdue = projectTasks.some(task => !isDone(task) && task.dueDate && task.dueDate < today)
  return overdue ? 'At risk' : 'On track'
}
function taskPublic(task, today, indexes = {}) {
  const project = indexes.projects?.get(String(task.projectId)) || projectById(task.projectId) || {}
  const person = indexes.people?.get(String(task.assigneeId)) || personById(task.assigneeId) || {}
  return {
    numericId: task.id,
    id: `${project.code || 'TASK'}-${String(task.id).padStart(3, '0')}`,
    title: task.title,
    projectId: task.projectId,
    project: project.name || 'Workspace',
    assigneeId: task.assigneeId,
    assignee: person.name || 'Unassigned',
    assigneeColor: person.color || 'purple',
    priority: task.priority || 'Medium',
    dueDate: task.dueDate,
    due: dueLabel(task, today),
    dueTone: dueTone(task, today),
    status: task.status || 'To do',
    type: task.type || 'Development',
    blocked: Boolean(task.blocked),
    tags: Array.isArray(task.tags) ? task.tags : [],
    createdAt: task.createdAt,
    completedAt: task.completedAt || '',
    customFields: task.customFields || {}
  }
}
function projectPublic(project, today, taskRows = undefined, indexes = {}) {
  const projectTasks = taskRows || store.tasks.filter(task => String(task.projectId) === String(project.id))
  const team = indexes.teams?.get(String(project.teamId)) || teamById(project.teamId) || {}
  const owner = indexes.people?.get(String(project.ownerId)) || personById(project.ownerId) || {}
  const memberIds = [...new Set(projectTasks.map(task => task.assigneeId).concat(project.ownerId).filter(Boolean))]
  const members = memberIds.map(id => indexes.people?.get(String(id)) || personById(id)).filter(Boolean)
  const milestoneRows = store.milestones.filter(milestone => String(milestone.projectId) === String(project.id)).map(milestone => ({ ...milestone, projectId: project.id }))
  const diff = project.deadline ? daysBetween(today, project.deadline) : null
  return {
    id: `project-${project.id}`,
    numericId: project.id,
    name: project.name,
    code: project.code,
    description: project.description,
    createdAt: project.createdAt || '',
    teamId: project.teamId,
    team: team.name || 'Workspace',
    ownerId: project.ownerId,
    owner: owner.name || 'Unassigned',
    color: project.color || team.color || 'purple',
    status: project.status,
    health: projectHealth(project, today, projectTasks),
    progress: projectProgress(project, projectTasks),
    deadlineDate: project.deadline,
    deadline: fmt(project.deadline),
    days: diff == null ? 'No date' : diff < 0 ? `${Math.abs(diff)} days late` : `${diff} days`,
    members: members.map(p => p.name),
    memberColors: Object.fromEntries(members.map(p => [p.name, p.color])),
    milestoneRows,
    customFields: project.customFields || {}
  }
}
function personPublic(person) {
  const team = teamById(person.teamId) || {}
  return {
    id: person.id, name: person.name, email: person.email, jobTitle: person.jobTitle, role: person.jobTitle,
    teamId: person.teamId, team: team.name || 'Workspace', focus: person.focus, capacity: person.capacity,
    load: person.capacity, status: person.status, color: person.color || team.color || 'purple', customFields: person.customFields || {}
  }
}
function activityPublic(activity, today) {
  const person = personById(activity.personId) || {}
  return { ...activity, customFields: activity.customFields || {}, person: person.name || 'Unknown', personColor: person.color || 'purple', isToday: activity.date === today }
}
function alertPublic(alert) {
  const project = projectById(alert.projectId) || {}
  return { ...alert, customFields: alert.customFields || {}, project: project.name || 'Workspace', time: alert.createdAt ? fmt(alert.createdAt) : 'Now' }
}
function dateKeyForValue(value) {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validIsoDate(value) ? value : ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? todayLA(date) : ''
}
function bucketFor(period, dateValue, today) {
  const dateKey = dateKeyForValue(dateValue)
  if (!dateKey) return ''
  const date = new Date(`${dateKey}T12:00:00Z`)
  const now = new Date(`${today}T12:00:00Z`)
  if (period === 'daily') return dateValue
  if (period === 'weekly') {
    const day = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() - day + 1)
    return date.toISOString().slice(0, 10)
  }
  if (period === 'monthly') return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  if (period === 'quarterly') return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`
  return String(date.getUTCFullYear())
}
function makeBuckets(period, today) {
  const base = new Date(`${today}T12:00:00Z`)
  const buckets = []
  const count = period === 'daily' ? 10 : period === 'weekly' ? 10 : period === 'monthly' ? 12 : period === 'quarterly' ? 8 : 5
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(base)
    if (period === 'daily') date.setUTCDate(base.getUTCDate() - i)
    if (period === 'weekly') date.setUTCDate(base.getUTCDate() - i * 7)
    if (period === 'monthly') date.setUTCMonth(base.getUTCMonth() - i, 1)
    if (period === 'quarterly') date.setUTCMonth(base.getUTCMonth() - i * 3, 1)
    if (period === 'yearly') date.setUTCFullYear(base.getUTCFullYear() - i, 0, 1)
    const iso = date.toISOString().slice(0, 10)
    const key = bucketFor(period, iso, today)
    let label = fmt(iso, { month: 'short', day: 'numeric' })
    if (period === 'weekly') label = `Wk ${fmt(key, { month: 'short', day: 'numeric' })}`
    if (period === 'monthly') label = fmt(iso, { month: 'short' })
    if (period === 'quarterly') label = key.split('-')[1]
    if (period === 'yearly') label = String(new Date(`${iso}T12:00:00Z`).getUTCFullYear())
    buckets.push({ key, label, completed: 0, created: 0, planned: 0, rate: 0 })
  }
  return buckets
}
function reportFor(period = 'weekly') {
  period = String(period).toLowerCase()
  if (!['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(period)) period = 'weekly'
  const today = todayLA()
  const buckets = makeBuckets(period, today)
  const byKey = Object.fromEntries(buckets.map(bucket => [bucket.key, bucket]))
  store.tasks.forEach(task => {
    const createdKey = bucketFor(period, task.createdAt || today, today)
    if (byKey[createdKey]) byKey[createdKey].created += 1
    if (task.completedAt) {
      const completedKey = bucketFor(period, task.completedAt, today)
      if (byKey[completedKey]) byKey[completedKey].completed += 1
    }
  })
  buckets.forEach(bucket => {
    bucket.planned = bucket.created // Backward-compatible field; this is intake, not a committed plan.
    bucket.rate = bucket.created ? Math.round((bucket.completed / bucket.created) * 100) : null
  })
  const completed = buckets.reduce((sum, b) => sum + b.completed, 0)
  const created = buckets.reduce((sum, b) => sum + b.created, 0)
  const planned = created
  const remainingTasks = store.tasks.filter(t => !isDone(t)).length
  const activeProjects = store.projects.filter(p => p.status !== 'Completed').length
  const completedProjects = store.projects.filter(p => p.status === 'Completed').length
  const blockedTasks = store.tasks.filter(t => t.blocked && !isDone(t)).length
  const overdue = store.tasks.filter(t => !isDone(t) && t.dueDate && t.dueDate < today).length
  const alerts = store.alerts.filter(a => !a.resolved).length
  return {
    period,
    series: buckets,
    completed,
    created,
    planned,
    deliveryRate: planned ? Math.round(completed / planned * 100) : null,
    remainingTasks,
    activeProjects,
    completedProjects,
    blockedTasks,
    overdue,
    alerts,
    activities: store.activities.filter(a => buckets.some(b => b.key === bucketFor(period, a.date, today))).length
  }
}
function dashboard(today, tasksPublic, projectsPublic, alertsPublic, user) {
  const openTasks = tasksPublic.filter(task => !isDone(task)).length
  const activeProjects = projectsPublic.filter(project => project.health !== 'Completed').length
  const atRisk = projectsPublic.filter(project => project.health === 'At risk').length
  const onTrack = activeProjects ? Math.round((activeProjects - atRisk) / activeProjects * 100) : 100
  const isAdministrator = user?.role === 'Administrator'
  const personId = String(user?.personId || '')
  const visibleActivities = isAdministrator
    ? store.activities
    : personId ? store.activities.filter(activity => String(activity.personId || '') === personId) : []
  const todayActivities = visibleActivities.filter(activity => activity.date === today)
  const yesterdayActivities = visibleActivities.filter(activity => activity.date === addDays(today, -1))
  const visibleTasks = personId ? tasksPublic.filter(task => String(task.assigneeId || '') === personId) : []
  const pulseItem = (activity, key, icon = 'bolt') => {
    const person = personById(activity.personId) || {}
    return { title: person.name || 'Unknown', detail: activity[key] || 'No update', time: activity.time || '', icon }
  }
  const weekStart = addDays(today, -6)
  const teamActivity = store.activities.filter(activity => activity.date >= weekStart && activity.date <= today)
  const teamAggregate = {
    updatesToday: store.activities.filter(activity => activity.date === today).length,
    updatesYesterday: store.activities.filter(activity => activity.date === addDays(today, -1)).length,
    updatesThisWeek: teamActivity.length,
    blockersToday: store.activities.filter(activity => activity.date === today && Boolean(activity.blocked)).length,
    blockedTasks: store.tasks.filter(task => task.blocked && !isDone(task)).length
  }
  const blockedTasks = isAdministrator ? tasksPublic.filter(task => task.blocked && !isDone(task)) : visibleTasks.filter(task => task.blocked && !isDone(task))
  return {
    stats: {
      activeProjects, openTasks, needsAttention: store.alerts.filter(alert => !alert.resolved).length,
      onTrack, completedTasks: tasksPublic.filter(task => isDone(task)).length
    },
    dailyPulse: {
      yesterday: yesterdayActivities.slice(0, 4).map(activity => pulseItem(activity, 'yesterday', 'check')),
      today: todayActivities.slice(0, 4).map(activity => pulseItem(activity, 'today', 'bolt')),
      blocked: todayActivities.filter(activity => activity.blocked).map(activity => pulseItem(activity, 'blocked', 'warning'))
        .concat(blockedTasks.slice(0, 3).map(task => ({ title: task.title, detail: isAdministrator ? `${task.project} · ${task.assignee}` : task.project, time: task.due, icon: 'warning' }))),
      upcoming: store.milestones.slice(0, 4).map(milestone => ({ title: milestone.name, detail: projectById(milestone.projectId)?.name || 'Project', time: fmt(milestone.dueDate), icon: 'calendar' })),
      teamAggregate
    },
    myTasks: visibleTasks.filter(task => !isDone(task)).slice(0, 6)
  }
}
function settingsForUser(user) {
  if (user?.role === 'Administrator') return store.settings
  const source = store.settings || {}
  const workspace = source.workspace || {}
  const ui = source.interface || {}
  const localization = source.localization || {}
  const customFields = Object.fromEntries(Object.entries(source.customFields || {}).map(([entity, definitions]) => [entity,
    Array.isArray(definitions) ? definitions.filter(isPlainObject).map(definition => ({
      key: definition.key, label: definition.label, type: definition.type,
      required: definition.required, visible: definition.visible, options: definition.options
    })) : []
  ]))
  const roles = Object.fromEntries(Object.entries(source.permissions?.roles || {}).map(([name, definition]) => [name, {
    name, summary: definition?.summary || definition?.description || name, description: definition?.description || definition?.summary || name
  }]))
  const modules = Object.fromEntries(Object.entries(source.modules || {}).map(([name, module]) => [name, {
    enabled: module?.enabled !== false, labelKey: module?.labelKey || `nav.${name}`, icon: module?.icon || name
  }]))
  return {
    workspace: {
      name: workspace.name, unit: workspace.unit, applicationName: workspace.applicationName,
      defaultTimezone: workspace.defaultTimezone, regionalFormats: workspace.regionalFormats,
      branding: { primaryColor: workspace.branding?.primaryColor, accentColor: workspace.branding?.accentColor, reportLogo: workspace.branding?.reportLogo }
    },
    workspaceName: source.workspaceName || workspace.name || 'Atlas Workspace',
    workspaceUnit: source.workspaceUnit || workspace.unit || 'Operations',
    interface: {
      theme: ui.theme, colors: ui.colors, density: ui.density, spacing: ui.spacing, typography: ui.typography,
      sidebarBehavior: ui.sidebarBehavior, navigationVisibility: ui.navigationVisibility,
      navigationOrder: ui.navigationOrder, dashboardLayouts: ui.dashboardLayouts, defaultLandingPage: ui.defaultLandingPage,
      tableBehavior: ui.tableBehavior, tableColumns: ui.tableColumns, formLayouts: ui.formLayouts,
      actionVisibility: ui.actionVisibility, cardLayouts: ui.cardLayouts, animations: ui.animations, accessibility: ui.accessibility
    },
    localization: {
      activeLanguages: localization.activeLanguages, defaultLanguage: localization.defaultLanguage,
      fallbackLanguage: localization.fallbackLanguage, userLanguagePreference: localization.userLanguagePreference,
      textDirectionByLanguage: localization.textDirectionByLanguage, dateFormats: localization.dateFormats,
      numberFormats: localization.numberFormats, currencyFormats: localization.currencyFormats,
      translations: localization.translations, languagePackages: localization.languagePackages
    },
    language: source.language || localization.defaultLanguage || 'en',
    density: source.density || ui.density || 'comfortable',
    dateFormat: source.dateFormat || workspace.regionalFormats?.date || 'MMM d, yyyy',
    defaultTaskView: source.defaultTaskView || ui.cardLayouts?.tasks || 'board',
    pageSize: source.pageSize || ui.tableBehavior?.pageSize || 50,
    printTemplate: source.printTemplate || source.reports?.defaultTemplate || 'executive',
    theme: source.theme || ui.theme || 'light',
    accentColor: source.accentColor || ui.colors?.accent || 'purple',
    sidebarMode: source.sidebarMode || ui.sidebarBehavior || 'expanded',
    defaultPage: source.defaultPage || ui.defaultLandingPage || 'overview',
    showAnimations: source.showAnimations !== false && ui.animations !== false,
    enabledPages: source.enabledPages || [],
    workflows: { task: { states: source.workflows?.task?.states || [] } },
    permissions: { roles },
    modules,
    customFields,
    exports: {
      formats: source.exports?.formats || ['csv', 'xlsx', 'json', 'pdf', 'print'],
      includeBranding: source.exports?.includeBranding !== false,
      pdf: { orientation: source.exports?.pdf?.orientation || 'landscape', margins: source.exports?.pdf?.margins || 'standard' }
    },
    reports: { defaultTemplate: source.reports?.defaultTemplate || 'executive' }
  }
}
function bootstrapFor(user) {
  const today = todayLA()
  const isAdministrator = user?.role === 'Administrator'
  const peopleById = new Map(store.people.map(person => [String(person.id), person]))
  const projectsById = new Map(store.projects.map(project => [String(project.id), project]))
  const teamsById = new Map(store.teams.map(team => [String(team.id), team]))
  const tasksByProject = new Map()
  for (const task of store.tasks) {
    const key = String(task.projectId)
    if (!tasksByProject.has(key)) tasksByProject.set(key, [])
    tasksByProject.get(key).push(task)
  }
  const teams = store.teams.map(team => ({ ...team, peopleCount: store.people.filter(person => person.teamId === team.id).length }))
  const people = store.people.map(personPublic)
  const indexes = { people: peopleById, projects: projectsById, teams: teamsById }
  const projects = store.projects.map(project => projectPublic(project, today, tasksByProject.get(String(project.id)) || [], indexes))
  const tasks = store.tasks.map(task => taskPublic(task, today, indexes)).sort((left, right) => String(left.dueDate || '').localeCompare(String(right.dueDate || '')))
  const visibleActivities = isAdministrator
    ? store.activities
    : user?.personId ? store.activities.filter(activity => String(activity.personId || '') === String(user.personId)) : []
  const activity = visibleActivities.map(row => activityPublic(row, today)).sort((left, right) => `${right.date} ${right.time}`.localeCompare(`${left.date} ${left.time}`))
  const visibleAlerts = isAdministrator
    ? store.alerts
    : store.alerts.filter(alert => alert.source !== 'activity-blocker' || String(alert.personId || '') === String(user?.personId || ''))
  const alerts = visibleAlerts.map(alertPublic).sort((left, right) => Number(left.resolved) - Number(right.resolved) || String(right.createdAt).localeCompare(String(left.createdAt)))
  const users = isAdministrator && can(user, 'manageUsers') ? store.users.map(publicAccessUser) : []
  const teamActivitySummary = {
    today: store.activities.filter(activityRow => activityRow.date === today).length,
    yesterday: store.activities.filter(activityRow => activityRow.date === addDays(today, -1)).length,
    thisWeek: store.activities.filter(activityRow => activityRow.date >= addDays(today, -6) && activityRow.date <= today).length,
    blockersToday: store.activities.filter(activityRow => activityRow.date === today && Boolean(activityRow.blocked)).length
  }
  return {
    today, user: publicUser(user), settings: settingsForUser(user), teams, people, users, projects, tasks, activity, alerts,
    teamActivitySummary, dashboard: dashboard(today, tasks, projects, alerts, user), reports: reportFor('weekly')
  }
}

function workLogPublic(log, period = 'daily') {
  const person = personById(log.personId) || {}
  const project = projectById(log.projectId) || {}
  const task = log.taskId ? taskById(log.taskId) : null
  const projectCode = project.code || log.projectCode || ''
  return {
    id: log.id,
    date: log.date,
    time: log.time || '',
    periodKey: bucketFor(period, log.date, todayLA()),
    periodLabel: bucketLabel(period, log.date),
    personId: log.personId,
    person: person.name || 'Unknown',
    role: person.jobTitle || '',
    projectId: log.projectId || '',
    project: project.name || log.projectName || 'Workspace',
    projectCode,
    taskId: task ? taskCode(task) : log.taskId ? `${projectCode || 'TASK'}-${String(log.taskId).padStart(3, '0')}` : '',
    taskNumericId: log.taskId || '',
    task: task?.title || log.taskTitle || (log.taskId ? 'Deleted task' : 'Daily update'),
    action: log.action || 'Task event',
    statusFrom: log.statusFrom || '',
    statusTo: log.statusTo || '',
    status: log.statusTo || log.action || 'Task event',
    summary: log.summary || '',
    minutes: Math.max(0, Number(log.minutes) || 0),
    source: log.source || 'Task event'
  }
}
function bucketLabel(period, dateValue) {
  if (period === 'daily') return fmt(dateValue, { weekday: 'short', month: 'short', day: 'numeric' })
  if (period === 'weekly') return `Week of ${fmt(bucketFor('weekly', dateValue, todayLA()), { month: 'short', day: 'numeric' })}`
  if (period === 'monthly') return fmt(`${dateValue.slice(0, 7)}-01`, { month: 'long', year: 'numeric' })
  return fmt(dateValue)
}
function isCompletionEvent(row) {
  if (!row.taskNumericId) return false
  const terminal = terminalTaskStates()
  const wasDone = terminal.includes(row.statusFrom) || row.statusFrom === 'Done'
  const isNowDone = terminal.includes(row.statusTo) || row.statusTo === 'Done'
  if (isNowDone && !wasDone) return true
  return !row.statusFrom && /^(created and completed|completed task)$/i.test(row.action || '')
}
function completedTaskIds(rows) { return new Set(rows.filter(isCompletionEvent).map(row => String(row.taskNumericId))) }
function activityReportFor(period = 'weekly', userId = 'all') {
  period = String(period).toLowerCase()
  if (!['daily', 'weekly', 'monthly'].includes(period)) period = 'weekly'
  const today = todayLA()
  const buckets = makeBuckets(period, today).slice(period === 'daily' ? -14 : period === 'weekly' ? -8 : -12)
  const bucketKeys = new Set(buckets.map(bucket => bucket.key))
  const includeUser = value => !userId || userId === 'all' || String(value) === String(userId)
  // Activity records are authoritative for daily updates; work-log rows only represent task events.
  const detailRows = (store.workLogs || [])
    .filter(log => log.taskId)
    .map(log => workLogPublic(log, period))
    .filter(row => bucketKeys.has(row.periodKey) && includeUser(row.personId))
  const activityRows = store.activities.map(activity => {
    const person = personById(activity.personId) || {}
    return {
      id: `activity_${activity.id}`, date: activity.date, time: activity.time || '',
      periodKey: bucketFor(period, activity.date, today), periodLabel: bucketLabel(period, activity.date),
      personId: activity.personId, person: person.name || 'Unknown', role: person.jobTitle || '',
      projectId: '', project: 'Workspace', projectCode: '', taskId: '', taskNumericId: '', task: 'Daily update',
      action: activity.blocked ? 'Raised blocker' : 'Logged update', statusFrom: '',
      statusTo: activity.blocked ? 'Blocked' : 'Confirmed', status: activity.blocked ? 'Blocked' : 'Confirmed',
      summary: [activity.yesterday && `Yesterday: ${activity.yesterday}`, activity.today && `Today: ${activity.today}`, activity.blocked && `Blocked: ${activity.blocked}`, activity.upcoming && `Upcoming: ${activity.upcoming}`].filter(Boolean).join(' | '),
      minutes: 0, source: 'Activity log'
    }
  }).filter(row => bucketKeys.has(row.periodKey) && includeUser(row.personId))
  const allRows = [...detailRows, ...activityRows].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
  const people = store.people.filter(person => includeUser(person.id))
  const userSummaries = people.map(person => {
    const rows = allRows.filter(row => row.personId === person.id)
    const taskRows = rows.filter(row => row.taskNumericId)
    const projectKeys = new Set(taskRows.map(row => String(row.projectId || row.project)).filter(Boolean))
    return {
      personId: person.id, person: person.name, role: person.jobTitle, team: teamById(person.teamId)?.name || 'Workspace',
      tasksTouched: new Set(taskRows.map(row => String(row.taskNumericId))).size,
      completedTasks: completedTaskIds(taskRows).size,
      projects: projectKeys.size,
      updates: rows.filter(row => row.source === 'Activity log').length,
      blockers: rows.filter(row => row.statusTo === 'Blocked' || row.summary.toLowerCase().includes('blocked')).length,
      minutes: rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0)
    }
  }).filter(summary => summary.tasksTouched || summary.updates || userId !== 'all')
  const projectGroups = new Map()
  allRows.filter(row => row.projectId && row.project !== 'Workspace').forEach(row => {
    const key = String(row.projectId || row.project)
    const group = projectGroups.get(key) || { projectId: row.projectId, project: row.project, projectCode: row.projectCode, taskIds: new Set(), completedIds: new Set(), users: new Set(), minutes: 0 }
    if (row.taskNumericId) group.taskIds.add(String(row.taskNumericId))
    if (isCompletionEvent(row)) group.completedIds.add(String(row.taskNumericId))
    if (row.person) group.users.add(row.person)
    group.minutes += Number(row.minutes || 0)
    projectGroups.set(key, group)
  })
  const projectSummaries = [...projectGroups.values()].map(group => ({ projectId: group.projectId, project: group.project, projectCode: group.projectCode, tasksTouched: group.taskIds.size, completedTasks: group.completedIds.size, users: group.users.size, minutes: group.minutes }))
  const series = buckets.map(bucket => {
    const rows = allRows.filter(row => row.periodKey === bucket.key)
    const taskRows = rows.filter(row => row.taskNumericId)
    return {
      key: bucket.key, label: bucket.label,
      tasksTouched: new Set(taskRows.map(row => String(row.taskNumericId))).size,
      completedTasks: completedTaskIds(taskRows).size,
      users: new Set(rows.map(row => row.personId).filter(Boolean)).size,
      updates: rows.filter(row => row.source === 'Activity log').length,
      minutes: rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0)
    }
  })
  return {
    period, userId, scope: userId === 'all' ? 'All people' : (personById(userId)?.name || 'Selected person'),
    generatedAt: new Date().toISOString(), series, users: userSummaries, projects: projectSummaries, rows: allRows,
    totals: {
      tasksTouched: new Set(allRows.filter(row => row.taskNumericId).map(row => String(row.taskNumericId))).size,
      completedTasks: completedTaskIds(allRows).size,
      activeUsers: new Set(allRows.map(row => row.personId).filter(Boolean)).size,
      projects: projectSummaries.length,
      updates: allRows.filter(row => row.source === 'Activity log').length,
      blockers: allRows.filter(row => row.statusTo === 'Blocked' || row.summary.toLowerCase().includes('blocked')).length,
      minutes: allRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0)
    }
  }
}

function nextProjectId() { const value = store.counters.project || (store.projects.reduce((maximum, project) => Math.max(maximum, Number(project.id) || 0), 0) + 1); store.counters.project = value + 1; return value }
function nextTaskId() { const value = store.counters.task || (store.tasks.reduce((maximum, task) => Math.max(maximum, Number(task.id) || 0), 0) + 1); store.counters.task = value + 1; return value }
  return { teamById, personById, projectById, taskById, validText, validEmail, validDateValue, validOptionalDate, validCustomFields, customFieldInputError, personReferenceExists, teamReferenceExists, projectReferenceExists, taskReferenceExists, publicUser, publicAccessUser, dueTone, dueLabel, projectProgress, projectHealth, taskPublic, projectPublic, personPublic, activityPublic, alertPublic, bucketFor, makeBuckets, reportFor, dashboard, settingsForUser, bootstrapFor, workLogPublic, bucketLabel, isCompletionEvent, completedTaskIds, activityReportFor, nextProjectId, nextTaskId }
}
