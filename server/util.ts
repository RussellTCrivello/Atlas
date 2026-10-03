import crypto from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { isValidTimeZone } from '../shared/settings'

/** An error that is safe to show to the client. `status` is the HTTP status code. */
export class HttpError extends Error {
  status: number
  code?: string
  details?: unknown
  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, 'BAD_REQUEST', details)
export const notFound = (message: string) => new HttpError(404, message, 'NOT_FOUND')
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) =>
  new HttpError(409, message, code, details)
export const forbidden = (message: string) => new HttpError(403, message, 'FORBIDDEN')

/** Express 5 forwards rejected promises already, but this keeps sync throws and async rejections uniform. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => {
    try {
      const result = fn(req, res, next)
      if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(next)
    } catch (error) {
      next(error)
    }
  }

export function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`
}

export function parseNumber(value: unknown, fallback: number): number {
  if (value === '' || value === null || value === undefined) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function sha256(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const left = crypto.createHash('sha256').update(String(a)).digest()
  const right = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(left, right)
}

// ---- dates -------------------------------------------------------------------------------------------------------
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const m = ISO_DATE.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>()
function zoneFormatter(kind: 'date' | 'time', tz: string): Intl.DateTimeFormat {
  const key = `${kind}|${tz}`
  let formatter = zoneFormatters.get(key)
  if (!formatter) {
    formatter =
      kind === 'date'
        ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
        : new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    zoneFormatters.set(key, formatter)
  }
  return formatter
}

/** `YYYY-MM-DD` for an instant in a given IANA time zone. */
export function dateInZone(date: Date, timeZone: string): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const parts = zoneFormatter('date', tz).formatToParts(date)
  const get = (type: string) => parts.find(part => part.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function timeInZone(date: Date, timeZone: string): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  return zoneFormatter('time', tz).format(date)
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (positive when b is later). Returns NaN for invalid input. */
export function daysBetween(a: string, b: string): number {
  if (!isIsoDate(a) || !isIsoDate(b)) return Number.NaN
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

export function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
}

export function clientIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

export function truncate(value: unknown, max: number): string {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}
