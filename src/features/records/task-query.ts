// How the state of the task grid (search, column filters, advanced filter, sort, page) becomes a request to the server, which
// filters, sorts and pages in the database. Kept apart from the component so the mapping can be tested on its own.
import type { Condition } from '../../lib/filters'
import { type ColumnFilters, type SortSpec, activeColumnFilters, sortParam } from '../../lib/grid-model'

/** The sortable task columns the server knows (`GET /api/tasks?sort=`). */
export const SERVER_SORT_KEYS = [
  'key',
  'title',
  'project',
  'status',
  'priority',
  'assignee',
  'due',
  'type',
  'blocked',
  'tags',
  'created',
  'completed'
]

export interface TaskGridQuery {
  q: string
  sort: SortSpec[]
  columnFilters: ColumnFilters
  conditions: Condition[]
  page: number
  pageSize: number
  /** Fixed by where the grid sits: a project's page, or "assigned to me". */
  fixed?: Record<string, string>
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : text(value) ? [text(value)] : []

/** The columns whose filter is a text search map to the field names the server's condition engine knows. */
const TEXT_FIELDS: Record<string, string> = { key: 'id', title: 'title', project: 'project', tags: 'tags' }
const DATE_FIELDS: Record<string, string> = { created: 'createdAt', completed: 'completedAt' }

export function taskParams(query: TaskGridQuery, { paged = true } = {}): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query.fixed || {})) if (value) params.set(key, value)
  if (query.q.trim()) params.set('q', query.q.trim())
  const sorts = query.sort.filter(sort => SERVER_SORT_KEYS.includes(sort.key))
  if (sorts.length) params.set('sort', sortParam(sorts))
  if (query.conditions.length) params.set('where', JSON.stringify(query.conditions))
  const cf: Condition[] = []
  for (const [key, filter] of Object.entries(activeColumnFilters(query.columnFilters))) {
    if (key === 'status' || key === 'priority' || key === 'type') {
      const values = list(filter)
      if (values.length) params.set(key, values.join(','))
    } else if (key === 'state') {
      const value = text(filter)
      if (value === 'open' || value === 'done' || value === 'overdue') params.set('scope', value)
    } else if (key === 'assignee') {
      const value = list(filter)[0]
      if (value) params.set('assignee', value)
    } else if (key === 'blocked') {
      if (text(filter) === 'true' || text(filter) === 'false') params.set('blocked', text(filter))
    } else if (key === 'due') {
      const range = filter as { from?: string; to?: string }
      if (range.from) params.set('dueFrom', range.from)
      if (range.to) params.set('dueTo', range.to)
    } else if (DATE_FIELDS[key]) {
      const range = filter as { from?: string; to?: string }
      if (range.from) cf.push({ field: DATE_FIELDS[key], operator: 'gte', value: range.from })
      if (range.to) cf.push({ field: DATE_FIELDS[key], operator: 'lte', value: range.to })
    } else if (TEXT_FIELDS[key] && text(filter)) {
      cf.push({ field: TEXT_FIELDS[key], operator: 'contains', value: text(filter) })
    }
  }
  if (cf.length) params.set('cf', JSON.stringify(cf))
  if (paged) {
    params.set('page', String(query.page))
    params.set('pageSize', String(query.pageSize))
  }
  return params
}
