// The only place the browser talks to the server. Every failure becomes an ApiError with a message fit to show a person.
export class ApiError extends Error {
  status: number
  code?: string
  details?: any
  constructor(status: number, message: string, code?: string, details?: any) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const UNAUTHENTICATED_EVENT = 'atlas:unauthenticated'
export const PASSWORD_CHANGE_EVENT = 'atlas:password-change-required'

/** Endpoints whose 401/403 are an expected part of signing in and must not bounce the user to the sign-in screen. */
const AUTH_PROBES = /^\/api\/(auth\/(me|login)|setup)/

/** Send a request and return the response, turning every failure into an ApiError with a message fit to show a person. */
export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(path, {
      credentials: 'include',
      ...options,
      headers: { 'Content-Type': 'application/json', ...((options.headers as Record<string, string>) || {}) }
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the Atlas server. Check that it is still running, then try again.', 'NETWORK')
  }
  if (res.ok) return res
  const text = await res.text()
  let body: any = {}
  try {
    body = text ? JSON.parse(text) : {}
  } catch {
    body = {}
  }
  if (res.status === 401 && !AUTH_PROBES.test(path)) window.dispatchEvent(new CustomEvent(UNAUTHENTICATED_EVENT))
  if (res.status === 403 && body.code === 'PASSWORD_CHANGE_REQUIRED')
    window.dispatchEvent(new CustomEvent(PASSWORD_CHANGE_EVENT))
  throw new ApiError(res.status, body.error || `Request failed (${res.status})`, body.code, body.details)
}

export async function apiRequest(path: string, options: RequestInit = {}) {
  const res = await apiFetch(path, options)
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return {}
  }
}

export const api = {
  get: (p: string) => apiRequest(p),
  post: (p: string, b?: unknown) => apiRequest(p, { method: 'POST', body: JSON.stringify(b ?? {}) }),
  put: (p: string, b?: unknown) => apiRequest(p, { method: 'PUT', body: JSON.stringify(b ?? {}) }),
  patch: (p: string, b?: unknown) => apiRequest(p, { method: 'PATCH', body: JSON.stringify(b ?? {}) }),
  delete: (p: string) => apiRequest(p, { method: 'DELETE' })
}

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  return error instanceof Error && error.message ? error.message : fallback
}
