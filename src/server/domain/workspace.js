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
function projectProgress(project) {
  const tasks = store.tasks.filter(t => String(t.projectId) === String(project.id))
  if (!tasks.length) return 0
  return Math.round(tasks.filter(isDone).length / tasks.length * 100)
}
function projectHealth(project, today) {
  if (project.status === 'Completed') return 'Completed'
  if (project.status === 'At risk') return 'At risk'
  const overdue = store.tasks.some(t => String(t.projectId) === String(project.id) && !isDone(t) && t.dueDate && t.dueDate < today)
  return overdue ? 'At risk' : 'On track'
}
function taskPublic(task, today) {
  const project = projectById(task.projectId) || {}
  const person = personById(task.assigneeId) || {}
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
    createdAt: task.createdAt,
    completedAt: task.completedAt || '',
    customFields: task.customFields || {}
  }
}
function projectPublic(project, today) {
  const team = teamById(project.teamId) || {}
  const owner = personById(project.ownerId) || {}
  const taskRows = store.tasks.filter(t => String(t.projectId) === String(project.id))
  const memberIds = [...new Set(taskRows.map(t => t.assigneeId).concat(project.ownerId).filter(Boolean))]
  const members = memberIds.map(id => personById(id)).filter(Boolean)
  const milestoneRows = store.milestones.filter(m => String(m.projectId) === String(project.id)).map(m => ({ ...m, projectId: project.id }))
  const diff = project.deadline ? daysBetween(today, project.deadline) : null
  return {
    id: `project-${project.id}`,
    numericId: project.id,
    name: project.name,
    code: project.code,
    description: project.description,
    teamId: project.teamId,
    team: team.name || 'Workspace',
    ownerId: project.ownerId,
    owner: owner.name || 'Unassigned',
    color: project.color || team.color || 'purple',
    status: project.status,
    health: projectHealth(project, today),
    progress: projectProgress(project),
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
function dashboard(today, tasksPublic, projectsPublic, alertsPublic) {
  const openTasks = tasksPublic.filter(t => !isDone(t)).length
  const activeProjects = projectsPublic.filter(p => p.health !== 'Completed').length
  const atRisk = projectsPublic.filter(p => p.health === 'At risk').length
  const onTrack = activeProjects ? Math.round((activeProjects - atRisk) / activeProjects * 100) : 100
  const todayActivities = store.activities.filter(a => a.date === today)
  const yesterdayActivities = store.activities.filter(a => a.date === addDays(today, -1))
  const pulseItem = (activity, key, icon = 'bolt') => {
    const person = personById(activity.personId) || {}
    return { title: person.name || 'Unknown', detail: activity[key] || 'No update', time: activity.time || '', icon }
  }
  return {
    stats: { activeProjects, openTasks, needsAttention: alertsPublic.filter(a => !a.resolved).length, onTrack, completedTasks: tasksPublic.filter(t => isDone(t)).length },
    dailyPulse: {
      yesterday: yesterdayActivities.slice(0, 4).map(a => pulseItem(a, 'yesterday', 'check')),
      today: todayActivities.slice(0, 4).map(a => pulseItem(a, 'today', 'bolt')),
      blocked: todayActivities.filter(a => a.blocked).map(a => pulseItem(a, 'blocked', 'warning')).concat(tasksPublic.filter(t => t.blocked && !isDone(t)).slice(0, 3).map(t => ({ title: t.title, detail: `${t.project} · ${t.assignee}`, time: t.due, icon: 'warning' }))),
      upcoming: store.milestones.slice(0, 4).map(m => ({ title: m.name, detail: projectById(m.projectId)?.name || 'Project', time: fmt(m.dueDate), icon: 'calendar' }))
    },
    myTasks: tasksPublic.filter(t => !isDone(t)).slice(0, 6)
  }
}
function settingsForUser(user) {
  if (can(user, 'manageSettings')) return store.settings
  const redact = value => {
    if (Array.isArray(value)) return value.map(redact)
    if (!isPlainObject(value)) return value
    const safe = {}
    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '')
      if (['password', 'passwordhash'].includes(normalizedKey) || /(?:secret|token|apikey|privatekey|credentials?|authorization)$/.test(normalizedKey)) continue
      Object.defineProperty(safe, key, { value: redact(item), enumerable: true, configurable: true, writable: true })
    }
    return safe
  }
  return redact(store.settings)
}
function bootstrapFor(user) {
  const today = todayLA()
  const teams = store.teams.map(team => ({ ...team, peopleCount: store.people.filter(p => p.teamId === team.id).length }))
  const people = store.people.map(personPublic)
  const projects = store.projects.map(project => projectPublic(project, today))
  const tasks = store.tasks.map(task => taskPublic(task, today)).sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))
  const activity = store.activities.map(a => activityPublic(a, today)).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
  const alerts = store.alerts.map(alertPublic).sort((a, b) => Number(a.resolved) - Number(b.resolved) || String(b.createdAt).localeCompare(String(a.createdAt)))
  const users = can(user, 'manageUsers') ? store.users.map(publicAccessUser) : []
  return { today, user: publicUser(user), settings: settingsForUser(user), teams, people, users, projects, tasks, activity, alerts, dashboard: dashboard(today, tasks, projects, alerts), reports: reportFor('weekly') }
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

function nextProjectId() { const value = store.counters.project || (Math.max(0, ...store.projects.map(p => Number(p.id))) + 1); store.counters.project = value + 1; return value }
function nextTaskId() { const value = store.counters.task || (Math.max(0, ...store.tasks.map(t => Number(t.id))) + 1); store.counters.task = value + 1; return value }
  return { teamById, personById, projectById, taskById, validText, validEmail, validDateValue, validOptionalDate, validCustomFields, customFieldInputError, personReferenceExists, teamReferenceExists, projectReferenceExists, taskReferenceExists, publicUser, publicAccessUser, dueTone, dueLabel, projectProgress, projectHealth, taskPublic, projectPublic, personPublic, activityPublic, alertPublic, bucketFor, makeBuckets, reportFor, dashboard, settingsForUser, bootstrapFor, workLogPublic, bucketLabel, isCompletionEvent, completedTaskIds, activityReportFor, nextProjectId, nextTaskId }
}
