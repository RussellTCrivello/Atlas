import {
  applyOfflineProjection, cacheApiResponse, canLogoutOffline, clearOfflineSession, createMutationOperation, ensureSessionNotExpired,
  getCachedResponse, getOfflineSession, localMutationDescriptor, markOfflineOperationConflict,
  queueOfflineOperation, removePendingOperation, reportConnection, saveOfflineSession, scheduleOfflineRetry, storePendingOperation,
  updatePendingOperation
} from './offline-sync.js'

export class ApiError extends Error {
  constructor(message, { status = 0, payload = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.payload = payload
  }
}

function jsonBody(options) {
  if (typeof options.body !== 'string' || !options.body) return {}
  try {
    const parsed = JSON.parse(options.body)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}
function responseBody(text) {
  try { return JSON.parse(text) } catch { return {} }
}
function publicApiError(response, body) {
  return new ApiError(body?.error || `Request failed (${response.status})`, { status: response.status, payload: body })
}
function operationMetadata(operation) {
  return {
    operationId: operation.operationId,
    collection: operation.collection,
    localId: operation.localId || undefined,
    baseRecord: operation.baseRecord,
    enforceConflicts: true
  }
}
function bodyWithMetadata(body, operation) {
  return { ...(body || {}), __atlasSync: operationMetadata(operation) }
}

async function sendFetch(path, options, bodyOverride) {
  return fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    ...(bodyOverride === undefined ? {} : { body: JSON.stringify(bodyOverride) })
  })
}

async function saveSessionFromResponse(path, body) {
  try {
    if ((path === '/api/auth/login' || path === '/api/setup' || path === '/api/auth/me') && body?.user?.id) {
      await saveOfflineSession({ user: body.user, sessionExpiresAt: body.sessionExpiresAt })
    }
  } catch {}
}

async function queueAfterUncertainResponse(operation, status, errorMessage) {
  if (!operation) return null
  operation.status = status >= 500 ? 'retrying' : 'queued'
  operation.attempts = Number(operation.attempts || 0) + (status >= 500 ? 1 : 0)
  operation.retryAt = status >= 500 ? Date.now() + Math.min(5 * 60 * 1000, 1000 * 2 ** Math.min(operation.attempts, 8)) : 0
  operation.lastError = String(errorMessage || 'The local Atlas host is unavailable.')
  await updatePendingOperation(operation)
  if (operation.status === 'retrying') scheduleOfflineRetry(operation.userId, operation.retryAt - Date.now())
  return { offlineQueued: true, operationId: operation.operationId, localId: operation.localId || null }
}

async function apiRequest(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const originalBody = jsonBody(options)
  const mutation = method !== 'GET' && method !== 'HEAD' ? localMutationDescriptor(path, method) : null
  let operation = null
  let effectiveBody = originalBody
  let storageError = null

  if (mutation) {
    const session = await getOfflineSession()
    if (session && ensureSessionNotExpired(session)) {
      try {
        operation = await createMutationOperation(path, method, originalBody, session.userId)
        if (operation) {
          effectiveBody = operation.body
          await storePendingOperation(operation)
        }
      } catch (error) {
        storageError = error
        operation = null
      }
    }
  }

  let response
  try {
    response = await sendFetch(path, options, operation ? bodyWithMetadata(effectiveBody, operation) : undefined)
  } catch (error) {
    reportConnection(false, error?.message || 'Local Atlas host is not reachable')
    if (method === 'GET' || method === 'HEAD') {
      const session = await getOfflineSession()
      if (session && ensureSessionNotExpired(session)) {
        try {
          const cached = await getCachedResponse(path, session.userId)
          if (cached !== null) return cached
        } catch {}
      }
    }
    if (operation) {
      operation.status = 'queued'
      operation.lastError = error?.message || 'Local Atlas host is not reachable'
      operation.retryAt = 0
      await updatePendingOperation(operation).catch(() => {})
      scheduleOfflineRetry(operation.userId)
      return { offlineQueued: true, operationId: operation.operationId, localId: operation.localId || null }
    }
    if (storageError) throw storageError
    throw new ApiError(error?.message || 'The local Atlas host is not reachable.', { status: 0 })
  }

  const text = await response.text()
  const body = responseBody(text)
  if (response.ok) {
    reportConnection(true)
    if (operation) await removePendingOperation(operation.operationId, operation.userId).catch(() => {})
    await saveSessionFromResponse(path, body)
    if (path === '/api/auth/logout') {
      const session = await getOfflineSession({ allowExpired: true })
      if (session) await clearOfflineSession(session.userId).catch(() => {})
    }
    if (method === 'GET') {
      await cacheApiResponse(path, body).catch(() => {})
      const session = await getOfflineSession()
      if (session && ensureSessionNotExpired(session)) return applyOfflineProjection(path, body, session.userId).catch(() => body)
    }
    return body
  }

  const apiError = publicApiError(response, body)
  if (operation && response.status === 409 && body?.conflict) {
    await markOfflineOperationConflict(operation, body)
    throw apiError
  }
  if (operation && response.status >= 500) {
    const queued = await queueAfterUncertainResponse(operation, response.status, apiError.message)
    reportConnection(true, apiError.message)
    return queued
  }
  if (operation) await removePendingOperation(operation.operationId, operation.userId).catch(() => {})
  if (response.status < 500) reportConnection(true)
  throw apiError
}

export const api = Object.freeze({
  get: (path) => apiRequest(path),
  post: (path, body) => apiRequest(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => apiRequest(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body) => apiRequest(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path) => apiRequest(path, { method: 'DELETE' })
})

export async function logOutOfflineState(userId) {
  const allowed = await canLogoutOffline(userId)
  if (!allowed) return false
  await clearOfflineSession(userId)
  return true
}
