import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import express from 'express'
import cookieParser from 'cookie-parser'

const root = process.env.ATLAS_ROOT || process.cwd()
const dataDir = process.env.ATLAS_DATA_DIR || path.join(root, 'data')
const staticDir = process.env.ATLAS_STATIC_DIR || path.join(root, 'dist')
const dataFile = path.join(dataDir, 'atlas-store.json')
const sessions = new Map()
const isProduction = process.env.NODE_ENV === 'production'
const allowDemoData = process.env.ATLAS_ALLOW_DEMO_DATA === 'true'
const cookieSecure = process.env.ATLAS_COOKIE_SECURE === 'true'
const STORE_SCHEMA_VERSION = '3.0.0'
const DATABASE_MODEL = 'embedded-json-document-store'
const DESIGN_SYSTEM_VERSION = '2.0.0'
const BACKUP_RETENTION = Math.max(3, Math.min(100, Number(process.env.ATLAS_BACKUP_RETENTION || 25)))
function sessionCookieOptions() { return { httpOnly: true, sameSite: 'lax', secure: cookieSecure, maxAge: 1000 * 60 * 60 * 24 * 14 } }

function ensureDir() { fs.mkdirSync(dataDir, { recursive: true }) }
function workspaceTimezone() { return (typeof store !== 'undefined' && store?.settings?.workspace?.defaultTimezone) || process.env.ATLAS_TIMEZONE || 'America/Los_Angeles' }
function todayLA(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: workspaceTimezone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
function addDays(value, offset) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
function fmt(value, options = { month: 'short', day: 'numeric' }) {
  if (!value) return 'No date'
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
}
function daysBetween(a, b) {
  return Math.ceil((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000)
}
function id(prefix) { return `${prefix}_${crypto.randomBytes(6).toString('hex')}` }
function parseNumber(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback }
function isDone(task) { return terminalTaskStates().includes(task?.status) || task?.status === 'Done' }

const ROLE_PERMISSIONS = {
  Administrator: ['manageSettings', 'manageUsers', 'manageProjects', 'managePeople', 'manageAlerts', 'manageTasks', 'writeTasks', 'logActivity', 'viewReports', 'exportData', 'removeDemoData'],
  Manager: ['manageProjects', 'managePeople', 'manageAlerts', 'manageTasks', 'writeTasks', 'logActivity', 'viewReports', 'exportData'],
  Developer: ['writeTasks', 'logActivity', 'viewReports', 'exportData'],
  Viewer: ['viewReports', 'exportData']
}
function permissionsFor(role = 'Viewer') {
  const registry = (typeof store !== 'undefined' && store?.settings?.permissions?.roles) || null
  const configured = registry?.[role]?.permissions
  return Array.isArray(configured) && configured.length ? configured : (ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.Viewer)
}
function can(user, permission) { return permissionsFor(user?.role).includes(permission) }
function roleRank(role) {
  const registry = (typeof store !== 'undefined' && store?.settings?.permissions?.roles) || null
  if (registry?.[role]?.rank) return Number(registry[role].rank)
  return { Viewer: 1, Developer: 2, Manager: 3, Administrator: 4 }[role] || 1
}
const DEFAULT_NAVIGATION = ['overview', 'projects', 'tasks', 'people', 'activity', 'reports', 'alerts']
const DEFAULT_WORKFLOW_STATES = [
  { id: 'todo', label: 'To do', color: 'muted', terminal: false },
  { id: 'in_progress', label: 'In progress', color: 'blue', terminal: false },
  { id: 'review', label: 'Review', color: 'purple', terminal: false },
  { id: 'testing', label: 'Testing', color: 'orange', terminal: false },
  { id: 'done', label: 'Done', color: 'green', terminal: true }
]
const DEFAULT_TRANSLATIONS = {
  en: { 'app.name': 'Atlas Workspace', 'nav.overview': 'Overview', 'nav.projects': 'Projects', 'nav.tasks': 'My work', 'nav.people': 'People', 'nav.activity': 'Activity', 'nav.reports': 'Reports', 'nav.alerts': 'Alerts', 'nav.settings': 'Settings', 'actions.new': 'New', 'actions.search': 'Search anything', 'settings.localization': 'Localization', 'settings.workflows': 'Workflows', 'settings.permissions': 'Permissions', 'reports.activity': 'User activity intelligence' },
  ar: { 'app.name': 'مساحة عمل أطلس', 'nav.overview': 'نظرة عامة', 'nav.projects': 'المشاريع', 'nav.tasks': 'عملي', 'nav.people': 'الأشخاص', 'nav.activity': 'النشاط', 'nav.reports': 'التقارير', 'nav.alerts': 'التنبيهات', 'nav.settings': 'الإعدادات', 'actions.new': 'جديد', 'actions.search': 'البحث في كل شيء', 'settings.localization': 'اللغة والتوطين', 'settings.workflows': 'سير العمل', 'settings.permissions': 'الصلاحيات', 'reports.activity': 'تحليل نشاط المستخدمين' },
  fa: { 'app.name': 'فضای کاری اطلس', 'nav.overview': 'نمای کلی', 'nav.projects': 'پروژه‌ها', 'nav.tasks': 'کارهای من', 'nav.people': 'افراد', 'nav.activity': 'فعالیت', 'nav.reports': 'گزارش‌ها', 'nav.alerts': 'هشدارها', 'nav.settings': 'تنظیمات', 'actions.new': 'جدید', 'actions.search': 'جست‌وجوی همه چیز', 'settings.localization': 'بومی‌سازی', 'settings.workflows': 'گردش‌کارها', 'settings.permissions': 'مجوزها', 'reports.activity': 'هوشمندی فعالیت کاربران' },
  he: { 'app.name': 'סביבת העבודה Atlas', 'nav.overview': 'סקירה', 'nav.projects': 'פרויקטים', 'nav.tasks': 'העבודה שלי', 'nav.people': 'אנשים', 'nav.activity': 'פעילות', 'nav.reports': 'דוחות', 'nav.alerts': 'התראות', 'nav.settings': 'הגדרות', 'actions.new': 'חדש', 'actions.search': 'חיפוש בכל מקום', 'settings.localization': 'לוקליזציה', 'settings.workflows': 'זרימות עבודה', 'settings.permissions': 'הרשאות', 'reports.activity': 'מודיעין פעילות משתמשים' }
}
const ROLE_DESCRIPTIONS = {
  Administrator: 'Full workspace ownership, security, settings, users, and all operational data.',
  Manager: 'Manage projects, people, alerts, delivery plans, tasks, reports, and exports.',
  Developer: 'Update task progress, log daily activity, and read/export operational reports.',
  Viewer: 'Read-only access to dashboards, reports, exports, and team context.'
}
function roleRegistryDefaults() {
  return Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([name, permissions], index) => [name, { name, description: ROLE_DESCRIPTIONS[name] || `${name} role`, permissions, rank: index + 1, system: name === 'Administrator' }]))
}
function defaultSettings() {
  const settings = {
    workspace: {
      name: 'Atlas Workspace', unit: 'Operations', logo: '', applicationName: 'Atlas Workspace',
      branding: { primaryColor: '#6d5dfc', accentColor: 'purple', reportLogo: '', loginHeadline: 'Operate with clarity.' },
      organization: { legalName: '', website: '', address: '', contactEmail: '' },
      defaultTimezone: process.env.ATLAS_TIMEZONE || 'America/Los_Angeles', defaultLanguage: 'en',
      regionalFormats: { date: 'MMM d, yyyy', number: 'latn', currency: 'USD', timezone: 'short' },
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], workingHours: { start: '09:00', end: '17:00' }, holidays: []
    },
    interface: {
      theme: 'light', colors: { accent: 'purple', primary: '#6d5dfc' }, density: 'comfortable', spacing: 'comfortable',
      typography: { family: 'Atlas Sans', scale: 100 }, sidebarBehavior: 'expanded',
      navigationVisibility: Object.fromEntries(DEFAULT_NAVIGATION.map(page => [page, true])), navigationOrder: [...DEFAULT_NAVIGATION],
      dashboardLayouts: { overview: ['stats', 'dailyPulse', 'projectHealth', 'myFocus'] }, defaultLandingPage: 'overview',
      tableBehavior: { pageSize: 50, stickyHeaders: true, zebraRows: false }, tableColumns: { projects: ['name','code','team','health','progress','deadline'], tasks: ['id','title','project','status','priority','assignee','due'], people: ['name','email','role','team','status','load'], activity: ['person','date','today','blocked'], alerts: ['title','type','project','resolved','time'], users: ['name','email','role','team','active'] }, formLayouts: { projects: ['name','code','description','teamId','ownerId','status','deadline'], tasks: ['title','projectId','assigneeId','priority','dueDate','status','type','blocked'], people: ['name','email','jobTitle','teamId','focus','capacity','status'], users: ['name','email','role','personId','active'] }, actionVisibility: { create: true, edit: true, delete: true, export: true, print: true }, cardLayouts: { projects: 'grid', tasks: 'board' },
      animations: true, accessibility: { highContrast: false, reducedMotion: false, scalableText: 100, screenReaderLabels: true }
    },
    localization: {
      activeLanguages: ['en', 'ar', 'fa', 'he'], defaultLanguage: 'en', fallbackLanguage: 'en', userLanguagePreference: true,
      textDirectionByLanguage: { en: 'ltr', ar: 'rtl', fa: 'rtl', he: 'rtl' },
      dateFormats: { en: 'MMM d, yyyy', ar: 'd MMM yyyy', fa: 'yyyy/MM/dd', he: 'd MMM yyyy' },
      numberFormats: { en: 'latn', ar: 'arab', fa: 'arabext', he: 'latn' }, currencyFormats: { en: 'USD', ar: 'USD', fa: 'USD', he: 'USD' }, timezoneFormats: { en: 'short', ar: 'short', fa: 'short', he: 'short' },
      translations: DEFAULT_TRANSLATIONS, missingTranslationDetection: true,
      languagePackages: [{ code: 'en', name: 'English', direction: 'ltr', enabled: true }, { code: 'ar', name: 'العربية', direction: 'rtl', enabled: true }, { code: 'fa', name: 'فارسی', direction: 'rtl', enabled: true }, { code: 'he', name: 'עברית', direction: 'rtl', enabled: true }],
      approvalWorkflow: { enabled: true, statusByKey: {} }, interfaces: { core: { namespace: 'core', label: 'Core application', registeredAt: 'built-in', status: 'active' }, setup: { namespace: 'setup', label: 'First-run setup', registeredAt: 'built-in', status: 'active' }, settings: { namespace: 'settings', label: 'Configuration console', registeredAt: 'built-in', status: 'active' }, extensions: { namespace: 'extensions', label: 'Extension interfaces', registeredAt: 'runtime', status: 'active' } }, missingKeys: [], translationMemory: [], keyPolicy: { prefixByNamespace: true, fallbackRequired: true, approvalRequired: true }, runtime: { domLocalization: true, attributeLocalization: true, optionLocalization: true, reportMissing: true }
    },
    modules: {
      overview: { enabled: true, labelKey: 'nav.overview', icon: 'overview', permissions: ['viewReports'] },
      projects: { enabled: true, labelKey: 'nav.projects', icon: 'projects', permissions: ['manageProjects', 'viewReports'] },
      tasks: { enabled: true, labelKey: 'nav.tasks', icon: 'tasks', permissions: ['writeTasks', 'viewReports'] },
      people: { enabled: true, labelKey: 'nav.people', icon: 'people', permissions: ['managePeople', 'viewReports'] },
      activity: { enabled: true, labelKey: 'nav.activity', icon: 'activity', permissions: ['logActivity', 'viewReports'] },
      reports: { enabled: true, labelKey: 'nav.reports', icon: 'reports', permissions: ['viewReports'] },
      alerts: { enabled: true, labelKey: 'nav.alerts', icon: 'alerts', permissions: ['manageAlerts', 'writeTasks', 'viewReports'] }
    },
    workflows: {
      task: { name: 'Default task workflow', states: DEFAULT_WORKFLOW_STATES, transitions: DEFAULT_WORKFLOW_STATES.slice(0, -1).map((state, index) => ({ from: state.label, to: DEFAULT_WORKFLOW_STATES[index + 1].label, permission: 'writeTasks' })), approvalSteps: [], automatedActions: [] }
    },
    customFields: { projects: [], tasks: [], people: [], teams: [], activities: [], alerts: [], reports: [] },
    permissions: { roles: roleRegistryDefaults(), moduleAccess: {}, fieldAccess: {}, actionAccess: {}, exportPermissions: {}, reportingPermissions: {} },
    notifications: { enabled: true, channels: { inApp: true, email: false, webhook: false }, events: { taskAssigned: true, alertCreated: true, reportReady: true } },
    reports: { defaultTemplate: 'executive', templates: ['standard', 'compact', 'executive'], customColumns: {}, customFilters: {}, customCalculations: {}, localizedOutput: true, branding: { includeLogo: true, footerText: '' } },
    exports: { formats: ['csv', 'xlsx', 'json', 'pdf', 'print'], respectLanguage: true, respectDirection: true, includeBranding: true, pdf: { orientation: 'landscape', margins: 'standard' } },
    integrations: { registry: [], webhooks: [], apiAccess: false },
    storage: { model: DATABASE_MODEL, schemaVersion: STORE_SCHEMA_VERSION, backupRetention: BACKUP_RETENTION, importExportEnabled: true },
    security: { passwordMinLength: 8, sessionDays: 14, cookieSecure, allowDemoData, requireApprovalForRoleChanges: false },
    audit: { enabled: true, retentionDays: 365, trackReads: false, trackWrites: true, trackExports: true }
  }
  return withLegacySettings(settings)
}
function mergeDeep(target, source) {
  const out = { ...(target || {}) }
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) out[key] = mergeDeep(out[key], value)
    else out[key] = value
  })
  return out
}
function withLegacySettings(settings) {
  const visibility = settings.interface?.navigationVisibility || {}
  settings.language = settings.localization?.defaultLanguage || settings.workspace?.defaultLanguage || 'en'
  settings.density = settings.interface?.density || 'comfortable'
  settings.dateFormat = settings.workspace?.regionalFormats?.date || settings.localization?.dateFormats?.[settings.language] || 'MMM d, yyyy'
  settings.defaultTaskView = settings.interface?.cardLayouts?.tasks || 'board'
  settings.pageSize = Number(settings.interface?.tableBehavior?.pageSize || 50)
  settings.printTemplate = settings.reports?.defaultTemplate || 'executive'
  settings.appMode = 'adaptive'
  settings.theme = settings.interface?.theme || 'light'
  settings.accentColor = settings.interface?.colors?.accent || 'purple'
  settings.sidebarMode = settings.interface?.sidebarBehavior || 'expanded'
  settings.defaultPage = settings.interface?.defaultLandingPage || 'overview'
  settings.showAnimations = settings.interface?.animations !== false
  settings.workspaceName = settings.workspace?.name || 'Atlas Workspace'
  settings.workspaceUnit = settings.workspace?.unit || 'Operations'
  const navOrder = Array.isArray(settings.interface?.navigationOrder) && settings.interface.navigationOrder.length ? settings.interface.navigationOrder : DEFAULT_NAVIGATION
  settings.interface.navigationOrder = [...new Set([...navOrder.filter(page => DEFAULT_NAVIGATION.includes(page)), ...DEFAULT_NAVIGATION])].filter(page => DEFAULT_NAVIGATION.includes(page))
  settings.enabledPages = settings.interface.navigationOrder.filter(page => visibility[page] !== false && settings.modules?.[page]?.enabled !== false)
  return settings
}
function normalizeSettings(raw = {}) {
  let next = mergeDeep(defaultSettings(), raw || {})
  if (raw.workspaceName && !raw.workspace?.name) next.workspace.name = raw.workspaceName
  if (raw.workspaceUnit && !raw.workspace?.unit) next.workspace.unit = raw.workspaceUnit
  if (raw.language && !raw.localization?.defaultLanguage) { next.localization.defaultLanguage = raw.language; next.workspace.defaultLanguage = raw.language }
  if (raw.dateFormat && !raw.workspace?.regionalFormats?.date) next.workspace.regionalFormats.date = raw.dateFormat
  if (raw.theme && !raw.interface?.theme) next.interface.theme = raw.theme
  if (raw.accentColor && !raw.interface?.colors?.accent) { next.interface.colors.accent = raw.accentColor; next.workspace.branding.accentColor = raw.accentColor }
  if (raw.density && !raw.interface?.density) next.interface.density = raw.density
  if (raw.sidebarMode && !raw.interface?.sidebarBehavior) next.interface.sidebarBehavior = raw.sidebarMode
  if (raw.defaultPage && !raw.interface?.defaultLandingPage) next.interface.defaultLandingPage = raw.defaultPage
  if (raw.defaultTaskView && !raw.interface?.cardLayouts?.tasks) next.interface.cardLayouts.tasks = raw.defaultTaskView
  if (raw.pageSize && !raw.interface?.tableBehavior?.pageSize) next.interface.tableBehavior.pageSize = Number(raw.pageSize)
  if (typeof raw.showAnimations === 'boolean' && typeof raw.interface?.animations !== 'boolean') next.interface.animations = raw.showAnimations
  if (Array.isArray(raw.enabledPages) && !raw.interface?.navigationVisibility && !raw.modules) DEFAULT_NAVIGATION.forEach(page => { next.interface.navigationVisibility[page] = raw.enabledPages.includes(page); if (next.modules[page]) next.modules[page].enabled = raw.enabledPages.includes(page) })
  next.localization.activeLanguages = [...new Set(next.localization.activeLanguages || ['en'])]
  next.localization.translations = next.localization.translations || {}
  next.localization.activeLanguages.forEach(code => { next.localization.translations[code] = { ...(DEFAULT_TRANSLATIONS[code] || {}), ...(next.localization.translations?.[code] || {}) } })
  next.localization.interfaces = mergeDeep({ core: { namespace: 'core', label: 'Core application', registeredAt: 'built-in', status: 'active' }, setup: { namespace: 'setup', label: 'First-run setup', registeredAt: 'built-in', status: 'active' }, settings: { namespace: 'settings', label: 'Configuration console', registeredAt: 'built-in', status: 'active' }, extensions: { namespace: 'extensions', label: 'Extension interfaces', registeredAt: 'runtime', status: 'active' } }, next.localization.interfaces || {})
  if (!Array.isArray(next.localization.missingKeys)) next.localization.missingKeys = []
  if (!Array.isArray(next.localization.translationMemory)) next.localization.translationMemory = []
  next.localization.keyPolicy = mergeDeep({ prefixByNamespace: true, fallbackRequired: true, approvalRequired: true }, next.localization.keyPolicy || {})
  next.localization.runtime = mergeDeep({ domLocalization: true, attributeLocalization: true, optionLocalization: true, reportMissing: true }, next.localization.runtime || {})
  next.permissions.roles = mergeDeep(roleRegistryDefaults(), next.permissions?.roles || {})
  next.permissions.roles.Administrator.permissions = [...new Set([...(next.permissions.roles.Administrator.permissions || []), 'manageSettings', 'manageUsers'])]
  next.workflows.task.states = (next.workflows?.task?.states || DEFAULT_WORKFLOW_STATES).map((state, index, states) => typeof state === 'string' ? { id: slugifyState(state), label: state, color: index === states.length - 1 ? 'green' : 'blue', terminal: index === states.length - 1 } : { id: state.id || slugifyState(state.label || state.name || `state-${index}`), label: state.label || state.name || `State ${index + 1}`, color: state.color || 'blue', terminal: Boolean(state.terminal || index === states.length - 1) })
  if (!Array.isArray(next.workflows.task.transitions) || !next.workflows.task.transitions.length) next.workflows.task.transitions = next.workflows.task.states.slice(0, -1).map((state, index) => ({ from: state.label, to: next.workflows.task.states[index + 1].label, permission: 'writeTasks' }))
  Object.keys(defaultSettings().customFields).forEach(key => { if (!Array.isArray(next.customFields[key])) next.customFields[key] = [] })
  return withLegacySettings(next)
}
function slugifyState(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || id('state') }
function taskWorkflowDefinitions() { return (typeof store !== 'undefined' && store?.settings?.workflows?.task?.states?.length ? store.settings.workflows.task.states : DEFAULT_WORKFLOW_STATES) }
function taskWorkflowStates() { return taskWorkflowDefinitions().map(state => state.label || state.name || String(state)).filter(Boolean) }
function terminalTaskStates() { return taskWorkflowDefinitions().filter(state => state.terminal).map(state => state.label || state.name || String(state)).filter(Boolean) }

function newStoreMeta(overrides = {}) {
  const now = new Date().toISOString()
  return {
    ...overrides,
    createdAt: overrides.createdAt || now,
    updatedAt: now,
    writeCount: Number(overrides.writeCount || 0),
    lastMigrationAt: overrides.lastMigrationAt || now,
    designSystemVersion: DESIGN_SYSTEM_VERSION,
    schemaVersion: STORE_SCHEMA_VERSION,
    model: DATABASE_MODEL,
    atomicPersistence: true,
    backupRetention: BACKUP_RETENTION
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const key = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `scrypt$${salt}$${key}`
}
function verifyPassword(password, user) {
  const stored = user?.passwordHash || user?.password || ''
  if (!stored) return false
  if (!stored.startsWith('scrypt$')) return stored === password
  const [, salt, key] = stored.split('$')
  if (!salt || !key) return false
  const candidate = crypto.scryptSync(String(password), salt, 64)
  const original = Buffer.from(key, 'hex')
  return original.length === candidate.length && crypto.timingSafeEqual(original, candidate)
}
function normalizeUserSecrets(user) {
  if (user.password && !user.passwordHash) user.passwordHash = hashPassword(user.password)
  delete user.password
  return user
}


function timeLA(date = new Date()) {
  return new Intl.DateTimeFormat('en-US', { timeZone: workspaceTimezone(), hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}
function taskCode(task) {
  const project = store?.projects?.find(project => String(project.id) === String(task.projectId)) || {}
  return `${project.code || 'TASK'}-${String(task.id).padStart(3, '0')}`
}
function buildSeedWorkLogs(tasks = [], activities = []) {
  const logs = []
  tasks.forEach((task, index) => {
    const date = task.completedAt || task.createdAt || todayLA()
    logs.push({
      id: `wl_seed_${task.id}_${index}`,
      personId: task.assigneeId,
      taskId: task.id,
      projectId: task.projectId,
      action: task.completedAt ? 'Completed task' : task.status === 'To do' ? 'Planned task' : 'Moved task',
      statusFrom: task.completedAt ? 'Testing' : 'To do',
      statusTo: task.status,
      summary: `${task.title} · ${task.type || 'Work'} · ${task.priority || 'Medium'} priority`,
      date,
      time: ['09:10', '10:25', '13:40', '15:15'][index % 4],
      minutes: task.completedAt ? 95 + (index % 5) * 15 : 35 + (index % 4) * 20,
      sample: Boolean(task.sample)
    })
  })
  activities.forEach((activity, index) => {
    if (!activity.today && !activity.yesterday && !activity.blocked) return
    logs.push({ id: `wl_activity_${activity.id}`, personId: activity.personId, taskId: '', projectId: '', action: 'Daily update', statusFrom: '', statusTo: activity.blocked ? 'Blocked' : 'Confirmed', summary: activity.blocked ? `${activity.today || 'Daily focus'} · Blocked: ${activity.blocked}` : (activity.today || activity.yesterday || 'Daily update'), date: activity.date, time: activity.time || ['09:00', '09:15', '09:30'][index % 3], minutes: 0, sample: Boolean(activity.sample), source: 'Activity log' })
  })
  return logs
}
function logWorkEvent({ personId, taskId = '', projectId = '', action, statusFrom = '', statusTo = '', summary = '', minutes = 30 }) {
  store.workLogs = store.workLogs || []
  const now = new Date()
  const log = { id: id('worklog'), personId, taskId, projectId, action, statusFrom, statusTo, summary, date: todayLA(now), time: timeLA(now), minutes: parseNumber(minutes, 30), sample: false }
  store.workLogs.push(log)
  return log
}



function demoStore() {
  const today = todayLA()
  const teams = [
    { id: 'team-platform', name: 'Platform', color: 'purple', sample: true },
    { id: 'team-product', name: 'Product Experience', color: 'blue', sample: true },
    { id: 'team-growth', name: 'Growth', color: 'orange', sample: true },
    { id: 'team-data', name: 'Data', color: 'green', sample: true }
  ]
  const people = [
    { id: 'p1', name: 'Maya Chen', email: 'maya@atlas.local', jobTitle: 'Engineering Manager', teamId: 'team-platform', focus: 'Release readiness and cross-team alignment', capacity: 78, status: 'On track', color: 'purple', sample: true },
    { id: 'p2', name: 'Noah Reed', email: 'noah@atlas.local', jobTitle: 'Senior Developer', teamId: 'team-platform', focus: 'API reliability and observability', capacity: 82, status: 'On track', color: 'blue', sample: true },
    { id: 'p3', name: 'Lina Patel', email: 'lina@atlas.local', jobTitle: 'Product Designer', teamId: 'team-product', focus: 'Onboarding interaction polish', capacity: 64, status: 'On track', color: 'pink', sample: true },
    { id: 'p4', name: 'Omar Haddad', email: 'omar@atlas.local', jobTitle: 'QA Lead', teamId: 'team-product', focus: 'Regression gates and risk checks', capacity: 91, status: 'Needs attention', color: 'orange', sample: true },
    { id: 'p5', name: 'Ella Brooks', email: 'ella@atlas.local', jobTitle: 'Data Engineer', teamId: 'team-data', focus: 'Delivery metrics warehouse', capacity: 70, status: 'On track', color: 'green', sample: true },
    { id: 'p6', name: 'Samir Khan', email: 'samir@atlas.local', jobTitle: 'Growth Engineer', teamId: 'team-growth', focus: 'Activation experiments', capacity: 58, status: 'On track', color: 'teal', sample: true }
  ]
  const projects = [
    { id: 1, name: 'Atlas Command Center', code: 'ATL', description: 'Make daily operations visible with decision-ready workspace intelligence.', teamId: 'team-platform', ownerId: 'p1', color: 'purple', status: 'On track', deadline: addDays(today, 19), createdAt: addDays(today, -70), sample: true },
    { id: 2, name: 'Customer Onboarding', code: 'ONB', description: 'Design a fast, guided path from invited user to productive team member.', teamId: 'team-product', ownerId: 'p3', color: 'blue', status: 'At risk', deadline: addDays(today, 9), createdAt: addDays(today, -50), sample: true },
    { id: 3, name: 'Data Reliability', code: 'DR', description: 'Harden reporting pipelines and close the trust gap in operational data.', teamId: 'team-data', ownerId: 'p5', color: 'green', status: 'On track', deadline: addDays(today, 37), createdAt: addDays(today, -44), sample: true },
    { id: 4, name: 'Growth Experiments', code: 'GRW', description: 'Run activation experiments with clear tracking and learning loops.', teamId: 'team-growth', ownerId: 'p6', color: 'orange', status: 'On track', deadline: addDays(today, 31), createdAt: addDays(today, -30), sample: true }
  ]
  const tasks = [
    { id: 1, title: 'Finalize advanced reporting export templates', projectId: 1, assigneeId: 'p1', priority: 'High', dueDate: today, status: 'In progress', type: 'Documentation', blocked: false, createdAt: addDays(today, -7), sample: true },
    { id: 2, title: 'Wire native drag-and-drop board updates', projectId: 1, assigneeId: 'p2', priority: 'High', dueDate: addDays(today, 1), status: 'Review', type: 'Development', blocked: false, createdAt: addDays(today, -9), sample: true },
    { id: 3, title: 'QA keyboard shortcut coverage', projectId: 1, assigneeId: 'p4', priority: 'Medium', dueDate: addDays(today, 4), status: 'Testing', type: 'Testing', blocked: false, createdAt: addDays(today, -11), sample: true },
    { id: 4, title: 'Design setup wizard empty states', projectId: 2, assigneeId: 'p3', priority: 'Medium', dueDate: addDays(today, 2), status: 'Done', type: 'Design', blocked: false, createdAt: addDays(today, -18), completedAt: addDays(today, -1), sample: true },
    { id: 5, title: 'Resolve SSO callback mismatch', projectId: 2, assigneeId: 'p2', priority: 'High', dueDate: addDays(today, -1), status: 'In progress', type: 'Development', blocked: true, createdAt: addDays(today, -13), sample: true },
    { id: 6, title: 'Refresh welcome checklist microcopy', projectId: 2, assigneeId: 'p3', priority: 'Low', dueDate: addDays(today, 6), status: 'To do', type: 'Design', blocked: false, createdAt: addDays(today, -6), sample: true },
    { id: 7, title: 'Backfill delivery metrics for quarterly trend', projectId: 3, assigneeId: 'p5', priority: 'Medium', dueDate: addDays(today, 3), status: 'In progress', type: 'Development', blocked: false, createdAt: addDays(today, -16), sample: true },
    { id: 8, title: 'Add pipeline freshness alert', projectId: 3, assigneeId: 'p5', priority: 'High', dueDate: addDays(today, 8), status: 'To do', type: 'Development', blocked: false, createdAt: addDays(today, -4), sample: true },
    { id: 9, title: 'Prototype activation cohort dashboard', projectId: 4, assigneeId: 'p6', priority: 'Medium', dueDate: addDays(today, 10), status: 'Review', type: 'Development', blocked: false, createdAt: addDays(today, -8), sample: true },
    { id: 10, title: 'Document experiment naming rules', projectId: 4, assigneeId: 'p6', priority: 'Low', dueDate: addDays(today, 15), status: 'Done', type: 'Documentation', blocked: false, createdAt: addDays(today, -25), completedAt: addDays(today, -10), sample: true },
    { id: 11, title: 'Create annual executive delivery pack', projectId: 1, assigneeId: 'p1', priority: 'High', dueDate: addDays(today, 12), status: 'To do', type: 'Documentation', blocked: false, createdAt: addDays(today, -2), sample: true },
    { id: 12, title: 'Polish local font loading and offline shell', projectId: 1, assigneeId: 'p2', priority: 'Medium', dueDate: addDays(today, 5), status: 'Done', type: 'Development', blocked: false, createdAt: addDays(today, -14), completedAt: today, sample: true }
  ]
  const oldTasks = []
  for (let i = 13; i <= 54; i++) {
    const projectId = ((i - 1) % 4) + 1
    const createdAt = addDays(today, -((i * 5) % 360) - 7)
    const done = i % 3 !== 0
    oldTasks.push({
      id: i,
      title: `Historical delivery item ${i - 12}`,
      projectId,
      assigneeId: people[(i - 1) % people.length].id,
      priority: ['Low', 'Medium', 'High'][i % 3],
      dueDate: addDays(createdAt, 8 + (i % 14)),
      status: done ? 'Done' : ['To do', 'In progress', 'Review', 'Testing'][i % 4],
      type: ['Development', 'Design', 'Testing', 'Documentation'][i % 4],
      blocked: !done && i % 7 === 0,
      createdAt,
      completedAt: done ? addDays(createdAt, 5 + (i % 12)) : undefined,
      sample: true
    })
  }
  const milestones = [
    { id: 'm1', projectId: 1, name: 'Executive report builder', dueDate: addDays(today, 12), status: 'Upcoming', sample: true },
    { id: 'm2', projectId: 2, name: 'Pilot onboarding release', dueDate: addDays(today, 9), status: 'At risk', sample: true },
    { id: 'm3', projectId: 3, name: 'Pipeline SLA review', dueDate: addDays(today, 18), status: 'Upcoming', sample: true },
    { id: 'm4', projectId: 4, name: 'Experiment readout', dueDate: addDays(today, 22), status: 'Upcoming', sample: true }
  ]
  const activities = [
    { id: 'a1', personId: 'p1', date: today, time: '09:10', yesterday: 'Validated report requirements with leadership.', today: 'Finalize export templates and print presets.', blocked: '', upcoming: 'Annual report review.', status: 'Confirmed', sample: true },
    { id: 'a2', personId: 'p2', date: today, time: '09:20', yesterday: 'Completed local asset audit.', today: 'Review drag-and-drop persistence and API update paths.', blocked: 'SSO callback mismatch needs environment confirmation.', upcoming: 'Ship board interaction polish.', status: 'Confirmed', sample: true },
    { id: 'a3', personId: 'p3', date: today, time: '09:31', yesterday: 'Finished setup wizard states.', today: 'Improve onboarding checklist affordances.', blocked: '', upcoming: 'Design review.', status: 'Confirmed', sample: true },
    { id: 'a4', personId: 'p4', date: addDays(today, -1), time: '16:40', yesterday: 'Ran regression smoke test.', today: 'Validate keyboard shortcuts and print layouts.', blocked: '', upcoming: 'Testing sign-off.', status: 'Confirmed', sample: true },
    { id: 'a5', personId: 'p5', date: addDays(today, -1), time: '15:25', yesterday: 'Backfilled weekly delivery metrics.', today: 'Compare monthly and quarterly rollups.', blocked: '', upcoming: 'Freshness alert.', status: 'Confirmed', sample: true },
    { id: 'a6', personId: 'p6', date: addDays(today, -2), time: '14:05', yesterday: 'Mapped activation cohorts.', today: 'Prototype readout dashboard.', blocked: '', upcoming: 'Experiment kickoff.', status: 'Confirmed', sample: true }
  ]
  const alerts = [
    { id: 'al1', title: 'Onboarding release is at risk', body: 'SSO callback mismatch blocks the pilot release path.', type: 'risk', tone: 'orange', projectId: 2, taskId: 5, resolved: false, createdAt: today, sample: true },
    { id: 'al2', title: 'Overdue task detected', body: 'Resolve SSO callback mismatch is past its due date.', type: 'overdue', tone: 'red', projectId: 2, taskId: 5, resolved: false, createdAt: today, sample: true },
    { id: 'al3', title: 'Local assets confirmed', body: 'Fonts, icons, manifest, and service worker are local to the project.', type: 'info', tone: 'blue', projectId: 1, resolved: true, createdAt: addDays(today, -1), sample: true }
  ]
  const allTasks = [...tasks, ...oldTasks]
  const workLogs = buildSeedWorkLogs(allTasks, activities)
  return {
    meta: newStoreMeta({ seededAt: new Date().toISOString() }),
    configured: true,
    counters: { project: 5, task: 55 },
    settings: { ...defaultSettings(), workspaceName: 'Northstar', workspaceUnit: 'Engineering' },
    users: [
      { id: 'u1', name: 'Maya Chen', email: 'maya@atlas.local', passwordHash: hashPassword('atlas-demo'), role: 'Administrator', personId: 'p1', avatarColor: 'purple', active: true, sample: true },
      { id: 'u2', name: 'Noah Reed', email: 'manager@atlas.local', passwordHash: hashPassword('manager-demo'), role: 'Manager', personId: 'p2', avatarColor: 'blue', active: true, sample: true },
      { id: 'u3', name: 'Lina Patel', email: 'developer@atlas.local', passwordHash: hashPassword('developer-demo'), role: 'Developer', personId: 'p3', avatarColor: 'pink', active: true, sample: true },
      { id: 'u4', name: 'Omar Haddad', email: 'viewer@atlas.local', passwordHash: hashPassword('viewer-demo'), role: 'Viewer', personId: 'p4', avatarColor: 'orange', active: true, sample: true }
    ],
    teams, people, projects, tasks: allTasks, milestones, activities, alerts, workLogs
  }
}
function ensureCollection(storeObject, key) {
  if (!Array.isArray(storeObject[key])) storeObject[key] = []
}
function normalizeStore(next = {}) {
  if (!next || typeof next !== 'object' || Array.isArray(next)) next = productionStore()
  const existingMeta = next.meta || {}
  next.meta = newStoreMeta({
    ...existingMeta,
    createdAt: existingMeta.createdAt || new Date().toISOString(),
    writeCount: Number(existingMeta.writeCount || 0),
    lastMigrationAt: existingMeta.schemaVersion === STORE_SCHEMA_VERSION ? existingMeta.lastMigrationAt : new Date().toISOString()
  })
  next.settings = normalizeSettings(next.settings || {})
  ;['users', 'teams', 'people', 'projects', 'tasks', 'milestones', 'activities', 'alerts', 'workLogs', 'auditLogs'].forEach(key => ensureCollection(next, key))
  const maxProjectId = Math.max(0, ...next.projects.map(p => Number(p.id) || 0))
  const maxTaskId = Math.max(0, ...next.tasks.map(t => Number(t.id) || 0))
  next.counters = {
    project: Math.max(Number(next.counters?.project || 1), maxProjectId + 1),
    task: Math.max(Number(next.counters?.task || 1), maxTaskId + 1)
  }
  if (!next.workLogs.length && (next.tasks.length || next.activities.length)) next.workLogs = buildSeedWorkLogs(next.tasks, next.activities)
  next.users.forEach(user => {
    user.role = user.role || 'Viewer'
    user.active = user.active !== false
    user.avatarColor = user.avatarColor || next.people.find(person => person.id === user.personId)?.color || 'purple'
    normalizeUserSecrets(user)
  })
  if (allowDemoData) {
    const demoUsers = demoStore().users
    demoUsers.forEach(sampleUser => {
      if (!next.users.some(user => user.email.toLowerCase() === sampleUser.email.toLowerCase()) && next.people.some(person => person.id === sampleUser.personId)) next.users.push(normalizeUserSecrets(sampleUser))
    })
  }
  next.configured = typeof next.configured === 'boolean' ? next.configured : next.users.length > 0
  return next
}

function productionStore() {
  return {
    meta: newStoreMeta(),
    configured: false,
    counters: { project: 1, task: 1 },
    settings: defaultSettings(),
    users: [], teams: [], people: [], projects: [], tasks: [], milestones: [], activities: [], alerts: [], workLogs: [], auditLogs: []
  }
}
function backupFileName(reason = 'snapshot') {
  const safeReason = String(reason).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 32) || 'snapshot'
  return `atlas-store-${new Date().toISOString().replace(/[:.]/g, '-')}-${safeReason}.json`
}
function listBackups() {
  const backupDir = path.join(dataDir, 'backups')
  if (!fs.existsSync(backupDir)) return []
  return fs.readdirSync(backupDir).filter(file => file.endsWith('.json')).map(file => ({ file, path: path.join(backupDir, file), createdAt: fs.statSync(path.join(backupDir, file)).mtime.toISOString() })).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
function pruneBackups() {
  listBackups().slice(BACKUP_RETENTION).forEach(backup => { try { fs.unlinkSync(backup.path) } catch {} })
}
function createBackup(reason = 'manual') {
  ensureDir()
  if (!fs.existsSync(dataFile)) return null
  const backupDir = path.join(dataDir, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const target = path.join(backupDir, backupFileName(reason))
  fs.copyFileSync(dataFile, target)
  pruneBackups()
  return target
}
function saveStore(next, options = {}) {
  ensureDir()
  const normalized = normalizeStore(next)
  normalized.meta.writeCount = Number(normalized.meta.writeCount || 0) + (options.incrementWriteCount === false ? 0 : 1)
  normalized.meta.updatedAt = new Date().toISOString()
  if (options.backup && fs.existsSync(dataFile)) createBackup(options.reason || 'write')
  const tempFile = path.join(dataDir, `.atlas-store.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tempFile, JSON.stringify(normalized, null, 2))
  fs.renameSync(tempFile, dataFile)
  return normalized
}
function loadStore() {
  ensureDir()
  if (!fs.existsSync(dataFile)) return saveStore(productionStore(), { incrementWriteCount: false })
  let parsed
  try { parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8')) }
  catch (error) {
    const corruptFile = path.join(dataDir, `atlas-store-corrupt-${Date.now()}.json`)
    fs.renameSync(dataFile, corruptFile)
    console.error(`Atlas store could not be parsed. Moved corrupt file to ${corruptFile}`)
    return saveStore(productionStore(), { incrementWriteCount: false })
  }
  return saveStore(normalizeStore(parsed), { incrementWriteCount: false })
}
function validateStoreState(candidate = store) {
  const errors = []
  const warnings = []
  const collections = ['users', 'teams', 'people', 'projects', 'tasks', 'milestones', 'activities', 'alerts', 'workLogs', 'auditLogs']
  collections.forEach(key => { if (!Array.isArray(candidate?.[key])) errors.push(`${key} must be an array`) })
  if (candidate?.meta?.schemaVersion !== STORE_SCHEMA_VERSION) warnings.push(`Store schema is ${candidate?.meta?.schemaVersion || 'missing'}; expected ${STORE_SCHEMA_VERSION}`)
  if (!candidate?.settings?.workspace || !candidate?.settings?.interface || !candidate?.settings?.localization) errors.push('Settings must include workspace, interface, and localization configuration branches')
  if (!candidate?.settings?.workflows?.task?.states?.length) errors.push('Task workflow must define at least one state')
  if (!candidate?.settings?.permissions?.roles?.Administrator?.permissions?.includes('manageSettings')) errors.push('Administrator role must retain manageSettings permission')
  const duplicateValues = (items, getter, label) => {
    const seen = new Set()
    ;(items || []).forEach(item => {
      const value = getter(item)
      if (!value) return
      if (seen.has(value)) errors.push(`Duplicate ${label}: ${value}`)
      seen.add(value)
    })
  }
  duplicateValues(candidate?.users, user => String(user.email || '').toLowerCase(), 'user email')
  duplicateValues(candidate?.people, person => person.id, 'person id')
  duplicateValues(candidate?.projects, project => String(project.id), 'project id')
  duplicateValues(candidate?.tasks, task => String(task.id), 'task id')
  const people = new Set((candidate?.people || []).map(person => person.id))
  const teams = new Set((candidate?.teams || []).map(team => team.id))
  const projects = new Set((candidate?.projects || []).map(project => String(project.id)))
  const tasks = new Set((candidate?.tasks || []).map(task => String(task.id)))
  ;(candidate?.people || []).forEach(person => { if (person.teamId && !teams.has(person.teamId)) warnings.push(`Person ${person.name || person.id} references a missing team`) })
  ;(candidate?.users || []).forEach(user => {
    if (user.password && !user.passwordHash) errors.push(`User ${user.email || user.id} still has a plain-text password field`)
    if (user.personId && !people.has(user.personId)) warnings.push(`User ${user.email || user.id} references a missing person profile`)
  })
  ;(candidate?.projects || []).forEach(project => {
    if (project.teamId && !teams.has(project.teamId)) warnings.push(`Project ${project.name || project.id} references a missing team`)
    if (project.ownerId && !people.has(project.ownerId)) warnings.push(`Project ${project.name || project.id} references a missing owner`)
  })
  ;(candidate?.tasks || []).forEach(task => {
    if (!projects.has(String(task.projectId))) warnings.push(`Task ${task.title || task.id} references a missing project`)
    if (task.assigneeId && !people.has(task.assigneeId)) warnings.push(`Task ${task.title || task.id} references a missing assignee`)
  })
  ;(candidate?.milestones || []).forEach(milestone => { if (milestone.projectId && !projects.has(String(milestone.projectId))) warnings.push(`Milestone ${milestone.name || milestone.id} references a missing project`) })
  ;(candidate?.alerts || []).forEach(alert => {
    if (alert.projectId && !projects.has(String(alert.projectId))) warnings.push(`Alert ${alert.title || alert.id} references a missing project`)
    if (alert.taskId && !tasks.has(String(alert.taskId))) warnings.push(`Alert ${alert.title || alert.id} references a missing task`)
  })
  return { integrity: errors.length ? 'attention' : warnings.length ? 'warning' : 'ok', errors, warnings }
}
function storeChecksum(candidate = store) {
  return crypto.createHash('sha256').update(JSON.stringify(candidate)).digest('hex')
}
if (process.argv.includes('--reset-data')) { saveStore(demoStore(), { backup: fs.existsSync(dataFile), reason: 'reset-data' }); console.log(`Reset ${dataFile} with development demo data`); process.exit(0) }
if (process.argv.includes('--init-production')) { saveStore(productionStore(), { backup: fs.existsSync(dataFile), reason: 'init-production' }); console.log(`Initialized ${dataFile} for production first-run setup`); process.exit(0) }
if (process.argv.includes('--backup-data')) { const backup = createBackup('manual'); console.log(backup ? `Created backup ${backup}` : `No store found at ${dataFile}`); process.exit(0) }
let store = loadStore()
function persist(options = {}) { store = saveStore(store, { backup: process.env.ATLAS_BACKUP_ON_WRITE === 'true', reason: options.reason || 'persist' }) }
function auditLog(action, actorId = '', detail = {}) {
  if (store?.settings?.audit?.enabled === false) return
  store.auditLogs = store.auditLogs || []
  store.auditLogs.push({ id: id('audit'), action, actorId, detail, createdAt: new Date().toISOString(), source: 'api' })
  const retentionDays = Number(store.settings?.audit?.retentionDays || 365)
  const cutoff = Date.now() - retentionDays * 86400000
  store.auditLogs = store.auditLogs.filter(event => !event.createdAt || Date.parse(event.createdAt) >= cutoff)
}

function teamById(id) { return store.teams.find(t => t.id === id) }
function personById(id) { return store.people.find(p => p.id === id) }
function projectById(id) { return store.projects.find(p => String(p.id) === String(id)) }
function taskById(id) { return store.tasks.find(t => String(t.id) === String(id)) }
function publicUser(user) { return user && { id: user.id, name: user.name, email: user.email, role: user.role, personId: user.personId, avatarColor: user.avatarColor, active: user.active !== false, permissions: permissionsFor(user.role) } }
function publicAccessUser(user) {
  const person = personById(user.personId) || {}
  return { ...publicUser(user), personName: person.name || user.name, team: teamById(person.teamId)?.name || 'Workspace', lastLoginAt: user.lastLoginAt || '', createdAt: user.createdAt || '', sample: Boolean(user.sample) }
}

function dueTone(task, today) { if (isDone(task)) return 'done'; if (task.dueDate === today) return 'today'; if (task.dueDate && task.dueDate < today) return 'overdue'; return 'soon' }
function dueLabel(task, today) {
  if (!task.dueDate) return 'No date'
  const diff = daysBetween(today, task.dueDate)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 0) return `${Math.abs(diff)}d late`
  return fmt(task.dueDate)
}
function projectProgress(project) {
  const tasks = store.tasks.filter(t => String(t.projectId) === String(project.id))
  if (!tasks.length) return 0
  return Math.round(tasks.filter(isDone).length / tasks.length * 100)
}
function projectHealth(project, today) {
  if (project.status === 'Completed') return 'Completed'
  if (project.status === 'At risk') return 'At risk'
  const overdue = store.tasks.some(t => String(t.projectId) === String(project.id) && !isDone(t) && t.dueDate && t.dueDate < today)
  return overdue ? 'At risk' : 'On track'
}
function taskPublic(task, today) {
  const project = projectById(task.projectId) || {}
  const person = personById(task.assigneeId) || {}
  return {
    numericId: task.id,
    id: `${project.code || 'TASK'}-${String(task.id).padStart(3, '0')}`,
    title: task.title,
    projectId: task.projectId,
    project: project.name || 'Workspace',
    assigneeId: task.assigneeId,
    assignee: person.name || 'Unassigned',
    assigneeColor: person.color || 'purple',
    priority: task.priority || 'Medium',
    dueDate: task.dueDate,
    due: dueLabel(task, today),
    dueTone: dueTone(task, today),
    status: task.status || 'To do',
    type: task.type || 'Development',
    blocked: Boolean(task.blocked),
    createdAt: task.createdAt,
    completedAt: task.completedAt || '',
    customFields: task.customFields || {}
  }
}
function projectPublic(project, today) {
  const team = teamById(project.teamId) || {}
  const owner = personById(project.ownerId) || {}
  const taskRows = store.tasks.filter(t => String(t.projectId) === String(project.id))
  const memberIds = [...new Set(taskRows.map(t => t.assigneeId).concat(project.ownerId).filter(Boolean))]
  const members = memberIds.map(id => personById(id)).filter(Boolean)
  const milestoneRows = store.milestones.filter(m => String(m.projectId) === String(project.id)).map(m => ({ ...m, projectId: project.id }))
  const diff = project.deadline ? daysBetween(today, project.deadline) : null
  return {
    id: `project-${project.id}`,
    numericId: project.id,
    name: project.name,
    code: project.code,
    description: project.description,
    teamId: project.teamId,
    team: team.name || 'Workspace',
    ownerId: project.ownerId,
    owner: owner.name || 'Unassigned',
    color: project.color || team.color || 'purple',
    status: project.status,
    health: projectHealth(project, today),
    progress: projectProgress(project),
    deadlineDate: project.deadline,
    deadline: fmt(project.deadline),
    days: diff == null ? 'No date' : diff < 0 ? `${Math.abs(diff)} days late` : `${diff} days`,
    members: members.map(p => p.name),
    memberColors: Object.fromEntries(members.map(p => [p.name, p.color])),
    milestoneRows,
    customFields: project.customFields || {}
  }
}
function personPublic(person) {
  const team = teamById(person.teamId) || {}
  return {
    id: person.id, name: person.name, email: person.email, jobTitle: person.jobTitle, role: person.jobTitle,
    teamId: person.teamId, team: team.name || 'Workspace', focus: person.focus, capacity: person.capacity,
    load: person.capacity, status: person.status, color: person.color || team.color || 'purple', customFields: person.customFields || {}
  }
}
function activityPublic(activity, today) {
  const person = personById(activity.personId) || {}
  return { ...activity, customFields: activity.customFields || {}, person: person.name || 'Unknown', personColor: person.color || 'purple', isToday: activity.date === today }
}
function alertPublic(alert) {
  const project = projectById(alert.projectId) || {}
  return { ...alert, customFields: alert.customFields || {}, project: project.name || 'Workspace', time: alert.createdAt ? fmt(alert.createdAt) : 'Now' }
}
function bucketFor(period, dateValue, today) {
  const date = new Date(`${dateValue}T12:00:00Z`)
  const now = new Date(`${today}T12:00:00Z`)
  if (period === 'daily') return dateValue
  if (period === 'weekly') {
    const day = date.getUTCDay() || 7
    date.setUTCDate(date.getUTCDate() - day + 1)
    return date.toISOString().slice(0, 10)
  }
  if (period === 'monthly') return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
  if (period === 'quarterly') return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`
  return String(date.getUTCFullYear())
}
function makeBuckets(period, today) {
  const base = new Date(`${today}T12:00:00Z`)
  const buckets = []
  const count = period === 'daily' ? 10 : period === 'weekly' ? 10 : period === 'monthly' ? 12 : period === 'quarterly' ? 8 : 5
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(base)
    if (period === 'daily') date.setUTCDate(base.getUTCDate() - i)
    if (period === 'weekly') date.setUTCDate(base.getUTCDate() - i * 7)
    if (period === 'monthly') date.setUTCMonth(base.getUTCMonth() - i, 1)
    if (period === 'quarterly') date.setUTCMonth(base.getUTCMonth() - i * 3, 1)
    if (period === 'yearly') date.setUTCFullYear(base.getUTCFullYear() - i, 0, 1)
    const iso = date.toISOString().slice(0, 10)
    const key = bucketFor(period, iso, today)
    let label = fmt(iso, { month: 'short', day: 'numeric' })
    if (period === 'weekly') label = `Wk ${fmt(key, { month: 'short', day: 'numeric' })}`
    if (period === 'monthly') label = fmt(iso, { month: 'short' })
    if (period === 'quarterly') label = key.split('-')[1]
    if (period === 'yearly') label = String(new Date(`${iso}T12:00:00Z`).getUTCFullYear())
    buckets.push({ key, label, completed: 0, planned: 0, rate: 0 })
  }
  return buckets
}
function reportFor(period = 'weekly') {
  period = String(period).toLowerCase()
  if (!['daily', 'weekly', 'monthly', 'quarterly', 'yearly'].includes(period)) period = 'weekly'
  const today = todayLA()
  const buckets = makeBuckets(period, today)
  const byKey = Object.fromEntries(buckets.map(bucket => [bucket.key, bucket]))
  store.tasks.forEach(task => {
    const createdKey = bucketFor(period, task.createdAt || today, today)
    if (byKey[createdKey]) byKey[createdKey].planned += 1
    if (task.completedAt) {
      const completedKey = bucketFor(period, task.completedAt, today)
      if (byKey[completedKey]) byKey[completedKey].completed += 1
    }
  })
  buckets.forEach(bucket => { bucket.rate = bucket.planned ? Math.round((bucket.completed / bucket.planned) * 100) : bucket.completed ? 100 : 0 })
  const completed = buckets.reduce((sum, b) => sum + b.completed, 0)
  const planned = buckets.reduce((sum, b) => sum + b.planned, 0)
  const remainingTasks = store.tasks.filter(t => !isDone(t)).length
  const activeProjects = store.projects.filter(p => p.status !== 'Completed').length
  const completedProjects = store.projects.filter(p => p.status === 'Completed').length
  const blockedTasks = store.tasks.filter(t => t.blocked && !isDone(t)).length
  const overdue = store.tasks.filter(t => !isDone(t) && t.dueDate && t.dueDate < today).length
  const alerts = store.alerts.filter(a => !a.resolved).length
  return {
    period,
    series: buckets,
    completed,
    planned,
    deliveryRate: planned ? Math.round(completed / planned * 100) : completed ? 100 : 0,
    remainingTasks,
    activeProjects,
    completedProjects,
    blockedTasks,
    overdue,
    alerts,
    activities: store.activities.filter(a => buckets.some(b => b.key === bucketFor(period, a.date, today))).length
  }
}
function dashboard(today, tasksPublic, projectsPublic, alertsPublic) {
  const openTasks = tasksPublic.filter(t => !isDone(t)).length
  const activeProjects = projectsPublic.filter(p => p.health !== 'Completed').length
  const atRisk = projectsPublic.filter(p => p.health === 'At risk').length
  const onTrack = activeProjects ? Math.round((activeProjects - atRisk) / activeProjects * 100) : 100
  const todayActivities = store.activities.filter(a => a.date === today)
  const yesterdayActivities = store.activities.filter(a => a.date === addDays(today, -1))
  const pulseItem = (activity, key, icon = 'bolt') => {
    const person = personById(activity.personId) || {}
    return { title: person.name || 'Unknown', detail: activity[key] || 'No update', time: activity.time || '', icon }
  }
  return {
    stats: { activeProjects, openTasks, needsAttention: alertsPublic.filter(a => !a.resolved).length, onTrack, completedTasks: tasksPublic.filter(t => isDone(t)).length },
    dailyPulse: {
      yesterday: yesterdayActivities.slice(0, 4).map(a => pulseItem(a, 'yesterday', 'check')),
      today: todayActivities.slice(0, 4).map(a => pulseItem(a, 'today', 'bolt')),
      blocked: todayActivities.filter(a => a.blocked).map(a => pulseItem(a, 'blocked', 'warning')).concat(tasksPublic.filter(t => t.blocked && !isDone(t)).slice(0, 3).map(t => ({ title: t.title, detail: `${t.project} · ${t.assignee}`, time: t.due, icon: 'warning' }))),
      upcoming: store.milestones.slice(0, 4).map(m => ({ title: m.name, detail: projectById(m.projectId)?.name || 'Project', time: fmt(m.dueDate), icon: 'calendar' }))
    },
    myTasks: tasksPublic.filter(t => !isDone(t)).slice(0, 6)
  }
}
function bootstrapFor(user) {
  const today = todayLA()
  const teams = store.teams.map(team => ({ ...team, peopleCount: store.people.filter(p => p.teamId === team.id).length }))
  const people = store.people.map(personPublic)
  const projects = store.projects.map(project => projectPublic(project, today))
  const tasks = store.tasks.map(task => taskPublic(task, today)).sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')))
  const activity = store.activities.map(a => activityPublic(a, today)).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
  const alerts = store.alerts.map(alertPublic).sort((a, b) => Number(a.resolved) - Number(b.resolved) || String(b.createdAt).localeCompare(String(a.createdAt)))
  return { today, user: publicUser(user), settings: store.settings, teams, people, users: store.users.map(publicAccessUser), projects, tasks, activity, alerts, dashboard: dashboard(today, tasks, projects, alerts), reports: reportFor('weekly') }
}

function workLogPublic(log, period = 'daily') {
  const person = personById(log.personId) || {}
  const project = projectById(log.projectId) || {}
  const task = log.taskId ? taskById(log.taskId) : null
  return {
    id: log.id,
    date: log.date,
    time: log.time || '',
    periodKey: bucketFor(period, log.date, todayLA()),
    periodLabel: bucketLabel(period, log.date),
    personId: log.personId,
    person: person.name || 'Unknown',
    role: person.jobTitle || '',
    projectId: log.projectId || '',
    project: project.name || 'Workspace',
    projectCode: project.code || '',
    taskId: task ? taskCode(task) : '',
    taskNumericId: log.taskId || '',
    task: task?.title || 'Daily update',
    action: log.action,
    statusFrom: log.statusFrom || '',
    statusTo: log.statusTo || '',
    status: log.statusTo || log.action,
    summary: log.summary || '',
    minutes: log.minutes || 0,
    source: log.source || 'Task event'
  }
}
function bucketLabel(period, dateValue) {
  if (period === 'daily') return fmt(dateValue, { weekday: 'short', month: 'short', day: 'numeric' })
  if (period === 'weekly') return `Week of ${fmt(bucketFor('weekly', dateValue, todayLA()), { month: 'short', day: 'numeric' })}`
  if (period === 'monthly') return fmt(`${dateValue.slice(0, 7)}-01`, { month: 'long', year: 'numeric' })
  return fmt(dateValue)
}
function activityReportFor(period = 'weekly', userId = 'all') {
  period = String(period).toLowerCase()
  if (!['daily', 'weekly', 'monthly'].includes(period)) period = 'weekly'
  const today = todayLA()
  const buckets = makeBuckets(period, today).slice(period === 'daily' ? -14 : period === 'weekly' ? -8 : -12)
  const bucketKeys = new Set(buckets.map(bucket => bucket.key))
  const includeUser = value => !userId || userId === 'all' || String(value) === String(userId)
  const detailRows = (store.workLogs || []).map(log => workLogPublic(log, period)).filter(row => bucketKeys.has(row.periodKey) && includeUser(row.personId))
  const activityRows = store.activities.map(activity => {
    const person = personById(activity.personId) || {}
    return { id: `activity_${activity.id}`, date: activity.date, time: activity.time || '', periodKey: bucketFor(period, activity.date, today), periodLabel: bucketLabel(period, activity.date), personId: activity.personId, person: person.name || 'Unknown', role: person.jobTitle || '', projectId: '', project: 'Workspace', projectCode: '', taskId: '', taskNumericId: '', task: 'Daily update', action: activity.blocked ? 'Raised blocker' : 'Logged update', statusFrom: '', statusTo: activity.blocked ? 'Blocked' : 'Confirmed', status: activity.blocked ? 'Blocked' : 'Confirmed', summary: [activity.yesterday && `Yesterday: ${activity.yesterday}`, activity.today && `Today: ${activity.today}`, activity.blocked && `Blocked: ${activity.blocked}`, activity.upcoming && `Upcoming: ${activity.upcoming}`].filter(Boolean).join(' | '), minutes: 0, source: 'Activity log' }
  }).filter(row => bucketKeys.has(row.periodKey) && includeUser(row.personId))
  const allRows = [...detailRows, ...activityRows].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
  const people = store.people.filter(person => includeUser(person.id))
  const userSummaries = people.map(person => {
    const rows = allRows.filter(row => row.personId === person.id)
    const taskRows = rows.filter(row => row.taskNumericId)
    const completed = taskRows.filter(row => terminalTaskStates().includes(row.statusTo) || row.action.toLowerCase().includes('completed')).length
    return { personId: person.id, person: person.name, role: person.jobTitle, team: teamById(person.teamId)?.name || 'Workspace', tasksTouched: new Set(taskRows.map(row => row.taskNumericId)).size, completedTasks: completed, projects: new Set(taskRows.map(row => row.project).filter(Boolean)).size, updates: rows.filter(row => row.source === 'Activity log').length, blockers: rows.filter(row => row.statusTo === 'Blocked' || row.summary.toLowerCase().includes('blocked')).length, minutes: rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0) }
  }).filter(summary => summary.tasksTouched || summary.updates || userId !== 'all')
  const projectSummaries = Object.values(allRows.filter(row => row.project && row.project !== 'Workspace').reduce((acc, row) => {
    acc[row.project] ||= { project: row.project, projectCode: row.projectCode, tasksTouched: new Set(), completedTasks: 0, users: new Set(), minutes: 0 }
    acc[row.project].tasksTouched.add(row.taskNumericId)
    if (terminalTaskStates().includes(row.statusTo) || row.action.toLowerCase().includes('completed')) acc[row.project].completedTasks += 1
    acc[row.project].users.add(row.person)
    acc[row.project].minutes += Number(row.minutes || 0)
    return acc
  }, {})).map(item => ({ ...item, tasksTouched: item.tasksTouched.size, users: item.users.size }))
  const series = buckets.map(bucket => {
    const rows = allRows.filter(row => row.periodKey === bucket.key)
    const taskRows = rows.filter(row => row.taskNumericId)
    return { key: bucket.key, label: bucket.label, tasksTouched: new Set(taskRows.map(row => row.taskNumericId)).size, completedTasks: taskRows.filter(row => terminalTaskStates().includes(row.statusTo) || row.action.toLowerCase().includes('completed')).length, users: new Set(rows.map(row => row.personId)).size, updates: rows.filter(row => row.source === 'Activity log').length, minutes: rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0) }
  })
  return { period, userId, scope: userId === 'all' ? 'All users' : (personById(userId)?.name || 'Selected user'), generatedAt: new Date().toISOString(), series, users: userSummaries, projects: projectSummaries, rows: allRows, totals: { tasksTouched: new Set(allRows.filter(row => row.taskNumericId).map(row => row.taskNumericId)).size, completedTasks: allRows.filter(row => terminalTaskStates().includes(row.statusTo) || row.action.toLowerCase().includes('completed')).length, activeUsers: new Set(allRows.map(row => row.personId)).size, projects: new Set(allRows.map(row => row.project).filter(project => project && project !== 'Workspace')).size, updates: allRows.filter(row => row.source === 'Activity log').length, blockers: allRows.filter(row => row.statusTo === 'Blocked' || row.summary.toLowerCase().includes('blocked')).length, minutes: allRows.reduce((sum, row) => sum + Number(row.minutes || 0), 0) } }
}

function nextProjectId() { const value = store.counters.project || (Math.max(0, ...store.projects.map(p => Number(p.id))) + 1); store.counters.project = value + 1; return value }
function nextTaskId() { const value = store.counters.task || (Math.max(0, ...store.tasks.map(t => Number(t.id))) + 1); store.counters.task = value + 1; return value }
function sendError(res, status, error) { res.status(status).json({ error }) }
function requireUser(req, res, next) {
  const sid = req.cookies.atlas_sid
  const userId = sid && sessions.get(sid)
  const user = store.users.find(u => u.id === userId)
  if (!user) return sendError(res, 401, 'Sign in to continue')
  if (user.active === false) return sendError(res, 403, 'This account is disabled')
  req.user = user
  next()
}
function requirePermission(permission, message = 'You do not have permission to complete this action') {
  return (req, res, next) => {
    if (!can(req.user, permission)) return sendError(res, 403, message)
    next()
  }
}
function requireManager(req, res, next) {
  if (!can(req.user, 'manageProjects') && !can(req.user, 'managePeople') && !can(req.user, 'manageAlerts')) return sendError(res, 403, 'Manager or administrator access required')
  next()
}
function requireAdmin(req, res, next) {
  if (!can(req.user, 'manageSettings')) return sendError(res, 403, 'Administrator access required')
  next()
}

const app = express()
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', process.env.NODE_ENV === 'production' ? 'SAMEORIGIN' : 'ALLOWALL')
  if (process.env.NODE_ENV === 'production') res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'")
  next()
})
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))

app.get('/api/health', (req, res) => res.json({ ok: true, name: 'Atlas Workspace', version: '1.0.0', mode: process.env.NODE_ENV || 'development', desktopReady: true, time: new Date().toISOString() }))
app.get('/api/runtime-config', (req, res) => res.json({ packagingMode: process.env.NODE_ENV === 'production' ? 'production-web' : 'development-web', designSystem: { version: DESIGN_SYSTEM_VERSION, localFonts: true, externalUiAssets: false }, database: { fileName: path.relative(root, dataFile), storeModel: DATABASE_MODEL, schemaVersion: STORE_SCHEMA_VERSION, atomicWrites: true, backupRetention: BACKUP_RETENTION }, packaging: { web: true, pwa: true, localAssets: true } }))
app.get('/api/setup/status', (req, res) => res.json({
  configured: Boolean(store.configured),
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
app.post('/api/setup', (req, res) => {
  const { name, email, password, includeDemo = false, workspaceName = 'Atlas Workspace', workspaceUnit = 'Operations', settings = {} } = req.body || {}
  if (!name || !email || !password || password.length < 8) return sendError(res, 400, 'Name, email, and an 8 character password are required')
  store = includeDemo && allowDemoData ? demoStore() : productionStore()
  const personId = id('person')
  const teamId = id('team')
  const initialTeamName = String(workspaceUnit || 'Operations').trim() || 'Operations'
  store.teams.push({ id: teamId, name: initialTeamName, color: 'purple', sample: false })
  store.people.push({ id: personId, name, email, jobTitle: 'Workspace Administrator', teamId, focus: 'Workspace setup', capacity: 75, status: 'On track', color: 'purple', sample: false })
  const user = { id: id('user'), name, email, passwordHash: hashPassword(password), role: 'Administrator', personId, avatarColor: 'purple', active: true, createdAt: new Date().toISOString(), sample: false }
  store.users.push(user)
  store.settings = normalizeSettings({ ...store.settings, ...(settings || {}), workspaceName, workspaceUnit, workspace: { ...((settings || {}).workspace || {}), name: workspaceName || settings?.workspace?.name || 'Atlas Workspace', unit: workspaceUnit || settings?.workspace?.unit || 'Operations' } })
  store.configured = true
  auditLog('workspace.setup.completed', user.id, { workspaceName, workspaceUnit })
  persist({ reason: 'setup' })
  const sid = id('sid')
  sessions.set(sid, user.id)
  res.cookie('atlas_sid', sid, sessionCookieOptions())
  res.json({ setup: { configured: true }, user: publicUser(user) })
})
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = store.users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase())
  if (!user || !verifyPassword(password, user)) return sendError(res, 401, 'Invalid email or password')
  if (user.active === false) return sendError(res, 403, 'This account is disabled. Contact an administrator.')
  if (user.password && !user.passwordHash) normalizeUserSecrets(user)
  user.lastLoginAt = new Date().toISOString()
  auditLog('auth.login', user.id, { email: user.email })
  persist({ reason: 'login' })
  const sid = id('sid')
  sessions.set(sid, user.id)
  res.cookie('atlas_sid', sid, sessionCookieOptions())
  res.json({ user: publicUser(user) })
})
app.post('/api/auth/logout', (req, res) => { if (req.cookies.atlas_sid) sessions.delete(req.cookies.atlas_sid); res.clearCookie('atlas_sid', sessionCookieOptions()); res.json({ ok: true }) })
app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }))
app.get('/api/bootstrap', requireUser, (req, res) => res.json(bootstrapFor(req.user)))
app.get('/api/reports/:period', requireUser, requirePermission('viewReports'), (req, res) => res.json(reportFor(req.params.period)))
app.get('/api/reports/activity/:period', requireUser, requirePermission('viewReports'), (req, res) => res.json(activityReportFor(req.params.period, req.query.userId || 'all')))
app.get('/api/system', requireUser, requireAdmin, (req, res) => {
  const validation = validateStoreState(store)
  const backups = listBackups()
  res.json({ ok: validation.integrity === 'ok', integrity: validation.integrity, errors: validation.errors, warnings: validation.warnings, checksum: storeChecksum(store), store: { fileName: path.relative(root, dataFile), storeModel: DATABASE_MODEL, schemaVersion: STORE_SCHEMA_VERSION, meta: store.meta, backups: backups.slice(0, 5).map(backup => ({ file: backup.file, createdAt: backup.createdAt })), backupCount: backups.length, sampleRows: [...store.people, ...store.projects, ...store.tasks, ...store.activities, ...store.alerts, ...(store.workLogs || [])].filter(row => row.sample).length, livePeople: store.people.filter(p => !p.sample).length }, counts: { teams: store.teams.length, people: store.people.length, projects: store.projects.length, tasks: store.tasks.length, activity: store.activities.length, alerts: store.alerts.length, workLogs: (store.workLogs || []).length, auditLogs: (store.auditLogs || []).length } })
})
app.get('/api/settings/export', requireUser, requireAdmin, (req, res) => res.json({ exportedAt: new Date().toISOString(), schemaVersion: STORE_SCHEMA_VERSION, settings: store.settings }))
app.post('/api/settings/import', requireUser, requireAdmin, (req, res) => { store.settings = normalizeSettings(req.body?.settings || req.body || {}); auditLog('settings.imported', req.user.id, { keys: Object.keys(req.body?.settings || req.body || {}) }); persist({ reason: 'settings-import' }); res.json(store.settings) })
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
  const localization = store.settings.localization || {}
  const fallback = localization.fallbackLanguage || 'en'
  const baseKeys = Object.keys(localization.translations?.[fallback] || {})
  const missing = Object.fromEntries((localization.activeLanguages || []).map(lang => [lang, baseKeys.filter(key => !localization.translations?.[lang]?.[key])]))
  const totalMissing = Object.values(missing).reduce((sum, rows) => sum + rows.length, 0)
  res.json({ fallback, keys: baseKeys, missing, totalMissing, byLanguage: missing })
})
app.get('/api/i18n/catalog', (req, res) => res.json(translationCatalogPayload(req.query.language || req.query.lang || null)))
app.post('/api/i18n/missing', (req, res) => {
  const localization = store.settings.localization || {}
  if (localization.runtime?.reportMissing === false) return res.json({ ok: true, ignored: true })
  const key = String(req.body?.key || '').trim()
  if (!key) return res.json({ ok: true, ignored: true })
  const language = String(req.body?.language || localization.defaultLanguage || 'en')
  const row = { key, language, fallback: String(req.body?.fallback || ''), source: String(req.body?.source || 'runtime'), firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), count: 1, status: 'missing' }
  localization.missingKeys = Array.isArray(localization.missingKeys) ? localization.missingKeys : []
  const existing = localization.missingKeys.find(item => item.key === key && item.language === language)
  if (existing) { existing.lastSeenAt = row.lastSeenAt; existing.count = Number(existing.count || 0) + 1; if (row.fallback) existing.fallback = row.fallback }
  else localization.missingKeys.push(row)
  store.settings.localization = localization
  if (store.configured) persist({ reason: 'i18n-missing' })
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
app.post('/api/system/backup', requireUser, requireAdmin, (req, res) => { const backup = createBackup('admin'); auditLog('system.backup.created', req.user.id, { backup: backup && path.basename(backup) }); persist({ reason: 'backup-audit' }); res.json({ ok: Boolean(backup), backup: backup && path.basename(backup) }) })
app.put('/api/settings', requireUser, requireAdmin, (req, res) => { store.settings = normalizeSettings({ ...store.settings, ...req.body }); auditLog('settings.updated', req.user.id, { branches: Object.keys(req.body || {}) }); persist({ reason: 'settings' }); res.json(store.settings) })
app.delete('/api/setup/seed', requireUser, requireAdmin, (req, res) => {
  const keepPersonIds = new Set(store.users.map(u => u.personId))
  store.tasks = store.tasks.filter(t => !t.sample)
  store.projects = store.projects.filter(p => !p.sample)
  store.milestones = store.milestones.filter(m => !m.sample)
  store.activities = store.activities.filter(a => !a.sample)
  store.alerts = store.alerts.filter(a => !a.sample)
  store.workLogs = (store.workLogs || []).filter(log => !log.sample)
  store.people = store.people.filter(p => !p.sample || keepPersonIds.has(p.id))
  store.teams = store.teams.filter(t => !t.sample || store.people.some(p => p.teamId === t.id))
  auditLog('demo-data.removed', req.user.id, {})
  persist({ reason: 'remove-demo' }); res.json({ ok: true })
})
app.post('/api/tasks', requireUser, requirePermission('writeTasks'), (req, res) => {
  const task = { id: nextTaskId(), title: req.body.title || 'Untitled task', projectId: parseNumber(req.body.projectId, store.projects[0]?.id), assigneeId: req.body.assigneeId || req.user.personId, priority: req.body.priority || 'Medium', dueDate: req.body.dueDate || todayLA(), status: req.body.status || taskWorkflowStates()[0] || 'To do', type: req.body.type || 'Development', blocked: Boolean(req.body.blocked), customFields: req.body.customFields || {}, createdAt: todayLA(), sample: false }
  if (isDone(task)) task.completedAt = todayLA()
  store.tasks.push(task); logWorkEvent({ personId: task.assigneeId, taskId: task.id, projectId: task.projectId, action: 'Created task', statusTo: task.status, summary: task.title, minutes: 20 }); auditLog('task.created', req.user.id, { taskId: task.id, projectId: task.projectId }); persist({ reason: 'task-create' }); res.json(taskPublic(task, todayLA()))
})
app.put('/api/tasks/:id', requireUser, requirePermission('writeTasks'), (req, res) => {
  const task = taskById(req.params.id); if (!task) return sendError(res, 404, 'Task not found')
  const previousSummary = { status: task.status, assigneeId: task.assigneeId, projectId: task.projectId, title: task.title }
  Object.assign(task, { title: req.body.title ?? task.title, projectId: parseNumber(req.body.projectId, task.projectId), assigneeId: req.body.assigneeId ?? task.assigneeId, priority: req.body.priority ?? task.priority, dueDate: req.body.dueDate ?? task.dueDate, status: req.body.status ?? task.status, type: req.body.type ?? task.type, blocked: Boolean(req.body.blocked), customFields: req.body.customFields ?? task.customFields ?? {} })
  task.completedAt = isDone(task) ? (task.completedAt || todayLA()) : undefined
  logWorkEvent({ personId: task.assigneeId, taskId: task.id, projectId: task.projectId, action: 'Updated task', statusFrom: previousSummary.status, statusTo: task.status, summary: task.title, minutes: 25 })
  auditLog('task.updated', req.user.id, { taskId: task.id, previousStatus: previousSummary.status, status: task.status }); persist({ reason: 'task-update' }); res.json(taskPublic(task, todayLA()))
})
app.patch('/api/tasks/:id/status', requireUser, requirePermission('writeTasks'), (req, res) => {
  const task = taskById(req.params.id); if (!task) return sendError(res, 404, 'Task not found')
  const statuses = taskWorkflowStates()
  const previousStatus = task.status
  if (req.body.status && statuses.includes(req.body.status)) task.status = req.body.status
  else if (req.body.advance) task.status = statuses[Math.min(statuses.length - 1, Math.max(0, statuses.indexOf(task.status)) + 1)] || statuses[0] || 'To do'
  task.completedAt = isDone(task) ? (task.completedAt || todayLA()) : undefined
  if (previousStatus !== task.status) logWorkEvent({ personId: task.assigneeId, taskId: task.id, projectId: task.projectId, action: isDone(task) ? 'Completed task' : 'Moved task', statusFrom: previousStatus, statusTo: task.status, summary: task.title, minutes: isDone(task) ? 90 : 45 })
  auditLog('task.status.changed', req.user.id, { taskId: task.id, from: previousStatus, to: task.status }); persist({ reason: 'task-status' }); res.json(taskPublic(task, todayLA()))
})
app.delete('/api/tasks/:id', requireUser, requirePermission('manageTasks'), (req, res) => { store.tasks = store.tasks.filter(t => String(t.id) !== String(req.params.id)); auditLog('task.deleted', req.user.id, { taskId: req.params.id }); persist({ reason: 'task-delete' }); res.json({ ok: true }) })
app.post('/api/projects', requireUser, requirePermission('manageProjects'), (req, res) => { const project = { id: nextProjectId(), name: req.body.name || 'Untitled project', code: (req.body.code || 'NEW').toUpperCase(), description: req.body.description || '', teamId: req.body.teamId || store.teams[0]?.id, ownerId: req.body.ownerId || req.user.personId, color: req.body.color || 'purple', status: req.body.status || 'On track', deadline: req.body.deadline || todayLA(), createdAt: todayLA(), customFields: req.body.customFields || {}, sample: false }; store.projects.push(project); auditLog('project.created', req.user.id, { projectId: project.id }); persist({ reason: 'project-create' }); res.json(projectPublic(project, todayLA())) })
app.put('/api/projects/:id', requireUser, requirePermission('manageProjects'), (req, res) => { const project = projectById(req.params.id); if (!project) return sendError(res, 404, 'Project not found'); Object.assign(project, { name: req.body.name ?? project.name, code: (req.body.code ?? project.code).toUpperCase(), description: req.body.description ?? project.description, teamId: req.body.teamId ?? project.teamId, ownerId: req.body.ownerId ?? project.ownerId, color: req.body.color ?? project.color, status: req.body.status ?? project.status, deadline: req.body.deadline ?? project.deadline, customFields: req.body.customFields ?? project.customFields ?? {} }); auditLog('project.updated', req.user.id, { projectId: project.id }); persist({ reason: 'project-update' }); res.json(projectPublic(project, todayLA())) })
app.delete('/api/projects/:id', requireUser, requirePermission('manageProjects'), (req, res) => { store.projects = store.projects.filter(p => String(p.id) !== String(req.params.id)); store.tasks = store.tasks.filter(t => String(t.projectId) !== String(req.params.id)); store.milestones = store.milestones.filter(m => String(m.projectId) !== String(req.params.id)); auditLog('project.deleted', req.user.id, { projectId: req.params.id }); persist({ reason: 'project-delete' }); res.json({ ok: true }) })
app.post('/api/people', requireUser, requirePermission('managePeople'), (req, res) => { const person = { id: id('person'), name: req.body.name || 'New person', email: req.body.email || `${Date.now()}@atlas.local`, jobTitle: req.body.jobTitle || 'Contributor', teamId: req.body.teamId || store.teams[0]?.id, focus: req.body.focus || 'Workspace priorities', capacity: parseNumber(req.body.capacity, 70), status: req.body.status || 'On track', color: req.body.color || 'purple', customFields: req.body.customFields || {}, sample: false }; store.people.push(person); auditLog('person.created', req.user.id, { personId: person.id }); persist({ reason: 'person-create' }); res.json(personPublic(person)) })
app.put('/api/people/:id', requireUser, requirePermission('managePeople'), (req, res) => { const person = personById(req.params.id); if (!person) return sendError(res, 404, 'Person not found'); Object.assign(person, { name: req.body.name ?? person.name, email: req.body.email ?? person.email, jobTitle: req.body.jobTitle ?? person.jobTitle, teamId: req.body.teamId ?? person.teamId, focus: req.body.focus ?? person.focus, capacity: parseNumber(req.body.capacity, person.capacity), status: req.body.status ?? person.status, color: req.body.color ?? person.color, customFields: req.body.customFields ?? person.customFields ?? {} }); auditLog('person.updated', req.user.id, { personId: person.id }); persist({ reason: 'person-update' }); res.json(personPublic(person)) })
app.delete('/api/people/:id', requireUser, requirePermission('managePeople'), (req, res) => { if (store.users.some(u => u.personId === req.params.id)) return sendError(res, 400, 'Cannot delete a person linked to an active account'); store.people = store.people.filter(p => p.id !== req.params.id); store.tasks.forEach(t => { if (t.assigneeId === req.params.id) t.assigneeId = req.user.personId }); auditLog('person.deleted', req.user.id, { personId: req.params.id }); persist({ reason: 'person-delete' }); res.json({ ok: true }) })
app.post('/api/teams', requireUser, requirePermission('managePeople'), (req, res) => { const team = { id: id('team'), name: req.body.name || 'New team', color: req.body.color || 'purple', customFields: req.body.customFields || {}, sample: false }; store.teams.push(team); auditLog('team.created', req.user.id, { teamId: team.id }); persist({ reason: 'team-create' }); res.json(team) })
app.put('/api/teams/:id', requireUser, requirePermission('managePeople'), (req, res) => { const team = teamById(req.params.id); if (!team) return sendError(res, 404, 'Team not found'); Object.assign(team, { name: req.body.name ?? team.name, color: req.body.color ?? team.color, customFields: req.body.customFields ?? team.customFields ?? {} }); auditLog('team.updated', req.user.id, { teamId: team.id }); persist({ reason: 'team-update' }); res.json(team) })
app.delete('/api/teams/:id', requireUser, requirePermission('managePeople'), (req, res) => { if (store.people.some(p => p.teamId === req.params.id)) return sendError(res, 400, 'Move people before deleting this team'); store.teams = store.teams.filter(t => t.id !== req.params.id); auditLog('team.deleted', req.user.id, { teamId: req.params.id }); persist({ reason: 'team-delete' }); res.json({ ok: true }) })
app.post('/api/milestones', requireUser, requirePermission('manageProjects'), (req, res) => { const milestone = { id: id('milestone'), name: req.body.name || 'New milestone', projectId: parseNumber(req.body.projectId, store.projects[0]?.id), dueDate: req.body.dueDate || todayLA(), status: req.body.status || 'Upcoming', customFields: req.body.customFields || {}, sample: false }; store.milestones.push(milestone); auditLog('milestone.created', req.user.id, { milestoneId: milestone.id }); persist({ reason: 'milestone-create' }); res.json(milestone) })
app.put('/api/milestones/:id', requireUser, requirePermission('manageProjects'), (req, res) => { const milestone = store.milestones.find(m => m.id === req.params.id); if (!milestone) return sendError(res, 404, 'Milestone not found'); Object.assign(milestone, { name: req.body.name ?? milestone.name, projectId: parseNumber(req.body.projectId, milestone.projectId), dueDate: req.body.dueDate ?? milestone.dueDate, status: req.body.status ?? milestone.status, customFields: req.body.customFields ?? milestone.customFields ?? {} }); auditLog('milestone.updated', req.user.id, { milestoneId: milestone.id }); persist({ reason: 'milestone-update' }); res.json(milestone) })
app.delete('/api/milestones/:id', requireUser, requirePermission('manageProjects'), (req, res) => { store.milestones = store.milestones.filter(m => m.id !== req.params.id); auditLog('milestone.deleted', req.user.id, { milestoneId: req.params.id }); persist({ reason: 'milestone-delete' }); res.json({ ok: true }) })
app.post('/api/activity', requireUser, requirePermission('logActivity'), (req, res) => { const activity = { id: id('activity'), personId: req.body.personId || req.user.personId, date: todayLA(), time: timeLA(), yesterday: req.body.yesterday || '', today: req.body.today || '', blocked: req.body.blocked || '', upcoming: req.body.upcoming || '', status: req.body.status || 'Confirmed', customFields: req.body.customFields || {}, sample: false }; store.activities.push(activity); logWorkEvent({ personId: activity.personId, action: activity.blocked ? 'Raised blocker' : 'Logged update', statusTo: activity.blocked ? 'Blocked' : 'Confirmed', summary: [activity.today, activity.blocked].filter(Boolean).join(' · '), minutes: 0 }); auditLog('activity.logged', req.user.id, { activityId: activity.id, personId: activity.personId }); persist({ reason: 'activity' }); res.json(activityPublic(activity, todayLA())) })
app.delete('/api/activity/:id', requireUser, requirePermission('manageTasks'), (req, res) => { store.activities = store.activities.filter(a => a.id !== req.params.id); auditLog('activity.deleted', req.user.id, { activityId: req.params.id }); persist({ reason: 'activity-delete' }); res.json({ ok: true }) })
app.post('/api/alerts', requireUser, requirePermission('manageAlerts'), (req, res) => { const alert = { id: id('alert'), title: req.body.title || 'New alert', body: req.body.body || '', type: req.body.type || 'info', tone: req.body.tone || (req.body.type === 'risk' ? 'orange' : 'blue'), projectId: req.body.projectId || '', taskId: req.body.taskId || '', resolved: false, createdAt: todayLA(), customFields: req.body.customFields || {}, sample: false }; store.alerts.push(alert); auditLog('alert.created', req.user.id, { alertId: alert.id }); persist({ reason: 'alert-create' }); res.json(alertPublic(alert)) })
app.patch('/api/alerts/:id', requireUser, (req, res) => {
  const editKeys = Object.keys(req.body || {}).filter(key => key !== 'resolved')
  if (editKeys.length && !can(req.user, 'manageAlerts')) return sendError(res, 403, 'Manager or administrator access required to edit alerts')
  if (!editKeys.length && typeof req.body.resolved === 'boolean' && !can(req.user, 'writeTasks')) return sendError(res, 403, 'Task write access required to resolve alerts')
  const alert = store.alerts.find(a => a.id === req.params.id); if (!alert) return sendError(res, 404, 'Alert not found')
  Object.assign(alert, { title: req.body.title ?? alert.title, body: req.body.body ?? alert.body, type: req.body.type ?? alert.type, tone: req.body.tone ?? alert.tone, projectId: req.body.projectId ?? alert.projectId, taskId: req.body.taskId ?? alert.taskId, customFields: req.body.customFields ?? alert.customFields ?? {} })
  if (typeof req.body.resolved === 'boolean') alert.resolved = req.body.resolved
  auditLog('alert.updated', req.user.id, { alertId: alert.id, resolved: alert.resolved })
  persist({ reason: 'alert-update' }); res.json(alertPublic(alert))
})
app.delete('/api/alerts/:id', requireUser, requirePermission('manageAlerts'), (req, res) => { store.alerts = store.alerts.filter(a => a.id !== req.params.id); auditLog('alert.deleted', req.user.id, { alertId: req.params.id }); persist({ reason: 'alert-delete' }); res.json({ ok: true }) })


app.get('/api/users', requireUser, requirePermission('manageUsers'), (req, res) => res.json(store.users.map(publicAccessUser)))
app.post('/api/users', requireUser, requirePermission('manageUsers'), (req, res) => {
  const { name, email, password, role = 'Viewer', personId, active = true, avatarColor = 'purple' } = req.body || {}
  if (!name || !email || !password || password.length < 8) return sendError(res, 400, 'Name, email, and an 8 character password are required')
  if (!store.settings.permissions.roles[role]) return sendError(res, 400, 'Unknown role')
  if (store.users.some(user => user.email.toLowerCase() === String(email).toLowerCase())) return sendError(res, 409, 'A user with this email already exists')
  let linkedPersonId = personId
  if (!linkedPersonId) {
    const teamId = store.teams[0]?.id || id('team')
    if (!store.teams.some(team => team.id === teamId)) store.teams.push({ id: teamId, name: 'Workspace', color: 'purple', sample: false })
    linkedPersonId = id('person')
    store.people.push({ id: linkedPersonId, name, email, jobTitle: role, teamId, focus: 'Workspace access', capacity: 70, status: 'On track', color: avatarColor, sample: false })
  }
  const user = { id: id('user'), name, email, passwordHash: hashPassword(password), role, personId: linkedPersonId, avatarColor, active: Boolean(active), createdAt: new Date().toISOString(), sample: false }
  store.users.push(user); auditLog('user.created', req.user.id, { userId: user.id, role }); persist({ reason: 'user-create' }); res.json(publicAccessUser(user))
})
app.put('/api/users/:id', requireUser, requirePermission('manageUsers'), (req, res) => {
  const user = store.users.find(item => item.id === req.params.id)
  if (!user) return sendError(res, 404, 'User not found')
  if (user.id === req.user.id && req.body.active === false) return sendError(res, 400, 'You cannot disable your own account')
  if (req.body.role && !store.settings.permissions.roles[req.body.role]) return sendError(res, 400, 'Unknown role')
  Object.assign(user, { name: req.body.name ?? user.name, email: req.body.email ?? user.email, role: req.body.role ?? user.role, personId: req.body.personId ?? user.personId, avatarColor: req.body.avatarColor ?? user.avatarColor, active: typeof req.body.active === 'boolean' ? req.body.active : user.active })
  if (req.body.password) {
    if (String(req.body.password).length < 8) return sendError(res, 400, 'Password must be at least 8 characters')
    user.passwordHash = hashPassword(req.body.password)
    delete user.password
  }
  auditLog('user.updated', req.user.id, { userId: user.id, role: user.role, active: user.active }); persist({ reason: 'user-update' }); res.json(publicAccessUser(user))
})
app.delete('/api/users/:id', requireUser, requirePermission('manageUsers'), (req, res) => {
  if (req.params.id === req.user.id) return sendError(res, 400, 'You cannot delete your own account')
  const target = store.users.find(user => user.id === req.params.id)
  if (target?.role === 'Administrator' && store.users.filter(user => user.role === 'Administrator' && user.active !== false && user.id !== req.params.id).length === 0) return sendError(res, 400, 'You cannot delete the last active administrator')
  store.users = store.users.filter(user => user.id !== req.params.id)
  auditLog('user.deleted', req.user.id, { userId: req.params.id })
  persist({ reason: 'user-delete' }); res.json({ ok: true })
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
