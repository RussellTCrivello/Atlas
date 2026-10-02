export const FIELD_OPERATORS = [
  ['contains', 'Contains'],
  ['equals', 'Equals'],
  ['notEquals', 'Does not equal'],
  ['startsWith', 'Starts with'],
  ['endsWith', 'Ends with'],
  ['gt', 'Greater than'],
  ['lt', 'Less than'],
  ['gte', 'Greater or equal'],
  ['lte', 'Less or equal']
]

function readRawValue(row, key) {
  return String(key).split('.').reduce((value, part) => value?.[part], row)
}

export function readValue(row, key) {
  return readRawValue(row, key)
}

export function configuredColumns(settings, entity, defaults) {
  const order = settings?.interface?.tableColumns?.[entity]
  if (!Array.isArray(order) || order.length === 0) return defaults
  const byKey = new Map(defaults.map((column) => [column.key, column]))
  const configured = order.map((key) => byKey.get(key)).filter(Boolean)
  return configured.length ? configured : defaults
}

export function actionVisible(settings, action) {
  return settings?.interface?.actionVisibility?.[action] !== false
}

function matches(row, condition) {
  const leftRaw = readRawValue(row, condition.field)
  const left = leftRaw === null || leftRaw === undefined ? '' : String(leftRaw).toLowerCase()
  const right = String(condition.value ?? '').toLowerCase()
  if (['gt', 'lt', 'gte', 'lte'].includes(condition.operator)) {
    const leftNumber = Number(leftRaw)
    const rightNumber = Number(condition.value)
    if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) return false
    if (condition.operator === 'gt') return leftNumber > rightNumber
    if (condition.operator === 'lt') return leftNumber < rightNumber
    if (condition.operator === 'gte') return leftNumber >= rightNumber
    return leftNumber <= rightNumber
  }
  if (condition.operator === 'equals') return left === right
  if (condition.operator === 'notEquals') return left !== right
  if (condition.operator === 'startsWith') return left.startsWith(right)
  if (condition.operator === 'endsWith') return left.endsWith(right)
  return left.includes(right)
}

export function applyAdvancedFilters(rows, conditions = []) {
  const active = conditions.filter((condition) => condition.value !== '')
  if (!active.length) return rows
  return rows.filter((row) => active.slice(1).reduce(
    (result, condition) => condition.join === 'OR' ? result || matches(row, condition) : result && matches(row, condition),
    matches(row, active[0])
  ))
}

export function sortRows(rows, sort) {
  if (!sort?.key) return rows
  return [...rows].sort((left, right) => String(readValue(left, sort.key) ?? '').localeCompare(
    String(readValue(right, sort.key) ?? ''), undefined, { numeric: true }
  ) * (sort.dir === 'desc' ? -1 : 1))
}
