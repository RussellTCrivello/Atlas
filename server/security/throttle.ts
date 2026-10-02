// Brakes against password guessing. Counters live in memory by design: a restart clears them, they are bounded in size
// and they expire when idle, so they cannot grow without limit or turn an attack into disk writes.
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
