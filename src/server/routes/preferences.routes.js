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
      if (join !== undefined && typeof join !== 'string') return null
      if (join !== undefined && !FILTER_JOINS.has(join)) return null
      if (typeof filterValue !== 'string' || filterValue.length > MAX_FILTER_VALUE_LENGTH) return null
      normalizedConditions.push({ field, operator, join: join || 'AND', value: filterValue })
    }
    normalized[key] = normalizedConditions
  }
  return normalized
}

function enabledLanguageCodes(settings) {
  const localization = settings?.localization || {}
  const packages = Array.isArray(localization.languagePackages) ? localization.languagePackages : []
  const active = Array.isArray(localization.activeLanguages) && localization.activeLanguages.length
    ? new Set(localization.activeLanguages.map(String))
    : new Set(packages.filter(item => item?.enabled !== false).map(item => String(item?.code || '')).filter(Boolean))
  const defaultLanguage = String(localization.defaultLanguage || settings?.language || '')
  if (defaultLanguage && packages.some(item => item?.code === defaultLanguage && item.enabled !== false)) active.add(defaultLanguage)
  return new Set(packages
    .filter(item => item && typeof item.code === 'string' && item.enabled !== false && active.has(item.code))
    .map(item => item.code))
}

function normalizeLanguage(value, settings) {
  if (value === '' || value === null) return ''
  if (typeof value !== 'string' || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value)) return null
  if (settings?.localization?.userLanguagePreference === false) return false
  return enabledLanguageCodes(settings).has(value) ? value : null
}

export function registerPreferencesRoutes(app, services) {
  const { requireUser, sendError, userPreferencesRepository, store } = services

  app.get('/api/preferences', requireUser, (req, res) => {
    res.json(userPreferencesRepository.getPreferences(req.user.id))
  })

  app.put('/api/preferences', requireUser, (req, res) => {
    const body = req.body || {}
    if (Object.keys(body).some(key => !['filters', 'language'].includes(key))) {
      return sendError(res, 400, 'Only saved filters and the current user’s language preference may be updated')
    }
    if (!Object.hasOwn(body, 'filters') && !Object.hasOwn(body, 'language')) {
      return sendError(res, 400, 'At least one user preference must be provided')
    }

    const current = userPreferencesRepository.getPreferences(req.user.id)
    const next = { ...current }
    if (Object.hasOwn(body, 'filters')) {
      const filters = normalizeFilters(body.filters)
      if (!filters) return sendError(res, 400, 'Saved filters contain invalid or oversized conditions')
      next.filters = filters
    }
    if (Object.hasOwn(body, 'language')) {
      const language = normalizeLanguage(body.language, store?.settings)
      if (language === false) return sendError(res, 403, 'Per-user language preferences are disabled by the workspace administrator')
      if (language === null) return sendError(res, 400, 'Choose an enabled workspace language')
      next.language = language
    }

    res.json(userPreferencesRepository.savePreferences(req.user.id, next))
  })
}
