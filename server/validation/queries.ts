// Query-string contracts for list endpoints. Everything arrives as text; this turns it into typed, bounded filters.
import { z } from 'zod'
import type { TaskFilter, TaskSort } from '../repositories/tasks'

const csv = z
  .string()
  .max(400)
  .transform(value =>
    value
      .split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .slice(0, 20)
  )
const flag = z.enum(['true', 'false']).transform(value => value === 'true')
const isoDate = z.iso.date()

export const SORT_KEYS = ['due', 'title', 'status', 'priority', 'assignee', 'created', 'key', 'project'] as const

export const taskQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: csv.optional(),
  priority: csv.optional(),
  type: csv.optional(),
  /** A person id, `none` (unassigned) or `me` (the signed-in person). */
  assignee: z.string().max(100).optional(),
  blocked: flag.optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  /** `open` hides finished tasks, `done` shows only them, `overdue` shows open tasks past their due date. */
  scope: z.enum(['open', 'done', 'overdue']).optional(),
  sort: z.enum(SORT_KEYS).default('due'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
})
export type TaskQuery = z.output<typeof taskQuerySchema>

/** Translate a validated query into the repository's filter, sort and page. */
export function toTaskListing(query: TaskQuery, me: { personId: string }) {
  const filter: TaskFilter = {
    q: query.q,
    status: query.status,
    priority: query.priority,
    type: query.type,
    blocked: query.blocked,
    dueFrom: query.dueFrom,
    dueTo: query.dueTo,
    open: query.scope === 'open',
    done: query.scope === 'done',
    overdue: query.scope === 'overdue'
  }
  if (query.assignee === 'none') filter.unassigned = true
  else if (query.assignee === 'me') filter.assigneeId = me.personId || '\u0000no-person'
  else if (query.assignee) filter.assigneeId = query.assignee
  const sort: TaskSort = { key: query.sort, dir: query.dir }
  return { filter, sort, page: { limit: query.pageSize, offset: (query.page - 1) * query.pageSize } }
}
