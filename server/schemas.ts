// Request validation. Every body that reaches a mutating route goes through one of these schemas, so nothing
// unvalidated can be persisted. Unknown keys are stripped (clients post whole records back), types/ranges/enums are enforced.
import { z } from 'zod'
import { PERMISSIONS, isValidTimeZone } from '../shared/settings'
import { HttpError } from './util'

export const COLORS = ['purple', 'blue', 'orange', 'green', 'pink', 'teal', 'red'] as const
export const PRIORITIES = ['Low', 'Medium', 'High'] as const
export const TASK_TYPES = ['Development', 'Design', 'Testing', 'Documentation'] as const
export const PROJECT_STATUSES = ['On track', 'At risk', 'Completed'] as const
export const PERSON_STATUSES = ['On track', 'Needs attention', 'At risk'] as const
export const MILESTONE_STATUSES = ['Upcoming', 'At risk', 'Complete', 'Completed'] as const
export const ALERT_TYPES = ['info', 'deadline', 'blocker', 'risk', 'overdue'] as const
export const ALERT_TONES = ['blue', 'orange', 'red', 'green', 'purple'] as const
export const REPORT_PERIODS = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const
export const ACTIVITY_PERIODS = ['daily', 'weekly', 'monthly'] as const

/** Run a schema and convert failures into a readable 400 (`"dueDate: Invalid ISO date"`). */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {})
  if (result.success) return result.data
  const issues = result.error.issues.map(issue => {
    const field = issue.path.map(String).join('.')
    return { field, message: issue.message }
  })
  const summary = issues
    .slice(0, 3)
    .map(issue => (issue.field ? `${issue.field}: ${issue.message}` : issue.message))
    .join('; ')
  throw new HttpError(400, `Invalid request. ${summary}`, 'VALIDATION_FAILED', issues)
}

const text = (max: number) => z.string().trim().max(max)
const required = (max: number) => z.string().trim().min(1, 'is required').max(max)
const id = z.string().trim().max(100)
const color = z.enum(COLORS)
const isoDate = z.iso.date()
/** An ISO date, or an empty string meaning "no date". */
const optionalDate = z.union([z.literal(''), isoDate])
const emailAddress = z
  .string()
  .trim()
  .max(254)
  .refine(value => z.email().safeParse(value).success, 'must be a valid email address')
const numericId = z.union([
  z.number().int().positive(),
  z.string().regex(/^\d+$/, 'must be a number').transform(Number)
])
const optionalNumericId = z.union([z.literal(''), z.null(), numericId])

export const customFields = z
  .record(
    z.string().regex(/^[\w.-]{1,64}$/, 'invalid field key'),
    z.union([z.string().max(2000), z.number(), z.boolean(), z.null()])
  )
  .refine(value => Object.keys(value).length <= 50, 'too many custom fields (max 50)')

// ---- auth ----------------------------------------------------------------------------------------------------------
export const loginSchema = z.object({ email: z.string().max(254), password: z.string().max(256) })
export const changePasswordSchema = z.object({
  currentPassword: z.string().max(256),
  newPassword: z.string().max(256)
})
export const setupSchema = z.object({
  name: required(120),
  email: emailAddress,
  password: z.string().max(256),
  token: z.string().max(200).optional(),
  includeDemo: z.boolean().optional(),
  workspaceName: text(120).optional(),
  workspaceUnit: text(120).optional(),
  settings: z.record(z.string(), z.unknown()).optional()
})

// ---- users ---------------------------------------------------------------------------------------------------------
export const userCreateSchema = z.object({
  name: required(120),
  email: emailAddress,
  password: z.string().max(256),
  role: text(40).optional(),
  personId: id.optional(),
  active: z.boolean().optional(),
  avatarColor: color.optional(),
  mustChangePassword: z.boolean().optional()
})
export const userUpdateSchema = z.object({
  name: required(120).optional(),
  email: emailAddress.optional(),
  role: text(40).optional(),
  personId: id.optional(),
  active: z.boolean().optional(),
  avatarColor: color.optional(),
  password: z.string().max(256).optional(),
  mustChangePassword: z.boolean().optional()
})

// ---- tasks ---------------------------------------------------------------------------------------------------------
const taskShape = {
  title: required(300),
  projectId: numericId,
  assigneeId: id,
  priority: z.enum(PRIORITIES),
  dueDate: optionalDate,
  status: text(40),
  type: z.enum(TASK_TYPES),
  blocked: z.boolean(),
  customFields
}
export const taskCreateSchema = z.object({ ...taskShape, title: required(300), projectId: numericId }).partial({
  assigneeId: true,
  priority: true,
  dueDate: true,
  status: true,
  type: true,
  blocked: true,
  customFields: true
})
export const taskUpdateSchema = z.object(taskShape).partial()
export const taskStatusSchema = z.object({ status: text(40).optional(), advance: z.boolean().optional() })

// ---- projects, people, teams, milestones ---------------------------------------------------------------------------
const projectCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,9}$/, 'must be 2-10 letters, digits, "-" or "_"')
const projectShape = {
  name: required(120),
  code: projectCode,
  description: text(2000),
  teamId: id,
  ownerId: id,
  color,
  status: z.enum(PROJECT_STATUSES),
  deadline: optionalDate,
  customFields
}
export const projectCreateSchema = z.object(projectShape).partial({
  code: true,
  description: true,
  teamId: true,
  ownerId: true,
  color: true,
  status: true,
  deadline: true,
  customFields: true
})
export const projectUpdateSchema = z.object(projectShape).partial()

const personShape = {
  name: required(120),
  email: z.union([z.literal(''), emailAddress]),
  jobTitle: text(120),
  teamId: id,
  focus: text(300),
  capacity: z.coerce.number().int().min(0).max(100),
  status: z.enum(PERSON_STATUSES),
  color,
  customFields
}
export const personCreateSchema = z.object(personShape).partial({
  email: true,
  jobTitle: true,
  teamId: true,
  focus: true,
  capacity: true,
  status: true,
  color: true,
  customFields: true
})
export const personUpdateSchema = z.object(personShape).partial()

const teamShape = { name: required(120), color, customFields }
export const teamCreateSchema = z.object(teamShape).partial({ color: true, customFields: true })
export const teamUpdateSchema = z.object(teamShape).partial()

const milestoneShape = {
  name: required(200),
  projectId: numericId,
  dueDate: isoDate,
  status: z.enum(MILESTONE_STATUSES),
  customFields
}
export const milestoneCreateSchema = z
  .object(milestoneShape)
  .partial({ dueDate: true, status: true, customFields: true })
export const milestoneUpdateSchema = z.object(milestoneShape).partial()

// ---- activity & alerts ---------------------------------------------------------------------------------------------
export const activityCreateSchema = z
  .object({
    personId: id.optional(),
    yesterday: text(5000).optional(),
    today: text(5000).optional(),
    blocked: text(5000).optional(),
    upcoming: text(5000).optional(),
    status: text(40).optional(),
    customFields: customFields.optional()
  })
  .refine(value => [value.yesterday, value.today, value.blocked, value.upcoming].some(part => part && part.length), {
    message: 'Write at least one update (yesterday, today, blocked or upcoming)'
  })

const alertShape = {
  title: required(200),
  body: text(2000),
  type: z.enum(ALERT_TYPES),
  tone: z.enum(ALERT_TONES),
  projectId: optionalNumericId,
  taskId: optionalNumericId,
  customFields
}
export const alertCreateSchema = z
  .object(alertShape)
  .partial({ body: true, type: true, tone: true, projectId: true, taskId: true, customFields: true })
export const alertPatchSchema = z.object({ ...alertShape, resolved: z.boolean() }).partial()

// ---- localization --------------------------------------------------------------------------------------------------
const languageCode = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'must be a language code such as "en" or "pt-BR"')
const translationKey = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(key => !['__proto__', 'constructor', 'prototype'].includes(key), 'reserved key name')
const translationValue = z.string().max(2000)
const catalog = z
  .record(translationKey, translationValue)
  .refine(value => Object.keys(value).length <= 5000, 'too many entries')
export const i18nMissingSchema = z.object({
  key: translationKey,
  language: languageCode.optional(),
  fallback: z.string().max(300).optional(),
  source: z.string().max(60).optional()
})
export const i18nRegisterSchema = z.object({
  namespace: z.string().trim().min(1).max(60),
  translations: z.record(languageCode, catalog).optional(),
  metadata: z
    .object({
      label: text(120).optional(),
      version: text(30).optional(),
      owner: text(60).optional(),
      status: text(30).optional(),
      route: text(200).optional()
    })
    .optional()
})
export const i18nTranslationSchema = z.object({
  language: languageCode,
  key: translationKey,
  value: translationValue.optional(),
  status: text(30).optional()
})
export const i18nBulkSchema = z
  .object({
    translations: z.record(languageCode, catalog).optional(),
    resources: z.record(languageCode, catalog).optional()
  })
  .refine(value => value.translations || value.resources, { message: 'Translation resources are required' })

// ---- settings (semantic checks; structure is normalised by shared/settings.ts) ---------------------------------------
const isObject = (value: unknown): value is Record<string, any> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** Returns a list of human-readable problems with a settings payload (empty when acceptable). */
export function settingsProblems(input: unknown): string[] {
  const problems: string[] = []
  if (!isObject(input)) return ['Settings must be a JSON object']
  const s: Record<string, any> = input
  const int = (value: unknown, min: number, max: number) =>
    Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max
  // `null` in a merge-patch removes the key (it falls back to its default), so only present, non-null values are checked.
  const given = (value: unknown) => value !== undefined && value !== null
  if (given(s.workspace?.defaultTimezone) && !isValidTimeZone(s.workspace.defaultTimezone))
    problems.push(
      `workspace.defaultTimezone "${String(s.workspace.defaultTimezone).slice(0, 40)}" is not a valid IANA time zone`
    )
  if (given(s.workspace?.weekStartsOn) && !['monday', 'sunday', 'saturday'].includes(s.workspace.weekStartsOn))
    problems.push('workspace.weekStartsOn must be monday, sunday or saturday')
  if (given(s.interface?.theme) && !['light', 'dark', 'system'].includes(s.interface.theme))
    problems.push('interface.theme must be light, dark or system')
  const pageSize = s.interface?.tableBehavior?.pageSize
  if (given(pageSize) && !int(pageSize, 10, 500))
    problems.push('interface.tableBehavior.pageSize must be a whole number from 10 to 500')
  if (given(s.security?.passwordMinLength) && !int(s.security.passwordMinLength, 8, 128))
    problems.push('security.passwordMinLength must be a whole number from 8 to 128')
  if (given(s.security?.sessionDays) && !int(s.security.sessionDays, 1, 90))
    problems.push('security.sessionDays must be a whole number from 1 to 90')
  if (given(s.audit?.retentionDays) && !int(s.audit.retentionDays, 30, 3650))
    problems.push('audit.retentionDays must be a whole number from 30 to 3650')
  if (given(s.audit?.workLogRetentionDays) && !int(s.audit.workLogRetentionDays, 0, 3650))
    problems.push('audit.workLogRetentionDays must be 0 (keep forever) or a whole number up to 3650')
  if (given(s.reports?.activityVisibility) && !['managers', 'everyone'].includes(s.reports.activityVisibility))
    problems.push('reports.activityVisibility must be "managers" or "everyone"')
  const languages = s.localization?.activeLanguages
  if (
    given(languages) &&
    (!Array.isArray(languages) || !languages.length || !languages.every(code => languageCode.safeParse(code).success))
  )
    problems.push('localization.activeLanguages must be a non-empty list of language codes')
  const roles = s.permissions?.roles
  if (given(roles)) {
    if (!isObject(roles)) problems.push('permissions.roles must be an object')
    else
      for (const [name, role] of Object.entries<any>(roles)) {
        if (!/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/.test(name) || name in Object.prototype)
          problems.push(`role name "${name.slice(0, 40)}" is not allowed`)
        else if (role === null) continue
        else if (!isObject(role)) problems.push(`role "${name}" must be an object`)
        else if (given(role.permissions)) {
          if (!Array.isArray(role.permissions)) problems.push(`role "${name}": permissions must be a list`)
          else {
            const unknown = role.permissions.filter(
              (permission: unknown) => !(PERMISSIONS as readonly string[]).includes(String(permission))
            )
            if (unknown.length) problems.push(`role "${name}": unknown permission(s) ${unknown.slice(0, 3).join(', ')}`)
          }
        }
      }
  }
  const states = s.workflows?.task?.states
  if (given(states)) {
    if (!Array.isArray(states) || !states.length) problems.push('workflows.task.states must be a non-empty list')
    else {
      const labels = states.map((state: any) =>
        String(typeof state === 'string' ? state : state?.label || state?.name || '')
          .trim()
          .toLowerCase()
      )
      if (labels.some((label: string) => !label)) problems.push('every workflow state needs a label')
      if (new Set(labels).size !== labels.length) problems.push('workflow state labels must be unique')
      if (labels.length > 20) problems.push('a workflow can have at most 20 states')
    }
  }
  return problems
}
