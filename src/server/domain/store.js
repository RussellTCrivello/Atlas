import crypto from 'node:crypto'

export function createStoreService({
  getStore, todayLA, timeLA, addDays, id, parseNumber, isPlainObject,
  defaultSettings, normalizeSettings, hashPassword, normalizeUserSecrets,
  allowDemoData, STORE_SCHEMA_VERSION, DATABASE_MODEL, DESIGN_SYSTEM_VERSION, configuredBackupRetention
}) {
  const store = new Proxy(Object.create(null), {
    get(_target, property) { const current = getStore(); return current == null ? undefined : Reflect.get(current, property) },
    set(_target, property, value) { const current = getStore(); if (current == null) throw new Error('Workspace state is not initialized'); return Reflect.set(current, property, value) }
  })
function newStoreMeta(overrides = {}) {
  const now = new Date().toISOString()
  return {
    ...overrides,
    createdAt: overrides.createdAt || now,
    updatedAt: now,
    writeCount: Number(overrides.writeCount || 0),
    lastMigrationAt: overrides.lastMigrationAt || now,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    schemaVersion: STORE_SCHEMA_VERSION,
    model: DATABASE_MODEL,
    atomicPersistence: true,
    backupRetention: Number(overrides.backupRetention || configuredBackupRetention())
  }
}

function buildSeedWorkLogs(tasks = [], activities = []) {
  const logs = []
  tasks.forEach((task, index) => {
    const date = task.completedAt || task.createdAt || todayLA()
    logs.push({
      id: `wl_seed_${task.id}_${index}`,
      personId: task.assigneeId,
      taskId: task.id,
      projectId: task.projectId,
      action: task.completedAt ? 'Completed task' : task.status === 'To do' ? 'Planned task' : 'Moved task',
      statusFrom: task.completedAt ? 'Testing' : 'To do',
      statusTo: task.status,
      summary: `${task.title} · ${task.type || 'Work'} · ${task.priority || 'Medium'} priority`,
      date,
      time: ['09:10', '10:25', '13:40', '15:15'][index % 4],
      minutes: 0,
      sample: Boolean(task.sample)
    })
  })
  activities.forEach((activity, index) => {
    if (!activity.today && !activity.yesterday && !activity.blocked) return
    logs.push({ id: `wl_activity_${activity.id}`, personId: activity.personId, taskId: '', projectId: '', action: 'Daily update', statusFrom: '', statusTo: activity.blocked ? 'Blocked' : 'Confirmed', summary: activity.blocked ? `${activity.today || 'Daily focus'} · Blocked: ${activity.blocked}` : (activity.today || activity.yesterday || 'Daily update'), date: activity.date, time: activity.time || ['09:00', '09:15', '09:30'][index % 3], minutes: 0, sample: Boolean(activity.sample), source: 'Activity log' })
  })
  return logs
}
function workLedgerCutoffDate(retentionMonths, now = new Date()) {
  const date = new Date(now)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() - retentionMonths)
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, daysInMonth))
  return date.toISOString().slice(0, 10)
}
function pruneWorkLedger(target = store, now = new Date()) {
  const months = Number(target?.settings?.workLedger?.retentionMonths)
  if (!Number.isInteger(months) || months <= 0 || !Array.isArray(target?.workLogs)) return 0
  const cutoff = workLedgerCutoffDate(months, now)
  const before = target.workLogs.length
  target.workLogs = target.workLogs.filter(log => {
    const value = log?.date
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return true
    const date = new Date(`${value}T00:00:00.000Z`)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return true
    return value >= cutoff
  })
  return before - target.workLogs.length
}
function logWorkEvent({ personId = '', actorUserId = '', taskId = '', projectId = '', action, statusFrom = '', statusTo = '', summary = '', minutes = 0 }) {
  store.workLogs = store.workLogs || []
  const now = new Date()
  const task = taskId ? store.tasks.find(row => String(row.id) === String(taskId)) : null
  const project = projectId ? store.projects.find(row => String(row.id) === String(projectId)) : null
  const log = {
    id: id('worklog'), personId, actorUserId, taskId, projectId, taskTitle: task?.title || '',
    projectName: project?.name || '', projectCode: project?.code || '', action, statusFrom, statusTo, summary,
    date: todayLA(now), time: timeLA(now), minutes: Math.max(0, parseNumber(minutes, 0)), sample: false
  }
  store.workLogs.push(log)
  pruneWorkLedger(store, now)
  return log
}
function createActivityBlockerAlert(activity) {
  const reason = String(activity.blocked || '').trim()
  if (!reason) return null
  store.alerts = store.alerts || []
  const normalizedReason = reason.toLocaleLowerCase()
  const existing = store.alerts.find(alert => alert.resolved !== true && alert.source === 'activity-blocker' && String(alert.personId || '') === String(activity.personId) && String(alert.body || '').trim().toLocaleLowerCase() === normalizedReason)
  const now = new Date().toISOString()
  if (existing) {
    existing.lastSeenAt = now
    existing.occurrences = Math.min(1000000, Number(existing.occurrences || 1) + 1)
    return { alert: existing, created: false }
  }
  const person = store.people.find(row => String(row.id) === String(activity.personId))
  const alert = {
    id: id('alert'), title: `Blocker reported by ${person?.name || 'workspace member'}`, body: reason,
    type: 'blocker', tone: 'orange', projectId: '', taskId: '', personId: activity.personId,
    activityId: activity.id, source: 'activity-blocker', occurrences: 1,
    resolved: false, createdAt: todayLA(), lastSeenAt: now, customFields: {}, sample: false
  }
  store.alerts.push(alert)
  return { alert, created: true }
}



function demoStore() {
  const today = todayLA()
  const teams = [
    { id: 'team-platform', name: 'Platform', color: 'purple', sample: true },
    { id: 'team-product', name: 'Product Experience', color: 'blue', sample: true },
    { id: 'team-growth', name: 'Growth', color: 'orange', sample: true },
    { id: 'team-data', name: 'Data', color: 'green', sample: true }
  ]
  const people = [
    { id: 'p1', name: 'Maya Chen', email: 'maya@atlas.local', jobTitle: 'Engineering Manager', teamId: 'team-platform', focus: 'Release readiness and cross-team alignment', capacity: 78, status: 'On track', color: 'purple', sample: true },
    { id: 'p2', name: 'Noah Reed', email: 'noah@atlas.local', jobTitle: 'Senior Developer', teamId: 'team-platform', focus: 'API reliability and observability', capacity: 82, status: 'On track', color: 'blue', sample: true },
    { id: 'p3', name: 'Lina Patel', email: 'lina@atlas.local', jobTitle: 'Product Designer', teamId: 'team-product', focus: 'Onboarding interaction polish', capacity: 64, status: 'On track', color: 'pink', sample: true },
    { id: 'p4', name: 'Omar Haddad', email: 'omar@atlas.local', jobTitle: 'QA Lead', teamId: 'team-product', focus: 'Regression gates and risk checks', capacity: 91, status: 'Needs attention', color: 'orange', sample: true },
    { id: 'p5', name: 'Ella Brooks', email: 'ella@atlas.local', jobTitle: 'Data Engineer', teamId: 'team-data', focus: 'Delivery metrics warehouse', capacity: 70, status: 'On track', color: 'green', sample: true },
    { id: 'p6', name: 'Samir Khan', email: 'samir@atlas.local', jobTitle: 'Growth Engineer', teamId: 'team-growth', focus: 'Activation experiments', capacity: 58, status: 'On track', color: 'teal', sample: true }
  ]
  const projects = [
    { id: 1, name: 'Atlas Command Center', code: 'ATL', description: 'Make daily operations visible with decision-ready workspace intelligence.', teamId: 'team-platform', ownerId: 'p1', color: 'purple', status: 'On track', deadline: addDays(today, 19), createdAt: addDays(today, -70), sample: true },
    { id: 2, name: 'Customer Onboarding', code: 'ONB', description: 'Design a fast, guided path from invited user to productive team member.', teamId: 'team-product', ownerId: 'p3', color: 'blue', status: 'At risk', deadline: addDays(today, 9), createdAt: addDays(today, -50), sample: true },
    { id: 3, name: 'Data Reliability', code: 'DR', description: 'Harden reporting pipelines and close the trust gap in operational data.', teamId: 'team-data', ownerId: 'p5', color: 'green', status: 'On track', deadline: addDays(today, 37), createdAt: addDays(today, -44), sample: true },
    { id: 4, name: 'Growth Experiments', code: 'GRW', description: 'Run activation experiments with clear tracking and learning loops.', teamId: 'team-growth', ownerId: 'p6', color: 'orange', status: 'On track', deadline: addDays(today, 31), createdAt: addDays(today, -30), sample: true }
  ]
  const tasks = [
    { id: 1, title: 'Finalize advanced reporting export templates', projectId: 1, assigneeId: 'p1', priority: 'High', dueDate: today, status: 'In progress', type: 'Documentation', blocked: false, createdAt: addDays(today, -7), sample: true },
    { id: 2, title: 'Wire native drag-and-drop board updates', projectId: 1, assigneeId: 'p2', priority: 'High', dueDate: addDays(today, 1), status: 'Review', type: 'Development', blocked: false, createdAt: addDays(today, -9), sample: true },
    { id: 3, title: 'QA keyboard shortcut coverage', projectId: 1, assigneeId: 'p4', priority: 'Medium', dueDate: addDays(today, 4), status: 'Testing', type: 'Testing', blocked: false, createdAt: addDays(today, -11), sample: true },
    { id: 4, title: 'Design setup wizard empty states', projectId: 2, assigneeId: 'p3', priority: 'Medium', dueDate: addDays(today, 2), status: 'Done', type: 'Design', blocked: false, createdAt: addDays(today, -18), completedAt: addDays(today, -1), sample: true },
    { id: 5, title: 'Resolve SSO callback mismatch', projectId: 2, assigneeId: 'p2', priority: 'High', dueDate: addDays(today, -1), status: 'In progress', type: 'Development', blocked: true, createdAt: addDays(today, -13), sample: true },
    { id: 6, title: 'Refresh welcome checklist microcopy', projectId: 2, assigneeId: 'p3', priority: 'Low', dueDate: addDays(today, 6), status: 'To do', type: 'Design', blocked: false, createdAt: addDays(today, -6), sample: true },
    { id: 7, title: 'Backfill delivery metrics for quarterly trend', projectId: 3, assigneeId: 'p5', priority: 'Medium', dueDate: addDays(today, 3), status: 'In progress', type: 'Development', blocked: false, createdAt: addDays(today, -16), sample: true },
    { id: 8, title: 'Add pipeline freshness alert', projectId: 3, assigneeId: 'p5', priority: 'High', dueDate: addDays(today, 8), status: 'To do', type: 'Development', blocked: false, createdAt: addDays(today, -4), sample: true },
    { id: 9, title: 'Prototype activation cohort dashboard', projectId: 4, assigneeId: 'p6', priority: 'Medium', dueDate: addDays(today, 10), status: 'Review', type: 'Development', blocked: false, createdAt: addDays(today, -8), sample: true },
    { id: 10, title: 'Document experiment naming rules', projectId: 4, assigneeId: 'p6', priority: 'Low', dueDate: addDays(today, 15), status: 'Done', type: 'Documentation', blocked: false, createdAt: addDays(today, -25), completedAt: addDays(today, -10), sample: true },
    { id: 11, title: 'Create annual executive delivery pack', projectId: 1, assigneeId: 'p1', priority: 'High', dueDate: addDays(today, 12), status: 'To do', type: 'Documentation', blocked: false, createdAt: addDays(today, -2), sample: true },
    { id: 12, title: 'Polish local font loading and offline shell', projectId: 1, assigneeId: 'p2', priority: 'Medium', dueDate: addDays(today, 5), status: 'Done', type: 'Development', blocked: false, createdAt: addDays(today, -14), completedAt: today, sample: true }
  ]
  const oldTasks = []
  for (let i = 13; i <= 54; i++) {
    const projectId = ((i - 1) % 4) + 1
    const createdAt = addDays(today, -((i * 5) % 360) - 7)
    const done = i % 3 !== 0
    oldTasks.push({
      id: i,
      title: `Historical delivery item ${i - 12}`,
      projectId,
      assigneeId: people[(i - 1) % people.length].id,
      priority: ['Low', 'Medium', 'High'][i % 3],
      dueDate: addDays(createdAt, 8 + (i % 14)),
      status: done ? 'Done' : ['To do', 'In progress', 'Review', 'Testing'][i % 4],
      type: ['Development', 'Design', 'Testing', 'Documentation'][i % 4],
      blocked: !done && i % 7 === 0,
      createdAt,
      completedAt: done ? addDays(createdAt, 5 + (i % 12)) : undefined,
      sample: true
    })
  }
  const milestones = [
    { id: 'm1', projectId: 1, name: 'Executive report builder', dueDate: addDays(today, 12), status: 'Upcoming', sample: true },
    { id: 'm2', projectId: 2, name: 'Pilot onboarding release', dueDate: addDays(today, 9), status: 'At risk', sample: true },
    { id: 'm3', projectId: 3, name: 'Pipeline SLA review', dueDate: addDays(today, 18), status: 'Upcoming', sample: true },
    { id: 'm4', projectId: 4, name: 'Experiment readout', dueDate: addDays(today, 22), status: 'Upcoming', sample: true }
  ]
  const activities = [
    { id: 'a1', personId: 'p1', date: today, time: '09:10', yesterday: 'Validated report requirements with leadership.', today: 'Finalize export templates and print presets.', blocked: '', upcoming: 'Annual report review.', status: 'Confirmed', sample: true },
    { id: 'a2', personId: 'p2', date: today, time: '09:20', yesterday: 'Completed local asset audit.', today: 'Review drag-and-drop persistence and API update paths.', blocked: 'SSO callback mismatch needs environment confirmation.', upcoming: 'Ship board interaction polish.', status: 'Confirmed', sample: true },
    { id: 'a3', personId: 'p3', date: today, time: '09:31', yesterday: 'Finished setup wizard states.', today: 'Improve onboarding checklist affordances.', blocked: '', upcoming: 'Design review.', status: 'Confirmed', sample: true },
    { id: 'a4', personId: 'p4', date: addDays(today, -1), time: '16:40', yesterday: 'Ran regression smoke test.', today: 'Validate keyboard shortcuts and print layouts.', blocked: '', upcoming: 'Testing sign-off.', status: 'Confirmed', sample: true },
    { id: 'a5', personId: 'p5', date: addDays(today, -1), time: '15:25', yesterday: 'Backfilled weekly delivery metrics.', today: 'Compare monthly and quarterly rollups.', blocked: '', upcoming: 'Freshness alert.', status: 'Confirmed', sample: true },
    { id: 'a6', personId: 'p6', date: addDays(today, -2), time: '14:05', yesterday: 'Mapped activation cohorts.', today: 'Prototype readout dashboard.', blocked: '', upcoming: 'Experiment kickoff.', status: 'Confirmed', sample: true }
  ]
  const alerts = [
    { id: 'al1', title: 'Onboarding release is at risk', body: 'SSO callback mismatch blocks the pilot release path.', type: 'risk', tone: 'orange', projectId: 2, taskId: 5, resolved: false, createdAt: today, sample: true },
    { id: 'al2', title: 'Overdue task detected', body: 'Resolve SSO callback mismatch is past its due date.', type: 'overdue', tone: 'red', projectId: 2, taskId: 5, resolved: false, createdAt: today, sample: true },
    { id: 'al3', title: 'Local assets confirmed', body: 'Fonts, icons, manifest, and service worker are local to the project.', type: 'info', tone: 'blue', projectId: 1, resolved: true, createdAt: addDays(today, -1), sample: true }
  ]
  const allTasks = [...tasks, ...oldTasks]
  const workLogs = buildSeedWorkLogs(allTasks, activities)
  return {
    meta: newStoreMeta({ seededAt: new Date().toISOString() }),
    configured: true,
    counters: { project: 5, task: 55 },
    settings: normalizeSettings({ ...defaultSettings(), workspaceName: 'Northstar', workspaceUnit: 'Engineering', workspace: { ...defaultSettings().workspace, name: 'Northstar', unit: 'Engineering' } }),
    users: [
      { id: 'u1', name: 'Maya Chen', email: 'maya@atlas.local', passwordHash: hashPassword('atlas-demo'), role: 'Administrator', personId: 'p1', avatarColor: 'purple', active: true, sample: true },
      { id: 'u2', name: 'Noah Reed', email: 'manager@atlas.local', passwordHash: hashPassword('manager-demo'), role: 'Manager', personId: 'p2', avatarColor: 'blue', active: true, sample: true },
      { id: 'u3', name: 'Lina Patel', email: 'developer@atlas.local', passwordHash: hashPassword('developer-demo'), role: 'Developer', personId: 'p3', avatarColor: 'pink', active: true, sample: true },
      { id: 'u4', name: 'Omar Haddad', email: 'viewer@atlas.local', passwordHash: hashPassword('viewer-demo'), role: 'Viewer', personId: 'p4', avatarColor: 'orange', active: true, sample: true }
    ],
    teams, people, projects, tasks: allTasks, milestones, activities, alerts, workLogs
  }
}
function ensureCollection(storeObject, key) {
  if (!Array.isArray(storeObject[key])) storeObject[key] = []
}
function normalizeStore(next = {}) {
  if (!isPlainObject(next)) next = productionStore()
  const legacyRetentionWasExplicit = isPlainObject(next.settings?.workLedger) && Object.hasOwn(next.settings.workLedger, 'retentionMonths')
  const legacyAuditRetentionWasExplicit = isPlainObject(next.settings?.audit) && Object.hasOwn(next.settings.audit, 'retentionDays')
  next.settings = normalizeSettings(next.settings || {})
  if (!legacyRetentionWasExplicit) next.settings.workLedger.retentionMonths = 0
  if (!legacyAuditRetentionWasExplicit) next.settings.audit.retentionDays = 0
  const existingMeta = isPlainObject(next.meta) ? next.meta : {}
  next.meta = newStoreMeta({
    ...existingMeta,
    createdAt: existingMeta.createdAt || new Date().toISOString(),
    writeCount: Number(existingMeta.writeCount || 0),
    backupRetention: next.settings.storage.backupRetention,
    lastMigrationAt: existingMeta.schemaVersion === STORE_SCHEMA_VERSION ? existingMeta.lastMigrationAt : new Date().toISOString()
  })
  ;['users', 'teams', 'people', 'projects', 'tasks', 'milestones', 'activities', 'alerts', 'workLogs', 'auditLogs'].forEach(key => ensureCollection(next, key))
  // Older releases generated deterministic seed rows from live task state. Remove only those generated rows; retain explicit imported work-log values, including any recorded minutes.
  if (existingMeta.schemaVersion !== STORE_SCHEMA_VERSION) {
    next.workLogs = next.workLogs.filter(log => !isPlainObject(log) || !/^wl_(?:seed|activity)_/.test(String(log.id || '')))
  }
  const maxProjectId = next.projects.reduce((maximum, project) => Math.max(maximum, Number(project.id) || 0), 0)
  const maxTaskId = next.tasks.reduce((maximum, task) => Math.max(maximum, Number(task.id) || 0), 0)
  next.counters = {
    project: Math.max(Number(next.counters?.project || 1), maxProjectId + 1),
    task: Math.max(Number(next.counters?.task || 1), maxTaskId + 1)
  }
  if (!next.workLogs.length) {
    const sampleTasks = next.tasks.filter(task => task.sample === true)
    const sampleActivities = next.activities.filter(activity => activity.sample === true)
    if (sampleTasks.length || sampleActivities.length) next.workLogs = buildSeedWorkLogs(sampleTasks, sampleActivities)
  }
  pruneWorkLedger(next)
  next.users.forEach(user => {
    user.role = user.role || 'Viewer'
    user.active = user.active !== false
    user.avatarColor = user.avatarColor || next.people.find(person => person.id === user.personId)?.color || 'purple'
    normalizeUserSecrets(user)
  })
  if (allowDemoData) {
    const demoUsers = demoStore().users
    demoUsers.forEach(sampleUser => {
      if (!next.users.some(user => user.email.toLowerCase() === sampleUser.email.toLowerCase()) && next.people.some(person => person.id === sampleUser.personId)) next.users.push(normalizeUserSecrets(sampleUser))
    })
  }
  next.configured = typeof next.configured === 'boolean' ? next.configured : next.users.length > 0
  return next
}

function productionStore() {
  return {
    meta: newStoreMeta(),
    configured: false,
    counters: { project: 1, task: 1 },
    settings: defaultSettings(),
    users: [], teams: [], people: [], projects: [], tasks: [], milestones: [], activities: [], alerts: [], workLogs: [], auditLogs: []
  }
}
  function validateStoreState(candidate = store) {
    const errors = []
    const warnings = []
    const collections = ['users', 'teams', 'people', 'projects', 'tasks', 'milestones', 'activities', 'alerts', 'workLogs', 'auditLogs']
    collections.forEach(key => { if (!Array.isArray(candidate?.[key])) errors.push(`${key} must be an array`) })
    if (candidate?.meta?.schemaVersion !== STORE_SCHEMA_VERSION) warnings.push(`Store schema is ${candidate?.meta?.schemaVersion || 'missing'}; expected ${STORE_SCHEMA_VERSION}`)
    if (!candidate?.settings?.workspace || !candidate?.settings?.interface || !candidate?.settings?.localization) errors.push('Settings must include workspace, interface, and localization configuration branches')
    if (!candidate?.settings?.workflows?.task?.states?.length) errors.push('Task workflow must define at least one state')
    if (!candidate?.settings?.permissions?.roles?.Administrator?.permissions?.includes('manageSettings')) errors.push('Administrator role must retain manageSettings permission')
    const duplicateValues = (items, getter, label) => {
      const seen = new Set()
      ;(items || []).forEach(item => {
        const value = getter(item)
        if (!value) return
        if (seen.has(value)) errors.push(`Duplicate ${label}: ${value}`)
        seen.add(value)
      })
    }
    duplicateValues(candidate?.users, user => String(user.email || '').toLowerCase(), 'user email')
    duplicateValues(candidate?.people, person => person.id, 'person id')
    duplicateValues(candidate?.projects, project => String(project.id), 'project id')
    duplicateValues(candidate?.tasks, task => String(task.id), 'task id')
    const people = new Set((candidate?.people || []).map(person => person.id))
    const teams = new Set((candidate?.teams || []).map(team => team.id))
    const projects = new Set((candidate?.projects || []).map(project => String(project.id)))
    const tasks = new Set((candidate?.tasks || []).map(task => String(task.id)))
    ;(candidate?.people || []).forEach(person => { if (person.teamId && !teams.has(person.teamId)) warnings.push(`Person ${person.name || person.id} references a missing team`) })
    ;(candidate?.users || []).forEach(user => {
      if (user.password && !user.passwordHash) errors.push(`User ${user.email || user.id} still has a plain-text password field`)
      if (user.personId && !people.has(user.personId)) warnings.push(`User ${user.email || user.id} references a missing person profile`)
    })
    ;(candidate?.projects || []).forEach(project => {
      if (project.teamId && !teams.has(project.teamId)) warnings.push(`Project ${project.name || project.id} references a missing team`)
      if (project.ownerId && !people.has(project.ownerId)) warnings.push(`Project ${project.name || project.id} references a missing owner`)
    })
    ;(candidate?.tasks || []).forEach(task => {
      if (!projects.has(String(task.projectId))) warnings.push(`Task ${task.title || task.id} references a missing project`)
      if (task.assigneeId && !people.has(task.assigneeId)) warnings.push(`Task ${task.title || task.id} references a missing assignee`)
    })
    ;(candidate?.milestones || []).forEach(milestone => { if (milestone.projectId && !projects.has(String(milestone.projectId))) warnings.push(`Milestone ${milestone.name || milestone.id} references a missing project`) })
    ;(candidate?.alerts || []).forEach(alert => {
      if (alert.projectId && !projects.has(String(alert.projectId))) warnings.push(`Alert ${alert.title || alert.id} references a missing project`)
      if (alert.taskId && !tasks.has(String(alert.taskId))) warnings.push(`Alert ${alert.title || alert.id} references a missing task`)
    })
    return { integrity: errors.length ? 'attention' : warnings.length ? 'warning' : 'ok', errors, warnings }
  }
  function storeChecksum(candidate = store) {
    return crypto.createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
  }
  return { newStoreMeta, buildSeedWorkLogs, logWorkEvent, pruneWorkLedger, createActivityBlockerAlert, demoStore, ensureCollection, normalizeStore, productionStore, validateStoreState, storeChecksum }
}
