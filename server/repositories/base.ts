// Helpers shared by the repositories: row <-> entity conversions and the small SQL builders that keep column names out of
// user input. A repository is the only place that knows table and column names.
import type { Database, Row, SqlValue } from '../db/driver'
import type { CustomFields } from '../domain/types'

export type { Database, Row, SqlValue }

export const isOne = (value: unknown): boolean => value === 1 || value === true || value === 1n

export function parseFields(value: unknown): CustomFields {
  if (typeof value !== 'string' || !value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
export const stringifyFields = (value: unknown): string =>
  JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? value : {})

/** Empty text and null both mean "no value" at the API boundary; the database stores NULL. */
export const nullable = (value: unknown): string | null =>
  value === undefined || value === null || value === '' ? null : String(value)
export const orEmpty = (value: unknown): string => (value === undefined || value === null ? '' : String(value))

export const marks = (count: number): string => Array.from({ length: count }, () => '?').join(', ')

export interface UpdatePlan {
  sql: string
  params: SqlValue[]
}

/**
 * `UPDATE table SET col = ? ... WHERE keyColumn = ?` for the entity fields present in `patch`. `columns` maps entity field
 * names to column names (a fixed whitelist), `encode` converts a value for storage. Returns null when nothing changes.
 */
export function updatePlan(
  table: string,
  keyColumn: string,
  key: SqlValue,
  columns: Record<string, string>,
  patch: Record<string, unknown>,
  encode: Record<string, (value: any) => SqlValue> = {}
): UpdatePlan | null {
  const sets: string[] = []
  const params: SqlValue[] = []
  for (const [field, column] of Object.entries(columns)) {
    if (!(field in patch) || patch[field] === undefined) continue
    sets.push(`${column} = ?`)
    params.push(encode[field] ? encode[field](patch[field]) : (patch[field] as SqlValue))
  }
  if (!sets.length) return null
  params.push(key)
  return { sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE ${keyColumn} = ?`, params }
}

/** Turn free text into a safe FTS5 query: every word becomes a quoted prefix term, all must match. */
export function ftsQuery(text: string): string | null {
  const words = String(text)
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
  return words.length ? words.map(word => `"${word.replaceAll('"', '""')}"*`).join(' ') : null
}

/** Escape LIKE wildcards in user text (used with ESCAPE '\\'). */
export const likeEscape = (text: string): string => String(text).replace(/[\\%_]/g, match => `\\${match}`)
