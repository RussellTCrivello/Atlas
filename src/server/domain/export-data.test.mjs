import assert from 'node:assert/strict'
import { prepareDatabaseExport } from './export-data.js'

const snapshot = {
  projects: [{ id: 7, name: 'Atlas Rollout', code: 'AR', deadline: '2026-11-05', teamId: 'team-1', ownerId: 'person-1' }],
  tasks: [
    { id: 41, title: 'Prepare launch plan', projectId: 7, dueDate: '2026-10-20', status: 'In progress', assigneeId: 'person-1', customFields: { qa_score: 98, private_note: 'not for export' } },
    { id: 42, title: 'Unrelated task', projectId: 8, dueDate: '2026-10-28', status: 'To do', assigneeId: 'person-1' }
  ],
  people: [{ id: 'person-1', name: 'Avery Example', jobTitle: 'Lead', teamId: 'team-1' }],
  teams: [{ id: 'team-1', name: 'Delivery' }],
  users: [{ id: 'user-1', name: 'Avery Example', email: 'avery@example.test', role: 'Administrator', personId: 'person-1', passwordHash: 'never-export-this' }],
  settings: { customFields: { tasks: [{ key: 'qa_score', label: 'QA score', type: 'number' }, { key: 'private_note', label: 'Private note', type: 'text', visible: false }] } },
  activities: [], alerts: [], milestones: []
}
const workspace = {
  projectPublic: project => ({ numericId: project.id, name: project.name, deadline: 'Nov 5, 2026', team: 'Delivery', owner: 'Avery Example', progress: 50 }),
  taskPublic: task => ({ numericId: task.id, id: `AR-${task.id}`, title: task.title, project: task.projectId === 7 ? 'Atlas Rollout' : 'Other project', projectId: task.projectId, due: 'friendly display value', dueDate: task.dueDate, status: task.status, customFields: task.customFields || {} }),
  personPublic: person => ({ id: person.id, name: person.name, role: person.jobTitle, team: 'Delivery' }),
  activityPublic: row => row,
  alertPublic: row => row,
  reportFor: period => ({ period, series: [{ key: '2026-W40', label: 'Week 40', completed: 3, created: 4, rate: 75 }] }),
  activityReportFor: () => ({ rows: [], users: [], projects: [] })
}
const context = { snapshot, workspace, today: '2026-10-02' }

const taskExport = prepareDatabaseExport({
  context, dataset: 'tasks', recordIds: [41], fields: ['id', 'title', 'project', 'status', 'due'], query: { projectId: 7 }
})
assert.equal(taskExport.source, 'sqlite')
assert.equal(taskExport.recordCount, 1)
assert.deepEqual(taskExport.rows[0], { id: 'AR-41', title: 'Prepare launch plan', project: 'Atlas Rollout', status: 'In progress', due: '2026-10-20' })
assert.equal(taskExport.columns.find(column => column.key === 'due').label, 'Due')
const customFieldExport = prepareDatabaseExport({ context, dataset: 'tasks', recordIds: [41], fields: ['customFields.qa_score'] })
assert.deepEqual(customFieldExport.rows[0], { 'customFields.qa_score': 98 })
assert.equal(customFieldExport.columns[0].type, 'number')

const projectExport = prepareDatabaseExport({ context, dataset: 'projects', recordIds: [7], fields: ['name', 'deadline', 'team'] })
assert.equal(projectExport.rows[0].deadline, '2026-11-05')
assert.equal(projectExport.rows[0].team, 'Delivery')

const userExport = prepareDatabaseExport({ context, dataset: 'users', recordIds: ['user-1'], fields: ['name', 'email', 'role'] })
assert.deepEqual(userExport.rows[0], { name: 'Avery Example', email: 'avery@example.test', role: 'Administrator' })
assert.equal(JSON.stringify(userExport).includes('never-export-this'), false)

assert.throws(() => prepareDatabaseExport({ context, dataset: 'tasks', recordIds: [999], fields: ['title'] }), /no longer available/)
assert.throws(() => prepareDatabaseExport({ context, dataset: 'tasks', fields: ['passwordHash'] }), /fields are unavailable/)
assert.throws(() => prepareDatabaseExport({ context, dataset: 'tasks', fields: ['customFields.private_note'] }), /fields are unavailable/)
assert.throws(() => prepareDatabaseExport({ context, dataset: 'tasks', fields: [] }), /export field is required/)
assert.throws(() => prepareDatabaseExport({ context, dataset: 'users', fields: ['passwordHash'] }), /fields are unavailable/)
assert.equal(prepareDatabaseExport({ context, dataset: 'delivery-report', recordIds: ['2026-W40'], fields: ['label', 'completed'] }).rows[0].label, 'Week 40')

console.log('Database-backed export field selection and safety checks passed')
