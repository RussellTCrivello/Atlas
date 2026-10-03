// What a person can ask of the task list, as SQL: the filter (every column name is fixed here, every value is a bound
// parameter), the multi-column sort, and the fields the advanced filter may name. Kept apart from the repository so the
// query rules can be read, and tested, without the persistence code around them.
import type { Condition } from '../../shared/filters'
import { type FieldMap, compileConditions } from './conditions'
import { type SqlValue, ftsQuery, likeEscape, marks } from './base'

export interface TaskFilter {
  projectId?: number
  assigneeId?: string
  /** `true` = only tasks nobody is assigned to. */
  unassigned?: boolean
  status?: string[]
  priority?: string[]
  type?: string[]
  blocked?: boolean
  /** Text search over title and key (full-text index, prefix match). */
  q?: string
  dueFrom?: string
  dueTo?: string
  noDueDate?: boolean
  /** Only these tasks (an explicit selection). An empty list matches nothing. */
  ids?: number[]
  /** Tasks carrying at least one of these tags. */
  tagIds?: string[]
  /** The advanced filter: conditions joined by AND / OR. */
  conditions?: Condition[]
  /** Terminal workflow labels plus the day to compare with: `open` and `overdue` need them. */
  terminal?: string[]
  today?: string
  open?: boolean
  done?: boolean
  overdue?: boolean
}

export type TaskSortKey =
  | 'due'
  | 'title'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'created'
  | 'key'
  | 'project'
  | 'type'
  | 'blocked'
  | 'completed'
  | 'tags'
export interface TaskSort {
  key: TaskSortKey
  dir: 'asc' | 'desc'
}

const PRIORITY_RANK = "CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 WHEN 'Low' THEN 2 ELSE 3 END"
/** One ORDER BY term per key; a final tie-breaker on the id keeps pages stable however many columns are sorted. */
const SORT_SQL: Record<TaskSortKey, (dir: string) => string> = {
  due: dir => `(t.due_date IS NULL), t.due_date ${dir}`,
  title: dir => `t.title COLLATE NOCASE ${dir}`,
  status: dir => `t.status COLLATE NOCASE ${dir}`,
  priority: dir => `${PRIORITY_RANK} ${dir}`,
  assignee: dir => `(t.assignee_name IS NULL), t.assignee_name COLLATE NOCASE ${dir}`,
  created: dir => `t.created_at ${dir}`,
  key: dir => `t.id ${dir}`,
  project: dir => `t.project_name COLLATE NOCASE ${dir}`,
  type: dir => `t.type COLLATE NOCASE ${dir}`,
  blocked: dir => `t.blocked ${dir}`,
  completed: dir => `(t.completed_at IS NULL), t.completed_at ${dir}`,
  tags: dir => `(t.tags IS NULL), t.tags COLLATE NOCASE ${dir}`
}

/** The fields the advanced filter may name, with the column each one reads. */
export const TASK_FIELDS: FieldMap = {
  id: { expr: 't.key' },
  title: { expr: 't.title' },
  project: { expr: 't.project_name' },
  projectCode: { expr: 't.project_code' },
  status: { expr: 't.status' },
  priority: { expr: 't.priority' },
  type: { expr: 't.type' },
  assignee: { expr: "COALESCE(t.assignee_name, 'Unassigned')" },
  dueDate: { expr: 't.due_date', kind: 'date' },
  createdAt: { expr: 't.created_at', kind: 'date' },
  completedAt: { expr: 't.completed_at', kind: 'date' },
  blocked: { expr: 't.blocked', kind: 'boolean' },
  tags: { expr: 't.tags' },
  team: { expr: 't.team_name' }
}

export const orderBy = (sorts: TaskSort[]): string => {
  const list = sorts.length ? sorts : [{ key: 'due' as TaskSortKey, dir: 'asc' as const }]
  const terms = list
    .filter(sort => SORT_SQL[sort.key])
    .map(sort => SORT_SQL[sort.key](sort.dir === 'desc' ? 'DESC' : 'ASC'))
  return `${terms.join(', ')}, t.id ${list[0].dir === 'desc' ? 'DESC' : 'ASC'}`
}

/** Build the WHERE clause. Column names are fixed here; every value is bound as a parameter. */
export function taskWhere(filter: TaskFilter): { sql: string; params: SqlValue[] } {
  const clauses: string[] = []
  const params: SqlValue[] = []
  const terminal = filter.terminal || []
  if (filter.projectId !== undefined) {
    clauses.push('t.project_id = ?')
    params.push(filter.projectId)
  }
  if (filter.assigneeId) {
    clauses.push('t.assignee_id = ?')
    params.push(filter.assigneeId)
  }
  if (filter.unassigned) clauses.push('t.assignee_id IS NULL')
  for (const [column, values] of [
    ['status', filter.status],
    ['priority', filter.priority],
    ['type', filter.type]
  ] as const) {
    if (values?.length) {
      clauses.push(`t.${column} IN (${marks(values.length)})`)
      params.push(...values)
    }
  }
  if (filter.blocked !== undefined) clauses.push(filter.blocked ? 't.blocked = 1' : 't.blocked = 0')
  if (filter.dueFrom) {
    clauses.push('t.due_date >= ?')
    params.push(filter.dueFrom)
  }
  if (filter.dueTo) {
    clauses.push('t.due_date <= ?')
    params.push(filter.dueTo)
  }
  if (filter.noDueDate) clauses.push('t.due_date IS NULL')
  if (filter.open) {
    clauses.push(`t.status NOT IN (${marks(terminal.length)})`)
    params.push(...terminal)
  }
  if (filter.done) {
    clauses.push(`t.status IN (${marks(terminal.length)})`)
    params.push(...terminal)
  }
  if (filter.overdue && filter.today) {
    clauses.push(`t.status NOT IN (${marks(terminal.length)}) AND t.due_date IS NOT NULL AND t.due_date < ?`)
    params.push(...terminal, filter.today)
  }
  if (filter.ids) {
    // One bound parameter however long the selection is (no limit on the number of SQL variables to run into).
    clauses.push(filter.ids.length ? 't.id IN (SELECT value FROM json_each(?))' : '0')
    if (filter.ids.length) params.push(JSON.stringify(filter.ids))
  }
  if (filter.tagIds?.length) {
    clauses.push(`t.id IN (SELECT task_id FROM task_tags WHERE tag_id IN (${marks(filter.tagIds.length)}))`)
    params.push(...filter.tagIds)
  }
  if (filter.conditions?.length) {
    const compiled = compileConditions(filter.conditions, TASK_FIELDS)
    if (compiled.sql) {
      clauses.push(`(${compiled.sql})`)
      params.push(...compiled.params)
    }
  }
  const text = filter.q?.trim()
  if (text) {
    const fts = text.length >= 2 ? ftsQuery(text) : null
    if (fts) {
      clauses.push('t.id IN (SELECT rowid FROM task_search WHERE task_search MATCH ?)')
      params.push(fts)
    } else {
      clauses.push("(t.title LIKE ? ESCAPE '\\' OR t.key LIKE ? ESCAPE '\\')")
      params.push(`%${likeEscape(text)}%`, `%${likeEscape(text)}%`)
    }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}
