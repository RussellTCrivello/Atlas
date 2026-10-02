// Sign-in sessions: random 256-bit tokens in a cookie, only their SHA-256 stored. A session lasts `sessionDays` from when
// it was created, can be revoked per token or per user, and is capped per user.
import crypto from 'node:crypto'
import { sha256 } from '../util'
import type { ServiceContext } from './context'

const MAX_SESSIONS_PER_USER = 20
const TOUCH_INTERVAL_MS = 60_000
/** Signing in and out is not a change to the workspace's data, so it does not advance the revision other browsers poll. */
const QUIET = { revision: false }

export interface ResolvedSession {
  userId: string
  hash: string
}

export class SessionService {
  constructor(private ctx: ServiceContext) {}

  create(userId: string): string {
    const token = crypto.randomBytes(32).toString('base64url')
    this.ctx.transaction(() => {
      this.ctx.repos.sessions.insert(sha256(token), userId, Date.now())
      this.ctx.repos.sessions.trimUser(userId, MAX_SESSIONS_PER_USER)
    }, QUIET)
    return token
  }

  /** The session behind a cookie value, or null (unknown, malformed or expired). Refreshes "last seen" at most once a minute. */
  resolve(token: unknown, maxAgeMs: number): ResolvedSession | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null
    const hash = sha256(token)
    const row = this.ctx.repos.sessions.find(hash)
    if (!row) return null
    const now = Date.now()
    if (now - row.createdAt > maxAgeMs) {
      this.ctx.transaction(() => this.ctx.repos.sessions.delete(hash), QUIET)
      return null
    }
    if (now - row.lastSeenAt > TOUCH_INTERVAL_MS)
      this.ctx.transaction(() => this.ctx.repos.sessions.touch(hash, now), QUIET)
    return { userId: row.userId, hash }
  }

  revoke(token: unknown) {
    if (typeof token !== 'string') return
    this.ctx.transaction(() => this.ctx.repos.sessions.delete(sha256(token)), QUIET)
  }

  /** Sign a user out everywhere, optionally keeping one session (the one making the request). */
  revokeUser(userId: string, exceptHash?: string): number {
    return this.ctx.transaction(() => this.ctx.repos.sessions.deleteForUser(userId, exceptHash), QUIET)
  }

  prune(maxAgeMs: number): number {
    return this.ctx.transaction(() => this.ctx.repos.sessions.deleteOlderThan(Date.now() - maxAgeMs), QUIET)
  }

  count(): number {
    return this.ctx.repos.sessions.count()
  }
}
