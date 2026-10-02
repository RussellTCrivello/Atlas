// Password hashing (scrypt with the cost parameters stored in each hash) and the password policy.
import crypto from 'node:crypto'
import { promisify } from 'node:util'
import { HttpError } from '../util'

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
export { passwordStrength, validatePassword, type PasswordContext } from '../../shared/password'
