// What the snapshot writer needs besides the writing itself: the order in which tables are emptied (children before the
// records they refer to) and the small coercions that turn whatever an old document held into what a STRICT column accepts.
export const WIPE_ORDER = [
  'task_trash',
  'work_logs',
  'alerts',
  'activities',
  'milestones',
  'tasks',
  'projects',
  'sessions',
  'users',
  'tags',
  'people',
  'teams'
] as const

export const json = (value: unknown) =>
  JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
export const text = (value: unknown, fallback = '') =>
  value === undefined || value === null ? fallback : String(value)
export const flag = (value: unknown) => (value ? 1 : 0)
/** A reference stored as a number, or null: old documents sometimes held '' or a numeric string where a task or project id belongs. */
export const intOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}
