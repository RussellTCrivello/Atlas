// Row filtering and sorting for list screens (the "advanced query builder").
export type FieldType = 'text' | 'date' | 'number'
export interface Condition {
  join?: 'AND' | 'OR'
  field: string
  operator: string
  value: string
}

export const FIELD_OPERATORS: [string, string][] = [
  ['contains', 'Contains'],
  ['equals', 'Equals'],
  ['notEquals', 'Does not equal'],
  ['startsWith', 'Starts with'],
  ['endsWith', 'Ends with'],
  ['gt', 'Greater than'],
  ['lt', 'Less than'],
  ['gte', 'Greater or equal'],
  ['lte', 'Less or equal'],
  ['isEmpty', 'Is empty'],
  ['isNotEmpty', 'Is not empty']
]
export const VALUELESS_OPERATORS = new Set(['isEmpty', 'isNotEmpty'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

export function readValue(row: any, key: string): any {
  return String(key)
    .split('.')
    .reduce((value, part) => value?.[part], row)
}

export function matches(row: any, c: Condition): boolean {
  const leftRaw = readValue(row, c.field)
  const left = leftRaw == null ? '' : String(leftRaw).toLowerCase()
  const right = String(c.value ?? '').toLowerCase()
  if (c.operator === 'isEmpty') return left === ''
  if (c.operator === 'isNotEmpty') return left !== ''
  if (['gt', 'lt', 'gte', 'lte'].includes(c.operator)) {
    let a: number | string
    let b: number | string
    if (ISO_DATE.test(String(leftRaw ?? '')) && ISO_DATE.test(String(c.value ?? ''))) {
      // Dates compare as ISO strings (lexicographic order is chronological), so "due before 2026-12-01" works.
      a = String(leftRaw).slice(0, 10)
      b = String(c.value).slice(0, 10)
    } else {
      a = Number(leftRaw)
      b = Number(c.value)
      if (Number.isNaN(a) || Number.isNaN(b) || leftRaw === '' || leftRaw == null || c.value === '') return false
    }
    return c.operator === 'gt' ? a > b : c.operator === 'lt' ? a < b : c.operator === 'gte' ? a >= b : a <= b
  }
  if (c.operator === 'equals') return left === right
  if (c.operator === 'notEquals') return left !== right
  if (c.operator === 'startsWith') return left.startsWith(right)
  if (c.operator === 'endsWith') return left.endsWith(right)
  return left.includes(right)
}

/** A condition counts only if it has something to test (an operand, or an operator that needs none). */
export const isActive = (c: Condition) =>
  VALUELESS_OPERATORS.has(c.operator) || (c.value !== undefined && c.value !== '')

/**
 * Conditions are AND-ed together unless joined with OR, and AND binds tighter than OR (as in SQL):
 *   A AND B OR C AND D   ==   (A AND B) OR (C AND D)
 * The `join` of a condition says how it connects to the one before it.
 */
export function applyAdvancedFilters<T = any>(rows: T[] = [], conditions: Condition[] = []): T[] {
  const active = conditions.filter(isActive)
  if (!active.length) return rows
  const groups: Condition[][] = [[active[0]]]
  for (const c of active.slice(1)) {
    if (c.join === 'OR') groups.push([c])
    else groups[groups.length - 1].push(c)
  }
  return rows.filter(row => groups.some(group => group.every(c => matches(row, c))))
}

export function sortRows<T = any>(rows: T[], sort?: { key: string; dir?: string }): T[] {
  if (!sort?.key) return rows
  const direction = sort.dir === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const left = readValue(a, sort.key)
    const right = readValue(b, sort.key)
    // empty values always sort last, whichever the direction
    if ((left == null || left === '') !== (right == null || right === '')) return left == null || left === '' ? 1 : -1
    return String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true }) * direction
  })
}
