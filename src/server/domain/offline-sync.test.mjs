import assert from 'node:assert/strict'
import { compareOfflineRecords, mergeOfflineRecord, mergeOfflineSettings, classifySyncRequest, syncRequestHash } from './offline-sync.js'

const taskBase = {
  title: 'Prepare release', projectId: 4, assigneeId: 'person-1', priority: 'Medium', dueDate: '2026-10-09',
  status: 'To do', type: 'Development', blocked: false, createdAt: '2026-10-01', completedAt: '',
  customFields: { ticket: 'ATL-41', review: { owner: 'Alex', approved: false } }
}

const differentFields = mergeOfflineRecord({
  collection: 'tasks', baseRecord: taskBase,
  currentRecord: { ...taskBase, priority: 'High' },
  localBody: { title: 'Prepare release', priority: 'Medium', status: 'In progress', customFields: taskBase.customFields }
})
assert.equal(differentFields.ok, true)
assert.equal(differentFields.mergedBody.priority, 'High')
assert.equal(differentFields.mergedBody.status, 'In progress')

const sameField = mergeOfflineRecord({
  collection: 'tasks', baseRecord: taskBase,
  currentRecord: { ...taskBase, status: 'Review' },
  localBody: { status: 'In progress' }
})
assert.equal(sameField.ok, false)
assert.deepEqual(sameField.fields.map(field => field.path), ['status'])
assert.equal(sameField.fields[0].base, 'To do')
assert.equal(sameField.fields[0].local, 'In progress')
assert.equal(sameField.fields[0].server, 'Review')

const customFieldsMerge = mergeOfflineRecord({
  collection: 'tasks', baseRecord: taskBase,
  currentRecord: { ...taskBase, customFields: { ...taskBase.customFields, review: { owner: 'Alex', approved: true } } },
  localBody: { customFields: { ...taskBase.customFields, ticket: 'ATL-42' } }
})
assert.equal(customFieldsMerge.ok, true)
assert.deepEqual(customFieldsMerge.mergedBody.customFields, {
  ticket: 'ATL-42', review: { owner: 'Alex', approved: true }
})

const customFieldOverlap = mergeOfflineRecord({
  collection: 'tasks', baseRecord: taskBase,
  currentRecord: { ...taskBase, customFields: { ...taskBase.customFields, review: { owner: 'Sam', approved: false } } },
  localBody: { customFields: { ...taskBase.customFields, review: { owner: 'Jordan', approved: false } } }
})
assert.equal(customFieldOverlap.ok, false)
assert.deepEqual(customFieldOverlap.fields.map(field => field.path), ['customFields.review.owner'])

const deletionDiff = compareOfflineRecords('tasks', taskBase, { ...taskBase, title: 'Renamed elsewhere' })
assert.deepEqual(deletionDiff.map(field => field.path), ['title'])

const activityBase = { personId: 'person-1', date: '2026-10-01', time: '09:00', yesterday: 'Done A', today: 'Doing B', blocked: '', upcoming: '', status: 'Confirmed', customFields: {} }
const activityDisjoint = mergeOfflineRecord({
  collection: 'activities', baseRecord: activityBase,
  currentRecord: { ...activityBase, today: 'Doing B and C' },
  localBody: { personId: 'person-1', yesterday: 'Done A and D' }
})
assert.equal(activityDisjoint.ok, true)
assert.equal(activityDisjoint.mergedBody.yesterday, 'Done A and D')
assert.equal(Object.hasOwn(activityDisjoint.mergedBody, 'today'), false)
const activityOverlap = mergeOfflineRecord({
  collection: 'activities', baseRecord: activityBase,
  currentRecord: { ...activityBase, blocked: 'Network access' },
  localBody: { personId: 'person-1', blocked: 'Waiting for review' }
})
assert.equal(activityOverlap.ok, false)
assert.deepEqual(activityOverlap.fields.map(field => field.path), ['blocked'])

const settingsBase = { workspace: { name: 'Atlas', branding: { primary: '#111111', accent: 'blue' } }, interface: { theme: 'light' } }
const disjointSettings = mergeOfflineSettings(settingsBase, { ...settingsBase, workspace: { ...settingsBase.workspace, name: 'Atlas host' } }, {
  workspace: { name: 'Atlas' }, interface: { theme: 'dark' }
})
assert.equal(disjointSettings.ok, true)
assert.deepEqual(disjointSettings.mergedBody, { workspace: { name: 'Atlas host' }, interface: { theme: 'dark' } })
const overlappingSettings = mergeOfflineSettings(settingsBase, { ...settingsBase, interface: { theme: 'dark' } }, { interface: { theme: 'system' } })
assert.equal(overlappingSettings.ok, false)
assert.deepEqual(overlappingSettings.fields.map(field => field.path), ['interface.theme'])

assert.deepEqual(classifySyncRequest('POST', '/api/tasks'), { collection: 'tasks', action: 'create', id: '' })
assert.deepEqual(classifySyncRequest('PATCH', '/api/tasks/41/status'), { collection: 'tasks', action: 'update', id: '41', statusOnly: true })
assert.deepEqual(classifySyncRequest('PUT', '/api/activity/activity-1'), { collection: 'activities', action: 'update', id: 'activity-1', statusOnly: false })
assert.deepEqual(classifySyncRequest('PUT', '/api/settings'), { collection: 'settings', action: 'update', id: 'workspace' })
assert.deepEqual(classifySyncRequest('POST', '/api/offline-sync/conflicts/op-1234567890123456/resolve'), { collection: 'syncConflicts', action: 'resolve', id: 'op-1234567890123456' })
assert.equal(classifySyncRequest('POST', '/api/users'), null)
assert.deepEqual(classifySyncRequest('PUT', '/api/preferences'), { collection: 'preferences', action: 'update', id: 'current-user' })
assert.deepEqual(classifySyncRequest('PUT', '/api/profile'), { collection: 'profile', action: 'update', id: 'current-user' })
const profileBase = { name: 'Avery Example', avatarColor: 'purple' }
const profileDisjoint = mergeOfflineRecord({
  collection: 'profile', baseRecord: profileBase,
  currentRecord: { ...profileBase, avatarColor: 'blue' },
  localBody: { name: 'Avery Chen' }
})
assert.equal(profileDisjoint.ok, true, 'profile fields merge independently through the offline conflict path')
assert.deepEqual(profileDisjoint.mergedBody, { name: 'Avery Chen' }, 'untouched profile fields remain server-owned and are omitted from the merged patch')
const profileOverlap = mergeOfflineRecord({
  collection: 'profile', baseRecord: profileBase,
  currentRecord: { ...profileBase, name: 'Avery Server' },
  localBody: { name: 'Avery Local' }
})
assert.equal(profileOverlap.ok, false)
assert.deepEqual(profileOverlap.fields.map(field => field.path), ['name'])

const requestHash = syncRequestHash({ method: 'PUT', pathname: '/api/tasks/41', body: { status: 'Review' }, localId: null, baseRecord: taskBase })
assert.equal(requestHash, syncRequestHash({ method: 'PUT', pathname: '/api/tasks/41', body: { status: 'Review' }, localId: null, baseRecord: taskBase }))
assert.notEqual(requestHash, syncRequestHash({ method: 'PUT', pathname: '/api/tasks/41', body: { status: 'Done' }, localId: null, baseRecord: taskBase }))

console.log('offline-sync conflict, merge, route classification, and idempotency-key tests passed')
