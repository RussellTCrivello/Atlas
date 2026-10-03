// Reading the JSON document store that Atlas used before it moved to SQL (atlas-store.json and the backups of it).
// Nothing here writes to disk: a legacy document is parsed, checked, brought up to the last document version (the old
// versioned migrations) and normalised into a Snapshot, which db/snapshot.ts then loads into SQLite. The code is kept
// verbatim from the JSON era so that every store the old versions could write can still be opened.
import fs from 'node:fs'
import {
  STORE_SCHEMA_VERSION,
  compactSettingsForStorage,
  isPlainObject,
  normalizeSettings
} from '../../shared/settings'
import type { AtlasConfig } from '../config'
import { taskKey } from '../domain/keys'
import { deriveLedger } from '../domain/ledger'
import type { StoreState } from '../domain/types'
import { hashPasswordSync } from '../security/passwords'
import { StoreCorruptError, StoreTooNewError } from './errors'

export function compareVersions(a: string, b: string): number {
  const pa = String(a || '0.0.0')
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0)
  const pb = String(b || '0.0.0')
    .split('.')
    .map(part => Number.parseInt(part, 10) || 0)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1
  }
  return 0
}

// ---- migrations ----------------------------------------------------------------------------------------------------
interface Migration {
  to: string
  description: string
  up(raw: any, config: Pick<AtlasConfig, 'defaultTimezone'>): void
}

/**
 * Each migration receives the parsed (not yet normalised) store and mutates it in place. A pre-migration backup of the
 * raw file is taken by the caller before any migration runs. Migrations must be idempotent.
 */
export const MIGRATIONS: Migration[] = [
  {
    to: '3.1.0',
    description:
      'Remove back-filled work-log rows and invented effort minutes, freeze task keys, derive real ledger rows from recorded task/activity timestamps, drop frozen built-in translation catalogs',
    up(raw) {
      const arrayOf = (key: string) => (Array.isArray(raw[key]) ? raw[key] : (raw[key] = []))
      const logs = arrayOf('workLogs')
      // Rows named wl_seed_* / wl_activity_* were synthesised by the old normaliser for tasks and activities that had no
      // events (with made-up clock times and effort). Real events (id "worklog_*") are kept; their `minutes` were fixed
      // constants per action type, never measured, so the field is removed everywhere.
      raw.workLogs = logs
        .filter((row: any) => !/^wl_(seed|activity)_/.test(String(row?.id || '')))
        .map((row: any) => {
          const { minutes: _minutes, ...rest } = row || {}
          return { source: 'Task event', ...rest }
        })
      const projects = new Map(arrayOf('projects').map((project: any) => [project.id, project]))
      arrayOf('tasks').forEach((task: any) => {
        if (!task.key) task.key = taskKey(projects.get(task.projectId) as any, Number(task.id))
      })
      if (raw.meta) delete raw.meta.backupRetention
    }
  }
]

export function pendingMigrations(fromVersion: string): Migration[] {
  return MIGRATIONS.filter(migration => compareVersions(fromVersion, migration.to) < 0)
}

// ---- normalisation -------------------------------------------------------------------------------------------------
const ensureArray = (target: any, key: string) => {
  if (!Array.isArray(target[key])) target[key] = []
}

/**
 * Bring a parsed store to the current in-memory shape. Cheap and idempotent: it only repairs structure (missing
 * collections, counters, defaults) and never invents data. Runs at load time, not on every write.
 */
export function normalizeState(raw: any, config: Pick<AtlasConfig, 'defaultTimezone'>): StoreState {
  const next = isPlainObject(raw) ? raw : {}
  const existingMeta = isPlainObject(next.meta) ? next.meta : {}
  const now = new Date().toISOString()
  next.meta = {
    ...existingMeta,
    createdAt: existingMeta.createdAt || now,
    updatedAt: existingMeta.updatedAt || now,
    writeCount: Number(existingMeta.writeCount || 0),
    lastMigrationAt: existingMeta.lastMigrationAt || now,
    schemaVersion: STORE_SCHEMA_VERSION
  }
  next.settings = compactSettingsForStorage(
    normalizeSettings(next.settings || {}, { timezone: config.defaultTimezone })
  )
  ;[
    'users',
    'teams',
    'people',
    'projects',
    'tasks',
    'milestones',
    'activities',
    'alerts',
    'workLogs',
    'auditLogs'
  ].forEach(key => ensureArray(next, key))
  let maxProject = 0
  for (const project of next.projects) maxProject = Math.max(maxProject, Number(project?.id) || 0)
  let maxTask = 0
  for (const task of next.tasks) maxTask = Math.max(maxTask, Number(task?.id) || 0)
  next.counters = {
    project: Math.max(Number(next.counters?.project || 1), maxProject + 1),
    task: Math.max(Number(next.counters?.task || 1), maxTask + 1)
  }
  const projectsById = new Map<any, any>(next.projects.map((project: any) => [project.id, project]))
  for (const task of next.tasks) {
    task.blocked = Boolean(task.blocked)
    if (!task.key) task.key = taskKey(projectsById.get(task.projectId), Number(task.id))
  }
  const peopleById = new Map<any, any>(next.people.map((person: any) => [person.id, person]))
  for (const user of next.users) {
    user.role = user.role || 'Viewer'
    user.active = user.active !== false
    user.avatarColor = user.avatarColor || peopleById.get(user.personId)?.color || 'purple'
    // Pre-1.0 stores could hold a plain-text password; convert it once and drop it.
    if (user.password && !user.passwordHash) user.passwordHash = hashPasswordSync(String(user.password))
    delete user.password
  }
  next.configured = typeof next.configured === 'boolean' ? next.configured : next.users.length > 0
  return next as StoreState
}

/** Derive ledger rows for records that have none (only used right after a migration or when seeding demo data). */
export function backfillLedger(state: StoreState): number {
  const rows = deriveLedger(state)
  state.workLogs.push(...rows)
  return rows.length
}

// ---- integrity -----------------------------------------------------------------------------------------------------
export interface ValidationResult {
  integrity: 'ok' | 'warning' | 'attention'
  errors: string[]
  warnings: string[]
}

export function validateStoreState(candidate: StoreState): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const collections = [
    'users',
    'teams',
    'people',
    'projects',
    'tasks',
    'milestones',
    'activities',
    'alerts',
    'workLogs',
    'auditLogs'
  ] as const
  collections.forEach(key => {
    if (!Array.isArray((candidate as any)?.[key])) errors.push(`${key} must be an array`)
  })
  if (candidate?.meta?.schemaVersion !== STORE_SCHEMA_VERSION)
    warnings.push(`Store schema is ${candidate?.meta?.schemaVersion || 'missing'}; expected ${STORE_SCHEMA_VERSION}`)
  if (!candidate?.settings?.workspace || !candidate?.settings?.interface || !candidate?.settings?.localization)
    errors.push('Settings must include workspace, interface, and localization configuration branches')
  if (!candidate?.settings?.workflows?.task?.states?.length) errors.push('Task workflow must define at least one state')
  const adminRole = candidate?.settings?.permissions?.roles?.Administrator
  if (!adminRole?.permissions?.includes('manageSettings'))
    errors.push('Administrator role must retain manageSettings permission')
  if (errors.length && collections.some(key => !Array.isArray((candidate as any)?.[key])))
    return { integrity: 'attention', errors, warnings }

  const duplicates = (items: any[], getter: (item: any) => string, label: string) => {
    const seen = new Set<string>()
    for (const item of items) {
      const value = getter(item)
      if (!value) continue
      if (seen.has(value)) errors.push(`Duplicate ${label}: ${value}`)
      seen.add(value)
    }
  }
  duplicates(
    candidate.users,
    user =>
      String(user.email || '')
        .trim()
        .toLowerCase(),
    'user email'
  )
  duplicates(candidate.users, user => String(user.id || ''), 'user id')
  duplicates(candidate.people, person => person.id, 'person id')
  duplicates(candidate.projects, project => String(project.id), 'project id')
  duplicates(candidate.tasks, task => String(task.id), 'task id')
  duplicates(candidate.projects, project => String(project.code || '').toUpperCase(), 'project code')
  const peopleIds = new Set(candidate.people.map(person => person.id))
  const teamIds = new Set(candidate.teams.map(team => team.id))
  const projectIds = new Set(candidate.projects.map(project => String(project.id)))
  const taskIds = new Set(candidate.tasks.map(task => String(task.id)))
  const linkedPeople = new Map<string, string>()
  for (const person of candidate.people)
    if (person.teamId && !teamIds.has(person.teamId))
      warnings.push(`Person ${person.name || person.id} references a missing team`)
  for (const user of candidate.users) {
    if ((user as any).password && !user.passwordHash)
      errors.push(`User ${user.email || user.id} still has a plain-text password field`)
    if (user.personId && !peopleIds.has(user.personId))
      warnings.push(`User ${user.email || user.id} references a missing person profile`)
    if (user.personId) {
      if (linkedPeople.has(user.personId))
        warnings.push(`Users ${linkedPeople.get(user.personId)} and ${user.email || user.id} share one person profile`)
      else linkedPeople.set(user.personId, String(user.email || user.id))
    }
  }
  for (const project of candidate.projects) {
    if (project.teamId && !teamIds.has(project.teamId))
      warnings.push(`Project ${project.name || project.id} references a missing team`)
    if (project.ownerId && !peopleIds.has(project.ownerId))
      warnings.push(`Project ${project.name || project.id} references a missing owner`)
  }
  for (const task of candidate.tasks) {
    if (!projectIds.has(String(task.projectId)))
      warnings.push(`Task ${task.title || task.id} references a missing project`)
    if (task.assigneeId && !peopleIds.has(task.assigneeId))
      warnings.push(`Task ${task.title || task.id} references a missing assignee`)
  }
  for (const milestone of candidate.milestones)
    if (milestone.projectId && !projectIds.has(String(milestone.projectId)))
      warnings.push(`Milestone ${milestone.name || milestone.id} references a missing project`)
  for (const alert of candidate.alerts) {
    if (alert.projectId && !projectIds.has(String(alert.projectId)))
      warnings.push(`Alert ${alert.title || alert.id} references a missing project`)
    if (alert.taskId && !taskIds.has(String(alert.taskId)))
      warnings.push(`Alert ${alert.title || alert.id} references a missing task`)
  }
  return { integrity: errors.length ? 'attention' : warnings.length ? 'warning' : 'ok', errors, warnings }
}

// ---- reading a legacy file ----------------------------------------------------------------------------------------
/** Parse + schema-check a legacy store file. Returns the normalised state or throws with a reason. */
export function readLegacyStoreFile(
  file: string,
  config: Pick<AtlasConfig, 'defaultTimezone'>
): { state: StoreState; migrated: boolean; raw: any } {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new StoreCorruptError(`Cannot read ${file}: ${(error as Error).message}`, file)
  }
  let raw: any
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new StoreCorruptError(`${file} is not valid JSON (${(error as Error).message})`, file)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new StoreCorruptError(`${file} does not contain a store object`, file)
  const version = String(raw.meta?.schemaVersion || '0.0.0')
  if (compareVersions(version, STORE_SCHEMA_VERSION) > 0)
    throw new StoreTooNewError(
      `${file} was written by a newer Atlas (schema ${version}; this build understands up to ${STORE_SCHEMA_VERSION}). Upgrade Atlas, or restore an older backup.`
    )
  const migrations = pendingMigrations(version)
  migrations.forEach(migration => migration.up(raw, config))
  const state = normalizeState(raw, config)
  if (migrations.length) backfillLedger(state)
  return { state, migrated: migrations.length > 0, raw }
}
