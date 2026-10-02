export function createTimeService({ getStore, environmentTimezone, isValidTimezone }) {
  function workspaceTimezone() {
    const configured = getStore()?.settings?.workspace?.defaultTimezone || environmentTimezone
    return isValidTimezone(configured) ? configured : 'America/Los_Angeles'
  }

  function todayLA(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: workspaceTimezone(), year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${values.year}-${values.month}-${values.day}`
  }

  function timeLA(date = new Date()) {
    return new Intl.DateTimeFormat('en-US', { timeZone: workspaceTimezone(), hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  }

  return { workspaceTimezone, todayLA, timeLA }
}

export function addDays(value, offset) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

export function formatDate(value, options = { month: 'short', day: 'numeric' }) {
  if (!value) return 'No date'
  const date = value instanceof Date
    ? value
    : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00Z`)
      : new Date(value)
  if (!Number.isFinite(date.getTime())) return 'No date'
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(date)
}

export function daysBetween(a, b) {
  return Math.ceil((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000)
}
