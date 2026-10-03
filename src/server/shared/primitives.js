import crypto from 'node:crypto'

export function boundedInteger(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback
}

export function id(prefix) { return `${prefix}_${crypto.randomBytes(16).toString('hex')}` }
export function parseNumber(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback }
export function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : '' }

export function isValidEmail(value) {
  const email = normalizeEmail(value)
  if (!email || email.length > 254 || /[\s\u0000-\u001f]/.test(email)) return false
  const parts = email.split('@')
  return parts.length === 2 && parts[0].length > 0 && parts[0].length <= 64 && parts[1].includes('.') && !parts[1].startsWith('.') && !parts[1].endsWith('.')
}

export function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function isValidTimezone(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date()); return true } catch { return false }
}

export function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
