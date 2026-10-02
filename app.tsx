import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import { openSqliteDatabase } from './src/server/database/connection.js'
import { SqliteStoreRepository } from './src/server/database/store-repository.js'
import { UserPreferencesRepository } from './src/server/database/user-preferences-repository.js'
import { registerRoutes } from './src/server/routes/index.js'
import { createSettingsService } from './src/server/domain/settings.js'
import { createWorkspaceServices } from './src/server/domain/workspace.js'
import { createSecurityService, ROLE_PERMISSIONS } from './src/server/domain/security.js'
import { createStoreService } from './src/server/domain/store.js'
import { createTimeService, addDays, formatDate as fmt, daysBetween } from './src/server/domain/time.js'
import { boundedInteger, id, parseNumber, normalizeEmail, isValidEmail, validIsoDate, isValidTimezone, isPlainObject } from './src/server/shared/primitives.js'
import { createRateLimitMiddleware } from './src/server/http/rate-limit.js'
import { createAuthMiddleware } from './src/server/http/auth-middleware.js'
import { createWorkflowService } from './src/server/domain/workflows.js'

const root = process.env.ATLAS_ROOT || process.cwd()
const dataDir = process.env.ATLAS_DATA_DIR || path.join(root, 'data')
const staticDir = process.env.ATLAS_STATIC_DIR || path.join(root, 'dist')
const databaseFile = process.env.ATLAS_DB_PATH || path.join(dataDir, 'atlas.sqlite')
const legacyDataFile = path.join(dataDir, 'atlas-store.json')
let store = null
const loginRateLimits = new Map()
const setupRateLimits = new Map()
const i18nRateLimits = new Map()
const isProduction = process.env.NODE_ENV === 'production'
const allowDemoData = process.env.ATLAS_ALLOW_DEMO_DATA === 'true'
const cookieSecure = process.env.ATLAS_COOKIE_SECURE === 'true'
const STORE_SCHEMA_VERSION = '4.0.0'
const DATABASE_MODEL = 'sqlite-relational'
const DESIGN_SYSTEM_VERSION = '2.0.0'
const DEFAULT_BACKUP_RETENTION = boundedInteger(process.env.ATLAS_BACKUP_RETENTION, 25, 3, 100)
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 1024
const SESSION_TOKEN_BYTES = 32
const I18N_MISSING_LIMIT = 2000
const MAX_I18N_KEY_LENGTH = 200
const securityServices = createSecurityService({ getStore: () => store, boundedInteger, cookieSecure, minPasswordLength: MIN_PASSWORD_LENGTH, maxPasswordLength: MAX_PASSWORD_LENGTH, sessionTokenBytes: SESSION_TOKEN_BYTES })
const { sessions, configuredPasswordMinLength, sessionCookieOptions, newSession, invalidateUserSessions, hashPassword, verifyPassword, normalizeUserSecrets, validatePassword, permissionsFor, can, roleRank } = securityServices
function configuredBackupRetention() {
  return boundedInteger(typeof store !== 'undefined' ? store?.settings?.storage?.backupRetention : null, DEFAULT_BACKUP_RETENTION, 3, 100)
}
function ensureDir() { fs.mkdirSync(dataDir, { recursive: true }) }
const timeService = createTimeService({ getStore: () => store, environmentTimezone: process.env.ATLAS_TIMEZONE, isValidTimezone })
const { todayLA, timeLA } = timeService

const settingsService = createSettingsService({ ROLE_PERMISSIONS, boundedInteger, isPlainObject, isValidTimezone, id, env: process.env, DATABASE_MODEL, STORE_SCHEMA_VERSION, I18N_MISSING_LIMIT, DEFAULT_BACKUP_RETENTION, MIN_PASSWORD_LENGTH, cookieSecure, allowDemoData })
const { DEFAULT_NAVIGATION, DEFAULT_WORKFLOW_STATES, DEFAULT_TRANSLATIONS, ROLE_DESCRIPTIONS, roleRegistryDefaults, defaultSettings, mergeDeep, withLegacySettings, normalizeSettings, settingsInputError, slugifyState } = settingsService
const workflowService = createWorkflowService({ getStore: () => store, defaultTaskStates: DEFAULT_WORKFLOW_STATES })
const { taskWorkflowDefinitions, taskWorkflowStates, terminalTaskStates, isDone } = workflowService

const storeServices = createStoreService({ getStore: () => store, todayLA, timeLA, addDays, id, parseNumber, isPlainObject, defaultSettings, normalizeSettings, hashPassword, normalizeUserSecrets, allowDemoData, STORE_SCHEMA_VERSION, DATABASE_MODEL, DESIGN_SYSTEM_VERSION, configuredBackupRetention })
const { newStoreMeta, buildSeedWorkLogs, logWorkEvent, createActivityBlockerAlert, demoStore, ensureCollection, normalizeStore, productionStore, validateStoreState, storeChecksum } = storeServices
const databaseExistedBeforeStartup = fs.existsSync(databaseFile)
ensureDir()
const sqliteDatabase = openSqliteDatabase(databaseFile, { dataDirectory: dataDir })
const storeRepository = new SqliteStoreRepository(sqliteDatabase, {
  filePath: databaseFile,
  dataDirectory: dataDir,
  backupRetention: DEFAULT_BACKUP_RETENTION
})
const userPreferencesRepository = new UserPreferencesRepository(sqliteDatabase)
function listBackups() { return storeRepository.listBackups() }
function pruneBackups() { storeRepository.pruneBackups() }
function createBackup(reason = 'manual') {
  if (!storeRepository.hasSnapshot()) return null
  return storeRepository.createBackup(reason)
}
function saveStore(next, options = {}) {
  ensureDir()
  const normalized = normalizeStore(next)
  normalized.meta.writeCount = Number(normalized.meta.writeCount || 0) + (options.incrementWriteCount === false ? 0 : 1)
  normalized.meta.updatedAt = new Date().toISOString()
  storeRepository.writeSnapshot(normalized, {
    backup: options.backup === true && storeRepository.hasSnapshot(),
    backupReason: options.reason || 'write'
  })
  return normalized
}
function archiveLegacyStore() {
  const legacyDirectory = path.join(dataDir, 'legacy')
  fs.mkdirSync(legacyDirectory, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const archivedPath = path.join(legacyDirectory, `atlas-store-imported-${timestamp}.json`)
  try {
    fs.renameSync(legacyDataFile, archivedPath)
    return archivedPath
  } catch (error) {
    console.warn(`SQLite migration succeeded, but the legacy JSON file could not be archived: ${error.message}`)
    return legacyDataFile
  }
}
function loadStore() {
  if (storeRepository.hasSnapshot()) {
    const normalized = normalizeStore(storeRepository.loadSnapshot())
    return saveStore(normalized, { incrementWriteCount: false })
  }
  if (fs.existsSync(legacyDataFile)) {
    let parsed
    try { parsed = JSON.parse(fs.readFileSync(legacyDataFile, 'utf8')) }
    catch (error) {
      const corruptFile = path.join(dataDir, `atlas-store-corrupt-${Date.now()}.json`)
      fs.renameSync(legacyDataFile, corruptFile)
      console.error(`Legacy JSON store could not be parsed. Moved it to ${corruptFile}`)
      return saveStore(productionStore(), { incrementWriteCount: false })
    }
    const migrated = saveStore(normalizeStore(parsed), { incrementWriteCount: false })
    console.log(`Imported legacy JSON store into SQLite and archived the source at ${archiveLegacyStore()}`)
    return migrated
  }
  return saveStore(productionStore(), { incrementWriteCount: false })
}
if (process.argv.includes('--reset-data')) {
  if (!allowDemoData) {
    console.error('Refusing to install demo accounts/data. Set ATLAS_ALLOW_DEMO_DATA=true to enable this development-only reset.')
    sqliteDatabase.close()
    process.exit(1)
  }
  if (fs.existsSync(legacyDataFile)) archiveLegacyStore()
  saveStore(demoStore(), { backup: storeRepository.hasSnapshot(), reason: 'reset-data' })
  console.log(`Reset ${databaseFile} with development demo data`)
  sqliteDatabase.close()
  process.exit(0)
}
if (process.argv.includes('--init-production')) {
  const existingStore = databaseExistedBeforeStartup || storeRepository.hasSnapshot() || fs.existsSync(legacyDataFile)
  if (existingStore && process.env.ATLAS_FORCE_INIT_PRODUCTION !== 'true') {
    console.error(`Refusing to replace existing data at ${databaseFile}. Back it up and set ATLAS_FORCE_INIT_PRODUCTION=true only if a destructive reset is intended.`)
    sqliteDatabase.close()
    process.exit(1)
  }
  if (fs.existsSync(legacyDataFile)) archiveLegacyStore()
  saveStore(productionStore(), { backup: storeRepository.hasSnapshot(), reason: 'init-production' })
  console.log(`Initialized ${databaseFile} for production first-run setup`)
  sqliteDatabase.close()
  process.exit(0)
}
if (process.argv.includes('--backup-data')) {
  if (!storeRepository.hasSnapshot() && fs.existsSync(legacyDataFile)) loadStore()
  const backup = createBackup('manual')
  console.log(backup ? `Created backup ${backup}` : `No SQLite store found at ${databaseFile}`)
  sqliteDatabase.close()
  process.exit(0)
}
store = loadStore()
let lastCommittedStore = structuredClone(store)
function persist(options = {}) {
  try {
    store = saveStore(store, { backup: process.env.ATLAS_BACKUP_ON_WRITE === 'true', reason: options.reason || 'persist' })
    lastCommittedStore = structuredClone(store)
  } catch (error) {
    try {
      const committedSnapshot = storeRepository.loadSnapshot()
      store = committedSnapshot ? normalizeStore(committedSnapshot) : structuredClone(lastCommittedStore)
    } catch (restoreError) {
      store = structuredClone(lastCommittedStore)
      error.restoreError = restoreError
    }
    throw error
  }
}
function auditLog(action, actorId = '', detail = {}) {
  const audit = store?.settings?.audit || {}
  if (audit.enabled === false) return
  if (action.startsWith('export.') && audit.trackExports === false) return
  if (action.startsWith('read.') && audit.trackReads !== true) return
  if (!action.startsWith('auth.') && !action.startsWith('read.') && !action.startsWith('export.') && audit.trackWrites === false) return
  store.auditLogs = store.auditLogs || []
  store.auditLogs.push({ id: id('audit'), action, actorId, detail, createdAt: new Date().toISOString(), source: 'api' })
  const retentionDays = boundedInteger(audit.retentionDays, 365, 1, 3650)
  const cutoff = Date.now() - retentionDays * 86400000
  store.auditLogs = store.auditLogs.filter(event => !event.createdAt || Date.parse(event.createdAt) >= cutoff)
}
function auditRead(action, userId) {
  if (store?.settings?.audit?.enabled === false || store?.settings?.audit?.trackReads !== true) return
  auditLog(`read.${action}`, userId, {})
  persist({ reason: 'audit-read' })
}

const workspaceServices = createWorkspaceServices({ getStore: () => store, todayLA, addDays, fmt, daysBetween, isPlainObject, validIsoDate, permissionsFor, can, isDone, terminalTaskStates })
const { teamById, personById, projectById, taskById, validText, validEmail, validDateValue, validOptionalDate, validCustomFields, customFieldInputError, personReferenceExists, teamReferenceExists, projectReferenceExists, taskReferenceExists, publicUser, publicAccessUser, dueTone, dueLabel, projectProgress, projectHealth, taskPublic, projectPublic, personPublic, activityPublic, alertPublic, bucketFor, makeBuckets, reportFor, dashboard, settingsForUser, bootstrapFor, workLogPublic, bucketLabel, isCompletionEvent, completedTaskIds, activityReportFor, nextProjectId, nextTaskId } = workspaceServices
function createDatabaseExportContext() {
  const snapshot = storeRepository.loadSnapshot()
  if (!snapshot) throw new Error('SQLite workspace is not initialized')
  const getSnapshot = () => snapshot
  const databaseTime = createTimeService({ getStore: getSnapshot, environmentTimezone: process.env.ATLAS_TIMEZONE, isValidTimezone })
  const databaseWorkflow = createWorkflowService({ getStore: getSnapshot, defaultTaskStates: DEFAULT_WORKFLOW_STATES })
  const workspace = createWorkspaceServices({
    getStore: getSnapshot, todayLA: databaseTime.todayLA, addDays, fmt, daysBetween, isPlainObject, validIsoDate,
    permissionsFor, can, isDone: databaseWorkflow.isDone, terminalTaskStates: databaseWorkflow.terminalTaskStates
  })
  return { snapshot, workspace, today: databaseTime.todayLA() }
}
function sendError(res, status, error) { res.status(status).json({ error }) }
const { rateLimitMiddleware } = createRateLimitMiddleware({ sendError })
const authMiddleware = createAuthMiddleware({ getStore: () => store, sessions, can, invalidateUserSessions, sendError })
const { requireUser, requirePermission, requireManager, requireAdmin } = authMiddleware
const app = express()
app.set('trust proxy', boundedInteger(process.env.ATLAS_TRUST_PROXY_HOPS, 0, 0, 5))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'")
  }
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  const origin = req.headers.origin
  if (mutating && req.path.startsWith('/api/') && origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== String(req.headers.host || '').toLowerCase()) return sendError(res, 403, 'Cross-origin mutation is not allowed')
    } catch { return sendError(res, 403, 'Invalid request origin') }
  }
  next()
})
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use('/api', (req, res, next) => {
  if (req.body !== undefined && !isPlainObject(req.body)) return sendError(res, 400, 'Request body must be a JSON object')
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body === undefined) return sendError(res, 400, 'A JSON object request body is required')
  next()
})

const storeView = new Proxy(Object.create(null), {
  get(_target, property) { return store == null ? undefined : Reflect.get(store, property) },
  set(_target, property, value) {
    if (store == null) throw new Error('Workspace state is not initialized')
    return Reflect.set(store, property, value)
  },
  has(_target, property) { return store != null && Reflect.has(store, property) },
  ownKeys() { return store == null ? [] : Reflect.ownKeys(store) },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = store == null ? undefined : Reflect.getOwnPropertyDescriptor(store, property)
    return descriptor ? { ...descriptor, configurable: true } : undefined
  }
})
const routeServices = {
  store: storeView, getStore: () => store, setStore: (nextStore) => { store = nextStore },
  root, databaseFile, DATABASE_MODEL, STORE_SCHEMA_VERSION, DESIGN_SYSTEM_VERSION, configuredBackupRetention, allowDemoData,
  rateLimitMiddleware, setupRateLimits, loginRateLimits, i18nRateLimits, sendError, normalizeEmail, isValidEmail, validatePassword,
  configuredPasswordMinLength, settingsInputError, mergeDeep, defaultSettings, normalizeSettings, hashPassword, todayLA, timeLA,
  publicUser, newSession, sessionCookieOptions, auditLog, persist, can, storeRepository, userPreferencesRepository, listBackups, auditRead, storeChecksum, createDatabaseExportContext,
  validateStoreState, requireUser, requireAdmin, requirePermission, createBackup, roleRank, publicAccessUser, verifyPassword,
  invalidateUserSessions, sessions, normalizeUserSecrets, projectById, validText, MAX_PASSWORD_LENGTH, activityReportFor, reportFor,
  bootstrapFor, settingsForUser, demoStore, id, MAX_I18N_KEY_LENGTH, I18N_MISSING_LIMIT, isPlainObject, path,
  validOptionalDate, personReferenceExists, customFieldInputError, nextProjectId, nextTaskId, taskPublic, projectPublic, taskById, taskWorkflowStates,
  terminalTaskStates, isDone, logWorkEvent, taskReferenceExists, validDateValue, dueTone, validEmail, teamReferenceExists,
  projectReferenceExists, personById, personPublic, activityPublic, alertPublic, createActivityBlockerAlert, requireManager, teamById
}
registerRoutes(app, routeServices)
app.use((error, req, res, next) => {
  if (!req.path.startsWith('/api')) return next(error)
  if (res.headersSent) return next(error)
  const status = [400, 413, 415].includes(Number(error.status)) ? Number(error.status) : 500
  if (status >= 500) console.error('Atlas API request failed:', error)
  const message = status === 413 ? 'Request body is too large' : status === 415 ? 'Unsupported request content type' : status === 400 ? 'Invalid JSON request body' : 'An internal server error occurred'
  res.status(status).json({ error: message })
})

const port = Number(process.env.PORT || 5173)
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(staticDir))
  app.use((req, res) => res.sendFile(path.join(staticDir, 'index.html')))
} else {
  const { createServer: createViteServer } = await import('vite')
  const vite = await createViteServer({ root: process.env.ATLAS_SOURCE_ROOT || root, server: { middlewareMode: true, host: '0.0.0.0', allowedHosts: true }, appType: 'spa' })
  app.use(vite.middlewares)
}
const host = process.env.ATLAS_HOST || process.env.HOST || (isProduction ? '127.0.0.1' : '0.0.0.0')
app.listen(port, host, () => {
  console.log(`Atlas Workspace listening on http://${host}:${port}`)
  if (allowDemoData) console.log('Development demo data enabled via ATLAS_ALLOW_DEMO_DATA=true')
  else console.log(`Production-safe mode: no default or demo credentials; ${store.configured ? 'workspace configured' : 'first-run setup required'}`)
})
