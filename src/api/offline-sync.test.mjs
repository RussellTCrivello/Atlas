import assert from 'node:assert/strict'
import { projectPendingChanges } from './offline-sync.js'

const source = {
  today: '2026-10-02',
  user: { id: 'user-1', role: 'Developer', personId: 'person-1' },
  settings: { workflows: { task: { states: [{ label: 'Done', terminal: true }] } } },
  teams: [{ id: 'team-1', name: 'Delivery', color: 'purple', peopleCount: 1 }],
  people: [{ id: 'person-1', name: 'Avery', email: 'avery@example.test', jobTitle: 'Developer', teamId: 'team-1', team: 'Delivery', capacity: 80, color: 'blue' }],
  projects: [{ numericId: 7, id: 'project-7', name: 'Atlas', code: 'ATL', teamId: 'team-1', ownerId: 'person-1', status: 'On track', deadlineDate: '2026-10-15', milestoneRows: [], customFields: {} }],
  tasks: [{ numericId: 41, id: 'ATL-041', title: 'Existing task', projectId: 7, project: 'Atlas', assigneeId: 'person-1', assignee: 'Avery', priority: 'Medium', dueDate: '2026-10-05', status: 'To do', type: 'Development', blocked: false, customFields: {} }],
  activity: [{ id: 'activity-1', personId: 'person-1', date: '2026-10-01', time: '09:00', yesterday: '', today: 'Original update', blocked: '', upcoming: '', person: 'Avery', personColor: 'blue' }], alerts: [], dashboard: { stats: { openTasks: 1, completedTasks: 0, activeProjects: 1, needsAttention: 0 }, myTasks: [] },
  reports: { series: [], remainingTasks: 1, activeProjects: 1, completedProjects: 0, blockedTasks: 0, overdue: 0, alerts: 0 }
}
const operations = [
  { collection: 'tasks', action: 'update', entityId: 41, body: { title: 'Edited offline', status: 'Done', projectId: 7 }, status: 'queued' },
  { collection: 'tasks', action: 'create', localId: 'offline-create-task-0123456789abcdef', entityId: 'offline-create-task-0123456789abcdef', body: { title: 'New offline task', projectId: 7, assigneeId: 'person-1', priority: 'High', dueDate: '2026-10-10', status: 'To do', type: 'Testing', blocked: false }, createdAt: Date.parse('2026-10-02T12:00:00Z'), status: 'queued' },
  { collection: 'activities', action: 'create', localId: 'offline-create-activity-0123456789abcdef', body: { personId: 'person-1', today: 'Working offline', blocked: '' }, createdAt: Date.parse('2026-10-02T12:01:00Z'), status: 'queued' },
  { collection: 'activities', action: 'update', entityId: 'activity-1', body: { personId: 'person-1', today: 'Corrected offline update', blocked: '' }, status: 'queued' }
]
const projected = projectPendingChanges('/api/bootstrap', source, operations)
assert.equal(projected.tasks.length, 2)
assert.equal(projected.tasks.find(task => task.numericId === 41).title, 'Edited offline')
assert.equal(projected.tasks.find(task => task.numericId === 41).status, 'Done')
assert.equal(projected.tasks.find(task => task.numericId === 'offline-create-task-0123456789abcdef').title, 'New offline task')
assert.equal(projected.projects[0].progress, 50)
assert.equal(projected.dashboard.stats.completedTasks, 1)
assert.equal(projected.activity[0].today, 'Working offline')
assert.equal(projected.activity.find(activity => activity.id === 'activity-1').today, 'Corrected offline update')

const detail = {
  project: { numericId: 7, name: 'Atlas', code: 'ATL' },
  tasks: [{ numericId: 41, title: 'Existing task', projectId: 7, status: 'To do', dueDate: '2026-10-05' }],
  milestones: [],
  source: 'sqlite'
}
const detailProjection = projectPendingChanges('/api/projects/7/tasks', detail, [
  { collection: 'tasks', action: 'update', entityId: 41, baseRecord: { projectId: 7 }, body: { projectId: 8, status: 'In progress' } }
])
assert.equal(detailProjection.tasks.length, 0)

const preferences = projectPendingChanges('/api/preferences', { filters: {}, language: '' }, [
  { collection: 'preferences', action: 'update', body: { filters: { tasks: [{ field: 'status', operator: 'equals', value: 'Done' }] }, language: 'ar' }, status: 'queued' }
])
assert.equal(preferences.filters.tasks.length, 1)
assert.equal(preferences.language, 'ar')

const profileOperation = { collection: 'profile', action: 'update', userId: 'user-1', body: { name: 'Avery Chen', avatarColor: 'teal' }, status: 'queued' }
const profile = projectPendingChanges('/api/profile', { user: { id: 'user-1', name: 'Avery', avatarColor: 'blue' } }, [profileOperation])
assert.equal(profile.user.name, 'Avery Chen')
assert.equal(profile.user.avatarColor, 'teal')
const profileBootstrap = projectPendingChanges('/api/bootstrap', source, [profileOperation])
assert.equal(profileBootstrap.user.name, 'Avery Chen')
assert.equal(profileBootstrap.people[0].name, 'Avery Chen')
assert.equal(profileBootstrap.people[0].color, 'teal')

const settings = projectPendingChanges('/api/bootstrap', source, [
  { collection: 'settings', action: 'update', body: { workspace: { name: 'Offline Atlas', branding: { primary: '#123456' } }, interface: { theme: 'dark' } }, status: 'queued' }
])
assert.equal(settings.settings.workspace.name, 'Offline Atlas')
assert.equal(settings.settings.workspace.branding.primary, '#123456')
assert.equal(settings.settings.workflows.task.states[0].label, 'Done')
assert.equal(settings.settings.interface.theme, 'dark')

console.log('offline client cache projection tests passed')
