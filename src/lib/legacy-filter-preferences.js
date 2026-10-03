export const LEGACY_FILTER_KEYS = ['projects', 'tasks', 'people', 'activity', 'alerts']
const LEGACY_OPERATORS = new Set(['contains', 'equals', 'notEquals', 'startsWith', 'endsWith', 'gt', 'lt', 'gte', 'lte'])
const FIELD_KEY_PATTERN = /^[a-zA-Z0-9_.-]{1,120}$/
const MAX_CONDITIONS = 30
const MAX_VALUE_LENGTH = 2000

function availableStorage() {
  try { return globalThis.localStorage || null }
  catch { return null }
}

function validLegacyCondition(condition) {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return false
  if (typeof condition.field !== 'string' || !FIELD_KEY_PATTERN.test(condition.field)) return false
  if (!LEGACY_OPERATORS.has(condition.operator)) return false
  if (condition.join !== undefined && !['AND', 'OR'].includes(condition.join)) return false
  return typeof condition.value === 'string' && condition.value.length <= MAX_VALUE_LENGTH
}

export function readLegacyFilterPreferences(storage = availableStorage()) {
  if (!storage) return {}
  const filters = {}
  for (const key of LEGACY_FILTER_KEYS) {
    try {
      const serialized = storage.getItem(`atlas-filter-${key}`)
      if (!serialized) continue
      const parsed = JSON.parse(serialized)
      if (!Array.isArray(parsed) || parsed.length > MAX_CONDITIONS) continue
      const valid = parsed.filter(validLegacyCondition).map((condition) => ({
        field: condition.field,
        operator: condition.operator,
        join: condition.join || 'AND',
        value: condition.value
      }))
      if (valid.length) filters[key] = valid
    } catch {}
  }
  return filters
}

export function mergeLegacyFilterPreferences(savedFilters = {}, legacyFilters = {}) {
  const merged = { ...(savedFilters && typeof savedFilters === 'object' && !Array.isArray(savedFilters) ? savedFilters : {}) }
  for (const [key, conditions] of Object.entries(legacyFilters)) {
    if (!Object.hasOwn(merged, key)) merged[key] = conditions
  }
  return merged
}

export function clearLegacyFilterPreferences(storage = availableStorage()) {
  if (!storage) return
  for (const key of LEGACY_FILTER_KEYS) {
    try { storage.removeItem(`atlas-filter-${key}`) } catch {}
  }
}
