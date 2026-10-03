// Query-string contracts for list endpoints. Everything arrives as text; this turns it into typed, bounded filters.
import { z } from 'zod'
import type { TaskFilter, TaskSort, TaskSortKey } from '../repositories/tasks'
import { conditionSchema } from './exports'

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

export const SORT_KEYS = [
  'due',
  'title',
  'status',
  'priority',
  'assignee',
  'created',
  'key',
  'project',
  'type',
  'blocked',
  'completed',
  'tags'
] as const

export const taskQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: csv.optional(),
  priority: csv.optional(),
  type: csv.optional(),
  /** Only this project's tasks (the project page and "select all matching" there). */
  project: z.coerce.number().int().positive().optional(),
  /** A person id, `none` (unassigned) or `me` (the signed-in person). */
  assignee: z.string().max(100).optional(),
  blocked: flag.optional(),
  dueFrom: isoDate.optional(),
  dueTo: isoDate.optional(),
  /** `open` hides finished tasks, `done` shows only them, `overdue` shows open tasks past their due date. */
  scope: z.enum(['open', 'done', 'overdue']).optional(),
  /** One key (`sort=title&dir=desc`) or several, most important first (`sort=priority:desc,due:asc`). */
  sort: z.string().max(200).default('due'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  /** Tag ids; a task matches when it carries any of them. */
  tag: csv.optional(),
  /** The advanced filter as JSON: [{ join?, field, operator, value }, …]. */
  where: z
    .string()
    .max(10_000)
    .optional()
    .transform((text, ctx) => {
      if (!text) return undefined
      try {
        const parsed = z.array(conditionSchema).max(20).safeParse(JSON.parse(text))
        if (parsed.success) return parsed.data
      } catch {
        /* falls through to the issue below */
      }
      ctx.addIssue({ code: 'custom', message: 'where must be a JSON list of up to 20 conditions' })
      return z.NEVER
    }),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50)
})
export type TaskQuery = z.output<typeof taskQuerySchema>

/** Translate a validated query into the repository's filter, sort and page. */
export function toTaskListing(query: TaskQuery, me: { personId: string }) {
  const filter: TaskFilter = {
    projectId: query.project,
    q: query.q,
    status: query.status,
    priority: query.priority,
    type: query.type,
    blocked: query.blocked,
    dueFrom: query.dueFrom,
    dueTo: query.dueTo,
    open: query.scope === 'open',
    done: query.scope === 'done',
    overdue: query.scope === 'overdue',
    tagIds: query.tag,
    conditions: query.where
  }
  if (query.assignee === 'none') filter.unassigned = true
  else if (query.assignee === 'me') filter.assigneeId = me.personId || '\u0000no-person'
  else if (query.assignee) filter.assigneeId = query.assignee
  return {
    filter,
    sort: parseSorts(query.sort, query.dir),
    page: { limit: query.pageSize, offset: (query.page - 1) * query.pageSize }
  }
}

/** `title` + dir, or `priority:desc,due:asc`: unknown keys are dropped, at most four columns count. */
export function parseSorts(text: string, dir: 'asc' | 'desc' = 'asc'): TaskSort[] {
  const known = new Set<string>(SORT_KEYS)
  const sorts = text
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [key, direction] = part.split(':')
      return {
        key: key as TaskSortKey,
        dir: (direction === 'desc' ? 'desc' : direction === 'asc' ? 'asc' : dir) as 'asc' | 'desc'
      }
    })
    .filter(sort => known.has(sort.key))
    .slice(0, 4)
  return sorts.length ? sorts : [{ key: 'due', dir: 'asc' }]
}
