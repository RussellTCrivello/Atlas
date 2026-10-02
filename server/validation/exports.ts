// What a person may ask of the export endpoint. Everything is bounded: the dataset must be known, the columns are keys,
// the filters are the same conditions the list screens use, and nothing here can name a table or write SQL.
import { z } from 'zod'

const key = z.string().trim().min(1).max(80)

export const conditionSchema = z.object({
  join: z.enum(['AND', 'OR']).optional(),
  field: key,
  operator: z.enum([
    'contains',
    'equals',
    'notEquals',
    'startsWith',
    'endsWith',
    'gt',
    'lt',
    'gte',
    'lte',
    'isEmpty',
    'isNotEmpty'
  ]),
  value: z.coerce.string().max(500).default('')
})

export const EXPORT_FORMATS = ['csv', 'xlsx', 'json', 'pdf', 'print'] as const

export const exportRequestSchema = z.object({
  dataset: z.string().trim().min(1).max(40),
  format: z.enum(EXPORT_FORMATS),
  columns: z.array(key).max(120).optional(),
  filters: z.array(conditionSchema).max(40).optional(),
  q: z.string().trim().max(200).optional(),
  /** Dataset parameters: a project, a period, a person, a priority… Only scalars. */
  scope: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
  sort: z.object({ key, dir: z.enum(['asc', 'desc']).optional() }).optional(),
  title: z.string().trim().max(120).optional(),
  language: z
    .string()
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .optional(),
  orientation: z.enum(['landscape', 'portrait']).optional(),
  margin: z.number().min(5).max(30).optional(),
  template: z.enum(['executive', 'standard', 'compact']).optional(),
  groupBy: key.optional(),
  /** Return the row count and a small sample instead of a file. */
  preview: z.boolean().optional()
})
export type ExportRequest = z.output<typeof exportRequestSchema>
export type ExportFormatName = (typeof EXPORT_FORMATS)[number]
