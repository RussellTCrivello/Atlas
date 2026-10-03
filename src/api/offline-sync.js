const DB_NAME = 'atlas-offline-workspace'
const DB_VERSION = 3
const RESPONSE_STORE = 'responses'
const OUTBOX_STORE = 'outbox'
const SESSION_STORE = 'sessions'
const META_STORE = 'meta'
const ACTIVE_SESSION_KEY = 'active'
const CACHEABLE_PATH = /^\/api\/(?:bootstrap|preferences|profile|reports(?:\/|$)|projects\/[^/]+\/tasks(?:\?|$))/
const SYNC_EVENT = 'atlas:offline-sync-updated'
const CONNECTIVITY_EVENT = 'atlas:offline-connectivity'

let databasePromise
let activeFlush = null
const retryTimers = new Map()

function clone(value) {
  if (value === undefined) return undefined
  return structuredClone(value)
}
function eventTarget() { return typeof window !== 'undefined' ? window : null }
function emit(name, detail = {}) {
  const target = eventTarget()
  if (target && typeof CustomEvent === 'function') target.dispatchEvent(new CustomEvent(name, { detail }))
}
function hasIndexedDb() { return typeof indexedDB !== 'undefined' }
function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `offline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}
function createOperationId() { return uuid() }
function createLocalId() { return `offline-${uuid()}` }
function cacheKey(userId, pathname) { return `${String(userId)}\n${String(pathname)}` }
function cleanPath(path) {
  const base = typeof location !== 'undefined' ? location.origin : 'http://atlas.local'
  return new URL(path, base).pathname
}
function normalizeMethod(method) { return String(method || 'GET').toUpperCase() }
function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function safeDateLabel(value) {
  if (!value) return 'No date'
  try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`)) }
  catch { return String(value) }
}
function isDone(task, settings = {}) {
  const states = settings?.workflows?.task?.states || []
  const terminal = states.filter(state => state?.terminal).map(state => state.label || state.name)
  return task?.status === 'Done' || terminal.includes(task?.status)
}
function statusTone(task, today) {
  if (isDone(task)) return 'done'
  if (task?.dueDate === today) return 'today'
  if (task?.dueDate && today && task.dueDate < today) return 'overdue'
  return 'soon'
}
function getCachedTask(data, id) { return data?.tasks?.find(row => String(row.numericId ?? row.id) === String(id)) || null }
function getCachedProject(data, id) { return data?.projects?.find(row => String(row.numericId ?? row.id) === String(id)) || null }
function cachedRecord(data, collection, id) {
  if (!data) return null
  if (collection === 'tasks') return getCachedTask(data, id)
  if (collection === 'projects') return getCachedProject(data, id)
  if (collection === 'people') return data.people?.find(row => String(row.id) === String(id)) || null
  if (collection === 'teams') return data.teams?.find(row => String(row.id) === String(id)) || null
  if (collection === 'alerts') return data.alerts?.find(row => String(row.id) === String(id)) || null
  if (collection === 'activities') return data.activity?.find(row => String(row.id) === String(id)) || null
  if (collection === 'milestones') {
    for (const project of data.projects || []) {
      const milestone = project.milestoneRows?.find(row => String(row.id) === String(id))
      if (milestone) return milestone
    }
  }
  return null
}
function canonicalRecord(collection, record) {
  if (!record) return null
  if (collection === 'settings') return clone(record)
  if (collection === 'profile') return { name: record.name || '', avatarColor: record.avatarColor || 'purple' }
  if (collection === 'tasks') return {
    title: record.title, projectId: record.projectId, assigneeId: record.assigneeId, priority: record.priority,
    dueDate: record.dueDate, status: record.status, type: record.type, blocked: Boolean(record.blocked), tags: clone(record.tags || []),
    createdAt: record.createdAt || '', completedAt: record.completedAt || '', customFields: clone(record.customFields || {})
  }
  if (collection === 'projects') return {
    name: record.name, code: record.code, description: record.description, teamId: record.teamId, ownerId: record.ownerId,
    color: record.color, status: record.status, deadline: record.deadlineDate ?? record.deadline ?? '',
    createdAt: record.createdAt || '', customFields: clone(record.customFields || {})
  }
  if (collection === 'people') return {
    name: record.name, email: record.email, jobTitle: record.jobTitle, teamId: record.teamId, focus: record.focus,
    capacity: record.capacity, status: record.status, color: record.color, customFields: clone(record.customFields || {})
  }
  if (collection === 'teams') return { name: record.name, color: record.color, customFields: clone(record.customFields || {}) }
  if (collection === 'milestones') return {
    name: record.name, projectId: record.projectId, dueDate: record.dueDate, status: record.status,
    customFields: clone(record.customFields || {})
  }
  if (collection === 'alerts') return {
    title: record.title, body: record.body, type: record.type, tone: record.tone, projectId: record.projectId,
    taskId: record.taskId || '', personId: record.personId || '', activityId: record.activityId || '', source: record.source || '',
    resolved: Boolean(record.resolved), createdAt: record.createdAt, lastSeenAt: record.lastSeenAt, customFields: clone(record.customFields || {})
  }
  if (collection === 'activities') return {
    personId: record.personId, date: record.date, time: record.time, yesterday: record.yesterday, today: record.today,
    blocked: record.blocked, upcoming: record.upcoming, status: record.status, customFields: clone(record.customFields || {})
  }
  return null
}
function identifyMutation(path, method) {
  const pathname = cleanPath(path)
  const verb = normalizeMethod(method)
  if (verb === 'POST') {
    const conflictResolution = pathname.match(/^\/api\/offline-sync\/conflicts\/([^/]+)\/resolve$/)
    if (conflictResolution) return { collection: 'syncConflicts', action: 'resolve', id: decodeURIComponent(conflictResolution[1]) }
  }
  if (verb === 'PUT' && pathname === '/api/settings') return { collection: 'settings', action: 'update', id: 'workspace' }
  if (verb === 'PUT' && pathname === '/api/preferences') return { collection: 'preferences', action: 'update', id: 'current-user' }
  if (verb === 'PUT' && pathname === '/api/profile') return { collection: 'profile', action: 'update', id: 'current-user' }
  const creates = {
    '/api/tasks': 'tasks', '/api/projects': 'projects', '/api/people': 'people', '/api/teams': 'teams',
    '/api/milestones': 'milestones', '/api/activity': 'activities', '/api/alerts': 'alerts'
  }
  if (verb === 'POST' && creates[pathname]) return { collection: creates[pathname], action: 'create', id: '' }
  if (!['PUT', 'PATCH', 'DELETE'].includes(verb)) return null
  const match = pathname.match(/^\/api\/(tasks|projects|people|teams|milestones|activity|alerts)\/([^/]+)(?:\/(status))?$/)
  if (!match) return null
  const collection = match[1] === 'activity' ? 'activities' : match[1]
  const isTaskStatus = match[1] === 'tasks' && match[3] === 'status'
  if (match[3] && !isTaskStatus) return null
  if (isTaskStatus && verb !== 'PATCH') return null
  if (verb === 'PATCH' && !(isTaskStatus || match[1] === 'alerts')) return null
  if (verb === 'PUT' && match[1] === 'alerts') return null
  return { collection, action: verb === 'DELETE' ? 'delete' : 'update', id: decodeURIComponent(match[2]), statusOnly: isTaskStatus }
}
function indexedRequest(path, method, body, userId) {
  return { path, method: normalizeMethod(method), body: clone(body || {}), userId: String(userId || '') }
}

async function openDatabase() {
  if (!hasIndexedDb()) throw new Error('This browser does not provide IndexedDB; offline changes cannot be stored safely.')
  if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = event => {
      const db = request.result
      if (!db.objectStoreNames.contains(RESPONSE_STORE)) db.createObjectStore(RESPONSE_STORE, { keyPath: 'key' })
      let outbox
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        outbox = db.createObjectStore(OUTBOX_STORE, { keyPath: 'operationId' })
        outbox.createIndex('byUser', 'userId', { unique: false })
        outbox.createIndex('byUserAndCreatedAt', ['userId', 'createdAt'], { unique: false })
      } else {
        outbox = request.transaction.objectStore(OUTBOX_STORE)
        if (!outbox.indexNames.contains('byUser')) outbox.createIndex('byUser', 'userId', { unique: false })
        if (!outbox.indexNames.contains('byUserAndCreatedAt')) outbox.createIndex('byUserAndCreatedAt', ['userId', 'createdAt'], { unique: false })
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE, { keyPath: 'key' })
      const meta = db.objectStoreNames.contains(META_STORE) ? request.transaction.objectStore(META_STORE) : db.createObjectStore(META_STORE, { keyPath: 'key' })
      if (event.oldVersion > 0 && event.oldVersion < 3) {
        const legacyRows = []
        const cursorRequest = outbox.openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (cursor) { legacyRows.push(cursor.value); cursor.continue(); return }
          legacyRows.sort((left, right) => String(left.userId).localeCompare(String(right.userId)) || Number(left.createdAt || 0) - Number(right.createdAt || 0) || String(left.operationId).localeCompare(String(right.operationId)))
          const sequences = new Map()
          for (const row of legacyRows) {
            const userKey = String(row.userId || '')
            const sequence = (sequences.get(userKey) || 0) + 1
            row.sequence = Number(row.sequence) > 0 ? Number(row.sequence) : sequence
            sequences.set(userKey, Math.max(sequence, Number(row.sequence)))
            outbox.put(row)
          }
          for (const [userKey, sequence] of sequences) meta.put({ key: `queue-sequence:${userKey}`, value: sequence })
        }
      }
      if (!outbox.indexNames.contains('byUserAndSequence')) outbox.createIndex('byUserAndSequence', ['userId', 'sequence'], { unique: false })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Unable to open offline storage'))
    request.onblocked = () => reject(new Error('Offline storage is blocked by another Atlas tab. Close older tabs and retry.'))
  }).catch(error => { databasePromise = null; throw error })
  return databasePromise
}

async function requestValue(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Offline storage request failed'))
  })
}
async function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error || new Error('Offline storage transaction was aborted'))
    transaction.onerror = () => reject(transaction.error || new Error('Offline storage transaction failed'))
  })
}
function createTransaction(db, stores, mode = 'readonly') {
  if (mode === 'readwrite') {
    try { return db.transaction(stores, mode, { durability: 'strict' }) } catch {}
  }
  return db.transaction(stores, mode)
}
function signalUpdated(userId = '') { emit(SYNC_EVENT, { userId }) }
function signalConnectivity(connected, error = '') { emit(CONNECTIVITY_EVENT, { connected: Boolean(connected), error: String(error || '') }) }

export async function saveOfflineSession({ user, sessionExpiresAt }) {
  if (!user?.id) return
  const expiresAt = Number(sessionExpiresAt)
  let persistentStorage = false
  try { persistentStorage = await globalThis.navigator?.storage?.persist?.() === true } catch {}
  const session = { key: ACTIVE_SESSION_KEY, user: clone(user), userId: String(user.id), expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now(), savedAt: Date.now(), persistentStorage }
  const db = await openDatabase()
  const tx = createTransaction(db, SESSION_STORE, 'readwrite')
  tx.objectStore(SESSION_STORE).put(session)
  await transactionDone(tx)
  signalUpdated(session.userId)
}

export async function getOfflineSession({ allowExpired = false } = {}) {
  try {
    const db = await openDatabase()
    const tx = createTransaction(db, SESSION_STORE, 'readonly')
    const done = transactionDone(tx)
    const session = await requestValue(tx.objectStore(SESSION_STORE).get(ACTIVE_SESSION_KEY))
    await done
    if (!session?.user?.id || (!allowExpired && Number(session.expiresAt) <= Date.now())) return null
    return clone(session)
  } catch { return null }
}

async function putCachedResponse(path, body, userId) {
  if (!userId || !CACHEABLE_PATH.test(path)) return
  const db = await openDatabase()
  const tx = createTransaction(db, RESPONSE_STORE, 'readwrite')
  tx.objectStore(RESPONSE_STORE).put({ key: cacheKey(userId, path), userId: String(userId), path, body: clone(body), savedAt: Date.now() })
  await transactionDone(tx)
}

export async function cacheApiResponse(path, body) {
  if (!CACHEABLE_PATH.test(cleanPath(path))) return
  const session = await getOfflineSession({ allowExpired: true })
  const userId = body?.user?.id || session?.userId
  if (!userId) return
  await putCachedResponse(path, body, userId)
}

async function readRawResponse(path, userId) {
  if (!userId) return null
  const db = await openDatabase()
  const tx = createTransaction(db, RESPONSE_STORE, 'readonly')
  const done = transactionDone(tx)
  const row = await requestValue(tx.objectStore(RESPONSE_STORE).get(cacheKey(userId, path)))
  await done
  return row ? clone(row.body) : null
}

async function readAllOperations(userId = '') {
  if (!hasIndexedDb()) return []
  const db = await openDatabase()
  const tx = createTransaction(db, OUTBOX_STORE, 'readonly')
  const done = transactionDone(tx)
  const rows = await requestValue(tx.objectStore(OUTBOX_STORE).getAll())
  await done
  return (rows || []).filter(row => !userId || row.userId === String(userId)).sort((left, right) => (Number(left.sequence) || left.createdAt) - (Number(right.sequence) || right.createdAt))
}

export async function getCachedResponse(path, userId) {
  const body = await readRawResponse(path, userId)
  if (body === null) return null
  const operations = await readAllOperations(userId)
  return projectPendingChanges(path, body, operations)
}

export async function createMutationOperation(path, method, body, userId) {
  const descriptor = identifyMutation(path, method)
  if (!descriptor || !userId) return null
  const normalizedBody = clone(body || {})
  let bootstrap = null
  let baseRecord = null
  if (descriptor.collection === 'settings') {
    bootstrap = await getCachedResponse('/api/bootstrap', userId)
    baseRecord = canonicalRecord('settings', bootstrap?.settings)
  } else if (descriptor.collection === 'profile') {
    const session = await getOfflineSession({ allowExpired: true })
    if (session?.userId === String(userId)) baseRecord = canonicalRecord('profile', session.user)
  } else if (descriptor.action !== 'create' && !['preferences', 'syncConflicts'].includes(descriptor.collection)) {
    bootstrap = await getCachedResponse('/api/bootstrap', userId)
    let record = cachedRecord(bootstrap, descriptor.collection, descriptor.id)
    if (!record && descriptor.collection === 'milestones') {
      const detailRows = await listCachedResponses(userId, /^\/api\/projects\/[^/]+\/tasks/)
      for (const detail of detailRows) {
        record = detail.body?.milestones?.find(row => String(row.id) === String(descriptor.id)) || null
        if (record) break
      }
    }
    baseRecord = canonicalRecord(descriptor.collection, record)
  }
  if (descriptor.action !== 'create' && !['preferences', 'syncConflicts'].includes(descriptor.collection) && !baseRecord) return null
  if (descriptor.collection === 'tasks' && descriptor.statusOnly && normalizedBody.advance === true) {
    const configured = bootstrap?.settings?.workflows?.task?.states || []
    const states = configured.map(state => typeof state === 'string' ? state : state?.label || state?.name).filter(Boolean)
    const fallback = ['To do', 'In progress', 'Review', 'Testing', 'Done']
    const sequence = states.length ? states : fallback
    const currentIndex = sequence.indexOf(baseRecord?.status)
    if (currentIndex >= 0) normalizedBody.status = sequence[Math.min(sequence.length - 1, currentIndex + 1)]
    delete normalizedBody.advance
  }
  if (descriptor.collection === 'activities' && !normalizedBody.personId) {
    const session = await getOfflineSession({ allowExpired: true })
    if (session?.user?.id === String(userId)) normalizedBody.personId = session.user.personId || ''
  }
  const localId = descriptor.action === 'create' ? createLocalId() : null
  return {
    operationId: createOperationId(), userId: String(userId), collection: descriptor.collection,
    action: descriptor.action, entityId: descriptor.id || localId, localId, path: String(path),
    method: normalizeMethod(method), body: normalizedBody, baseRecord,
    status: 'queued', attempts: 0, createdAt: Date.now(), updatedAt: Date.now(), retryAt: 0,
    lastError: '', conflict: null
  }
}

async function listCachedResponses(userId, pathnamePattern) {
  const db = await openDatabase()
  const tx = createTransaction(db, RESPONSE_STORE, 'readonly')
  const done = transactionDone(tx)
  const rows = await requestValue(tx.objectStore(RESPONSE_STORE).getAll())
  await done
  return (rows || []).filter(row => row.userId === String(userId) && pathnamePattern.test(row.path)).map(clone)
}

export async function storePendingOperation(operation) {
  if (!operation?.operationId || !operation.userId) throw new Error('Offline changes need a signed-in local session.')
  const db = await openDatabase()
  const tx = createTransaction(db, [OUTBOX_STORE, META_STORE], 'readwrite')
  const done = transactionDone(tx)
  const metaKey = `queue-sequence:${operation.userId}`
  const sequenceRequest = tx.objectStore(META_STORE).get(metaKey)
  sequenceRequest.onsuccess = () => {
    const sequence = Number(sequenceRequest.result?.value || 0) + 1
    operation.sequence = sequence
    tx.objectStore(META_STORE).put({ key: metaKey, value: sequence })
    tx.objectStore(OUTBOX_STORE).put(clone(operation))
  }
  await done
  signalUpdated(operation.userId)
}

async function replaceConflictOperations(conflictOperationId, userId, replacements) {
  const db = await openDatabase()
  const tx = createTransaction(db, [OUTBOX_STORE, META_STORE], 'readwrite')
  const done = transactionDone(tx)
  const outbox = tx.objectStore(OUTBOX_STORE)
  const meta = tx.objectStore(META_STORE)
  let found = false
  const conflictRequest = outbox.get(conflictOperationId)
  conflictRequest.onsuccess = () => {
    const existing = conflictRequest.result
    if (!existing || existing.userId !== String(userId) || existing.status !== 'conflict') {
      try { tx.abort() } catch {}
      return
    }
    found = true
    const metaRequest = meta.get(`queue-sequence:${userId}`)
    metaRequest.onsuccess = () => {
      let latestSequence = Math.max(Number(metaRequest.result?.value || 0), Number(existing.sequence || 0))
      outbox.delete(conflictOperationId)
      replacements.forEach((operation, index) => {
        const sequence = index === 0 && Number(existing.sequence) > 0 ? Number(existing.sequence) : ++latestSequence
        operation.sequence = sequence
        operation.createdAt ||= Date.now()
        operation.updatedAt = Date.now()
        outbox.put(clone(operation))
      })
      latestSequence = Math.max(latestSequence, ...replacements.map(operation => Number(operation.sequence || 0)))
      meta.put({ key: `queue-sequence:${userId}`, value: latestSequence })
    }
  }
  try { await done } catch (error) { if (found) throw error; return false }
  if (!found) return false
  signalUpdated(userId)
  return true
}

export async function updatePendingOperation(operation) {
  const db = await openDatabase()
  const tx = createTransaction(db, OUTBOX_STORE, 'readwrite')
  tx.objectStore(OUTBOX_STORE).put({ ...clone(operation), updatedAt: Date.now() })
  await transactionDone(tx)
  signalUpdated(operation.userId)
}

export async function removePendingOperation(operationId, userId = '') {
  const db = await openDatabase()
  const tx = createTransaction(db, OUTBOX_STORE, 'readwrite')
  const store = tx.objectStore(OUTBOX_STORE)
  const done = transactionDone(tx)
  const existing = await requestValue(store.get(operationId))
  if (existing && (!userId || existing.userId === String(userId))) store.delete(operationId)
  await done
  signalUpdated(existing?.userId || userId)
}

export async function getPendingOperations(userId = '') { return readAllOperations(userId) }

export async function getOfflineSyncStatus(userId = '') {
  const operations = await readAllOperations()
  const visible = userId ? operations.filter(row => row.userId === String(userId)) : operations
  const otherUserPending = userId ? operations.filter(row => row.userId !== String(userId)).length : 0
  const pending = visible.filter(row => row.status === 'queued' || row.status === 'retrying' || row.status === 'sending').length
  const conflicts = visible.filter(row => row.status === 'conflict').length
  const failed = visible.filter(row => row.status === 'failed').length
  const session = userId ? await getOfflineSession({ allowExpired: true }) : null
  const storagePersistent = Boolean(session?.userId === String(userId) && session.persistentStorage)
  return { pending, conflicts, failed, otherUserPending, storagePersistent, operations: visible }
}

export async function clearOfflineSession(userId, { clearResponses = true } = {}) {
  const db = await openDatabase()
  const tx = createTransaction(db, [SESSION_STORE, ...(clearResponses ? [RESPONSE_STORE] : [])], 'readwrite')
  const sessionStore = tx.objectStore(SESSION_STORE)
  const done = transactionDone(tx)
  const active = await requestValue(sessionStore.get(ACTIVE_SESSION_KEY))
  if (!userId || active?.userId === String(userId)) sessionStore.delete(ACTIVE_SESSION_KEY)
  if (clearResponses && userId) {
    const responseStore = tx.objectStore(RESPONSE_STORE)
    const rows = await requestValue(responseStore.getAll())
    for (const row of rows || []) if (row.userId === String(userId)) responseStore.delete(row.key)
  }
  await done
  signalUpdated(userId)
}

function setPathValue(target, dottedPath, value, exists = true) {
  const keys = String(dottedPath).split('.')
  let current = target
  for (let index = 0; index < keys.length - 1; index++) {
    if (!isPlainObject(current[keys[index]])) current[keys[index]] = {}
    current = current[keys[index]]
  }
  const last = keys[keys.length - 1]
  if (exists) current[last] = clone(value)
  else delete current[last]
}
function setEntityField(target, collection, key, value) {
  if (collection === 'projects' && key === 'deadline') target.deadlineDate = value
  else target[key] = clone(value)
}
function findIndex(rows, key, id) { return (rows || []).findIndex(row => String(row[key]) === String(id)) }
function projectDisplay(row, bootstrap) {
  const team = bootstrap.teams?.find(item => String(item.id) === String(row.teamId)) || {}
  const owner = bootstrap.people?.find(item => String(item.id) === String(row.ownerId)) || {}
  return {
    id: `project-${row.id}`, numericId: row.id, name: row.name, code: row.code || '', description: row.description || '',
    teamId: row.teamId || '', team: team.name || 'Workspace', ownerId: row.ownerId || '', owner: owner.name || 'Unassigned',
    color: row.color || team.color || 'purple', status: row.status || 'On track', health: row.status || 'On track', progress: 0,
    deadlineDate: row.deadline || '', deadline: safeDateLabel(row.deadline), days: row.deadline ? safeDateLabel(row.deadline) : 'No date',
    members: owner.name ? [owner.name] : [], memberColors: owner.name ? { [owner.name]: owner.color || 'purple' } : {},
    milestoneRows: [], customFields: clone(row.customFields || {})
  }
}
function taskDisplay(row, bootstrap) {
  const project = bootstrap.projects?.find(item => String(item.numericId) === String(row.projectId)) || {}
  const person = bootstrap.people?.find(item => String(item.id) === String(row.assigneeId)) || {}
  return {
    numericId: row.id, id: `${project.code || 'TASK'}-${String(row.id).padStart(3, '0')}`, title: row.title || '',
    projectId: row.projectId, project: project.name || 'Workspace', assigneeId: row.assigneeId || '',
    assignee: person.name || 'Unassigned', assigneeColor: person.color || 'purple', priority: row.priority || 'Medium',
    dueDate: row.dueDate || '', due: safeDateLabel(row.dueDate), dueTone: statusTone(row, bootstrap.today),
    status: row.status || 'To do', type: row.type || 'Development', blocked: Boolean(row.blocked),
    createdAt: row.createdAt || '', completedAt: row.completedAt || '', customFields: clone(row.customFields || {})
  }
}
function updateDerivedTaskFields(task, bootstrap) {
  const project = bootstrap.projects?.find(item => String(item.numericId) === String(task.projectId)) || {}
  const person = bootstrap.people?.find(item => String(item.id) === String(task.assigneeId)) || {}
  task.id = `${project.code || 'TASK'}-${String(task.numericId).padStart(3, '0')}`
  task.project = project.name || 'Workspace'
  task.assignee = person.name || 'Unassigned'
  task.assigneeColor = person.color || 'purple'
  task.due = safeDateLabel(task.dueDate)
  task.dueTone = statusTone(task, bootstrap.today)
}
function updateProjectMetrics(bootstrap) {
  for (const project of bootstrap.projects || []) {
    const rows = (bootstrap.tasks || []).filter(task => String(task.projectId) === String(project.numericId))
    const completed = rows.filter(task => isDone(task, bootstrap.settings)).length
    project.progress = rows.length ? Math.round(completed / rows.length * 100) : 0
    project.health = project.status === 'Completed' ? 'Completed' : project.status === 'At risk' ? 'At risk' : rows.some(task => !isDone(task, bootstrap.settings) && task.dueDate && bootstrap.today && task.dueDate < bootstrap.today) ? 'At risk' : 'On track'
  }
  const tasks = bootstrap.tasks || []
  const projects = bootstrap.projects || []
  const alerts = bootstrap.alerts || []
  const stats = bootstrap.dashboard?.stats
  if (stats) {
    stats.openTasks = tasks.filter(task => !isDone(task, bootstrap.settings)).length
    stats.completedTasks = tasks.filter(task => isDone(task, bootstrap.settings)).length
    stats.activeProjects = projects.filter(project => project.status !== 'Completed').length
    stats.needsAttention = alerts.filter(alert => !alert.resolved).length
    const active = projects.filter(project => project.status !== 'Completed')
    stats.onTrack = active.length ? Math.round(active.filter(project => project.health !== 'At risk').length / active.length * 100) : 100
  }
  const report = bootstrap.reports
  if (report) {
    report.remainingTasks = tasks.filter(task => !isDone(task, bootstrap.settings)).length
    report.activeProjects = projects.filter(project => project.status !== 'Completed').length
    report.completedProjects = projects.filter(project => project.status === 'Completed').length
    report.blockedTasks = tasks.filter(task => task.blocked && !isDone(task, bootstrap.settings)).length
    report.overdue = tasks.filter(task => !isDone(task, bootstrap.settings) && task.dueDate && bootstrap.today && task.dueDate < bootstrap.today).length
    report.alerts = alerts.filter(alert => !alert.resolved).length
  }
}

function mergeProjectedObject(target, source) {
  const result = isPlainObject(target) ? clone(target) : {}
  for (const [key, value] of Object.entries(source || {})) {
    result[key] = isPlainObject(value) && isPlainObject(result[key]) ? mergeProjectedObject(result[key], value) : clone(value)
  }
  return result
}

function projectPendingOperation(bootstrap, operation) {
  const { collection, action, entityId, localId, body } = operation
  if (collection === 'settings') { bootstrap.settings = mergeProjectedObject(bootstrap.settings, body); return }
  if (collection === 'profile') {
    if (String(bootstrap.user?.id || '') === String(operation.userId)) {
      Object.assign(bootstrap.user, clone(body || {}))
      const person = bootstrap.people?.find(row => String(row.id) === String(bootstrap.user.personId || ''))
      if (person) {
        if (Object.hasOwn(body || {}, 'name')) person.name = body.name
        if (Object.hasOwn(body || {}, 'avatarColor')) person.color = body.avatarColor
      }
      const userRow = bootstrap.users?.find(row => String(row.id) === String(operation.userId))
      if (userRow) Object.assign(userRow, clone(body || {}))
    }
    return
  }
  if (collection === 'preferences') return
  if (collection === 'tasks') {
    const id = action === 'create' ? localId : entityId
    const index = findIndex(bootstrap.tasks, 'numericId', id)
    if (action === 'delete') { if (index >= 0) bootstrap.tasks.splice(index, 1); return }
    if (action === 'create') {
      const raw = { ...clone(body), id: localId }
      bootstrap.tasks.push(taskDisplay(raw, bootstrap))
      return
    }
    if (index >= 0) {
      const row = bootstrap.tasks[index]
      for (const [key, value] of Object.entries(body || {})) setEntityField(row, collection, key, value)
      updateDerivedTaskFields(row, bootstrap)
    }
    return
  }
  if (collection === 'projects') {
    const id = action === 'create' ? localId : entityId
    const index = findIndex(bootstrap.projects, 'numericId', id)
    if (action === 'delete') { if (index >= 0) bootstrap.projects.splice(index, 1); return }
    if (action === 'create') {
      bootstrap.projects.push(projectDisplay({ ...clone(body), id: localId }, bootstrap))
      return
    }
    if (index >= 0) {
      const row = bootstrap.projects[index]
      for (const [key, value] of Object.entries(body || {})) setEntityField(row, collection, key, value)
      row.deadline = safeDateLabel(row.deadlineDate)
    }
    return
  }
  if (collection === 'people') {
    const id = action === 'create' ? localId : entityId
    const index = findIndex(bootstrap.people, 'id', id)
    if (action === 'delete') { if (index >= 0) bootstrap.people.splice(index, 1); return }
    if (action === 'create') {
      const team = bootstrap.teams?.find(row => String(row.id) === String(body.teamId)) || {}
      bootstrap.people.push({ ...clone(body), id: localId, team: team.name || 'Workspace', role: body.jobTitle || '', load: body.capacity || 0 })
      return
    }
    if (index >= 0) Object.assign(bootstrap.people[index], clone(body))
    return
  }
  if (collection === 'teams') {
    const id = action === 'create' ? localId : entityId
    const index = findIndex(bootstrap.teams, 'id', id)
    if (action === 'delete') { if (index >= 0) bootstrap.teams.splice(index, 1); return }
    if (action === 'create') { bootstrap.teams.push({ ...clone(body), id: localId, peopleCount: 0 }); return }
    if (index >= 0) Object.assign(bootstrap.teams[index], clone(body))
    return
  }
  if (collection === 'activities') {
    const id = action === 'create' ? localId : entityId
    const index = findIndex(bootstrap.activity, 'id', id)
    if (action === 'delete') { if (index >= 0) bootstrap.activity.splice(index, 1); return }
    if (action === 'create') {
      const person = bootstrap.people?.find(row => String(row.id) === String(body.personId)) || {}
      bootstrap.activity.unshift({ ...clone(body), id: localId, date: body.date || bootstrap.today, time: body.time || '', person: person.name || 'Unknown', personColor: person.color || 'purple', isToday: true })
      return
    }
    if (index >= 0) {
      Object.assign(bootstrap.activity[index], clone(body))
      const person = bootstrap.people?.find(row => String(row.id) === String(bootstrap.activity[index].personId)) || {}
      bootstrap.activity[index].person = person.name || 'Unknown'
      bootstrap.activity[index].personColor = person.color || 'purple'
    }
    return
  }
  if (collection === 'alerts') {
    const id = action === 'create' ? localId : entityId
    const index = findIndex(bootstrap.alerts, 'id', id)
    if (action === 'delete') { if (index >= 0) bootstrap.alerts.splice(index, 1); return }
    if (action === 'create') {
      const project = bootstrap.projects?.find(row => String(row.numericId) === String(body.projectId)) || {}
      bootstrap.alerts.unshift({ ...clone(body), id: localId, project: project.name || 'Workspace', resolved: false, time: 'Just now', createdAt: new Date(operation.createdAt).toISOString() })
      return
    }
    if (index >= 0) {
      Object.assign(bootstrap.alerts[index], clone(body))
      const project = bootstrap.projects?.find(row => String(row.numericId) === String(bootstrap.alerts[index].projectId)) || {}
      bootstrap.alerts[index].project = project.name || 'Workspace'
    }
    return
  }
  if (collection === 'milestones') {
    const id = action === 'create' ? localId : entityId
    const projects = bootstrap.projects || []
    let project = projects.find(row => String(row.numericId) === String(action === 'create' ? body.projectId : (cachedRecord(bootstrap, collection, id)?.projectId || body.projectId)))
    for (const row of projects) row.milestoneRows = Array.isArray(row.milestoneRows) ? row.milestoneRows : []
    let existing = null
    for (const row of projects) {
      const index = row.milestoneRows.findIndex(item => String(item.id) === String(id))
      if (index >= 0) { project = row; existing = { index, row: row.milestoneRows[index] }; break }
    }
    if (action === 'delete') { if (existing) project.milestoneRows.splice(existing.index, 1); return }
    if (action === 'create') {
      project ||= projects.find(row => String(row.numericId) === String(body.projectId))
      if (project) project.milestoneRows.push({ ...clone(body), id: localId, projectId: project.numericId, project: project.name })
      return
    }
    if (existing) Object.assign(existing.row, clone(body))
  }
}

export function projectPendingChanges(path, response, operations = []) {
  const result = clone(response)
  const pathname = cleanPath(path)
  if (pathname === '/api/preferences') {
    for (const operation of operations) {
      if (operation.collection !== 'preferences' || operation.status === 'conflict') continue
      if (operation.body && Object.hasOwn(operation.body, 'filters')) result.filters = clone(operation.body.filters)
      if (operation.body && Object.hasOwn(operation.body, 'language')) result.language = clone(operation.body.language)
    }
    return result
  }
  if (pathname === '/api/profile') {
    if (result?.user && typeof result.user === 'object') {
      for (const operation of operations) {
        if (operation.collection === 'profile' && operation.status !== 'conflict') Object.assign(result.user, clone(operation.body || {}))
      }
    }
    return result
  }
  if (pathname === '/api/bootstrap') {
    if (!Array.isArray(result?.tasks) || !Array.isArray(result?.projects)) return result
    for (const operation of operations) projectPendingOperation(result, operation)
    updateProjectMetrics(result)
    return result
  }
  const match = pathname.match(/^\/api\/projects\/([^/]+)\/tasks$/)
  if (match && result?.project) {
    const projectId = decodeURIComponent(match[1])
    for (const operation of operations) {
      if (operation.collection === 'tasks') {
        const taskId = operation.action === 'create' ? operation.localId : operation.entityId
        const index = findIndex(result.tasks, 'numericId', taskId)
        const sourceProjectId = operation.baseRecord?.projectId
        const targetProjectId = operation.body?.projectId ?? sourceProjectId
        if (String(sourceProjectId ?? targetProjectId ?? '') !== projectId && String(targetProjectId ?? '') !== projectId) continue
        if (operation.action === 'delete') { if (index >= 0) result.tasks.splice(index, 1) }
        else if (operation.action === 'create') result.tasks.push(taskDisplay({ ...clone(operation.body), id: taskId }, { projects: [result.project], people: [], today: new Date().toISOString().slice(0, 10) }))
        else if (index >= 0) {
          Object.assign(result.tasks[index], clone(operation.body))
          if (String(result.tasks[index].projectId) !== projectId) result.tasks.splice(index, 1)
          else updateDerivedTaskFields(result.tasks[index], { projects: [result.project], people: [], today: new Date().toISOString().slice(0, 10) })
        } else if (String(targetProjectId) === projectId && operation.action === 'update') {
          result.tasks.push(taskDisplay({ ...(operation.baseRecord || {}), ...clone(operation.body), id: taskId }, { projects: [result.project], people: [], today: new Date().toISOString().slice(0, 10) }))
        }
      }
      if (operation.collection === 'milestones' && String(operation.body?.projectId ?? operation.baseRecord?.projectId ?? '') === projectId) {
        const milestoneId = operation.action === 'create' ? operation.localId : operation.entityId
        const index = findIndex(result.milestones, 'id', milestoneId)
        if (operation.action === 'delete') { if (index >= 0) result.milestones.splice(index, 1) }
        else if (operation.action === 'create') result.milestones.push({ ...clone(operation.body), id: milestoneId, projectId: result.project.numericId, project: result.project.name })
        else if (index >= 0) Object.assign(result.milestones[index], clone(operation.body))
      }
    }
    return result
  }
  return result
}

export async function applyOfflineProjection(path, response, userId) {
  const operations = await readAllOperations(userId)
  return projectPendingChanges(path, response, operations)
}

function metadataFor(operation) {
  return {
    operationId: operation.operationId, collection: operation.collection,
    localId: operation.localId || undefined, baseRecord: operation.baseRecord,
    enforceConflicts: true
  }
}

export async function queueOfflineOperation(operation, { conflict = null, error = '' } = {}) {
  if (!operation) throw new Error('This change cannot be safely queued for offline synchronization.')
  operation.status = conflict ? 'conflict' : 'queued'
  operation.conflict = conflict ? clone(conflict) : null
  operation.lastError = String(error || '')
  operation.retryAt = 0
  await storePendingOperation(operation)
  return { offlineQueued: true, operationId: operation.operationId, localId: operation.localId || null, conflict: Boolean(conflict) }
}

function backoff(attempt) {
  const maxDelay = 5 * 60 * 1000
  const base = Math.min(maxDelay, 1000 * (2 ** Math.min(Math.max(attempt - 1, 0), 8)))
  return Math.round(base * (0.8 + Math.random() * 0.4))
}

export function scheduleOfflineRetry(userId, delay = 1000) {
  if (!userId || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  const key = String(userId)
  const existing = retryTimers.get(key)
  if (existing) clearTimeout(existing)
  const timer = setTimeout(() => {
    retryTimers.delete(key)
    flushOfflineOutbox(key, { force: true }).catch(() => {})
  }, Math.max(250, Number(delay) || 1000))
  retryTimers.set(key, timer)
}

export async function flushOfflineOutbox(userId, { force = false } = {}) {
  if (!userId || typeof fetch !== 'function') return { synced: 0, remaining: 0 }
  if (activeFlush) return activeFlush
  activeFlush = (async () => {
    let synced = 0
    const operations = await getPendingOperations(userId)
    for (const operation of operations) {
      if (operation.status === 'conflict' || operation.status === 'failed') break
      if (!force && Number(operation.retryAt || 0) > Date.now()) break
      operation.status = 'sending'
      await updatePendingOperation(operation)
      signalConnectivity(true)
      let response
      try {
        const originalBody = clone(operation.body || {})
        const outgoingBody = { ...originalBody, __atlasSync: metadataFor(operation) }
        response = await fetch(operation.path, {
          method: operation.method, credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(outgoingBody)
        })
      } catch (error) {
        const attempts = Number(operation.attempts || 0) + 1
        operation.status = 'retrying'
        operation.attempts = attempts
        operation.retryAt = Date.now() + backoff(attempts)
        operation.lastError = String(error?.message || 'Local Atlas host is not reachable')
        await updatePendingOperation(operation)
        signalConnectivity(false, operation.lastError)
        break
      }
      const responseBody = await response.json().catch(() => ({}))
      if (response.status >= 200 && response.status < 300) {
        await removePendingOperation(operation.operationId, userId)
        synced++
        continue
      }
      if (response.status === 409 && responseBody?.conflict) {
        operation.status = 'conflict'
        operation.conflict = responseBody
        operation.lastError = responseBody.error || 'This change conflicts with a newer server edit.'
        operation.retryAt = 0
        await updatePendingOperation(operation)
        signalConnectivity(true)
        break
      }
      if (response.status === 401 || response.status === 403) {
        operation.status = 'failed'
        operation.lastError = responseBody.error || 'Sign in with the same account to synchronize these changes.'
        operation.retryAt = 0
        await updatePendingOperation(operation)
        signalConnectivity(true)
        break
      }
      const attempts = Number(operation.attempts || 0) + 1
      operation.status = response.status >= 500 ? 'retrying' : 'failed'
      operation.attempts = attempts
      operation.retryAt = response.status >= 500 ? Date.now() + backoff(attempts) : 0
      operation.lastError = responseBody.error || `Synchronization failed (${response.status})`
      await updatePendingOperation(operation)
      signalConnectivity(true, operation.lastError)
      break
    }
    const status = await getOfflineSyncStatus(userId)
    if (synced) emit('atlas:offline-sync-complete', { userId, synced })
    const first = status.operations[0]
    if (first?.status === 'retrying' && typeof navigator !== 'undefined' && navigator.onLine !== false) scheduleOfflineRetry(userId, Math.max(250, Number(first.retryAt || 0) - Date.now()))
    signalUpdated(userId)
    return { synced, remaining: status.pending + status.conflicts + status.failed, ...status }
  })().finally(() => { activeFlush = null })
  return activeFlush
}

export async function retryFailedOperation(operationId, userId) {
  const operations = await getPendingOperations(userId)
  const operation = operations.find(row => row.operationId === operationId)
  if (!operation) return false
  operation.status = 'queued'
  operation.retryAt = 0
  operation.lastError = ''
  await updatePendingOperation(operation)
  return true
}

export async function resolveOfflineConflict(operationId, userId, resolution = {}) {
  const operations = await getPendingOperations(userId)
  const original = operations.find(row => row.operationId === operationId)
  if (!original || original.status !== 'conflict' || !original.conflict) return false
  const conflict = original.conflict
  const action = String(resolution.action || '')
  const selectedFields = resolution.fields || {}
  if (!isPlainObject(selectedFields)) return false

  const resolutionChoices = {}
  if (action === 'merge') {
    const paths = new Set((conflict.fields || []).map(field => field.path))
    if (Object.keys(selectedFields).some(path => !paths.has(path) || !['local', 'server'].includes(selectedFields[path]))) return false
    for (const field of conflict.fields || []) resolutionChoices[field.path] = selectedFields[field.path] === 'server' ? 'server' : 'local'
  }

  const resolutionOperation = {
    operationId: createOperationId(), userId: String(userId), collection: 'syncConflicts', action: 'resolve',
    entityId: original.operationId, localId: null,
    path: `/api/offline-sync/conflicts/${encodeURIComponent(original.operationId)}/resolve`, method: 'POST',
    body: { action, fields: resolutionChoices }, baseRecord: null,
    status: 'queued', attempts: 0, createdAt: Date.now(), updatedAt: Date.now(), retryAt: 0,
    lastError: '', conflict: null
  }
  let retryOperation = null
  const createRetry = () => {
    const operation = clone(original)
    operation.operationId = createOperationId()
    operation.status = 'queued'
    operation.conflict = null
    operation.lastError = ''
    operation.attempts = 0
    operation.retryAt = 0
    operation.updatedAt = Date.now()
    return operation
  }

  if (action === 'keep-server' || action === 'discard') {
    // The resolution record is still synchronized so the host's conflict audit can be closed.
  } else if (conflict.code === 'offline-id-collision' && action === 'new-id') {
    retryOperation = createRetry()
    retryOperation.localId = createLocalId()
    retryOperation.entityId = retryOperation.localId
  } else if (conflict.fields?.some(field => field.path === '*') && action === 'overwrite') {
    retryOperation = createRetry()
    retryOperation.baseRecord = clone(conflict.serverRecord)
  } else if ((original.action === 'delete' || conflict.localDelete) && action === 'delete-anyway') {
    retryOperation = createRetry()
    retryOperation.baseRecord = clone(conflict.serverRecord)
  } else if ((conflict.remoteDeleted || !conflict.serverRecord) && action === 'recreate') {
    retryOperation = createRetry()
    const localId = original.action === 'create' ? original.localId : createLocalId()
    const record = { ...(clone(original.baseRecord) || {}), ...(clone(original.body) || {}) }
    for (const [key, value] of Object.entries(record)) if (value === undefined) delete record[key]
    retryOperation.path = `/api/${original.collection === 'activities' ? 'activity' : original.collection}`
    retryOperation.method = 'POST'
    retryOperation.action = 'create'
    retryOperation.localId = localId
    retryOperation.entityId = localId
    retryOperation.body = record
    retryOperation.baseRecord = null
  } else if (action === 'merge' && (conflict.fields || []).length > 0 && !conflict.fields.some(field => field.path === '*')) {
    retryOperation = createRetry()
    const body = clone(original.body || {})
    for (const field of conflict.fields || []) {
      if (resolutionChoices[field.path] !== 'server') continue
      setPathValue(body, field.path, field.server, field.serverExists !== false)
    }
    retryOperation.body = body
    retryOperation.baseRecord = clone(conflict.serverRecord)
  } else {
    return false
  }

  const replacements = retryOperation ? [resolutionOperation, retryOperation] : [resolutionOperation]
  const replaced = await replaceConflictOperations(operationId, userId, replacements)
  if (!replaced) return false
  scheduleOfflineRetry(userId, 250)
  return true
}

export async function canLogoutOffline(userId) {
  const status = await getOfflineSyncStatus(userId)
  return status.pending + status.conflicts + status.failed === 0
}

export async function getCachedBootstrap(userId) { return getCachedResponse('/api/bootstrap', userId) }
export function reportConnection(connected, error = '') { signalConnectivity(connected, error) }
export function offlineEvents() { return { sync: SYNC_EVENT, connectivity: CONNECTIVITY_EVENT } }
export function localMutationDescriptor(path, method) { return identifyMutation(path, method) }
export function offlineStorageAvailable() { return hasIndexedDb() }
export function markOfflineOperationConflict(operation, conflict) {
  return queueOfflineOperation(operation, { conflict, error: conflict?.error || '' })
}
export function ensureSessionNotExpired(session) { return Boolean(session?.user?.id && Number(session.expiresAt) > Date.now()) }
