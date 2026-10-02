// Authentication primitives: password hashing, password policy, sessions and login throttling.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { promisify } from 'node:util'
import { atomicWriteFileSync } from './fsutil'
import { HttpError, sha256 } from './util'

// ---- password hashing --------------------------------------------------------------------------------------------
// Format: scrypt$N$r$p$saltHex$keyHex. The cost parameters travel with each hash so they can be raised later and old
// hashes are upgraded transparently on the next successful login. The legacy 3-part format scrypt$salt$key (N=16384)
// written by earlier versions is still verified.
const SCRYPT = { N: 131072, r: 8, p: 1, keyLength: 64, maxmem: 256 * 1024 * 1024 }
const LEGACY_SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 64, maxmem: 64 * 1024 * 1024 }
const scryptAsync = promisify(crypto.scrypt) as (
  password: string,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>

class Gate {
  private active = 0
  private queue: Array<() => void> = []
  constructor(
    private limit: number,
    private maxQueue: number
  ) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.queue.length >= this.maxQueue) throw new HttpError(503, 'The server is busy. Try again shortly.', 'BUSY')
      await new Promise<void>(resolve => this.queue.push(resolve))
    }
    this.active++
    try {
      return await fn()
    } finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}
// scrypt needs ~128 MiB per operation: never run more than two at once and never queue unboundedly.
const hashGate = new Gate(2, 64)

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16)
  const key = await hashGate.run(() => scryptAsync(String(password), salt, SCRYPT.keyLength, SCRYPT))
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`
}

/** Synchronous variant for one-off migrations and the CLI only; never call it from a request handler. */
export function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keyLength, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`
}

interface ParsedHash {
  N: number
  r: number
  p: number
  salt: Buffer
  key: Buffer
  legacy: boolean
}
function parseHash(stored: string): ParsedHash | null {
  const parts = String(stored || '').split('$')
  if (parts[0] !== 'scrypt') return null
  if (parts.length === 3)
    return { ...LEGACY_SCRYPT, salt: Buffer.from(parts[1], 'utf8'), key: Buffer.from(parts[2], 'hex'), legacy: true }
  if (parts.length === 6) {
    const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])]
    if (![N, r, p].every(Number.isInteger) || N < 2 || N > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return null
    return { N, r, p, salt: Buffer.from(parts[4], 'hex'), key: Buffer.from(parts[5], 'hex'), legacy: false }
  }
  return null
}

export async function verifyPassword(password: string, stored: string): Promise<{ ok: boolean; needsRehash: boolean }> {
  const parsed = parseHash(stored)
  if (!parsed || !parsed.key.length) return { ok: false, needsRehash: false }
  const options = { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: 256 * 1024 * 1024 }
  const candidate = await hashGate.run(() => scryptAsync(String(password), parsed.salt, parsed.key.length, options))
  const ok = candidate.length === parsed.key.length && crypto.timingSafeEqual(candidate, parsed.key)
  return { ok, needsRehash: ok && (parsed.legacy || parsed.N < SCRYPT.N || parsed.r < SCRYPT.r || parsed.p < SCRYPT.p) }
}

let dummyHash: Promise<string> | null = null
/** Verify against a throw-away hash so that unknown accounts cost the same as known ones (no user enumeration by timing). */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword(crypto.randomBytes(12).toString('hex'))
  await verifyPassword(password, await dummyHash)
}

// Password policy and strength live in shared/password.ts so the browser gives the same feedback the server enforces.
export { passwordStrength, validatePassword, type PasswordContext } from '../shared/password'

// ---- sessions ----------------------------------------------------------------------------------------------------
export interface SessionRecord {
  userId: string
  createdAt: number
  lastSeenAt: number
}
const MAX_SESSIONS_PER_USER = 20

/**
 * Server-side sessions. The cookie carries a 256-bit random token; only its SHA-256 is stored, so a leaked sessions
 * file cannot be replayed. Sessions live in their own file (not the main store) so that reads never cause store
 * rewrites, survive restarts, expire after `sessionDays`, and can be revoked per user.
 */
export class SessionManager {
  private sessions = new Map<string, SessionRecord>()
  private dirty = false
  private timer: NodeJS.Timeout | null = null

  constructor(private file: string | null) {
    this.load()
  }

  private load() {
    if (!this.file) return
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      for (const [hash, record] of Object.entries<any>(parsed?.sessions || {})) {
        if (/^[0-9a-f]{64}$/.test(hash) && record && typeof record.userId === 'string')
          this.sessions.set(hash, {
            userId: record.userId,
            createdAt: Number(record.createdAt) || Date.now(),
            lastSeenAt: Number(record.lastSeenAt) || Date.now()
          })
      }
    } catch {
      /* missing or unreadable sessions file simply means everyone signs in again */
    }
  }

  create(userId: string): string {
    const token = crypto.randomBytes(32).toString('base64url')
    const now = Date.now()
    this.sessions.set(sha256(token), { userId, createdAt: now, lastSeenAt: now })
    const mine = [...this.sessions.entries()]
      .filter(([, s]) => s.userId === userId)
      .sort((a, b) => a[1].createdAt - b[1].createdAt)
    while (mine.length > MAX_SESSIONS_PER_USER) this.sessions.delete(mine.shift()![0])
    this.touchDirty()
    return token
  }

  resolve(token: unknown, maxAgeMs: number): (SessionRecord & { hash: string }) | null {
    if (typeof token !== 'string' || token.length < 20 || token.length > 128) return null
    const hash = sha256(token)
    const record = this.sessions.get(hash)
    if (!record) return null
    const now = Date.now()
    if (now - record.createdAt > maxAgeMs) {
      this.sessions.delete(hash)
      this.touchDirty()
      return null
    }
    record.lastSeenAt = now
    return { ...record, hash }
  }

  revoke(token: unknown) {
    if (typeof token !== 'string') return
    if (this.sessions.delete(sha256(token))) this.touchDirty()
  }

  /** Sign a user out everywhere, optionally keeping one session (the one making the request). */
  revokeUser(userId: string, exceptHash?: string): number {
    let removed = 0
    for (const [hash, record] of this.sessions) {
      if (record.userId === userId && hash !== exceptHash) {
        this.sessions.delete(hash)
        removed++
      }
    }
    if (removed) this.touchDirty()
    return removed
  }

  prune(maxAgeMs: number, validUserIds?: Set<string>) {
    const now = Date.now()
    for (const [hash, record] of this.sessions) {
      if (now - record.createdAt > maxAgeMs || (validUserIds && !validUserIds.has(record.userId))) {
        this.sessions.delete(hash)
        this.dirty = true
      }
    }
    if (this.dirty) this.touchDirty()
  }

  count() {
    return this.sessions.size
  }

  private touchDirty() {
    this.dirty = true
    if (!this.file || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      try {
        this.flush()
      } catch (error) {
        console.error('Could not persist sessions:', (error as Error).message)
      }
    }, 300)
    this.timer.unref?.()
  }

  flush() {
    if (!this.file || !this.dirty) return
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    atomicWriteFileSync(this.file, JSON.stringify({ version: 1, sessions: Object.fromEntries(this.sessions) }), 0o600)
    this.dirty = false
  }
}

// ---- login throttling --------------------------------------------------------------------------------------------
interface Bucket {
  count: number
  resetAt: number
}
interface AccountState {
  failures: number
  lockedUntil: number
  lastFailureAt: number
}
export interface ThrottleDecision {
  allowed: boolean
  retryAfterSeconds: number
}

/**
 * Two independent brakes against password guessing:
 *  - per client address: at most `ipLimit` attempts per `ipWindowMs` (also bounds the CPU spent on hashing);
 *  - per account: after `freeAttempts` consecutive failures the account is locked for an exponentially growing time
 *    (15 s, 30 s, 1 min … capped at 15 min). A successful sign-in resets the counter.
 * Counters are in memory (a restart clears them), bounded in size, and expire when idle.
 */
export class LoginThrottle {
  private byIp = new Map<string, Bucket>()
  private byAccount = new Map<string, AccountState>()
  constructor(
    private options = {
      ipLimit: 30,
      ipWindowMs: 10 * 60_000,
      freeAttempts: 5,
      maxLockMs: 15 * 60_000,
      maxEntries: 10_000
    }
  ) {}

  check(ip: string, account: string, now = Date.now()): ThrottleDecision {
    const bucket = this.byIp.get(ip)
    if (bucket && bucket.resetAt > now && bucket.count >= this.options.ipLimit)
      return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
    const state = this.byAccount.get(account)
    if (state && state.lockedUntil > now)
      return { allowed: false, retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1000) }
    return { allowed: true, retryAfterSeconds: 0 }
  }

  /** Count an attempt against the address (called for every attempt, successful or not). */
  attempt(ip: string, now = Date.now()) {
    const bucket = this.byIp.get(ip)
    if (!bucket || bucket.resetAt <= now) this.byIp.set(ip, { count: 1, resetAt: now + this.options.ipWindowMs })
    else bucket.count++
    this.evict(this.byIp)
  }

  failure(account: string, now = Date.now()) {
    const state = this.byAccount.get(account) || { failures: 0, lockedUntil: 0, lastFailureAt: now }
    if (now - state.lastFailureAt > this.options.maxLockMs * 2) state.failures = 0
    state.failures++
    state.lastFailureAt = now
    if (state.failures >= this.options.freeAttempts) {
      const step = state.failures - this.options.freeAttempts
      state.lockedUntil = now + Math.min(this.options.maxLockMs, 15_000 * 2 ** step)
    }
    this.byAccount.set(account, state)
    this.evict(this.byAccount)
  }

  success(account: string) {
    this.byAccount.delete(account)
  }

  private evict(map: Map<string, unknown>) {
    while (map.size > this.options.maxEntries) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
    }
  }
}
