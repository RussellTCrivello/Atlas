// Tasks. Listing goes through the v_task_rows view (names already joined), filtering and sorting are done by SQL, and
// every list is paged, so a workspace with 100,000 tasks costs the same per request as one with 100.
import type { Task } from '../domain/types'
import {
  type Database,
  type Row,
  type SqlValue,
  ftsQuery,
  isOne,
  likeEscape,
  marks,
  nullable,
  orEmpty,
  parseFields,
  stringifyFields,
  updatePlan
} from './base'

const COLUMNS = {
  key: 'key',
  title: 'title',
  projectId: 'project_id',
  assigneeId: 'assignee_id',
  priority: 'priority',
  dueDate: 'due_date',
  status: 'status',
  type: 'type',
  blocked: 'blocked',
  customFields: 'custom_fields',
  completedAt: 'completed_at'
}

/** Fields of a task that can change. `completedAt: null` clears the completion date. */
export type TaskPatch = Omit<Partial<Task>, 'completedAt'> & { completedAt?: string | null }

/** A task together with the names SQL joined onto it. */
export interface TaskRow extends Task {
  projectName: string
  projectCode: string
  assigneeName: string
}

export const toTask = (row: Row): Task => ({
  id: Number(row.id),
  key: row.key,
  title: row.title,
  projectId: Number(row.project_id),
  assigneeId: orEmpty(row.assignee_id),
  priority: row.priority,
  dueDate: orEmpty(row.due_date),
  status: row.status,
  type: row.type,
  blocked: isOne(row.blocked),
  customFields: parseFields(row.custom_fields),
  createdAt: row.created_at,
  createdBy: row.created_by ?? undefined,
  completedAt: row.completed_at ?? undefined,
  sample: isOne(row.sample)
})
const toTaskRow = (row: Row): TaskRow => ({
  ...toTask(row),
  projectName: orEmpty(row.project_name),
  projectCode: orEmpty(row.project_code),
  assigneeName: orEmpty(row.assignee_name)
})

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
  /** Terminal workflow labels plus the day to compare with: `open` and `overdue` need them. */
  terminal?: string[]
  today?: string
  open?: boolean
  done?: boolean
  overdue?: boolean
}

export type TaskSortKey = 'due' | 'title' | 'status' | 'priority' | 'assignee' | 'created' | 'key' | 'project'
export interface TaskSort {
  key: TaskSortKey
  dir: 'asc' | 'desc'
}

const PRIORITY_RANK = "CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 WHEN 'Low' THEN 2 ELSE 3 END"
const SORT_SQL: Record<TaskSortKey, (dir: string) => string> = {
  due: dir => `(t.due_date IS NULL), t.due_date ${dir}, t.id ${dir}`,
  title: dir => `t.title COLLATE NOCASE ${dir}, t.id`,
  status: dir => `t.status COLLATE NOCASE ${dir}, t.id`,
  priority: dir => `${PRIORITY_RANK} ${dir}, t.id`,
  assignee: dir => `(t.assignee_name IS NULL), t.assignee_name COLLATE NOCASE ${dir}, t.id`,
  created: dir => `t.created_at ${dir}, t.id ${dir}`,
  key: dir => `t.id ${dir}`,
  project: dir => `t.project_name COLLATE NOCASE ${dir}, t.id`
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

export interface TaskCounts {
  total: number
  open: number
  done: number
  blocked: number
  overdue: number
}

export class TaskRepository {
  constructor(private db: Database) {}

  byId(id: number): Task | undefined {
    const row = this.db.get('SELECT * FROM tasks WHERE id = ?', [id])
    return row && toTask(row)
  }
  exists(id: number): boolean {
    return Boolean(this.db.get('SELECT 1 FROM tasks WHERE id = ?', [id]))
  }
  rowById(id: number): TaskRow | undefined {
    const row = this.db.get('SELECT * FROM v_task_rows WHERE id = ?', [id])
    return row && toTaskRow(row)
  }

  /** Current title, key and project of the given tasks (ledger rows show live names while the task still exists). */
  liveInfo(ids: number[]): Map<number, { title: string; key: string; projectId: number }> {
    const found = new Map<number, { title: string; key: string; projectId: number }>()
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      for (const row of this.db.all<{ id: number; title: string; key: string; project_id: number }>(
        `SELECT id, title, key, project_id FROM tasks WHERE id IN (${marks(chunk.length)})`,
        chunk
      ))
        found.set(Number(row.id), { title: row.title, key: row.key, projectId: Number(row.project_id) })
    }
    return found
  }

  /** The id the next task will get (identifiers are never reused, even after deletions). */
  nextId(): number {
    const sequence = Number(this.db.scalar("SELECT seq FROM sqlite_sequence WHERE name = 'tasks'") ?? 0)
    const max = Number(this.db.scalar('SELECT COALESCE(MAX(id), 0) FROM tasks'))
    return Math.max(sequence, max) + 1
  }

  insert(task: Task) {
    this.db.run(
      'INSERT INTO tasks(id, key, title, project_id, assignee_id, priority, due_date, status, type, blocked, custom_fields, created_at, created_by, completed_at, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        task.id,
        task.key || '',
        task.title,
        task.projectId,
        nullable(task.assigneeId),
        task.priority,
        nullable(task.dueDate),
        task.status,
        task.type,
        task.blocked,
        stringifyFields(task.customFields),
        task.createdAt,
        nullable(task.createdBy),
        nullable(task.completedAt),
        Boolean(task.sample)
      ]
    )
  }

  update(id: number, patch: TaskPatch) {
    const plan = updatePlan('tasks', 'id', id, COLUMNS, patch as Record<string, unknown>, {
      assigneeId: nullable,
      dueDate: nullable,
      blocked: Boolean,
      customFields: stringifyFields,
      completedAt: nullable
    })
    if (plan) this.db.run(plan.sql, plan.params)
  }

  delete(id: number) {
    this.db.run('DELETE FROM tasks WHERE id = ?', [id])
  }
  deleteSamples() {
    this.db.run('DELETE FROM tasks WHERE sample = 1')
  }

  // ---- queries -------------------------------------------------------------------------------------------------------
  list(
    filter: TaskFilter,
    sort: TaskSort = { key: 'due', dir: 'asc' },
    page: { limit: number; offset?: number } = { limit: 50 }
  ): TaskRow[] {
    const { sql, params } = taskWhere(filter)
    const order = SORT_SQL[sort.key](sort.dir === 'desc' ? 'DESC' : 'ASC')
    return this.db
      .all(`SELECT t.* FROM v_task_rows t ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`, [
        ...params,
        page.limit,
        page.offset ?? 0
      ])
      .map(toTaskRow)
  }

  /** Stream every matching row (exports): rows are produced one by one instead of being held in memory twice. */
  *iterate(filter: TaskFilter, sort: TaskSort = { key: 'due', dir: 'asc' }): Generator<Row> {
    const { sql, params } = taskWhere(filter)
    const order = SORT_SQL[sort.key](sort.dir === 'desc' ? 'DESC' : 'ASC')
    yield* this.db.iterate(`SELECT t.* FROM v_task_rows t ${sql} ORDER BY ${order}`, params)
  }

  count(filter: TaskFilter): number {
    const { sql, params } = taskWhere(filter)
    return Number(this.db.scalar(`SELECT count(*) FROM v_task_rows t ${sql}`, params))
  }

  /** Task counts by status for a filter (the column headers of a board, the filter facets of a project page). */
  statusCounts(filter: TaskFilter): Map<string, number> {
    const { sql, params } = taskWhere(filter)
    return new Map(
      this.db
        .all<{ status: string; n: number }>(
          `SELECT t.status, count(*) AS n FROM v_task_rows t ${sql} GROUP BY t.status`,
          params
        )
        .map(row => [row.status, Number(row.n)])
    )
  }
  priorityCounts(filter: TaskFilter): Map<string, number> {
    const { sql, params } = taskWhere(filter)
    return new Map(
      this.db
        .all<{ priority: string; n: number }>(
          `SELECT t.priority, count(*) AS n FROM v_task_rows t ${sql} GROUP BY t.priority`,
          params
        )
        .map(row => [row.priority, Number(row.n)])
    )
  }

  counts(terminal: string[], today: string, filter: TaskFilter = {}): TaskCounts {
    const { sql, params } = taskWhere(filter)
    const done = `t.status IN (${marks(terminal.length)})`
    const row = this.db.get(
      `SELECT count(*) AS total,
              coalesce(sum(CASE WHEN ${done} THEN 1 ELSE 0 END), 0) AS done,
              coalesce(sum(CASE WHEN NOT ${done} AND t.blocked = 1 THEN 1 ELSE 0 END), 0) AS blocked,
              coalesce(sum(CASE WHEN NOT ${done} AND t.due_date IS NOT NULL AND t.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue
       FROM v_task_rows t ${sql}`,
      [...terminal, ...terminal, ...terminal, today, ...params]
    )!
    return {
      total: Number(row.total),
      done: Number(row.done),
      open: Number(row.total) - Number(row.done),
      blocked: Number(row.blocked),
      overdue: Number(row.overdue)
    }
  }

  /**
   * The working set the browser receives at sign-in: open tasks first (soonest due first), then the most recently
   * finished ones, capped. The page for a single project, filtered lists and exports read the database directly, so the
   * cap never hides anything from them.
   */
  workingSet(terminal: string[], limit: number): TaskRow[] {
    const done = `t.status IN (${marks(terminal.length)})`
    return this.db
      .all(
        `SELECT t.* FROM v_task_rows t
         ORDER BY ${done}, (t.due_date IS NULL), t.due_date, t.id
         LIMIT ?`,
        [...terminal, limit]
      )
      .map(toTaskRow)
  }

  /** Statuses in use and how many tasks sit in each (so renaming or removing a workflow state can be checked). */
  statusUsage(): Map<string, number> {
    return new Map(
      this.db
        .all<{ status: string; n: number }>('SELECT status, count(*) AS n FROM tasks GROUP BY status')
        .map(row => [row.status, Number(row.n)])
    )
  }

  /** Rename statuses in one statement, so swapping two names cannot chain (A→B then B→C). */
  renameStatuses(renames: Map<string, string>) {
    if (!renames.size) return
    const olds = [...renames.keys()]
    const cases = olds.map(() => 'WHEN ? THEN ?').join(' ')
    const params: SqlValue[] = []
    for (const [from, to] of renames) params.push(from, to)
    this.db.run(
      `UPDATE tasks SET status = CASE status ${cases} ELSE status END WHERE status IN (${marks(olds.length)})`,
      [...params, ...olds]
    )
  }
}
