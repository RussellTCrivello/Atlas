const FILTER_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/
const FIELD_PATTERN = /^[a-zA-Z0-9_.-]{1,120}$/
const FILTER_OPERATORS = new Set(['contains', 'equals', 'notEquals', 'startsWith', 'endsWith', 'gt', 'lt', 'gte', 'lte'])
const FILTER_JOINS = new Set(['AND', 'OR'])
const MAX_FILTERS = 25
const MAX_CONDITIONS_PER_FILTER = 30
const MAX_FILTER_VALUE_LENGTH = 2000

function normalizeFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const entries = Object.entries(value)
  if (entries.length > MAX_FILTERS) return null
  const normalized = {}
  for (const [key, conditions] of entries) {
    if (!FILTER_KEY_PATTERN.test(key) || !Array.isArray(conditions) || conditions.length > MAX_CONDITIONS_PER_FILTER) return null
    const normalizedConditions = []
    for (const condition of conditions) {
      if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return null
      const { field, operator, join, value: filterValue } = condition
      if (typeof field !== 'string' || !FIELD_PATTERN.test(field)) return null
      if (typeof operator !== 'string' || !FILTER_OPERATORS.has(operator)) return null
      if (join !== undefined && (typeof join !== 'string' || !FILTER_JOINS.has(join))) return null
      if (typeof filterValue !== 'string' || filterValue.length > MAX_FILTER_VALUE_LENGTH) return null
      normalizedConditions.push({
        field,
        operator,
        join: join || 'AND',
        value: filterValue
      })
    }
    normalized[key] = normalizedConditions
  }
  return normalized
}

export function registerPreferencesRoutes(app, services) {
  const { requireUser, sendError, userPreferencesRepository } = services

  app.get('/api/preferences', requireUser, (req, res) => {
    res.json({ filters: userPreferencesRepository.getFilters(req.user.id) })
  })

  app.put('/api/preferences', requireUser, (req, res) => {
    if (Object.keys(req.body || {}).some((key) => key !== 'filters')) {
      return sendError(res, 400, 'Only saved filter preferences may be updated')
    }
    const filters = normalizeFilters(req.body?.filters)
    if (!filters) return sendError(res, 400, 'Saved filters contain invalid or oversized conditions')
    res.json({ filters: userPreferencesRepository.saveFilters(req.user.id, filters) })
  })
}
