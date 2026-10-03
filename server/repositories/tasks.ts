// Tasks. Listing goes through the v_task_rows view (names already joined), filtering and sorting are done by SQL, and
// every list is paged, so a workspace with 100,000 tasks costs the same per request as one with 100.
import type { Task } from '../domain/types'
import {
  type Database,
  type Row,
  type SqlValue,
  isOne,
  marks,
  nullable,
  orEmpty,
  parseFields,
  stringifyFields,
  updatePlan
} from './base'
import { type TaskFilter, type TaskSort, orderBy, taskWhere } from './task-query'

export { TASK_FIELDS, taskWhere } from './task-query'
export type { TaskFilter, TaskSort, TaskSortKey } from './task-query'

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
    sort: TaskSort | TaskSort[] = { key: 'due', dir: 'asc' },
    page: { limit: number; offset?: number } = { limit: 50 }
  ): TaskRow[] {
    const { sql, params } = taskWhere(filter)
    return this.db
      .all(`SELECT t.* FROM v_task_rows t ${sql} ORDER BY ${orderBy([sort].flat())} LIMIT ? OFFSET ?`, [
        ...params,
        page.limit,
        page.offset ?? 0
      ])
      .map(toTaskRow)
  }

  /** Lower-cased titles of one project's tasks: the import uses them to recognise rows that already exist. */
  titlesOf(projectId: number): Set<string> {
    return new Set(
      this.db
        .all<{ title: string }>('SELECT lower(title) AS title FROM tasks WHERE project_id = ?', [projectId])
        .map(row => row.title)
    )
  }

  /** The ids of every task matching a filter, in display order, up to `limit` ("select all matching" works from this). */
  idsOf(filter: TaskFilter, sort: TaskSort | TaskSort[], limit: number): number[] {
    const { sql, params } = taskWhere(filter)
    return this.db
      .all<{ id: number }>(`SELECT t.id FROM v_task_rows t ${sql} ORDER BY ${orderBy([sort].flat())} LIMIT ?`, [
        ...params,
        limit
      ])
      .map(row => Number(row.id))
  }

  /** Stream every matching row (exports): rows are produced one by one instead of being held in memory twice. */
  *iterate(filter: TaskFilter, sort: TaskSort | TaskSort[] = { key: 'due', dir: 'asc' }): Generator<Row> {
    const { sql, params } = taskWhere(filter)
    yield* this.db.iterate(`SELECT t.* FROM v_task_rows t ${sql} ORDER BY ${orderBy([sort].flat())}`, params)
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
