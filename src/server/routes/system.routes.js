export function registerSystemRoutes(app, services) {
  const { store, getStore, setStore, root, databaseFile, DATABASE_MODEL, STORE_SCHEMA_VERSION, DESIGN_SYSTEM_VERSION, configuredBackupRetention, allowDemoData, rateLimitMiddleware, setupRateLimits, loginRateLimits, i18nRateLimits, sendError, normalizeEmail, isValidEmail, validatePassword, configuredPasswordMinLength, settingsInputError, mergeDeep, defaultSettings, normalizeSettings, hashPassword, todayLA, timeLA, publicUser, newSession, sessionCookieOptions, auditLog, persist, can, storeRepository, listBackups, auditRead, storeChecksum, validateStoreState, requireUser, requireAdmin, requirePermission, createBackup, roleRank, publicAccessUser, verifyPassword, invalidateUserSessions, sessions, normalizeUserSecrets, projectById, validText, MAX_PASSWORD_LENGTH, activityReportFor, reportFor, bootstrapFor, settingsForUser, demoStore, id, MAX_I18N_KEY_LENGTH, I18N_MISSING_LIMIT, isPlainObject, path } = services
app.get('/api/health', (req, res) => res.json({ ok: true, name: 'Atlas Workspace', version: '1.0.0', mode: process.env.NODE_ENV || 'development', desktopReady: process.env.ATLAS_DESKTOP === 'true', time: new Date().toISOString() }))
app.get('/api/runtime-config', (req, res) => {
  const databaseInfo = storeRepository.databaseInfo()
  res.json({
    packagingMode: process.env.ATLAS_DESKTOP === 'true' ? 'electron-desktop' : process.env.NODE_ENV === 'production' ? 'production-web' : 'development-web',
    designSystem: { version: DESIGN_SYSTEM_VERSION, localFonts: true, externalUiAssets: false },
    database: { engine: databaseInfo.engine, engineVersion: databaseInfo.version, fileName: path.relative(root, databaseFile), storeModel: DATABASE_MODEL, schemaVersion: databaseInfo.schemaVersion, dataSchemaVersion: STORE_SCHEMA_VERSION, journalMode: databaseInfo.journalMode, transactionalWrites: true, backupRetention: configuredBackupRetention() },
    packaging: { web: true, pwa: true, localAssets: true }
  })
})
app.get('/api/setup/status', (req, res) => res.json({
  configured: Boolean(store.configured || store.users.length),
  demoAllowed: allowDemoData,
  demo: allowDemoData ? {
    email: 'maya@atlas.local',
    password: 'atlas-demo',
    accounts: [
      { email: 'maya@atlas.local', password: 'atlas-demo', role: 'Administrator', name: 'Maya Chen' },
      { email: 'manager@atlas.local', password: 'manager-demo', role: 'Manager', name: 'Noah Reed' },
      { email: 'developer@atlas.local', password: 'developer-demo', role: 'Developer', name: 'Lina Patel' },
      { email: 'viewer@atlas.local', password: 'viewer-demo', role: 'Viewer', name: 'Omar Haddad' }
    ]
  } : null
}))
app.post('/api/setup', rateLimitMiddleware(setupRateLimits, 5, 60 * 60 * 1000), (req, res) => {
  if (store.configured || store.users.length > 0) return sendError(res, 409, 'Workspace setup has already been completed')
  const { name, email, password, includeDemo = false, workspaceName, workspaceUnit, settings = {} } = req.body
  const cleanName = typeof name === 'string' ? name.trim() : ''
  const cleanEmail = normalizeEmail(email)
  if (!cleanName || cleanName.length > 120 || !isValidEmail(cleanEmail) || !validatePassword(password)) return sendError(res, 400, `Name, valid email, and a password of at least ${configuredPasswordMinLength()} characters are required`)
  if (settingsInputError(settings)) return sendError(res, 400, settingsInputError(settings))
  const cleanWorkspaceName = typeof workspaceName === 'string' && workspaceName.trim() ? workspaceName.trim() : (settings.workspace?.name || 'Atlas Workspace')
  const cleanWorkspaceUnit = typeof workspaceUnit === 'string' && workspaceUnit.trim() ? workspaceUnit.trim() : (settings.workspace?.unit || 'Operations')
  if (cleanWorkspaceName.length > 120 || cleanWorkspaceUnit.length > 120) return sendError(res, 400, 'Workspace name and unit must be 120 characters or fewer')

  const previousStore = getStore()
  const hasExistingRecords = ['users', 'teams', 'people', 'projects', 'tasks', 'milestones', 'activities', 'alerts', 'workLogs', 'auditLogs'].some(key => Array.isArray(previousStore?.[key]) && previousStore[key].length > 0)
  if (includeDemo === true && allowDemoData && hasExistingRecords) return sendError(res, 409, 'Demo data can only be added to an empty workspace; existing workspace records have been preserved')
  const nextStore = includeDemo === true && allowDemoData ? demoStore() : structuredClone(previousStore)
  if (nextStore.users.some(user => normalizeEmail(user.email) === cleanEmail)) return sendError(res, 409, 'A user with this email already exists in the selected sample data')
  const existingPerson = nextStore.people.find(person => normalizeEmail(person.email) === cleanEmail)
  let personId = existingPerson?.id
  if (!personId) {
    const existingTeam = nextStore.teams.find(team => String(team.name || '').trim().toLowerCase() === cleanWorkspaceUnit.toLowerCase())
    const teamId = existingTeam?.id || id('team')
    if (!existingTeam) nextStore.teams.push({ id: teamId, name: cleanWorkspaceUnit, color: 'purple', sample: false })
    personId = id('person')
    nextStore.people.push({ id: personId, name: cleanName, email: cleanEmail, jobTitle: 'Workspace Administrator', teamId, focus: 'Workspace setup', capacity: 75, status: 'On track', color: 'purple', sample: false })
  }
  const user = { id: id('user'), name: cleanName, email: cleanEmail, passwordHash: hashPassword(password), role: 'Administrator', personId, avatarColor: 'purple', active: true, createdAt: new Date().toISOString(), sample: false }
  nextStore.users.push(user)
  nextStore.settings = normalizeSettings(mergeDeep(nextStore.settings, settings))
  nextStore.settings.workspace.name = cleanWorkspaceName
  nextStore.settings.workspace.unit = cleanWorkspaceUnit
  nextStore.settings.workspaceName = cleanWorkspaceName
  nextStore.settings.workspaceUnit = cleanWorkspaceUnit
  nextStore.configured = true
  setStore(nextStore)
  auditLog('workspace.setup.completed', user.id, { workspaceName: cleanWorkspaceName, workspaceUnit: cleanWorkspaceUnit })
  try { persist({ reason: 'setup' }) } catch (error) { setStore(previousStore); throw error }
  const sid = newSession(user.id)
  res.cookie('atlas_sid', sid, sessionCookieOptions())
  res.json({ setup: { configured: true }, user: publicUser(user) })
})
app.post('/api/auth/login', rateLimitMiddleware(loginRateLimits, 20, 15 * 60 * 1000), (req, res) => {
  const { email, password } = req.body
  const normalized = normalizeEmail(email)
  const user = store.users.find(candidate => normalizeEmail(candidate.email) === normalized)
  if (!user || typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH || !verifyPassword(password, user)) return sendError(res, 401, 'Invalid email or password')
  if (user.active === false) return sendError(res, 403, 'This account is disabled. Contact an administrator.')
  if (user.password && !user.passwordHash) normalizeUserSecrets(user)
  user.lastLoginAt = new Date().toISOString()
  auditLog('auth.login', user.id, { email: user.email })
  persist({ reason: 'login' })
  const sid = newSession(user.id)
  res.cookie('atlas_sid', sid, sessionCookieOptions())
  res.json({ user: publicUser(user) })
})
app.post('/api/auth/logout', (req, res) => {
  const sessionId = req.cookies.atlas_sid
  if (sessionId) sessions.delete(sessionId)
  res.clearCookie('atlas_sid', sessionCookieOptions())
  res.json({ ok: true })
})
app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }))
app.get('/api/bootstrap', requireUser, (req, res) => {
  auditRead('bootstrap', req.user.id)
  res.json(bootstrapFor(req.user))
})
app.get('/api/reports/:period', requireUser, requirePermission('viewReports'), (req, res) => {
  auditRead('report', req.user.id)
  res.json(reportFor(req.params.period))
})
app.get('/api/reports/activity/:period', requireUser, requirePermission('viewReports'), (req, res) => {
  auditRead('activity-report', req.user.id)
  res.json(activityReportFor(req.params.period, req.query.userId || 'all'))
})
app.post('/api/audit/export', requireUser, requirePermission('exportData'), (req, res) => {
  const { title, format, rowCount } = req.body
  if (!validText(title, 200) || !['csv', 'xlsx', 'json', 'pdf', 'print'].includes(format) || !Number.isInteger(rowCount) || rowCount < 0 || rowCount > 1000000) return sendError(res, 400, 'A title, supported export format, and valid row count are required')
  auditLog('export.data', req.user.id, { title: title.trim(), format, rowCount })
  persist({ reason: 'export-audit' })
  res.json({ ok: true })
})
app.get('/api/system', requireUser, requireAdmin, (req, res) => {
  auditRead('system', req.user.id)
  const validation = validateStoreState(store)
  const databaseIntegrity = storeRepository.integrity()
  const backups = listBackups()
  if (!databaseIntegrity.ok) validation.errors.push('SQLite integrity check failed')
  validation.integrity = validation.errors.length ? 'attention' : validation.warnings.length ? 'warning' : 'ok'
  res.json({ ok: validation.integrity === 'ok', integrity: validation.integrity, errors: validation.errors, warnings: validation.warnings, databaseIntegrity, checksum: storeChecksum(store), store: { fileName: path.relative(root, databaseFile), storeModel: DATABASE_MODEL, schemaVersion: STORE_SCHEMA_VERSION, databaseSchemaVersion: storeRepository.databaseInfo().schemaVersion, meta: store.meta, backups: backups.slice(0, 5).map(backup => ({ file: backup.file, createdAt: backup.createdAt })), backupCount: backups.length, sampleRows: [...store.people, ...store.projects, ...store.tasks, ...store.activities, ...store.alerts, ...(store.workLogs || [])].filter(row => row.sample).length, livePeople: store.people.filter(p => !p.sample).length }, counts: storeRepository.tableCounts() })
})
app.get('/api/settings/export', requireUser, requireAdmin, (req, res) => {
  if (store.settings.storage.importExportEnabled === false) return sendError(res, 403, 'Configuration export is disabled by workspace policy')
  auditRead('settings-export', req.user.id)
  auditLog('export.settings', req.user.id, { format: 'json' })
  persist({ reason: 'settings-export' })
  res.json({ exportedAt: new Date().toISOString(), schemaVersion: STORE_SCHEMA_VERSION, settings: store.settings })
})
app.post('/api/settings/import', requireUser, requireAdmin, (req, res) => {
  if (store.settings.storage.importExportEnabled === false) return sendError(res, 403, 'Configuration import is disabled by workspace policy')
  const imported = req.body.settings || req.body
  const error = settingsInputError(imported)
  if (error) return sendError(res, 400, error)
  store.settings = normalizeSettings(imported)
  auditLog('settings.imported', req.user.id, { keys: Object.keys(imported) })
  persist({ reason: 'settings-import' })
  res.json(store.settings)
})
function translationCatalogPayload(language = null) {
  const localization = store.settings.localization || {}
  const fallback = localization.fallbackLanguage || 'en'
  const selected = language || localization.defaultLanguage || store.settings.language || fallback || 'en'
  const fallbackCatalog = localization.translations?.[fallback] || {}
  const selectedCatalog = localization.translations?.[selected] || {}
  return {
    language: selected,
    fallbackLanguage: fallback,
    direction: localization.textDirectionByLanguage?.[selected] || (['ar', 'fa', 'he', 'ur'].includes(selected) ? 'rtl' : 'ltr'),
    catalog: { ...fallbackCatalog, ...selectedCatalog },
    fallbackCatalog,
    languages: localization.languagePackages || [],
    activeLanguages: localization.activeLanguages || [],
    interfaces: localization.interfaces || {},
    keyPolicy: localization.keyPolicy || {},
    runtime: localization.runtime || {},
    generatedAt: new Date().toISOString()
  }
}
app.get('/api/settings/translations/missing', requireUser, requireAdmin, (req, res) => {
  auditRead('missing-translations', req.user.id)
  const localization = store.settings.localization || {}
  const fallback = localization.fallbackLanguage || 'en'
  const baseKeys = Object.keys(localization.translations?.[fallback] || {})
  const missing = Object.fromEntries((localization.activeLanguages || []).map(lang => [lang, baseKeys.filter(key => !localization.translations?.[lang]?.[key])]))
  const totalMissing = Object.values(missing).reduce((sum, rows) => sum + rows.length, 0)
  res.json({ fallback, keys: baseKeys, missing, totalMissing, byLanguage: missing })
})
app.get('/api/i18n/catalog', (req, res) => res.json(translationCatalogPayload(req.query.language || req.query.lang || null)))
app.post('/api/i18n/missing', rateLimitMiddleware(i18nRateLimits, 30, 10 * 60 * 1000), (req, res) => {
  if (!store.configured) return res.json({ ok: true, ignored: true })
  const localization = store.settings.localization || {}
  if (localization.runtime?.reportMissing === false) return res.json({ ok: true, ignored: true })
  const key = typeof req.body.key === 'string' ? req.body.key.trim() : ''
  if (!key) return res.json({ ok: true, ignored: true })
  if (key.length > MAX_I18N_KEY_LENGTH) return sendError(res, 400, `Translation keys may not exceed ${MAX_I18N_KEY_LENGTH} characters`)
  const language = typeof req.body.language === 'string' ? req.body.language.trim() : String(localization.defaultLanguage || 'en')
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)) return sendError(res, 400, 'Invalid language code')
  const now = new Date().toISOString()
  const row = { key, language, fallback: String(req.body.fallback || '').slice(0, 500), source: String(req.body.source || 'runtime').slice(0, 100), firstSeenAt: now, lastSeenAt: now, count: 1, status: 'missing' }
  localization.missingKeys = Array.isArray(localization.missingKeys) ? localization.missingKeys.slice(-I18N_MISSING_LIMIT) : []
  const existing = localization.missingKeys.find(item => item.key === key && item.language === language)
  if (existing) { existing.lastSeenAt = now; existing.count = Math.min(I18N_MISSING_LIMIT, Number(existing.count || 0) + 1); if (row.fallback) existing.fallback = row.fallback }
  else {
    if (localization.missingKeys.length >= I18N_MISSING_LIMIT) localization.missingKeys.shift()
    localization.missingKeys.push(row)
  }
  store.settings.localization = localization
  persist({ reason: 'i18n-missing' })
  res.json({ ok: true })
})
app.post('/api/i18n/register', requireUser, requireAdmin, (req, res) => {
  const namespace = String(req.body?.namespace || '').trim().replace(/[^a-zA-Z0-9_.-]+/g, '_')
  if (!namespace) return sendError(res, 400, 'Translation namespace is required')
  const translations = req.body?.translations || {}
  const metadata = req.body?.metadata || {}
  const localization = store.settings.localization || {}
  localization.translations = localization.translations || {}
  localization.activeLanguages = Array.isArray(localization.activeLanguages) ? localization.activeLanguages : ['en']
  Object.entries(translations).forEach(([language, catalog]) => {
    if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return
    localization.translations[language] = { ...(localization.translations[language] || {}), ...catalog }
    if (!localization.activeLanguages.includes(language)) localization.activeLanguages.push(language)
  })
  localization.interfaces = mergeDeep(localization.interfaces || {}, { [namespace]: { namespace, label: metadata.label || namespace, version: metadata.version || '1.0.0', owner: metadata.owner || 'custom', status: metadata.status || 'active', route: metadata.route || '', registeredAt: new Date().toISOString(), keys: Object.keys(translations?.[localization.fallbackLanguage || 'en'] || translations?.en || {}) } })
  localization.translationMemory = Array.isArray(localization.translationMemory) ? localization.translationMemory : []
  localization.translationMemory.push({ namespace, action: 'registered', languages: Object.keys(translations), userId: req.user.id, at: new Date().toISOString() })
  store.settings.localization = localization
  store.settings = normalizeSettings(store.settings)
  auditLog('i18n.interface.registered', req.user.id, { namespace, languages: Object.keys(translations) })
  persist({ reason: 'i18n-register' })
  res.json({ ok: true, namespace, catalog: translationCatalogPayload() })
})
app.put('/api/i18n/translation', requireUser, requireAdmin, (req, res) => {
  const language = String(req.body?.language || '').trim()
  const key = String(req.body?.key || '').trim()
  const value = String(req.body?.value ?? '')
  const status = String(req.body?.status || 'approved')
  if (!language || !key) return sendError(res, 400, 'Language and key are required')
  const localization = store.settings.localization || {}
  localization.translations = localization.translations || {}
  localization.activeLanguages = Array.isArray(localization.activeLanguages) ? localization.activeLanguages : ['en']
  if (!localization.activeLanguages.includes(language)) localization.activeLanguages.push(language)
  localization.translations[language] = { ...(localization.translations[language] || {}), [key]: value }
  localization.approvalWorkflow = localization.approvalWorkflow || { enabled: true, statusByKey: {} }
  localization.approvalWorkflow.statusByKey = { ...(localization.approvalWorkflow.statusByKey || {}), [key]: status }
  localization.missingKeys = (localization.missingKeys || []).filter(row => !(row.key === key && row.language === language))
  store.settings.localization = localization
  store.settings = normalizeSettings(store.settings)
  auditLog('i18n.translation.updated', req.user.id, { language, key, status })
  persist({ reason: 'i18n-translation' })
  res.json({ ok: true, language, key, value, status })
})
app.post('/api/i18n/bulk', requireUser, requireAdmin, (req, res) => {
  const resources = req.body?.translations || req.body?.resources || {}
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) return sendError(res, 400, 'Translation resources are required')
  const localization = store.settings.localization || {}
  localization.translations = localization.translations || {}
  localization.activeLanguages = Array.isArray(localization.activeLanguages) ? localization.activeLanguages : ['en']
  Object.entries(resources).forEach(([language, catalog]) => { if (catalog && typeof catalog === 'object' && !Array.isArray(catalog)) { localization.translations[language] = { ...(localization.translations[language] || {}), ...catalog }; if (!localization.activeLanguages.includes(language)) localization.activeLanguages.push(language) } })
  localization.translationMemory = Array.isArray(localization.translationMemory) ? localization.translationMemory : []
  localization.translationMemory.push({ action: 'bulk-import', languages: Object.keys(resources), userId: req.user.id, at: new Date().toISOString() })
  store.settings.localization = localization
  store.settings = normalizeSettings(store.settings)
  auditLog('i18n.bulk.imported', req.user.id, { languages: Object.keys(resources) })
  persist({ reason: 'i18n-bulk' })
  res.json({ ok: true, catalog: translationCatalogPayload() })
})
app.post('/api/system/backup', requireUser, requireAdmin, (req, res) => {
  const backup = createBackup('admin')
  auditLog('system.backup.created', req.user.id, { backup: backup && path.basename(backup) })
  persist({ reason: 'backup-audit' })
  res.json({ ok: Boolean(backup), backup: backup && path.basename(backup) })
})
app.put('/api/settings', requireUser, requireAdmin, (req, res) => {
  const error = settingsInputError(req.body)
  if (error) return sendError(res, 400, error)
  store.settings = normalizeSettings(mergeDeep(store.settings, req.body))
  auditLog('settings.updated', req.user.id, { branches: Object.keys(req.body) })
  persist({ reason: 'settings' })
  res.json(store.settings)
})
app.delete('/api/setup/seed', requireUser, requireAdmin, (req, res) => {
  const retainedTaskIds = new Set(store.tasks.filter(task => !task.sample).map(task => String(task.id)))
  const retainedProjectIds = new Set([
    ...store.tasks.filter(task => !task.sample).map(task => String(task.projectId)),
    ...store.milestones.filter(row => !row.sample).map(row => String(row.projectId)),
    ...store.alerts.filter(row => !row.sample).map(row => String(row.projectId || ''))
  ].filter(Boolean))
  store.tasks = store.tasks.filter(task => !task.sample)
  store.projects = store.projects.filter(project => !project.sample || retainedProjectIds.has(String(project.id)))
  store.projects.forEach(project => { if (project.sample && retainedProjectIds.has(String(project.id))) project.sample = false })
  store.milestones = store.milestones.filter(row => !row.sample && projectById(row.projectId))
  store.activities = store.activities.filter(row => !row.sample)
  store.alerts = store.alerts.filter(row => !row.sample && (!row.taskId || retainedTaskIds.has(String(row.taskId))) && (!row.projectId || projectById(row.projectId)))
  store.workLogs = (store.workLogs || []).filter(log => !log.sample && (!log.taskId || retainedTaskIds.has(String(log.taskId))))
  const referencedPeople = new Set([
    ...store.users.map(user => String(user.personId || '')),
    ...store.tasks.map(task => String(task.assigneeId || '')),
    ...store.projects.map(project => String(project.ownerId || '')),
    ...store.activities.map(activity => String(activity.personId || '')),
    ...store.workLogs.map(log => String(log.personId || ''))
  ].filter(Boolean))
  store.people = store.people.filter(person => !person.sample || referencedPeople.has(String(person.id)))
  store.people.forEach(person => { if (person.sample && referencedPeople.has(String(person.id))) person.sample = false })
  const referencedTeams = new Set([
    ...store.people.map(person => String(person.teamId || '')),
    ...store.projects.map(project => String(project.teamId || ''))
  ].filter(Boolean))
  store.teams = store.teams.filter(team => !team.sample || referencedTeams.has(String(team.id)))
  store.teams.forEach(team => { if (team.sample && referencedTeams.has(String(team.id))) team.sample = false })
  auditLog('demo-data.removed', req.user.id, {})
  persist({ reason: 'remove-demo' })
  res.json({ ok: true })
})
}
