// Administration: users, settings, localization, system health/backups, exports, reports and the bootstrap payload.
import path from 'node:path'
import type { Express, Request } from 'express'
import { z } from 'zod'
import {
  STORE_SCHEMA_VERSION,
  DATABASE_MODEL,
  compactSettingsForStorage,
  mergePatch,
  normalizeSettings
} from '../../shared/settings'
import { buildTranslationCatalog } from '../../shared/i18n/catalog'
import { hashPassword, validatePassword } from '../auth'
import { appendAudit, verifyAuditChain } from '../audit'
import { DESIGN_SYSTEM_VERSION } from '../config'
import {
  buildIndex,
  can,
  canSeePeopleAnalytics,
  isAdministrator,
  permissionsFor,
  roleExists,
  roleRank,
  todayIn,
  workflowDefinitions
} from '../domain'
import { publicAccessUser } from '../presenters'
import { type ActivityScope, activityReportFor, reportFor } from '../reports'
import {
  ACTIVITY_PERIODS,
  REPORT_PERIODS,
  i18nBulkSchema,
  i18nMissingSchema,
  i18nRegisterSchema,
  i18nTranslationSchema,
  parse,
  settingsProblems,
  userCreateSchema,
  userUpdateSchema
} from '../schemas'
import type { StoreState, User } from '../types'
import { HttpError, badRequest, clientIp, conflict, forbidden, handler, id, normalizeEmail, notFound } from '../util'
import { bootstrapFor, settingsForClient, translationCatalogPayload } from '../views'
import { type Deps, auditContext, requirePermission, sessionHashOf, userOf } from './context'

export function registerPublicInfoRoutes(app: Express, deps: Deps) {
  const { config, db } = deps
  app.get('/api/health', (_req, res) => {
    const health = db.health()
    res.status(health.writable ? 200 : 503).json({
      ok: health.writable,
      name: 'Atlas Workspace',
      version: config.version,
      mode: config.isProduction ? 'production' : 'development',
      storage: { writable: health.writable, lastSavedAt: health.lastSavedAt },
      time: new Date().toISOString()
    })
  })
}

export function registerRuntimeConfig(app: Express, deps: Deps, isAdminRequest: (req: Request) => boolean) {
  const { config, db } = deps
  app.get('/api/runtime-config', (req, res) => {
    const base = {
      packagingMode: config.isProduction ? 'production-web' : 'development-web',
      designSystem: { version: DESIGN_SYSTEM_VERSION, localFonts: true, externalUiAssets: false },
      packaging: { web: true, pwa: true, localAssets: true }
    }
    if (!isAdminRequest(req)) return void res.json(base)
    res.json({
      ...base,
      database: {
        fileName: path.relative(config.appRoot, db.file),
        storeModel: DATABASE_MODEL,
        schemaVersion: STORE_SCHEMA_VERSION,
        atomicWrites: true,
        backupRetention: config.backupRetention
      }
    })
  })
}

/** Is there still at least one active user who can administer the workspace after this change? */
function adminsAfter(state: StoreState, settings: any, userId: string, change: Partial<User> | 'delete'): number {
  return state.users.filter(user => {
    if (user.id === userId) {
      if (change === 'delete') return false
      return isAdministrator(settings, { ...user, ...change })
    }
    return isAdministrator(settings, user)
  }).length
}

/**
 * Tasks store their status as the state's label, so editing the workflow must keep them attached to their state:
 * states are matched by id, a renamed state carries its tasks along, and a removed state that still has tasks is refused.
 * Returns old-label -> new-label renames to apply once the new settings are accepted.
 */
function workflowRenames(state: StoreState, next: any): Map<string, string> {
  const before = workflowDefinitions(state.settings) as { id: string; label: string }[]
  const after = workflowDefinitions(next) as { id: string; label: string }[]
  const afterById = new Map(after.map(entry => [entry.id, entry]))
  const afterLabels = new Set(after.map(entry => entry.label))
  const renames = new Map<string, string>()
  for (const old of before) {
    const kept = afterById.get(old.id)
    if (kept && kept.label !== old.label) renames.set(old.label, kept.label)
    if (!kept && !afterLabels.has(old.label)) {
      const used = state.tasks.filter(task => task.status === old.label).length
      if (used)
        throw badRequest(
          `The status "${old.label}" is used by ${used} task(s). Rename it instead, or move those tasks to another status first.`
        )
    }
  }
  return renames
}
function applyRenames(state: StoreState, renames: Map<string, string>) {
  if (!renames.size) return
  for (const task of state.tasks) task.status = renames.get(task.status) ?? task.status
}

export function registerAdminRoutes(app: Express, deps: Deps) {
  const { db, sessions } = deps
  const need = (permission: string | string[], message?: string) => requirePermission(deps, permission, message)
  const settingsOf = () => db.state.settings

  // ============================== read endpoints ==============================
  app.get('/api/bootstrap', (req, res) => res.json(bootstrapFor(db.state, userOf(req))))
  app.get('/api/revision', (_req, res) => res.json({ revision: db.revision, serverTime: new Date().toISOString() }))

  app.get('/api/reports/activity/:period', need('viewReports'), (req, res) => {
    const user = userOf(req)
    const settings = settingsOf()
    const period = parse(z.enum(ACTIVITY_PERIODS), req.params.period)
    const requested = String(req.query.userId || 'all')
    // Per-person analytics are visible to people managers (and administrators), or to everyone when the workspace
    // opted in (Settings > Reports). Everyone can always see their own activity.
    const everyone = canSeePeopleAnalytics(settings, user)
    let scope: ActivityScope = { onlyPersonId: null, label: 'All users' }
    if (!everyone) {
      if (requested !== 'all' && requested !== user.personId)
        throw forbidden('You can only view your own activity. Ask a manager for team reports.')
      scope = { onlyPersonId: user.personId || '__none__', label: 'Your activity' }
    }
    // Checked after the visibility rule, so a restricted caller cannot probe which person ids exist (VAL-03).
    if (requested !== 'all' && !db.state.people.some(person => person.id === requested))
      throw notFound('Person not found')
    if (settings.audit?.trackReads)
      deps.audit.push('report.viewed', auditContext(req), { report: 'activity', period, userId: requested })
    const limit = Math.min(5000, Math.max(1, Math.trunc(Number(req.query.limit)) || 500))
    res.json(activityReportFor(buildIndex(db.state), period, requested, scope, limit))
  })

  app.get('/api/reports/:period', need('viewReports'), (req, res) => {
    const period = parse(z.enum(REPORT_PERIODS), String(req.params.period).toLowerCase())
    res.json(reportFor(buildIndex(db.state), period))
  })

  // ============================== exports (client side) ==============================
  // Exports are generated in the browser from data the user can already read, so this endpoint cannot prevent copying.
  // It does enforce the exportData permission at the moment of export and records the event in the audit trail.
  app.post(
    '/api/exports/audit',
    need('exportData', 'Your role is not allowed to export data'),
    handler((req, res) => {
      const body = parse(
        z.object({
          page: z.string().max(40),
          format: z.enum(['csv', 'xlsx', 'json', 'pdf', 'print']),
          rows: z.number().int().min(0).max(10_000_000),
          columns: z.number().int().min(0).max(200)
        }),
        req.body
      )
      if (settingsOf().audit?.trackExports !== false) deps.audit.push('data.exported', auditContext(req), body)
      res.json({ ok: true })
    })
  )

  // ============================== users ==============================
  app.get('/api/users', need('manageUsers'), (_req, res) => {
    const index = buildIndex(db.state)
    res.json(db.state.users.map(user => publicAccessUser(index, user)))
  })

  const assertRank = (actor: User, role: string) => {
    if (roleRank(settingsOf(), role) > roleRank(settingsOf(), actor.role))
      throw forbidden(`You cannot grant or change the "${role}" role: it outranks your own.`)
  }
  const assertEmailFree = (state: StoreState, email: string, exceptId?: string) => {
    if (state.users.some(user => user.id !== exceptId && normalizeEmail(user.email) === normalizeEmail(email)))
      throw conflict('A user with this email already exists', 'DUPLICATE_EMAIL')
  }
  const assertPersonFree = (state: StoreState, personId: string, exceptId?: string) => {
    if (!state.people.some(person => person.id === personId))
      throw badRequest('The selected person profile does not exist')
    if (state.users.some(user => user.id !== exceptId && user.personId === personId))
      throw conflict('That person profile already belongs to another account', 'PERSON_ALREADY_LINKED')
  }

  app.post(
    '/api/users',
    need('manageUsers'),
    handler(async (req, res) => {
      const actor = userOf(req)
      const body = parse(userCreateSchema, req.body)
      const settings = settingsOf()
      const role = body.role || 'Viewer'
      if (!roleExists(settings, role)) throw badRequest('Unknown role')
      assertRank(actor, role)
      assertEmailFree(db.state, body.email)
      if (body.personId) assertPersonFree(db.state, body.personId)
      const weak = validatePassword(body.password, {
        minLength: settings.security.passwordMinLength,
        email: body.email,
        name: body.name
      })
      if (weak) throw new HttpError(400, weak, 'WEAK_PASSWORD')
      const passwordHash = await hashPassword(body.password)
      const created = db.commit(
        state => {
          assertEmailFree(state, body.email)
          if (body.personId) assertPersonFree(state, body.personId)
          let personId = body.personId
          if (!personId) {
            let teamId = state.teams[0]?.id
            if (!teamId) {
              teamId = id('team')
              state.teams.push({ id: teamId, name: 'Workspace', color: 'purple', sample: false })
            }
            personId = id('person')
            state.people.push({
              id: personId,
              name: body.name,
              email: body.email,
              jobTitle: role,
              teamId,
              focus: 'Workspace access',
              capacity: 70,
              status: 'On track',
              color: body.avatarColor || 'purple',
              sample: false
            })
          }
          const user: User = {
            id: id('user'),
            name: body.name,
            email: body.email,
            passwordHash,
            role,
            personId,
            avatarColor: body.avatarColor || 'purple',
            active: body.active !== false,
            createdAt: new Date().toISOString(),
            passwordChangedAt: new Date().toISOString(),
            // An administrator chose this password, so the person must replace it at first sign-in.
            mustChangePassword: body.mustChangePassword !== false,
            sample: false
          }
          state.users.push(user)
          appendAudit(state, 'user.created', auditContext(req), { userId: user.id, role })
          return publicAccessUser(buildIndex(state), user)
        },
        { reason: 'user-create' }
      )
      res.json(created)
    })
  )

  app.put(
    '/api/users/:id',
    need('manageUsers'),
    handler(async (req, res) => {
      const actor = userOf(req)
      const settings = settingsOf()
      const target = db.state.users.find(user => user.id === req.params.id)
      if (!target) throw notFound('User not found')
      const body = parse(userUpdateSchema, req.body)
      if (roleRank(settings, target.role) > roleRank(settings, actor.role))
        throw forbidden('You cannot modify an account that outranks yours.')
      if (target.id === actor.id && body.active === false) throw badRequest('You cannot disable your own account')
      if (body.role !== undefined) {
        if (!roleExists(settings, body.role)) throw badRequest('Unknown role')
        assertRank(actor, body.role)
      }
      if (body.email !== undefined) assertEmailFree(db.state, body.email, target.id)
      if (body.personId !== undefined && body.personId !== target.personId)
        assertPersonFree(db.state, body.personId, target.id)
      const patch: Partial<User> = {}
      if (body.name !== undefined) patch.name = body.name
      if (body.email !== undefined) patch.email = body.email
      if (body.role !== undefined) patch.role = body.role
      if (body.personId !== undefined) patch.personId = body.personId
      if (body.avatarColor !== undefined) patch.avatarColor = body.avatarColor
      if (body.active !== undefined) patch.active = body.active
      if (adminsAfter(db.state, settings, target.id, patch) === 0)
        throw badRequest('That change would leave the workspace without an active administrator')
      let passwordHash: string | undefined
      if (body.password) {
        const weak = validatePassword(body.password, {
          minLength: settings.security.passwordMinLength,
          email: patch.email || target.email,
          name: patch.name || target.name
        })
        if (weak) throw new HttpError(400, weak, 'WEAK_PASSWORD')
        passwordHash = await hashPassword(body.password)
      }
      const updated = db.commit(
        state => {
          const user = state.users.find(candidate => candidate.id === target.id)
          if (!user) throw notFound('User not found')
          if (patch.email !== undefined) assertEmailFree(state, patch.email, user.id)
          if (adminsAfter(state, state.settings, user.id, patch) === 0)
            throw badRequest('That change would leave the workspace without an active administrator')
          const before = { role: user.role, active: user.active }
          Object.assign(user, patch)
          if (passwordHash) {
            user.passwordHash = passwordHash
            user.passwordChangedAt = new Date().toISOString()
            user.mustChangePassword = body.mustChangePassword !== false
          } else if (body.mustChangePassword !== undefined) user.mustChangePassword = body.mustChangePassword
          appendAudit(state, 'user.updated', auditContext(req), {
            userId: user.id,
            roleFrom: before.role,
            roleTo: user.role,
            activeFrom: before.active,
            activeTo: user.active,
            passwordReset: Boolean(passwordHash)
          })
          return publicAccessUser(buildIndex(state), user)
        },
        { reason: 'user-update' }
      )
      // A reset password or a disabled account must stop working immediately, everywhere.
      if (passwordHash || patch.active === false)
        sessions.revokeUser(target.id, target.id === actor.id ? sessionHashOf(req) : undefined)
      res.json(updated)
    })
  )

  app.delete(
    '/api/users/:id',
    need('manageUsers'),
    handler((req, res) => {
      const actor = userOf(req)
      const settings = settingsOf()
      const target = db.state.users.find(user => user.id === req.params.id)
      if (!target) throw notFound('User not found')
      if (target.id === actor.id) throw badRequest('You cannot delete your own account')
      if (roleRank(settings, target.role) > roleRank(settings, actor.role))
        throw forbidden('You cannot delete an account that outranks yours.')
      if (adminsAfter(db.state, settings, target.id, 'delete') === 0)
        throw badRequest('You cannot delete the last active administrator')
      db.commit(
        state => {
          state.users = state.users.filter(user => user.id !== target.id)
          appendAudit(state, 'user.deleted', auditContext(req), {
            userId: target.id,
            email: target.email,
            role: target.role
          })
        },
        { reason: 'user-delete' }
      )
      sessions.revokeUser(target.id)
      res.json({ ok: true })
    })
  )

  // ============================== settings ==============================
  const applySettings = (state: StoreState, next: any) => {
    const compact = compactSettingsForStorage(next)
    if (!state.users.some(user => isAdministrator(compact, user)))
      throw badRequest('That change would leave the workspace without an active administrator')
    state.settings = compact
  }

  app.put(
    '/api/settings',
    need('manageSettings', 'Administrator access required'),
    handler((req, res) => {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null
      if (!body) throw badRequest('Settings must be a JSON object')
      const problems = settingsProblems(body)
      if (problems.length) throw new HttpError(400, `Invalid settings. ${problems[0]}`, 'VALIDATION_FAILED', problems)
      const updated = db.commit(
        state => {
          // RFC 7386 merge-patch: only the leaves present in the body change; `null` resets a key to its default.
          const merged = mergePatch(state.settings, body)
          let next = normalizeSettings(merged, { timezone: deps.config.defaultTimezone })
          const renames = workflowRenames(state, next)
          if (renames.size && body.workflows?.task?.transitions === undefined) {
            // The request renamed states but did not restate the transitions: carry the stored ones along.
            merged.workflows.task.transitions = (merged.workflows.task.transitions || []).map((t: any) => ({
              ...t,
              from: renames.get(t.from) ?? t.from,
              to: renames.get(t.to) ?? t.to
            }))
            next = normalizeSettings(merged, { timezone: deps.config.defaultTimezone })
          }
          const security = ['security', 'audit'].filter(
            branch =>
              body[branch] !== undefined && JSON.stringify(state.settings[branch]) !== JSON.stringify(next[branch])
          )
          const detail: Record<string, unknown> = {
            branches: Object.keys(body).filter(key => typeof body[key] === 'object')
          }
          security.forEach(branch => (detail[branch] = { from: state.settings[branch], to: next[branch] }))
          applySettings(state, next)
          applyRenames(state, renames)
          if (renames.size) detail.statusRenames = Object.fromEntries(renames)
          appendAudit(state, 'settings.updated', auditContext(req), detail)
          return settingsForClient(state.settings, true)
        },
        { reason: 'settings' }
      )
      res.json(updated)
    })
  )

  const requireTransfer = () => {
    if (settingsOf().storage?.importExportEnabled === false)
      throw new HttpError(403, 'Settings import and export are turned off (Settings > System).', 'TRANSFER_DISABLED')
  }
  app.get('/api/settings/export', need('manageSettings', 'Administrator access required'), (_req, res) => {
    requireTransfer()
    res.json({ exportedAt: new Date().toISOString(), schemaVersion: STORE_SCHEMA_VERSION, settings: db.state.settings })
  })

  app.post(
    '/api/settings/import',
    need('manageSettings', 'Administrator access required'),
    handler((req, res) => {
      requireTransfer()
      const incoming = req.body?.settings ?? req.body
      const problems = settingsProblems(incoming)
      if (problems.length)
        throw new HttpError(400, `Invalid settings file. ${problems[0]}`, 'VALIDATION_FAILED', problems)
      const next = normalizeSettings(incoming, { timezone: deps.config.defaultTimezone })
      if (!db.state.users.some(user => isAdministrator(next, user)))
        throw badRequest('Importing these settings would leave the workspace without an active administrator')
      const updated = db.commit(
        state => {
          const renames = workflowRenames(state, next)
          applySettings(state, next)
          applyRenames(state, renames)
          appendAudit(state, 'settings.imported', auditContext(req), { keys: Object.keys(incoming) })
          return settingsForClient(state.settings, true)
        },
        { reason: 'settings-import', backupFirst: 'pre-settings-import' }
      )
      res.json(updated)
    })
  )

  // ============================== localization ==============================
  app.get('/api/i18n/missing', need('manageSettings', 'Administrator access required'), (_req, res) =>
    res.json({ keys: deps.missingKeys.list() })
  )
  app.delete('/api/i18n/missing', need('manageSettings', 'Administrator access required'), (_req, res) => {
    deps.missingKeys.clear()
    res.json({ ok: true })
  })

  app.get(
    '/api/settings/translations/missing',
    need('manageSettings', 'Administrator access required'),
    (_req, res) => {
      const localization = settingsOf().localization || {}
      const builtin = buildTranslationCatalog()
      const catalogFor = (lang: string) => ({ ...(builtin[lang] || {}), ...(localization.translations?.[lang] || {}) })
      const fallback = localization.fallbackLanguage || 'en'
      const base = Object.keys(catalogFor(fallback))
      const missing = Object.fromEntries(
        (localization.activeLanguages || []).map((lang: string) => [lang, base.filter(key => !catalogFor(lang)[key])])
      )
      const totalMissing = Object.values(missing).reduce((sum: number, rows: any) => sum + rows.length, 0)
      res.json({ fallback, keys: base, missing, totalMissing, byLanguage: missing })
    }
  )

  app.post('/api/i18n/missing', (req, res) => {
    const body = parse(i18nMissingSchema, req.body)
    const localization = settingsOf().localization || {}
    if (localization.runtime?.reportMissing === false) return void res.json({ ok: true, ignored: true })
    deps.missingKeys.add({
      key: body.key,
      language: body.language || localization.defaultLanguage || 'en',
      fallback: body.fallback,
      source: body.source
    })
    res.json({ ok: true })
  })

  const mergeCatalogs = (state: StoreState, resources: Record<string, Record<string, string>>) => {
    const localization = state.settings.localization
    localization.translations = localization.translations || {}
    for (const [language, catalog] of Object.entries(resources)) {
      localization.translations[language] = { ...(localization.translations[language] || {}), ...catalog }
      if (!localization.activeLanguages.includes(language)) localization.activeLanguages.push(language)
    }
  }
  const renormalize = (state: StoreState) => {
    state.settings = compactSettingsForStorage(
      normalizeSettings(state.settings, { timezone: deps.config.defaultTimezone })
    )
  }

  app.post(
    '/api/i18n/register',
    need('manageSettings', 'Administrator access required'),
    handler((req, res) => {
      const body = parse(i18nRegisterSchema, req.body)
      const namespace = body.namespace.replace(/[^a-zA-Z0-9_.-]+/g, '_')
      const translations = (body.translations || {}) as Record<string, Record<string, string>>
      const metadata = body.metadata || {}
      db.commit(
        state => {
          const localization = state.settings.localization
          mergeCatalogs(state, translations)
          const fallbackLanguage = localization.fallbackLanguage || 'en'
          localization.interfaces = {
            ...(localization.interfaces || {}),
            [namespace]: {
              namespace,
              label: metadata.label || namespace,
              version: metadata.version || '1.0.0',
              owner: metadata.owner || 'custom',
              status: metadata.status || 'active',
              route: metadata.route || '',
              registeredAt: new Date().toISOString(),
              keys: Object.keys(translations[fallbackLanguage] || translations.en || {})
            }
          }
          localization.translationMemory = [
            ...(localization.translationMemory || []),
            {
              namespace,
              action: 'registered',
              languages: Object.keys(translations),
              userId: userOf(req).id,
              at: new Date().toISOString()
            }
          ]
          renormalize(state)
          appendAudit(state, 'i18n.interface.registered', auditContext(req), {
            namespace,
            languages: Object.keys(translations)
          })
        },
        { reason: 'i18n-register' }
      )
      res.json({ ok: true, namespace, catalog: translationCatalogPayload(settingsOf()) })
    })
  )

  app.put(
    '/api/i18n/translation',
    need('manageSettings', 'Administrator access required'),
    handler((req, res) => {
      const body = parse(i18nTranslationSchema, req.body)
      const value = body.value ?? ''
      const status = body.status || 'approved'
      db.commit(
        state => {
          mergeCatalogs(state, { [body.language]: { [body.key]: value } })
          const localization = state.settings.localization
          localization.approvalWorkflow = localization.approvalWorkflow || { enabled: true, statusByKey: {} }
          localization.approvalWorkflow.statusByKey = {
            ...(localization.approvalWorkflow.statusByKey || {}),
            [body.key]: status
          }
          renormalize(state)
          appendAudit(state, 'i18n.translation.updated', auditContext(req), {
            language: body.language,
            key: body.key,
            status
          })
        },
        { reason: 'i18n-translation' }
      )
      deps.missingKeys.clear()
      res.json({ ok: true, language: body.language, key: body.key, value, status })
    })
  )

  app.post(
    '/api/i18n/bulk',
    need('manageSettings', 'Administrator access required'),
    handler((req, res) => {
      const body = parse(i18nBulkSchema, req.body)
      const resources = (body.translations || body.resources || {}) as Record<string, Record<string, string>>
      db.commit(
        state => {
          mergeCatalogs(state, resources)
          const localization = state.settings.localization
          localization.translationMemory = [
            ...(localization.translationMemory || []),
            {
              action: 'bulk-import',
              languages: Object.keys(resources),
              userId: userOf(req).id,
              at: new Date().toISOString()
            }
          ]
          renormalize(state)
          appendAudit(state, 'i18n.bulk.imported', auditContext(req), { languages: Object.keys(resources) })
        },
        { reason: 'i18n-bulk' }
      )
      res.json({ ok: true, catalog: translationCatalogPayload(settingsOf()) })
    })
  )

  // ============================== system ==============================
  app.get('/api/system', need('manageSettings', 'Administrator access required'), (_req, res) => {
    const state = db.state
    const validation = db.validate()
    const backups = db.listBackups()
    const chain = db.memo('auditChain', () => verifyAuditChain(state))
    const sampleRows = [
      ...state.people,
      ...state.projects,
      ...state.tasks,
      ...state.activities,
      ...state.alerts,
      ...state.workLogs,
      ...state.users
    ].filter((row: any) => row.sample).length
    res.json({
      ok: validation.integrity === 'ok' && chain.ok && db.health().writable,
      integrity: validation.integrity,
      errors: validation.errors,
      warnings: validation.warnings,
      checksum: db.checksum(),
      auditChain: chain,
      storage: db.health(),
      store: {
        fileName: path.relative(deps.config.appRoot, db.file),
        storeModel: DATABASE_MODEL,
        schemaVersion: STORE_SCHEMA_VERSION,
        meta: state.meta,
        backups: backups.slice(0, 5).map(backup => ({
          file: backup.file,
          createdAt: backup.createdAt,
          reason: backup.reason,
          size: backup.size
        })),
        backupCount: backups.length,
        sampleRows,
        livePeople: state.people.filter(person => !person.sample).length
      },
      counts: {
        teams: state.teams.length,
        people: state.people.length,
        projects: state.projects.length,
        tasks: state.tasks.length,
        activity: state.activities.length,
        alerts: state.alerts.length,
        workLogs: state.workLogs.length,
        auditLogs: state.auditLogs.length
      }
    })
  })

  app.post(
    '/api/system/backup',
    need('manageSettings', 'Administrator access required'),
    handler((req, res) => {
      const backup = db.createBackup('manual', { required: true })
      deps.audit.push('system.backup.created', auditContext(req), { backup: backup && path.basename(backup) })
      res.json({ ok: Boolean(backup), backup: backup && path.basename(backup) })
    })
  )

  app.get('/api/audit', need('manageSettings', 'Administrator access required'), (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100))
    const index = buildIndex(db.state, { light: true })
    const names = new Map(db.state.users.map(user => [user.id, user.name]))
    const rows = db.state.auditLogs
      .slice(-limit)
      .reverse()
      .map(entry => ({
        id: entry.id,
        action: entry.action,
        actor: names.get(entry.actorId) || entry.actorId || 'system',
        createdAt: entry.createdAt,
        ip: entry.ip || '',
        detail: entry.detail
      }))
    res.json({ rows, total: db.state.auditLogs.length, chain: verifyAuditChain(db.state), today: index.today })
  })

  app.delete(
    '/api/setup/seed',
    need('removeDemoData'),
    handler((req, res) => {
      const settings = settingsOf()
      const real = db.state.users.filter(user => !user.sample && isAdministrator(settings, user))
      if (!real.length)
        throw new HttpError(
          409,
          'Create your own administrator account first: demo accounts are removed together with the demo data.',
          'NEEDS_REAL_ADMIN'
        )
      const removedUsers = db.state.users.filter(user => user.sample).map(user => user.id)
      db.commit(
        state => {
          state.tasks = state.tasks.filter(task => !task.sample)
          state.projects = state.projects.filter(project => !project.sample)
          state.milestones = state.milestones.filter(milestone => !milestone.sample)
          state.activities = state.activities.filter(activity => !activity.sample)
          state.alerts = state.alerts.filter(alert => !alert.sample)
          state.workLogs = state.workLogs.filter(log => !log.sample)
          state.users = state.users.filter(user => !user.sample)
          const keepPersonIds = new Set(state.users.map(user => user.personId))
          state.people = state.people.filter(person => !person.sample || keepPersonIds.has(person.id))
          state.teams = state.teams.filter(
            team => !team.sample || state.people.some(person => person.teamId === team.id)
          )
          appendAudit(state, 'demo-data.removed', auditContext(req), { accountsRemoved: removedUsers.length })
        },
        { reason: 'remove-demo', backupFirst: 'pre-remove-demo' }
      )
      removedUsers.forEach(userId => sessions.revokeUser(userId))
      res.json({ ok: true, accountsRemoved: removedUsers.length })
    })
  )
}

export { clientIp, permissionsFor, todayIn }
