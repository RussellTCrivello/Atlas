// Input contracts for working with many records: bulk operations, CSV import, tags and saved views. Same rules as
// schemas.ts (everything bounded, unknown keys stripped); split out so each file stays a size one person can read.
import { z } from 'zod'
import {
  MILESTONE_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  TASK_TYPES,
  color,
  id,
  numericId,
  optionalDate,
  optionalNumericId,
  required,
  text
} from './schemas'

// ---- records at scale: bulk operations, import, tags, saved views -------------------------------------------------------
/** A bulk request names its records explicitly (never "everything matching"): the person always knows how many are affected. */
const bulkIds = z
  .array(z.union([numericId, z.string().trim().min(1).max(100)]))
  .min(1, 'Select at least one record')
  .max(500, 'At most 500 records per request')

export const taskBulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), ids: bulkIds, status: text(40).min(1) }),
  z.object({ action: z.literal('assign'), ids: bulkIds, assigneeId: id }),
  z.object({
    action: z.literal('edit'),
    ids: bulkIds,
    priority: z.enum(PRIORITIES).optional(),
    type: z.enum(TASK_TYPES).optional(),
    dueDate: optionalDate.optional(),
    blocked: z.boolean().optional(),
    projectId: numericId.optional()
  }),
  z.object({ action: z.literal('tag'), ids: bulkIds, tags: z.array(z.string().trim().min(1).max(40)).min(1).max(20) }),
  z.object({
    action: z.literal('untag'),
    ids: bulkIds,
    tags: z.array(z.string().trim().min(1).max(40)).min(1).max(20)
  }),
  z.object({ action: z.literal('delete'), ids: bulkIds, batch: z.string().max(60).optional() })
])
export type TaskBulkInput = z.output<typeof taskBulkSchema>

export const restoreSchema = z.object({ batch: z.string().trim().min(1).max(60) })

export const projectBulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), ids: bulkIds, status: z.enum(PROJECT_STATUSES) }),
  z.object({ action: z.literal('owner'), ids: bulkIds, ownerId: id }),
  z.object({ action: z.literal('team'), ids: bulkIds, teamId: id.min(1) }),
  z.object({ action: z.literal('delete'), ids: bulkIds, cascade: z.boolean().optional() })
])
export const peopleBulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('team'), ids: bulkIds, teamId: id.min(1) }),
  z.object({ action: z.literal('delete'), ids: bulkIds })
])
export const alertBulkSchema = z.object({ action: z.enum(['resolve', 'reopen', 'delete']), ids: bulkIds })
export const milestoneBulkSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), ids: bulkIds, status: z.enum(MILESTONE_STATUSES) }),
  z.object({ action: z.literal('delete'), ids: bulkIds })
])
export type ProjectBulkInput = z.output<typeof projectBulkSchema>
export type PeopleBulkInput = z.output<typeof peopleBulkSchema>
export type AlertBulkInput = z.output<typeof alertBulkSchema>
export type MilestoneBulkInput = z.output<typeof milestoneBulkSchema>
export const duplicateSchema = z.object({ withTasks: z.boolean().optional() }).default({})

/** The task fields a CSV column can fill. */
export const IMPORT_FIELDS = [
  'title',
  'project',
  'assignee',
  'priority',
  'status',
  'type',
  'dueDate',
  'blocked',
  'tags'
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const importSchema = z.object({
  csv: z.string().min(1, 'The file is empty').max(5_000_000, 'The file is larger than 5 MB'),
  /** Check and report without creating anything. */
  dryRun: z.boolean().optional(),
  /** Import the valid rows and skip the invalid ones (otherwise any invalid row stops the import). */
  skipInvalid: z.boolean().optional(),
  /** Project for rows that do not name one. */
  projectId: optionalNumericId.optional(),
  /** Column header (as written in the file) to the field it fills, or "ignore". Columns not listed are matched by name. */
  mapping: z.record(z.string().max(200), z.enum([...IMPORT_FIELDS, 'ignore'])).optional(),
  /** A row whose title already exists in its project: skip it (default) or create it anyway. */
  duplicates: z.enum(['skip', 'create']).optional()
})
export type ImportInput = z.output<typeof importSchema>

export const tagSchema = z.object({ name: required(40), color: color.optional() })
export const tagPatchSchema = z.object({ name: required(40).optional(), color: color.optional() })

const viewScope = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9:_-]{0,59}$/, 'is not a valid screen name')
export const viewSchema = z.object({
  scope: viewScope,
  name: required(80),
  config: z
    .record(z.string(), z.unknown())
    .refine(value => JSON.stringify(value).length <= 20_000, 'The view is too large'),
  shared: z.boolean().optional(),
  isDefault: z.boolean().optional()
})
export const viewPatchSchema = z.object({
  name: required(80).optional(),
  config: z
    .record(z.string(), z.unknown())
    .refine(value => JSON.stringify(value).length <= 20_000, 'The view is too large')
    .optional(),
  shared: z.boolean().optional(),
  isDefault: z.boolean().optional()
})

export type TagInput = z.output<typeof tagSchema>
export type TagPatchInput = z.output<typeof tagPatchSchema>
export type ViewInput = z.output<typeof viewSchema>
export type ViewPatchInput = z.output<typeof viewPatchSchema>

/** The screen a list of saved views belongs to. */
export const viewQuerySchema = z.object({ scope: viewScope })
