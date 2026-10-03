import crypto from 'node:crypto'

const ENTITY_FIELDS = Object.freeze({
  tasks: ['title', 'projectId', 'assigneeId', 'priority', 'dueDate', 'status', 'type', 'blocked', 'tags', 'createdAt', 'completedAt', 'customFields'],
  projects: ['name', 'code', 'description', 'teamId', 'ownerId', 'color', 'status', 'deadline', 'createdAt', 'customFields'],
  people: ['name', 'email', 'jobTitle', 'teamId', 'focus', 'capacity', 'status', 'color', 'customFields'],
  teams: ['name', 'color', 'customFields'],
  milestones: ['name', 'projectId', 'dueDate', 'status', 'customFields'],
  alerts: ['title', 'body', 'type', 'tone', 'projectId', 'taskId', 'personId', 'activityId', 'source', 'resolved', 'createdAt', 'lastSeenAt', 'customFields'],
  activities: ['personId', 'date', 'time', 'yesterday', 'today', 'blocked', 'upcoming', 'status', 'customFields'],
  profile: ['name', 'avatarColor'],
  preferences: ['filters', 'language'],
  settings: []
})

const CREATE_PATHS = new Map([
  ['/api/tasks', 'tasks'], ['/api/projects', 'projects'], ['/api/people', 'people'], ['/api/teams', 'teams'],
  ['/api/milestones', 'milestones'], ['/api/activity', 'activities'], ['/api/alerts', 'alerts']
])
const ITEM_PATHS = new Map([
  ['tasks', 'tasks'], ['projects', 'projects'], ['people', 'people'], ['teams', 'teams'],
  ['milestones', 'milestones'], ['activity', 'activities'], ['alerts', 'alerts']
])
const MISSING = Symbol('offline-sync-missing')

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}
function equal(left, right) {
  if (left === MISSING || right === MISSING) return left === right
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}
const REFERENCE_FIELDS = new Set(['projectId', 'assigneeId', 'teamId', 'ownerId', 'taskId', 'personId', 'activityId'])
function fieldEqual(collection, key, left, right) {
  if (left === MISSING || right === MISSING) return left === right
  if (REFERENCE_FIELDS.has(key) && left !== null && right !== null && left !== '' && right !== '') return String(left) === String(right)
  if (collection === 'people' && key === 'capacity' && left !== '' && right !== '') return Number(left) === Number(right)
  return equal(left, right)
}
function clone(value) { return value === MISSING ? MISSING : structuredClone(value) }
function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key) }
function getAtPath(value, path) {
  let current = value
  for (const key of path) {
    if (!isObject(current) || !hasOwn(current, key)) return MISSING
    current = current[key]
  }
  return current
}
function setAtPath(target, path, value) {
  let current = target
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index]
    if (!isObject(current[key])) current[key] = {}
    current = current[key]
  }
  const last = path[path.length - 1]
  if (value === MISSING) delete current[last]
  else current[last] = clone(value)
}
function serializableValue(value) { return value === MISSING ? undefined : clone(value) }
function changedLeaves(base, local, path = []) {
  if (isObject(base) && isObject(local)) {
    const keys = new Set([...Object.keys(base), ...Object.keys(local)])
    return [...keys].flatMap(key => changedLeaves(hasOwn(base, key) ? base[key] : MISSING, hasOwn(local, key) ? local[key] : MISSING, [...path, key]))
  }
  return equal(base, local) ? [] : [{ path, base, local }]
}

export function entityFields(collection) { return ENTITY_FIELDS[collection] || [] }

export function classifySyncRequest(method, pathname) {
  const verb = String(method || 'GET').toUpperCase()
  const cleanPath = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/'
  if (verb === 'POST') {
    const conflictResolution = cleanPath.match(/^\/api\/offline-sync\/conflicts\/([^/]+)\/resolve$/)
    if (conflictResolution) return { collection: 'syncConflicts', action: 'resolve', id: decodeURIComponent(conflictResolution[1]) }
  }
  if (verb === 'PUT' && cleanPath === '/api/settings') return { collection: 'settings', action: 'update', id: 'workspace' }
  if (verb === 'PUT' && cleanPath === '/api/preferences') return { collection: 'preferences', action: 'update', id: 'current-user' }
  if (verb === 'PUT' && cleanPath === '/api/profile') return { collection: 'profile', action: 'update', id: 'current-user' }
  if (verb === 'POST' && CREATE_PATHS.has(cleanPath)) return { collection: CREATE_PATHS.get(cleanPath), action: 'create', id: '' }
  if (verb === 'PUT' || verb === 'PATCH' || verb === 'DELETE') {
    const match = cleanPath.match(/^\/api\/(tasks|projects|people|teams|milestones|activity|alerts)\/([^/]+)(?:\/(status))?$/)
    if (!match) return null
    const collection = ITEM_PATHS.get(match[1])
    const isTaskStatus = match[1] === 'tasks' && match[3] === 'status'
    if (match[3] && !isTaskStatus) return null
    if (isTaskStatus && verb !== 'PATCH') return null
    if (verb === 'PATCH' && !(isTaskStatus || match[1] === 'alerts')) return null
    if (verb === 'PUT' && match[1] === 'alerts') return null
    return { collection, action: verb === 'DELETE' ? 'delete' : 'update', id: decodeURIComponent(match[2]), statusOnly: isTaskStatus }
  }
  return null
}

export function canonicalSyncRecord(collection, record) {
  if (!record) return null
  if (collection === 'settings') return clone(record)
  const result = {}
  for (const key of entityFields(collection)) {
    if (hasOwn(record, key)) result[key] = clone(record[key])
  }
  // Normalize omitted display values so cache and SQL snapshots compare consistently.
  if (collection === 'tasks') {
    result.createdAt = result.createdAt || ''
    result.completedAt = result.completedAt || ''
  }
  if (collection === 'projects') {
    if (!hasOwn(result, 'deadline') && hasOwn(record, 'deadlineDate')) result.deadline = record.deadlineDate
    result.deadline = result.deadline || ''
    result.createdAt = result.createdAt || ''
  }
  if (collection === 'alerts') {
    for (const key of ['personId', 'activityId', 'source', 'lastSeenAt']) result[key] = result[key] || ''
  }
  if (Object.hasOwn(result, 'customFields')) result.customFields = result.customFields || {}
  return result
}

export function compareOfflineRecords(collection, baseRecord, currentRecord) {
  if (!isObject(baseRecord) || !isObject(currentRecord)) return [{ path: '*', base: baseRecord ?? null, server: currentRecord ?? null }]
  const differences = []
  for (const key of entityFields(collection)) {
    if (key === 'customFields') continue
    const baseValue = hasOwn(baseRecord, key) ? baseRecord[key] : MISSING
    const serverValue = hasOwn(currentRecord, key) ? currentRecord[key] : MISSING
    if (!fieldEqual(collection, key, baseValue, serverValue)) differences.push({
      path: key, base: serializableValue(baseValue), server: serializableValue(serverValue),
      baseExists: baseValue !== MISSING, serverExists: serverValue !== MISSING
    })
  }
  const baseFields = isObject(baseRecord.customFields) ? baseRecord.customFields : {}
  const serverFields = isObject(currentRecord.customFields) ? currentRecord.customFields : {}
  for (const change of changedLeaves(baseFields, serverFields)) differences.push({
    path: `customFields.${change.path.join('.')}`, base: serializableValue(change.base), server: serializableValue(change.local),
    baseExists: change.base !== MISSING, serverExists: change.local !== MISSING
  })
  return differences
}

export function mergeOfflineRecord({ collection, baseRecord, currentRecord, localBody, statusOnly = false }) {
  if (!isObject(baseRecord) || !isObject(currentRecord) || !isObject(localBody)) {
    return { ok: false, fields: [{ path: '*', base: baseRecord ?? null, local: localBody ?? null, server: currentRecord ?? null }], mergedBody: null }
  }
  const mergedBody = clone(localBody)
  const conflicts = []
  const allowed = new Set(entityFields(collection))
  const fields = Object.keys(localBody).filter(key => allowed.has(key) && (!statusOnly || key === 'status'))

  for (const key of fields) {
    if (key === 'customFields') {
      const baseFields = isObject(baseRecord.customFields) ? baseRecord.customFields : {}
      const localFields = isObject(localBody.customFields) ? localBody.customFields : {}
      const serverFields = isObject(currentRecord.customFields) ? currentRecord.customFields : {}
      const mergedFields = clone(serverFields)
      for (const leaf of changedLeaves(baseFields, localFields)) {
        const serverValue = getAtPath(serverFields, leaf.path)
        const pathName = `customFields.${leaf.path.join('.')}`
        if (equal(serverValue, leaf.base) || equal(serverValue, leaf.local)) {
          setAtPath(mergedFields, leaf.path, leaf.local)
          continue
        }
        conflicts.push({
          path: pathName,
          base: serializableValue(leaf.base), local: serializableValue(leaf.local), server: serializableValue(serverValue),
          baseExists: leaf.base !== MISSING, localExists: leaf.local !== MISSING, serverExists: serverValue !== MISSING
        })
      }
      mergedBody.customFields = mergedFields
      continue
    }

    const baseValue = hasOwn(baseRecord, key) ? baseRecord[key] : MISSING
    const localValue = hasOwn(localBody, key) ? localBody[key] : MISSING
    const serverValue = hasOwn(currentRecord, key) ? currentRecord[key] : MISSING
    if (fieldEqual(collection, key, localValue, baseValue)) {
      if (serverValue === MISSING) delete mergedBody[key]
      else mergedBody[key] = clone(serverValue)
      continue
    }
    if (fieldEqual(collection, key, serverValue, baseValue) || fieldEqual(collection, key, serverValue, localValue)) continue
    conflicts.push({
      path: key,
      base: serializableValue(baseValue), local: serializableValue(localValue), server: serializableValue(serverValue),
      baseExists: baseValue !== MISSING, localExists: localValue !== MISSING, serverExists: serverValue !== MISSING
    })
  }

  return { ok: conflicts.length === 0, fields: conflicts, mergedBody: conflicts.length ? null : mergedBody }
}

export function findRecord(store, collection, entityId) {
  if (collection === 'profile') return store?.users?.find(record => String(record.id) === String(entityId)) || null
  return store?.[collection]?.find(record => String(record.id) === String(entityId)) || null
}

export function syncRequestHash({ method, pathname, body, localId, baseRecord }) {
  const value = JSON.stringify(canonical({ method: String(method).toUpperCase(), pathname, body: body || {}, localId: localId ?? null, baseRecord: baseRecord ?? null }))
  return crypto.createHash('sha256').update(value).digest('hex')
}

function currentEntityState(store, request) {
  return canonicalSyncRecord(request.collection, request.record)
}

function mergeSettingsPath(base, current, local, path, conflicts) {
  const canRecurse = isObject(local) && (isObject(base) || base === MISSING) && (isObject(current) || current === MISSING)
  if (canRecurse) {
    const baseObject = isObject(base) ? base : {}
    const currentObject = isObject(current) ? current : {}
    const merged = {}
    for (const key of Object.keys(local)) {
      const baseValue = hasOwn(baseObject, key) ? baseObject[key] : MISSING
      const currentValue = hasOwn(currentObject, key) ? currentObject[key] : MISSING
      const value = mergeSettingsPath(baseValue, currentValue, local[key], [...path, key], conflicts)
      if (value !== MISSING) merged[key] = value
    }
    return merged
  }
  const baseValue = base
  const currentValue = current
  const localValue = local
  if (equal(localValue, baseValue)) return clone(currentValue)
  if (equal(currentValue, baseValue) || equal(currentValue, localValue)) return clone(localValue)
  conflicts.push({
    path: path.join('.'), base: serializableValue(baseValue), local: serializableValue(localValue), server: serializableValue(currentValue),
    baseExists: baseValue !== MISSING, localExists: localValue !== MISSING, serverExists: currentValue !== MISSING
  })
  return clone(localValue)
}

export function mergeOfflineSettings(baseRecord, currentRecord, localBody) {
  if (!isObject(baseRecord) || !isObject(currentRecord) || !isObject(localBody)) {
    return { ok: false, fields: [{ path: '*', base: baseRecord ?? null, local: localBody ?? null, server: currentRecord ?? null }], mergedBody: null }
  }
  const conflicts = []
  const mergedBody = mergeSettingsPath(baseRecord, currentRecord, localBody, [], conflicts)
  return { ok: conflicts.length === 0, fields: conflicts, mergedBody: conflicts.length ? null : mergedBody }
}

function hasPermission(can, actor, permission) { return typeof can === 'function' && can(actor, permission) }
function maySynchronize(classification, actor, store, body, can, storeRepository) {
  if (classification.collection === 'syncConflicts') {
    const conflict = storeRepository?.getSyncConflict(classification.id)
    return Boolean(conflict && conflict.actorId === String(actor.id))
  }
  const ownsTask = taskId => {
    const task = findRecord(store, 'tasks', taskId)
    return Boolean(task && String(task.assigneeId || '') === String(actor.personId || ''))
  }
  if (classification.collection === 'preferences') return true
  if (classification.collection === 'profile') return String(classification.id) === String(actor.id)
  if (classification.collection === 'settings') return actor.role === 'Administrator' && hasPermission(can, actor, 'manageSettings')
  if (classification.collection === 'tasks') {
    if (classification.statusOnly && hasPermission(can, actor, 'writeTasks')) return hasPermission(can, actor, 'manageTasks') || ownsTask(classification.id)
    return hasPermission(can, actor, 'manageTasks')
  }
  if (classification.collection === 'projects' || classification.collection === 'milestones') return hasPermission(can, actor, 'manageProjects')
  if (classification.collection === 'people' || classification.collection === 'teams') return hasPermission(can, actor, 'managePeople')
  if (classification.collection === 'activities') {
    if (classification.action === 'create') return hasPermission(can, actor, 'logActivity')
    if (classification.action === 'delete') {
      const activity = findRecord(store, 'activities', classification.id)
      const isAdministrator = actor.role === 'Administrator' && hasPermission(can, actor, 'manageSettings')
      return Boolean(activity && (isAdministrator || (hasPermission(can, actor, 'manageTasks') && String(activity.personId || '') === String(actor.personId || ''))))
    }
    const activity = findRecord(store, 'activities', classification.id)
    const isAdministrator = actor.role === 'Administrator' && hasPermission(can, actor, 'manageSettings')
    return Boolean(activity && (isAdministrator || (hasPermission(can, actor, 'logActivity') && String(activity.personId || '') === String(actor.personId || ''))))
  }
  if (classification.collection === 'alerts') {
    if (classification.action === 'create' || classification.action === 'delete') return hasPermission(can, actor, 'manageAlerts')
    const edits = Object.keys(body || {}).filter(key => key !== 'resolved')
    if (edits.length) return hasPermission(can, actor, 'manageAlerts')
    if (hasPermission(can, actor, 'manageAlerts')) return true
    const alert = findRecord(store, 'alerts', classification.id)
    return hasPermission(can, actor, 'writeTasks') && Boolean(alert?.taskId) && ownsTask(alert.taskId)
  }
  return false
}

export function createOfflineSyncMiddleware({ getStore, sessions, storeRepository, operationContext, sendError, can }) {
  return function offlineSyncMiddleware(req, res, next) {
    const metadata = req.atlasSync
    if (!metadata) return next()
    const pathname = String(req.originalUrl || req.path).split('?')[0]
    const classification = classifySyncRequest(req.method, pathname)
    if (!classification) return sendError(res, 400, 'This operation cannot be queued for offline synchronization')
    if (!isObject(metadata) || typeof metadata.operationId !== 'string' || !/^[a-zA-Z0-9_-]{16,120}$/.test(metadata.operationId)) return sendError(res, 400, 'Offline operation identifier is invalid')
    if (metadata.collection !== undefined && metadata.collection !== classification.collection) return sendError(res, 400, 'Offline operation type does not match the API route')

    const sid = req.cookies?.atlas_sid
    const session = sid && sessions.get(sid)
    if (!session || session.expiresAt <= Date.now()) return sendError(res, 401, 'Sign in to synchronize pending changes')
    const store = getStore()
    const actor = store?.users?.find(user => user.id === session.userId && user.active !== false)
    if (!actor) return sendError(res, 401, 'Sign in to synchronize pending changes')
    req.user = actor
    if (classification.collection === 'profile') classification.id = String(actor.id)
    const cleanBody = req.body || {}
    if (!maySynchronize(classification, actor, store, cleanBody, can, storeRepository)) return sendError(res, 403, 'Your current role is not allowed to synchronize this change')
    const sendConflict = payload => {
      try {
        storeRepository.recordSyncConflict({
          operationId: metadata.operationId, actorId: actor.id, collection: classification.collection,
          entityId: payload.entityId ?? classification.id ?? null, method: req.method, path: pathname,
          code: payload.code || 'field-conflict', baseRecord: payload.baseRecord,
          localRecord: payload.localRecord, serverRecord: payload.serverRecord, fields: payload.fields || []
        })
        storeRepository.pruneSyncConflicts(store?.settings?.audit?.retentionDays)
      } catch (error) {
        console.error('Unable to preserve Atlas offline conflict:', error)
        return sendError(res, 500, 'Unable to safely record this offline conflict')
      }
      return res.status(409).json(payload)
    }

    const localId = metadata.localId
    if (classification.action === 'create' && (typeof localId !== 'string' || !/^offline-[a-zA-Z0-9_-]{16,120}$/.test(localId))) {
      return sendError(res, 400, 'Offline record ID is invalid')
    }

    const requestHash = syncRequestHash({ method: req.method, pathname, body: cleanBody, localId, baseRecord: metadata.baseRecord })
    const existingReceipt = storeRepository.getSyncOperation(metadata.operationId)
    if (existingReceipt) {
      if (existingReceipt.actorId !== actor.id || existingReceipt.requestHash !== requestHash) return sendError(res, 409, 'This offline operation ID was already used for a different request')
      res.setHeader('X-Atlas-Sync-Replayed', 'true')
      if (existingReceipt.responseStatus !== null && existingReceipt.responseBody !== null) return res.status(existingReceipt.responseStatus).json(existingReceipt.responseBody)
      return res.status(200).json({ ok: true, applied: true, acknowledgementRecovered: true, operationId: metadata.operationId })
    }

    let directResponse = null
    if (classification.collection === 'syncConflicts') {
      const action = String(cleanBody.action || '')
      const allowedActions = new Set(['keep-server', 'discard', 'new-id', 'overwrite', 'delete-anyway', 'recreate', 'merge'])
      if (!allowedActions.has(action)) return sendError(res, 400, 'Conflict resolution action is invalid')
      const conflict = storeRepository.getSyncConflict(classification.id)
      if (!conflict) return sendError(res, 404, 'Offline conflict was not found')
      const fieldChoices = cleanBody.fields || {}
      if (!isObject(fieldChoices) || Object.entries(fieldChoices).some(([field, choice]) => !conflict.fields.some(item => item.path === field) || !['local', 'server'].includes(choice))) {
        return sendError(res, 400, 'Conflict field selection is invalid')
      }
      const updated = storeRepository.resolveSyncConflict(classification.id, actor.id, { action, fields: fieldChoices })
      if (!updated) return sendError(res, 404, 'Offline conflict was not found')
      storeRepository.pruneSyncConflicts(store?.settings?.audit?.retentionDays)
      directResponse = { ok: true, conflictOperationId: classification.id, status: updated.status }
    } else if (classification.action === 'create') {
      if (findRecord(store, classification.collection, localId)) {
        return sendConflict({
          error: 'A record with this offline identifier already exists', conflict: true, code: 'offline-id-collision',
          operationId: metadata.operationId, collection: classification.collection, localRecord: cleanBody,
          serverRecord: canonicalSyncRecord(classification.collection, findRecord(store, classification.collection, localId))
        })
      }
    } else if (classification.collection === 'settings' && classification.action === 'update') {
      if (metadata.enforceConflicts !== false) {
        const merged = mergeOfflineSettings(metadata.baseRecord, store.settings, cleanBody)
        if (!merged.ok) {
          return sendConflict({
            error: 'Some settings changed on the server while this device was offline', conflict: true, code: 'field-conflict',
            operationId: metadata.operationId, collection: 'settings', entityId: 'workspace',
            baseRecord: metadata.baseRecord || null, localRecord: cleanBody, serverRecord: clone(store.settings), fields: merged.fields
          })
        }
        req.body = merged.mergedBody
      }
    } else if ((classification.action === 'update' || classification.action === 'delete') && !['preferences', 'settings'].includes(classification.collection)) {
      const record = findRecord(store, classification.collection, classification.id)
      if (metadata.enforceConflicts !== false) {
        if (!record) {
          return sendConflict({
            error: 'The record was deleted on the server while this device was offline', conflict: true, code: 'remote-delete',
            operationId: metadata.operationId, collection: classification.collection, entityId: classification.id,
            baseRecord: metadata.baseRecord || null, localRecord: cleanBody, serverRecord: null, remoteDeleted: true
          })
        }
        const base = metadata.baseRecord
        const serverRecord = currentEntityState(store, { collection: classification.collection, record })
        if (classification.action === 'delete') {
          const differences = compareOfflineRecords(classification.collection, base, serverRecord)
          if (differences.length) {
            return sendConflict({
              error: 'The record changed on the server while this device was offline', conflict: true, code: 'delete-versus-edit',
              operationId: metadata.operationId, collection: classification.collection, entityId: classification.id,
              baseRecord: base || null, localRecord: null, serverRecord, fields: differences, localDelete: true
            })
          }
        } else {
          const merged = mergeOfflineRecord({
            collection: classification.collection, baseRecord: base, currentRecord: serverRecord,
            localBody: cleanBody, statusOnly: classification.statusOnly
          })
          if (!merged.ok) {
            return sendConflict({
              error: 'Some fields changed on the server while this device was offline', conflict: true, code: 'field-conflict',
              operationId: metadata.operationId, collection: classification.collection, entityId: classification.id,
              baseRecord: base || null, localRecord: cleanBody, serverRecord, fields: merged.fields
            })
          }
          req.body = merged.mergedBody
        }
      }
    }

    metadata.actorId = actor.id
    metadata.requestHash = requestHash
    metadata.operationId = metadata.operationId
    const originalJson = res.json.bind(res)
    res.json = body => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try { storeRepository.completeSyncOperation(metadata, res.statusCode, body) }
        catch (error) { console.error('Unable to save Atlas sync acknowledgement:', error) }
      }
      return originalJson(body)
    }

    if (directResponse) return res.status(200).json(directResponse)
    return operationContext.run(metadata, next)
  }
}

export function offlineCreateId(req, collection, factory) {
  if (typeof factory !== 'function') throw new TypeError('An ID factory is required')
  const metadata = req?.atlasSync
  if (!metadata || metadata.collection && metadata.collection !== collection || !metadata.localId) return factory()
  return clone(metadata.localId)
}
