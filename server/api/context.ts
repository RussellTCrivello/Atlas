// Shared plumbing for the route modules.
import type { Request, RequestHandler } from 'express'
import type { AtlasConfig } from '../config'
import { LoginThrottle, SessionManager } from '../auth'
import { appendAudit, type AuditContext } from '../audit'
import { can } from '../domain'
import type { DocumentStore } from '../store'
import type { User } from '../types'
import { HttpError, clientIp, truncate } from '../util'
import { SESSION_COOKIE } from '../http'

export interface Deps {
  config: AtlasConfig
  db: DocumentStore
  sessions: SessionManager
  throttle: LoginThrottle
  audit: AuditBuffer
  missingKeys: MissingKeyLog
}

export const userOf = (req: Request): User => (req as any).user as User
export const sessionHashOf = (req: Request): string => (req as any).sessionHash as string

export function auditContext(req: Request): AuditContext {
  const user = (req as any).user as User | undefined
  return { actorId: user?.id, ip: clientIp(req), userAgent: req.get('user-agent') || undefined }
}

/**
 * Security-relevant events that happen at request rate (failed sign-ins, denied requests) are queued and written to the
 * audit trail in batches, so that a flood of bad requests cannot turn into a flood of full-store disk writes.
 */
export class AuditBuffer {
  private queue: { action: string; ctx: AuditContext; detail: Record<string, unknown> }[] = []
  private timer: NodeJS.Timeout | null = null
  dropped = 0
  constructor(
    private db: DocumentStore,
    private delayMs = 2000,
    private maxQueue = 500
  ) {}

  push(action: string, ctx: AuditContext, detail: Record<string, unknown> = {}) {
    if (this.queue.length >= this.maxQueue) {
      this.dropped++
      return
    }
    this.queue.push({ action, ctx, detail })
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.delayMs)
      this.timer.unref?.()
    }
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.queue.length) return
    const batch = this.queue.splice(0, this.queue.length)
    const dropped = this.dropped
    this.dropped = 0
    try {
      this.db.commit(
        state => {
          for (const item of batch) appendAudit(state, item.action, item.ctx, item.detail)
          if (dropped) appendAudit(state, 'security.audit.overflow', {}, { dropped })
        },
        { reason: 'audit-batch' }
      )
    } catch (error) {
      console.error('Could not write queued audit events:', (error as Error).message)
    }
  }
}

/** Runtime log of translation keys the UI could not resolve. Diagnostic only: kept in memory, bounded, never persisted. */
export class MissingKeyLog {
  private rows = new Map<
    string,
    {
      key: string
      language: string
      fallback: string
      source: string
      count: number
      firstSeenAt: string
      lastSeenAt: string
    }
  >()
  constructor(private cap = 200) {}
  add(input: { key: string; language: string; fallback?: string; source?: string }) {
    const id = `${input.language}:${input.key}`
    const now = new Date().toISOString()
    const existing = this.rows.get(id)
    if (existing) {
      existing.count++
      existing.lastSeenAt = now
      return
    }
    if (this.rows.size >= this.cap) return
    this.rows.set(id, {
      key: truncate(input.key, 200),
      language: truncate(input.language, 20),
      fallback: truncate(input.fallback || '', 300),
      source: truncate(input.source || 'runtime', 60),
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now
    })
  }
  list() {
    return [...this.rows.values()].map(row => ({ ...row, status: 'missing' }))
  }
  clear() {
    this.rows.clear()
  }
}

/** Require a permission (or any one of several); denials are recorded in the audit trail. */
export function requirePermission(
  deps: Deps,
  permission: string | string[],
  message = 'You do not have permission to complete this action'
): RequestHandler {
  const anyOf = Array.isArray(permission) ? permission : [permission]
  return (req, _res, next) => {
    const user = userOf(req)
    if (!anyOf.some(candidate => can(deps.db.state.settings, user, candidate))) {
      deps.audit.push('access.denied', auditContext(req), {
        method: req.method,
        path: truncate(req.originalUrl.split('?')[0], 160),
        permission: anyOf.join(' | ')
      })
      return next(new HttpError(403, message, 'FORBIDDEN'))
    }
    next()
  }
}

export function sessionCookieOptions(deps: Deps, req: Request) {
  const days = Number(deps.db.state.settings?.security?.sessionDays || 14)
  const secure = deps.config.cookieSecure === 'auto' ? Boolean(req.secure) : deps.config.cookieSecure
  return { httpOnly: true, sameSite: 'lax' as const, secure, path: '/', maxAge: days * 86400000 }
}

export { SESSION_COOKIE }
