const field = (label, type = 'text') => ({ label, type })

export const EXPORT_FIELD_SCHEMAS = {
  projects: {
    name: field('Project'), code: field('Code'), team: field('Team'), health: field('Health'), progress: field('Progress', 'percent'),
    deadline: field('Deadline', 'date'), status: field('Status'), owner: field('Owner'), description: field('Description'), createdAt: field('Created', 'date')
  },
  tasks: {
    id: field('Task ID'), title: field('Task'), project: field('Project'), status: field('Status'), priority: field('Priority'),
    assignee: field('Assignee'), due: field('Due', 'date'), dueDate: field('Due date', 'date'), type: field('Type'), blocked: field('Blocked', 'boolean'), tags: field('Tags'),
    createdAt: field('Created', 'date'), completedAt: field('Completed', 'date')
  },
  people: {
    name: field('Name'), email: field('Email'), role: field('Job title'), team: field('Team'), status: field('Status'),
    load: field('Capacity', 'percent'), focus: field('Focus')
  },
  activity: {
    person: field('Person'), date: field('Date', 'date'), time: field('Time'), yesterday: field('Yesterday'), today: field('Today'),
    blocked: field('Blocked'), upcoming: field('Upcoming'), status: field('Status')
  },
  alerts: {
    title: field('Alert'), type: field('Type'), project: field('Project'), resolved: field('Resolved', 'boolean'), time: field('Created', 'date'),
    body: field('Details'), source: field('Source'), occurrences: field('Occurrences', 'number')
  },
  milestones: {
    name: field('Milestone'), 'project.name': field('Project'), status: field('Status'), dueDate: field('Due date', 'date')
  },
  users: {
    name: field('Name'), email: field('Email'), role: field('Role'), team: field('Team'), active: field('Active', 'boolean'), createdAt: field('Created', 'date')
  },
  'delivery-report': {
    label: field('Period'), completed: field('Completions', 'number'), created: field('New tasks', 'number'), rate: field('Completions / intake %', 'percent')
  },
  'activity-evidence': {
    date: field('Date', 'date'), time: field('Time'), person: field('Person'), project: field('Project'), taskId: field('Task ID'),
    task: field('Task / update'), action: field('Action'), status: field('Status'), summary: field('Evidence'), minutes: field('Minutes', 'number'), source: field('Source')
  },
  'activity-summary': {
    person: field('Person'), role: field('Job title'), team: field('Team'), tasksTouched: field('Tasks touched', 'number'),
    completedTasks: field('Completed', 'number'), projects: field('Projects', 'number'), updates: field('Updates', 'number'),
    blockers: field('Blockers', 'number'), minutes: field('Minutes', 'number')
  },
  'project-contributions': {
    project: field('Project'), projectCode: field('Code'), tasksTouched: field('Tasks touched', 'number'),
    completedTasks: field('Completed', 'number'), users: field('People', 'number'), minutes: field('Minutes', 'number')
  }
}

function objectValue(row, key) {
  if (Object.hasOwn(row || {}, key)) return row[key]
  return String(key).split('.').reduce((value, part) => value?.[part], row)
}

const CUSTOM_FIELD_ENTITIES = { projects: 'projects', tasks: 'tasks', people: 'people', activity: 'activities', alerts: 'alerts', milestones: 'milestones' }
function exportFieldType(type) {
  if (type === 'number') return 'number'
  if (type === 'date' || type === 'datetime') return 'date'
  if (type === 'checkbox') return 'boolean'
  return 'text'
}
function schemaForDataset(dataset, snapshot) {
  const schema = { ...EXPORT_FIELD_SCHEMAS[dataset] }
  const entity = CUSTOM_FIELD_ENTITIES[dataset]
  const definitions = entity ? snapshot.settings?.customFields?.[entity] : []
  for (const definition of definitions || []) {
    if (!definition || typeof definition.key !== 'string' || definition.visible === false) continue
    schema[`customFields.${definition.key}`] = field(definition.label || definition.key, exportFieldType(definition.type))
  }
  return schema
}

function sourceId(dataset, row) {
  if (dataset === 'delivery-report') return row.key
  if (dataset === 'activity-summary') return row.personId
  if (dataset === 'project-contributions') return row.projectId
  return row.__recordId ?? row.numericId ?? row.id
}

function rowsForDataset(dataset, context, query) {
  const { snapshot, workspace, today } = context
  const peopleById = new Map(snapshot.people.map(person => [String(person.id), person]))
  const teamsById = new Map(snapshot.teams.map(team => [String(team.id), team]))
  const projectsById = new Map(snapshot.projects.map(project => [String(project.id), project]))
  const indexes = { people: peopleById, teams: teamsById, projects: projectsById }
  const tasksByProject = new Map()
  snapshot.tasks.forEach(task => {
    const key = String(task.projectId)
    if (!tasksByProject.has(key)) tasksByProject.set(key, [])
    tasksByProject.get(key).push(task)
  })
  const projects = () => snapshot.projects.map(project => ({
    ...workspace.projectPublic(project, today, tasksByProject.get(String(project.id)) || [], indexes),
    __recordId: project.id, deadline: project.deadline || '', createdAt: project.createdAt || ''
  }))
  const tasks = () => snapshot.tasks.map(task => ({ ...workspace.taskPublic(task, today, indexes), __recordId: task.id, due: task.dueDate || '' }))

  if (dataset === 'projects') return projects()
  if (dataset === 'tasks') {
    const projectId = query.projectId == null ? '' : String(query.projectId)
    return tasks().filter(task => !projectId || String(task.projectId) === projectId)
  }
  if (dataset === 'people') return snapshot.people.map(person => ({ ...workspace.personPublic(person), __recordId: person.id }))
  if (dataset === 'activity') return snapshot.activities
    .filter(activity => !query.personId || query.personId === 'all' || String(activity.personId || '') === String(query.personId))
    .map(activity => ({ ...workspace.activityPublic(activity, today), __recordId: activity.id }))
  if (dataset === 'alerts') return snapshot.alerts.map(alert => ({ ...workspace.alertPublic(alert), __recordId: alert.id, time: alert.createdAt || '' }))
  if (dataset === 'milestones') return snapshot.milestones.map(milestone => {
    const project = projectsById.get(String(milestone.projectId)) || {}
    return { ...milestone, project: { name: project.name || 'Workspace', code: project.code || '' }, 'project.name': project.name || 'Workspace', __recordId: milestone.id }
  })
  if (dataset === 'users') return snapshot.users.map(user => {
    const person = peopleById.get(String(user.personId)) || {}
    const team = teamsById.get(String(person.teamId)) || {}
    return {
      __recordId: user.id, id: user.id, name: user.name, email: user.email, role: user.role,
      team: team.name || 'Workspace', active: user.active !== false, createdAt: user.createdAt || ''
    }
  })
  if (dataset === 'delivery-report') return workspace.reportFor(query.period).series
  if (dataset === 'activity-evidence' || dataset === 'activity-summary' || dataset === 'project-contributions') {
    const report = workspace.activityReportFor(query.period, query.personId || 'all')
    if (dataset === 'activity-evidence') return report.rows
    if (dataset === 'activity-summary') return report.users
    return report.projects
  }
  return null
}

export function prepareDatabaseExport({ context, dataset, recordIds, fields, query = {} }) {
  if (!Object.hasOwn(EXPORT_FIELD_SCHEMAS, dataset)) throw new Error('Unsupported export dataset')
  const schema = schemaForDataset(dataset, context.snapshot)
  if (fields !== undefined && !Array.isArray(fields)) throw new Error('One or more export fields are unavailable for this dataset')
  const requested = fields === undefined ? Object.keys(schema) : [...new Set(fields)]
  if (!requested.length) throw new Error('At least one export field is required')
  if (requested.length > 250 || requested.some(key => typeof key !== 'string' || !Object.hasOwn(schema, key))) throw new Error('One or more export fields are unavailable for this dataset')

  const sourceRows = rowsForDataset(dataset, context, query)
  if (!sourceRows) throw new Error('Unsupported export dataset')
  let rows = sourceRows
  if (Array.isArray(recordIds)) {
    const selected = new Set(recordIds.map(String))
    rows = rows.filter(row => selected.has(String(sourceId(dataset, row))))
  }
  if (Array.isArray(recordIds) && rows.length !== new Set(recordIds.map(String)).size) throw new Error('One or more selected database records are no longer available')
  const columns = requested.map(key => ({ key, ...schema[key] }))
  const data = rows.map(row => Object.fromEntries(requested.map(key => [key, objectValue(row, key) ?? null])))
  return {
    dataset,
    source: 'sqlite',
    generatedAt: new Date().toISOString(),
    recordCount: data.length,
    columns,
    rows: data
  }
}
