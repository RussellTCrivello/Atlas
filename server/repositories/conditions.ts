// The advanced filter ("field operator value, joined by AND / OR") as SQL. The same conditions the screens build and the export
// engine applies in memory are compiled here so that a list of 100,000 records can be filtered, counted and selected by the
// database. Field names come from a fixed map (never from the request), every value is bound as a parameter, and AND binds
// tighter than OR, exactly as in shared/filters.ts: `A AND B OR C` is `(A AND B) OR C`.
import { type Condition, isActive } from '../../shared/filters'
import { type SqlValue, likeEscape } from './base'

export interface FieldMap {
  /** field name as the screens know it -> SQL expression (an alias.column of the view being queried). */
  [field: string]: { expr: string; kind?: 'text' | 'date' | 'number' | 'boolean' }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

function one(condition: Condition, map: FieldMap): { sql: string; params: SqlValue[] } | null {
  const field = map[condition.field]
  if (!field) return null // an unknown field matches nothing it should not: the condition is ignored, never interpolated
  const text = `COALESCE(CAST(${field.expr} AS TEXT), '')`
  const value = String(condition.value ?? '')
  switch (condition.operator) {
    case 'isEmpty':
      return { sql: `${text} = ''`, params: [] }
    case 'isNotEmpty':
      return { sql: `${text} <> ''`, params: [] }
    case 'equals':
      return { sql: `lower(${text}) = lower(?)`, params: [field.kind === 'boolean' ? normalizeBoolean(value) : value] }
    case 'notEquals':
      return { sql: `lower(${text}) <> lower(?)`, params: [field.kind === 'boolean' ? normalizeBoolean(value) : value] }
    case 'startsWith':
      return { sql: `lower(${text}) LIKE lower(?) ESCAPE '\\'`, params: [`${likeEscape(value)}%`] }
    case 'endsWith':
      return { sql: `lower(${text}) LIKE lower(?) ESCAPE '\\'`, params: [`%${likeEscape(value)}`] }
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const op = { gt: '>', lt: '<', gte: '>=', lte: '<=' }[condition.operator]
      if (ISO_DATE.test(value) && field.kind !== 'number')
        return { sql: `${field.expr} IS NOT NULL AND ${field.expr} ${op} ?`, params: [value.slice(0, 10)] }
      const number = Number(value)
      if (value === '' || Number.isNaN(number)) return { sql: '0', params: [] }
      return { sql: `${field.expr} IS NOT NULL AND CAST(${field.expr} AS REAL) ${op} ?`, params: [number] }
    }
    default: // contains
      return { sql: `lower(${text}) LIKE lower(?) ESCAPE '\\'`, params: [`%${likeEscape(value)}%`] }
  }
}

const normalizeBoolean = (value: string) =>
  /^(true|yes|1)$/i.test(value) ? '1' : /^(false|no|0)$/i.test(value) ? '0' : value

export function compileConditions(conditions: Condition[] = [], map: FieldMap): { sql: string; params: SqlValue[] } {
  const active = conditions.filter(isActive)
  const groups: Condition[][] = []
  for (const condition of active) {
    if (!groups.length || condition.join === 'OR') groups.push([condition])
    else groups[groups.length - 1].push(condition)
  }
  const params: SqlValue[] = []
  const sqlGroups: string[] = []
  for (const group of groups) {
    const parts: string[] = []
    for (const condition of group) {
      const compiled = one(condition, map)
      if (!compiled) continue
      parts.push(`(${compiled.sql})`)
      params.push(...compiled.params)
    }
    if (parts.length) sqlGroups.push(`(${parts.join(' AND ')})`)
  }
  return { sql: sqlGroups.join(' OR '), params }
}
