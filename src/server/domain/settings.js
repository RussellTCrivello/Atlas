const DEFAULT_NAVIGATION = ['overview', 'projects', 'tasks', 'people', 'activity', 'reports', 'alerts']
const DEFAULT_WORKFLOW_STATES = [
  { id: 'todo', label: 'To do', color: 'muted', terminal: false },
  { id: 'in_progress', label: 'In progress', color: 'blue', terminal: false },
  { id: 'review', label: 'Review', color: 'purple', terminal: false },
  { id: 'testing', label: 'Testing', color: 'orange', terminal: false },
  { id: 'done', label: 'Done', color: 'green', terminal: true }
]
const BUILTIN_REPORT_TEMPLATES = ['executive', 'ledger', 'compact']
const EXPORT_FORMATS = ['csv', 'xlsx', 'json', 'pdf', 'print']
const WORKFLOW_COLORS = ['muted', 'blue', 'purple', 'orange', 'green', 'pink', 'teal']
const ACCENT_PRIMARY_COLORS = { purple: '#6d5dfc', blue: '#3b82f6', green: '#28a778', orange: '#f2994a' }
const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
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

export function createSettingsService({
  ROLE_PERMISSIONS, boundedInteger, isPlainObject, isValidTimezone, id, env = process.env,
  DATABASE_MODEL, STORE_SCHEMA_VERSION, I18N_MISSING_LIMIT = 2000, MAX_I18N_KEY_LENGTH = 200,
  DEFAULT_BACKUP_RETENTION = 25, MIN_PASSWORD_LENGTH = 8, cookieSecure = false, allowDemoData = false
}) {
function roleRegistryDefaults() {
  const ranks = { Viewer: 1, Developer: 2, Manager: 3, Administrator: 4 }
  return Object.fromEntries(Object.entries(ROLE_PERMISSIONS).map(([name, permissions]) => [name, { name, description: ROLE_DESCRIPTIONS[name] || `${name} role`, permissions, rank: ranks[name] || 1, system: name === 'Administrator' }]))
}
function defaultSettings() {
  const settings = {
    workspace: {
      name: 'Atlas Workspace', unit: 'Operations', logo: '', applicationName: 'Atlas Workspace',
      branding: { primaryColor: '#6d5dfc', accentColor: 'purple', reportLogo: '', loginHeadline: 'Operate with clarity.' },
      organization: { legalName: '', website: '', address: '', contactEmail: '' },
      defaultTimezone: env.ATLAS_TIMEZONE || 'America/Los_Angeles', defaultLanguage: 'en',
      regionalFormats: { date: 'MMM d, yyyy', number: 'latn', currency: 'USD', timezone: 'short' },
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], workingHours: { start: '09:00', end: '17:00' }, holidays: []
    },
    interface: {
      theme: 'light', colors: { accent: 'purple', primary: '#6d5dfc' }, density: 'comfortable', spacing: 'comfortable',
      typography: { family: 'Atlas Sans', scale: 100 }, sidebarBehavior: 'expanded',
      navigationVisibility: Object.fromEntries(DEFAULT_NAVIGATION.map(page => [page, true])), navigationOrder: [...DEFAULT_NAVIGATION],
      dashboardLayouts: { overview: ['stats', 'dailyPulse', 'projectHealth', 'myFocus'] }, defaultLandingPage: 'overview',
      tableBehavior: { pageSize: 50, stickyHeaders: true, zebraRows: false }, tableColumns: { projects: ['name','code','team','health','progress','deadline'], tasks: ['id','title','project','status','priority','assignee','due'], people: ['name','email','role','team','status','load'], activity: ['person','date','today','blocked'], alerts: ['title','type','project','resolved','time'], users: ['name','email','role','team','active'] }, formLayouts: { projects: ['name','code','description','teamId','ownerId','status','deadline'], tasks: ['title','projectId','assigneeId','priority','dueDate','status','type','blocked'], people: ['name','email','jobTitle','teamId','focus','capacity','status'], teams: ['name','color'], milestones: ['name','projectId','dueDate','status'], activities: ['personId','yesterday','today','blocked','upcoming'], alerts: ['title','body','type','projectId'], users: ['name','email','role','personId','password','active','avatarColor'] }, actionVisibility: { create: true, edit: true, delete: true, export: true, print: true }, cardLayouts: { projects: 'grid', tasks: 'board' },
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
    customFields: { projects: [], tasks: [], people: [], teams: [], milestones: [], activities: [], alerts: [], reports: [] },
    permissions: { roles: roleRegistryDefaults(), moduleAccess: {}, fieldAccess: {}, actionAccess: {}, exportPermissions: {}, reportingPermissions: {} },
    notifications: { enabled: true, channels: { inApp: true, email: false, webhook: false }, events: { taskAssigned: true, alertCreated: true, reportReady: true } },
    reports: { defaultTemplate: 'executive', templates: [...BUILTIN_REPORT_TEMPLATES], customColumns: {}, customFilters: {}, customCalculations: {}, localizedOutput: true, branding: { includeLogo: true, footerText: '' } },
    exports: { formats: ['csv', 'xlsx', 'json', 'pdf', 'print'], respectLanguage: true, respectDirection: true, includeBranding: true, pdf: { orientation: 'landscape', margins: 'standard' } },
    integrations: { registry: [], webhooks: [], apiAccess: false },
    storage: { model: DATABASE_MODEL, schemaVersion: STORE_SCHEMA_VERSION, backupRetention: DEFAULT_BACKUP_RETENTION, importExportEnabled: true },
    security: { passwordMinLength: MIN_PASSWORD_LENGTH, sessionDays: 14, cookieSecure, allowDemoData, requireApprovalForRoleChanges: false },
    audit: { enabled: true, retentionDays: 365, trackReads: false, trackWrites: true, trackExports: true },
    workLedger: { retentionMonths: 24 }
  }
  return withLegacySettings(settings)
}
function mergeDeep(target, source) {
  const out = isPlainObject(target) ? { ...target } : {}
  if (!isPlainObject(source)) return out
  Object.entries(source).forEach(([key, value]) => {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') return
    const previous = out[key]
    if (isPlainObject(previous) && !isPlainObject(value)) return
    const merged = isPlainObject(value) ? mergeDeep(isPlainObject(previous) ? previous : {}, value) : value
    Object.defineProperty(out, key, { value: merged, enumerable: true, configurable: true, writable: true })
  })
  return out
}
function mergeSettingsUpdate(existing, patch) {
  const merged = mergeDeep(existing, patch)
  const replacePaths = [
    ['interface', 'colors'], ['interface', 'navigationVisibility'], ['interface', 'actionVisibility'], ['interface', 'tableColumns'], ['interface', 'formLayouts'],
    ['interface', 'cardLayouts'], ['interface', 'dashboardLayouts'], ['modules'],
    ['localization', 'translations'], ['localization', 'interfaces'], ['localization', 'textDirectionByLanguage'],
    ['localization', 'dateFormats'], ['localization', 'numberFormats'], ['localization', 'currencyFormats'], ['localization', 'timezoneFormats'],
    ['localization', 'approvalWorkflow', 'statusByKey'],
    ['customFields'],
    ['permissions', 'roles'], ['permissions', 'moduleAccess'], ['permissions', 'fieldAccess'], ['permissions', 'actionAccess'],
    ['permissions', 'exportPermissions'], ['permissions', 'reportingPermissions'],
    ['notifications', 'channels'], ['notifications', 'events'],
    ['reports', 'customColumns'], ['reports', 'customFilters'], ['reports', 'customCalculations']
  ]
  for (const parts of replacePaths) {
    let source = patch
    for (const part of parts) source = isPlainObject(source) ? source[part] : undefined
    if (source === undefined) continue
    let target = merged
    for (const part of parts.slice(0, -1)) target = target?.[part]
    if (!isPlainObject(target)) continue
    Object.defineProperty(target, parts.at(-1), { value: structuredClone(source), enumerable: true, configurable: true, writable: true })
  }
  return merged
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
  const source = isPlainObject(raw) ? raw : {}
  const next = mergeDeep(defaultSettings(), source)
  if (source.workspaceName && !source.workspace?.name) next.workspace.name = source.workspaceName
  if (source.workspaceUnit && !source.workspace?.unit) next.workspace.unit = source.workspaceUnit
  if (source.language && !source.localization?.defaultLanguage) { next.localization.defaultLanguage = source.language; next.workspace.defaultLanguage = source.language }
  if (source.dateFormat && !source.workspace?.regionalFormats?.date) next.workspace.regionalFormats.date = source.dateFormat
  if (source.theme && !source.interface?.theme) next.interface.theme = source.theme
  if (source.accentColor && !source.interface?.colors?.accent) { next.interface.colors.accent = source.accentColor; next.workspace.branding.accentColor = source.accentColor }
  if (source.density && !source.interface?.density) next.interface.density = source.density
  if (source.sidebarMode && !source.interface?.sidebarBehavior) next.interface.sidebarBehavior = source.sidebarMode
  if (source.defaultPage && !source.interface?.defaultLandingPage) next.interface.defaultLandingPage = source.defaultPage
  if (source.defaultTaskView && !source.interface?.cardLayouts?.tasks) next.interface.cardLayouts.tasks = source.defaultTaskView
  if (source.pageSize && !source.interface?.tableBehavior?.pageSize) next.interface.tableBehavior.pageSize = Number(source.pageSize)
  if (typeof source.showAnimations === 'boolean' && typeof source.interface?.animations !== 'boolean') next.interface.animations = source.showAnimations
  if (Array.isArray(source.enabledPages) && !source.interface?.navigationVisibility && !source.modules) DEFAULT_NAVIGATION.forEach(page => { next.interface.navigationVisibility[page] = source.enabledPages.includes(page); if (next.modules[page]) next.modules[page].enabled = source.enabledPages.includes(page) })

  const fallbackTimezone = isValidTimezone(env.ATLAS_TIMEZONE) ? env.ATLAS_TIMEZONE : 'America/Los_Angeles'
  if (!isValidTimezone(next.workspace.defaultTimezone)) next.workspace.defaultTimezone = fallbackTimezone
  next.security.passwordMinLength = boundedInteger(next.security.passwordMinLength, MIN_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, 128)
  next.security.sessionDays = boundedInteger(next.security.sessionDays, 14, 1, 365)
  next.security.cookieSecure = next.security.cookieSecure === true || cookieSecure
  next.storage.backupRetention = boundedInteger(next.storage.backupRetention, DEFAULT_BACKUP_RETENTION, 3, 100)
  next.audit.retentionDays = boundedInteger(next.audit.retentionDays, 365, 0, 3650)
  next.workLedger.retentionMonths = boundedInteger(next.workLedger.retentionMonths, 24, 0, 120)
  next.interface.tableBehavior.pageSize = boundedInteger(next.interface.tableBehavior.pageSize, 50, 1, 500)
  next.interface.theme = ['light', 'dark', 'system'].includes(next.interface.theme) ? next.interface.theme : 'light'
  next.interface.density = ['comfortable', 'compact'].includes(next.interface.density) ? next.interface.density : 'comfortable'
  next.interface.spacing = ['compact', 'comfortable', 'spacious'].includes(next.interface.spacing) ? next.interface.spacing : 'comfortable'
  next.interface.sidebarBehavior = ['expanded', 'collapsed'].includes(next.interface.sidebarBehavior) ? next.interface.sidebarBehavior : 'expanded'
  next.interface.colors.accent = ['purple', 'blue', 'green', 'orange'].includes(next.interface.colors.accent) ? next.interface.colors.accent : 'purple'
  const configuredPrimaryColor = source.interface?.colors?.primary || source.workspace?.branding?.primaryColor
  next.interface.colors.primary = typeof configuredPrimaryColor === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(configuredPrimaryColor)
    ? configuredPrimaryColor
    : ACCENT_PRIMARY_COLORS[next.interface.colors.accent]
  next.workspace.branding.primaryColor = next.interface.colors.primary
  next.interface.typography.family = ['Atlas Sans', 'system-ui', 'serif', 'monospace'].includes(next.interface.typography.family) ? next.interface.typography.family : 'Atlas Sans'
  next.interface.typography.scale = boundedInteger(next.interface.typography.scale, 100, 75, 200)
  next.interface.accessibility.scalableText = next.interface.typography.scale
  next.interface.defaultLandingPage = DEFAULT_NAVIGATION.includes(next.interface.defaultLandingPage) ? next.interface.defaultLandingPage : 'overview'
  const allowedWidgets = new Set(['stats', 'dailyPulse', 'projectHealth', 'myFocus'])
  next.interface.dashboardLayouts.overview = Array.isArray(next.interface.dashboardLayouts.overview)
    ? [...new Set(next.interface.dashboardLayouts.overview.filter(widget => allowedWidgets.has(widget)))]
    : ['stats', 'dailyPulse', 'projectHealth', 'myFocus']
  const templates = Array.isArray(next.reports.templates)
    ? [...new Set(next.reports.templates.filter(template => BUILTIN_REPORT_TEMPLATES.includes(template)))]
    : [...BUILTIN_REPORT_TEMPLATES]
  next.reports.templates = templates.length ? templates : ['executive']
  if (!next.reports.templates.includes(next.reports.defaultTemplate)) next.reports.defaultTemplate = next.reports.templates[0]
  next.reports.localizedOutput = next.reports.localizedOutput !== false
  next.reports.branding.footerText = typeof next.reports.branding.footerText === 'string' ? next.reports.branding.footerText.slice(0, 500) : ''
  next.exports.formats = Array.isArray(next.exports.formats) ? [...new Set(next.exports.formats.filter(format => EXPORT_FORMATS.includes(format)))] : [...EXPORT_FORMATS]
  next.exports.respectLanguage = next.exports.respectLanguage !== false
  next.exports.respectDirection = next.exports.respectDirection !== false
  next.exports.includeBranding = next.exports.includeBranding !== false
  next.exports.pdf.orientation = ['landscape', 'portrait'].includes(next.exports.pdf.orientation) ? next.exports.pdf.orientation : 'landscape'
  next.exports.pdf.margins = ['narrow', 'standard', 'wide'].includes(next.exports.pdf.margins) ? next.exports.pdf.margins : 'standard'
  next.storage.model = DATABASE_MODEL
  next.storage.schemaVersion = STORE_SCHEMA_VERSION

  next.localization.defaultLanguage = typeof next.localization.defaultLanguage === 'string' && LANGUAGE_CODE_PATTERN.test(next.localization.defaultLanguage) ? next.localization.defaultLanguage : 'en'
  next.localization.fallbackLanguage = typeof next.localization.fallbackLanguage === 'string' && LANGUAGE_CODE_PATTERN.test(next.localization.fallbackLanguage) ? next.localization.fallbackLanguage : 'en'
  const defaultPackages = defaultSettings().localization.languagePackages
  const configuredPackages = Array.isArray(next.localization.languagePackages)
    ? next.localization.languagePackages.filter(row => isPlainObject(row) && typeof row.code === 'string' && LANGUAGE_CODE_PATTERN.test(row.code))
    : defaultPackages
  const packageByCode = new Map()
  for (const row of configuredPackages) {
    if (!packageByCode.has(row.code)) packageByCode.set(row.code, row)
  }
  if (!packageByCode.has('en')) packageByCode.set('en', defaultPackages[0])
  const activeCandidates = Array.isArray(next.localization.activeLanguages)
    ? next.localization.activeLanguages.filter(code => typeof code === 'string' && LANGUAGE_CODE_PATTERN.test(code))
    : ['en']
  for (const code of [...activeCandidates, next.localization.defaultLanguage, next.localization.fallbackLanguage]) {
    if (!packageByCode.has(code)) packageByCode.set(code, { code, name: code, direction: ['ar', 'fa', 'he', 'ur'].includes(code) ? 'rtl' : 'ltr', enabled: true, version: '1.0.0', status: 'draft' })
  }
  for (const code of [next.localization.defaultLanguage, next.localization.fallbackLanguage, 'en']) {
    const pack = packageByCode.get(code)
    if (pack) packageByCode.set(code, { ...pack, enabled: true })
  }
  next.localization.languagePackages = [...packageByCode.values()].map(pack => ({
    ...pack,
    name: typeof pack.name === 'string' && pack.name.trim() ? pack.name.trim().slice(0, 100) : pack.code,
    direction: ['ltr', 'rtl'].includes(pack.direction) ? pack.direction : (['ar', 'fa', 'he', 'ur'].includes(pack.code) ? 'rtl' : 'ltr'),
    enabled: pack.enabled !== false,
    version: typeof pack.version === 'string' ? pack.version.slice(0, 40) : '1.0.0',
    status: ['draft', 'review', 'approved'].includes(pack.status) ? pack.status : 'draft'
  }))
  const enabledLanguageCodes = new Set(next.localization.languagePackages.filter(pack => pack.enabled).map(pack => pack.code))
  next.localization.activeLanguages = [...new Set([...activeCandidates, next.localization.defaultLanguage, next.localization.fallbackLanguage, 'en'])]
    .filter(code => enabledLanguageCodes.has(code))
  next.workspace.defaultLanguage = next.localization.defaultLanguage
  next.localization.translations = isPlainObject(next.localization.translations) ? next.localization.translations : {}
  next.localization.activeLanguages.forEach(code => {
    const configured = next.localization.translations[code]
    next.localization.translations[code] = { ...(DEFAULT_TRANSLATIONS[code] || {}), ...(isPlainObject(configured) ? configured : {}) }
  })
  next.localization.interfaces = mergeDeep({ core: { namespace: 'core', label: 'Core application', registeredAt: 'built-in', status: 'active' }, setup: { namespace: 'setup', label: 'First-run setup', registeredAt: 'built-in', status: 'active' }, settings: { namespace: 'settings', label: 'Configuration console', registeredAt: 'built-in', status: 'active' }, extensions: { namespace: 'extensions', label: 'Extension interfaces', registeredAt: 'runtime', status: 'active' } }, next.localization.interfaces)
  if (!Array.isArray(next.localization.missingKeys)) next.localization.missingKeys = []
  next.localization.missingKeys = next.localization.missingKeys.slice(-I18N_MISSING_LIMIT)
  if (!Array.isArray(next.localization.translationMemory)) next.localization.translationMemory = []
  next.localization.translationMemory = next.localization.translationMemory.slice(-I18N_MISSING_LIMIT)
  next.localization.keyPolicy = mergeDeep({ prefixByNamespace: true, fallbackRequired: true, approvalRequired: true }, next.localization.keyPolicy)
  next.localization.runtime = mergeDeep({ domLocalization: true, attributeLocalization: true, optionLocalization: true, reportMissing: true }, next.localization.runtime)

  const defaultRoles = roleRegistryDefaults()
  const sourceRoles = source.permissions?.roles
  if (isPlainObject(sourceRoles)) {
    next.permissions.roles = Object.fromEntries(Object.entries(sourceRoles).map(([name, role]) => [
      name,
      mergeDeep(defaultRoles[name] || { name, description: `${name} role`, permissions: [], rank: 1, system: false }, role)
    ]))
    if (!Object.hasOwn(next.permissions.roles, 'Administrator')) next.permissions.roles.Administrator = defaultRoles.Administrator
  } else {
    next.permissions.roles = mergeDeep(defaultRoles, next.permissions.roles)
  }
  const administratorPermissions = next.permissions.roles.Administrator?.permissions
  next.permissions.roles.Administrator.permissions = [...new Set([...(Array.isArray(administratorPermissions) ? administratorPermissions : []), ...ROLE_PERMISSIONS.Administrator])]

  const configuredStates = next.workflows.task.states
  const stateSource = Array.isArray(configuredStates) && configuredStates.length ? configuredStates : DEFAULT_WORKFLOW_STATES
  const normalizedStates = []
  const seenStateLabels = new Set()
  const seenStateIds = new Set()
  stateSource.forEach((state, index) => {
    const rawLabel = typeof state === 'string' ? state : isPlainObject(state) ? state.label || state.name : ''
    const label = String(rawLabel || `State ${index + 1}`).trim().slice(0, 80)
    const key = label.toLocaleLowerCase()
    if (!label || seenStateLabels.has(key)) return
    seenStateLabels.add(key)
    const candidateId = typeof state === 'string' ? '' : String(state?.id || '')
    const baseId = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(candidateId) ? candidateId : slugifyState(label)
    let stateId = baseId
    let suffix = 2
    while (seenStateIds.has(stateId)) stateId = `${baseId.slice(0, 72)}_${suffix++}`
    seenStateIds.add(stateId)
    normalizedStates.push(typeof state === 'string'
      ? { id: stateId, label, color: index === stateSource.length - 1 ? 'green' : 'blue', terminal: index === stateSource.length - 1 }
      : { id: stateId, label, color: String(state?.color || 'blue').slice(0, 30), terminal: Boolean(state?.terminal) })
  })
  next.workflows.task.states = normalizedStates.length ? normalizedStates : DEFAULT_WORKFLOW_STATES.map(state => ({ ...state }))
  if (!Array.isArray(next.workflows.task.transitions) || !next.workflows.task.transitions.length) next.workflows.task.transitions = next.workflows.task.states.slice(0, -1).map((state, index) => ({ from: state.label, to: next.workflows.task.states[index + 1].label, permission: 'writeTasks' }))
  Object.keys(defaultSettings().customFields).forEach(key => { if (!Array.isArray(next.customFields[key])) next.customFields[key] = [] })
  return withLegacySettings(next)
}
function settingsInputError(value) {
  if (!isPlainObject(value)) return 'Settings must be a JSON object'
  const inspect = (current, depth = 0, budget = { nodes: 0 }) => {
    budget.nodes += 1
    if (budget.nodes > 100000) return 'Settings contain too many values'
    if (depth > 24) return 'Settings exceed the maximum supported nesting depth'
    if (typeof current === 'string') return current.length > 10000 ? 'A settings value exceeds the 10000-character limit' : ''
    if (typeof current === 'number') return Number.isFinite(current) ? '' : 'Settings must contain finite numbers'
    if (current === null || typeof current === 'boolean') return ''
    if (Array.isArray(current)) {
      if (current.length > 10000) return 'A settings list exceeds the 10000-item limit'
      for (const item of current) { const error = inspect(item, depth + 1, budget); if (error) return error }
      return ''
    }
    if (!isPlainObject(current)) return 'Settings must contain only JSON-compatible objects and values'
    const entries = Object.entries(current)
    if (entries.length > 10000) return 'A settings object exceeds the 10000-key limit'
    for (const [key, item] of entries) {
      if (!key || key.length > 1000 || ['__proto__', 'prototype', 'constructor'].includes(key)) return 'Settings object keys must be safe text of at most 1000 characters'
      const error = inspect(item, depth + 1, budget)
      if (error) return error
    }
    return ''
  }
  const treeError = inspect(value)
  if (treeError) return treeError
  const objectBranch = (parent, key, label) => parent?.[key] !== undefined && !isPlainObject(parent[key]) ? `${label} must be a JSON object` : ''
  const stringField = (parent, key, label, max, allowEmpty = true) => {
    const candidate = parent?.[key]
    if (candidate === undefined) return ''
    if (typeof candidate !== 'string' || candidate.length > max || (!allowEmpty && !candidate.trim())) return `${label} must be ${allowEmpty ? 'text' : 'non-empty text'} no longer than ${max} characters`
    return ''
  }
  const booleanField = (parent, key, label) => parent?.[key] !== undefined && typeof parent[key] !== 'boolean' ? `${label} must be true or false` : ''
  const enumField = (parent, key, label, allowed) => parent?.[key] !== undefined && !allowed.includes(parent[key]) ? `${label} must be one of: ${allowed.join(', ')}` : ''
  const numberField = (parent, key, label, min, max) => {
    const candidate = parent?.[key]
    return candidate !== undefined && (!Number.isInteger(Number(candidate)) || Number(candidate) < min || Number(candidate) > max) ? `${label} must be an integer between ${min} and ${max}` : ''
  }
  const stringArray = (candidate, label, { maxRows = 200, maxLength = 200 } = {}) => {
    if (!Array.isArray(candidate) || candidate.length > maxRows || candidate.some(item => typeof item !== 'string' || item.length > maxLength)) return `${label} must be a list of at most ${maxRows} text values (maximum ${maxLength} characters each)`
    return ''
  }
  const objectBranches = [
    ['workspace', 'Workspace settings'], ['interface', 'Interface settings'], ['localization', 'Localization settings'],
    ['modules', 'Module settings'], ['workflows', 'Workflow settings'], ['permissions', 'Permission settings'],
    ['customFields', 'Custom fields'], ['notifications', 'Notification settings'], ['reports', 'Report settings'],
    ['exports', 'Export settings'], ['integrations', 'Integration settings'], ['storage', 'Storage settings'],
    ['security', 'Security settings'], ['audit', 'Audit settings'], ['workLedger', 'Work-ledger settings']
  ]
  for (const [key, label] of objectBranches) { const error = objectBranch(value, key, label); if (error) return error }

  const workspace = value.workspace || {}
  for (const [key, label, max] of [
    ['name', 'Workspace name', 120], ['unit', 'Workspace unit', 120], ['applicationName', 'Application name', 120],
    ['logo', 'Workspace logo metadata', 500]
  ]) { const error = stringField(workspace, key, label, max); if (error) return error }
  if (workspace.defaultTimezone !== undefined && !isValidTimezone(workspace.defaultTimezone)) return 'Workspace timezone must be a valid IANA timezone'
  const workspaceBranding = workspace.branding
  if (workspaceBranding !== undefined && !isPlainObject(workspaceBranding)) return 'Workspace branding must be a JSON object'
  for (const [key, label, max] of [['primaryColor', 'Primary color', 20], ['accentColor', 'Brand accent', 40], ['reportLogo', 'Report logo metadata', 500], ['loginHeadline', 'Login headline', 240]]) {
    const error = stringField(workspaceBranding, key, label, max); if (error) return error
  }
  if (workspaceBranding?.primaryColor !== undefined && !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(workspaceBranding.primaryColor)) return 'Workspace primary color must be a three- or six-digit hexadecimal color'
  const organization = workspace.organization
  if (organization !== undefined && !isPlainObject(organization)) return 'Organization settings must be a JSON object'
  for (const [key, label, max] of [['legalName', 'Legal organization name', 200], ['website', 'Organization website', 500], ['address', 'Organization address', 2000], ['contactEmail', 'Organization contact email', 254]]) {
    const error = stringField(organization, key, label, max); if (error) return error
  }
  const regional = workspace.regionalFormats
  if (regional !== undefined && !isPlainObject(regional)) return 'Regional formats must be a JSON object'
  for (const [key, label, max] of [['date', 'Date format', 100], ['number', 'Number system', 20], ['currency', 'Currency code', 3], ['timezone', 'Timezone display format', 30]]) {
    const error = stringField(regional, key, label, max); if (error) return error
  }
  if (regional?.number !== undefined && !['latn', 'arab', 'arabext'].includes(regional.number)) return 'Number system must be latn, arab, or arabext'
  if (regional?.currency !== undefined && !/^[A-Z]{3}$/.test(regional.currency)) return 'Currency must be a three-letter ISO currency code'
  if (workspace.workingDays !== undefined) {
    const error = stringArray(workspace.workingDays, 'Working days', { maxRows: 7, maxLength: 20 }); if (error) return error
    if (workspace.workingDays.some(day => !WEEKDAYS.includes(day)) || new Set(workspace.workingDays).size !== workspace.workingDays.length) return 'Working days must be unique weekday names'
  }
  if (workspace.holidays !== undefined) {
    const error = stringArray(workspace.holidays, 'Workspace holidays', { maxRows: 500, maxLength: 100 }); if (error) return error
  }
  if (workspace.workingHours !== undefined) {
    if (!isPlainObject(workspace.workingHours)) return 'Working hours must be a JSON object'
    for (const key of ['start', 'end']) if (workspace.workingHours[key] !== undefined && (typeof workspace.workingHours[key] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(workspace.workingHours[key]))) return 'Working hours must use 24-hour HH:MM values'
  }

  const ui = value.interface || {}
  for (const [key, label, options] of [
    ['theme', 'Theme', ['light', 'dark', 'system']], ['density', 'Density', ['comfortable', 'compact']],
    ['spacing', 'Spacing', ['compact', 'comfortable', 'spacious']], ['sidebarBehavior', 'Sidebar behavior', ['expanded', 'collapsed']]
  ]) { const error = enumField(ui, key, label, options); if (error) return error }
  const uiColors = ui.colors
  if (uiColors !== undefined && !isPlainObject(uiColors)) return 'Interface colors must be a JSON object'
  const colorAccentError = enumField(uiColors, 'accent', 'Interface accent', ['purple', 'blue', 'green', 'orange'])
  if (colorAccentError) return colorAccentError
  if (uiColors?.primary !== undefined && (typeof uiColors.primary !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(uiColors.primary))) return 'Primary color must be a three- or six-digit hexadecimal color'
  if (ui.typography !== undefined && !isPlainObject(ui.typography)) return 'Typography settings must be a JSON object'
  const fontError = enumField(ui.typography, 'family', 'Interface font', ['Atlas Sans', 'system-ui', 'serif', 'monospace'])
  if (fontError) return fontError
  const scaleError = numberField(ui.typography, 'scale', 'Text scale', 75, 200)
  if (scaleError) return scaleError
  if (ui.tableBehavior !== undefined && !isPlainObject(ui.tableBehavior)) return 'Table behavior must be a JSON object'
  const pageSizeError = numberField(ui.tableBehavior, 'pageSize', 'Table page size', 1, 500)
  if (pageSizeError) return pageSizeError
  for (const key of ['stickyHeaders', 'zebraRows']) { const error = booleanField(ui.tableBehavior, key, `Table ${key}`); if (error) return error }
  if (ui.accessibility !== undefined && !isPlainObject(ui.accessibility)) return 'Accessibility settings must be a JSON object'
  for (const key of ['highContrast', 'reducedMotion', 'screenReaderLabels']) { const error = booleanField(ui.accessibility, key, `Accessibility ${key}`); if (error) return error }
  const scalableTextError = numberField(ui.accessibility, 'scalableText', 'Accessibility text scale', 75, 200)
  if (scalableTextError) return scalableTextError
  const actionVisibility = ui.actionVisibility
  if (actionVisibility !== undefined && !isPlainObject(actionVisibility)) return 'Action visibility must be a JSON object'
  for (const [key, enabled] of Object.entries(actionVisibility || {})) if (typeof enabled !== 'boolean') return `Action visibility for ${key} must be true or false`
  if (ui.dashboardLayouts !== undefined && !isPlainObject(ui.dashboardLayouts)) return 'Dashboard layouts must be a JSON object'
  if (ui.dashboardLayouts?.overview !== undefined) {
    const error = stringArray(ui.dashboardLayouts.overview, 'Overview widgets', { maxRows: 4, maxLength: 40 }); if (error) return error
    if (ui.dashboardLayouts.overview.some(widget => !['stats', 'dailyPulse', 'projectHealth', 'myFocus'].includes(widget))) return 'Overview contains an unsupported widget'
  }
  for (const surface of ['tableColumns', 'formLayouts']) {
    if (ui[surface] === undefined) continue
    if (!isPlainObject(ui[surface])) return `${surface === 'tableColumns' ? 'Table columns' : 'Form layouts'} must be a JSON object`
    for (const [entity, fields] of Object.entries(ui[surface])) { const error = stringArray(fields, `${surface} for ${entity}`, { maxRows: 200, maxLength: 100 }); if (error) return error }
  }

  const passwordLength = numberField(value.security, 'passwordMinLength', 'Password minimum length', MIN_PASSWORD_LENGTH, 128)
  if (passwordLength) return 'Password minimum length must be between 8 and 128'
  const sessionDays = numberField(value.security, 'sessionDays', 'Session duration', 1, 365)
  if (sessionDays) return sessionDays
  const securityApproval = booleanField(value.security, 'requireApprovalForRoleChanges', 'Role-change approval policy')
  if (securityApproval) return securityApproval
  const backupRetention = numberField(value.storage, 'backupRetention', 'Backup retention', 3, 100)
  if (backupRetention) return 'Backup retention must be between 3 and 100 files'
  const importExport = booleanField(value.storage, 'importExportEnabled', 'Configuration import/export')
  if (importExport) return importExport
  const auditRetention = numberField(value.audit, 'retentionDays', 'Audit retention', 0, 3650)
  if (auditRetention) return 'Audit retention must be 0 (keep indefinitely) or 1 to 3650 days'
  for (const key of ['enabled', 'trackReads', 'trackWrites', 'trackExports']) { const error = booleanField(value.audit, key, `Audit ${key}`); if (error) return error }
  const workLedgerRetention = numberField(value.workLedger, 'retentionMonths', 'Work-ledger retention', 0, 120)
  if (workLedgerRetention) return 'Work-ledger retention must be 0 (keep indefinitely) or 1 to 120 months'
  for (const [parent, key, label] of [[value.security, 'cookieSecure', 'Secure-cookie policy'], [value.security, 'allowDemoData', 'Demo-data policy']]) { const error = booleanField(parent, key, label); if (error) return error }

  const localization = value.localization || {}
  for (const key of ['defaultLanguage', 'fallbackLanguage']) if (localization[key] !== undefined && (typeof localization[key] !== 'string' || !LANGUAGE_CODE_PATTERN.test(localization[key]))) return `${key === 'defaultLanguage' ? 'Default' : 'Fallback'} language must be a valid language code`
  if (localization.activeLanguages !== undefined) {
    const error = stringArray(localization.activeLanguages, 'Active languages', { maxRows: 50, maxLength: 10 }); if (error) return error
    if (localization.activeLanguages.some(code => !LANGUAGE_CODE_PATTERN.test(code))) return 'Active languages must use valid language codes'
  }
  if (localization.languagePackages !== undefined) {
    if (!Array.isArray(localization.languagePackages) || localization.languagePackages.length > 50) return 'Language packages must be a list of at most 50 entries'
    const codes = new Set()
    for (const pack of localization.languagePackages) {
      if (!isPlainObject(pack) || typeof pack.code !== 'string' || !LANGUAGE_CODE_PATTERN.test(pack.code)) return 'Every language package needs a valid locale code'
      if (codes.has(pack.code)) return `Language package ${pack.code} is duplicated`
      codes.add(pack.code)
      if (typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 100) return `Language package ${pack.code} needs a name of at most 100 characters`
      if (!['ltr', 'rtl'].includes(pack.direction)) return `Language package ${pack.code} direction must be LTR or RTL`
      if (pack.enabled !== undefined && typeof pack.enabled !== 'boolean') return `Language package ${pack.code} enabled state must be true or false`
    }
  }
  for (const key of ['userLanguagePreference', 'missingTranslationDetection']) { const error = booleanField(localization, key, `Localization ${key}`); if (error) return error }
  for (const key of ['interfaces', 'keyPolicy', 'runtime']) if (localization[key] !== undefined && !isPlainObject(localization[key])) return `Localization ${key} must be a JSON object`
  if (localization.interfaces !== undefined) {
    if (Object.keys(localization.interfaces).length > 100) return 'Localization interface registry may contain at most 100 entries'
    for (const [namespace, meta] of Object.entries(localization.interfaces)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(namespace) || !isPlainObject(meta)) return 'Localization interfaces must use safe namespace keys and JSON object values'
      for (const key of ['namespace', 'label', 'registeredAt', 'status', 'owner', 'version', 'route']) {
        const error = stringField(meta, key, `Interface ${namespace} ${key}`, 200)
        if (error) return error
      }
      if (meta.status !== undefined && !['active', 'draft', 'disabled'].includes(meta.status)) return `Interface ${namespace} status must be active, draft, or disabled`
      if (meta.keys !== undefined) { const error = stringArray(meta.keys, `Interface ${namespace} keys`, { maxRows: 5000, maxLength: MAX_I18N_KEY_LENGTH }); if (error) return error }
    }
  }
  for (const [key, label] of [['prefixByNamespace', 'Namespace key policy'], ['fallbackRequired', 'Fallback translation policy'], ['approvalRequired', 'Approval translation policy']]) {
    const error = booleanField(localization.keyPolicy, key, label)
    if (error) return error
  }
  for (const [key, enabled] of Object.entries(localization.runtime || {})) if (typeof enabled !== 'boolean') return `Localization runtime option ${key} must be true or false`
  if (localization.languagePackages !== undefined && localization.activeLanguages !== undefined) {
    const packageByCode = new Map(localization.languagePackages.map(pack => [pack.code, pack]))
    if (localization.activeLanguages.some(code => !packageByCode.has(code) || packageByCode.get(code).enabled === false)) return 'Every active language must have an enabled language package'
    for (const code of [localization.defaultLanguage, localization.fallbackLanguage]) {
      if (code && (!packageByCode.has(code) || packageByCode.get(code).enabled === false)) return `Default and fallback languages must have enabled packages (${code})`
      if (code && !localization.activeLanguages.includes(code)) return `Default and fallback languages must be active (${code})`
    }
  }
  if (localization.languagePackages !== undefined) {
    for (const pack of localization.languagePackages) {
      if (pack.version !== undefined && (typeof pack.version !== 'string' || pack.version.length > 40)) return `Language package ${pack.code} version must be text of at most 40 characters`
      if (pack.status !== undefined && !['draft', 'review', 'approved'].includes(pack.status)) return `Language package ${pack.code} status must be draft, review, or approved`
    }
  }
  if (localization.textDirectionByLanguage !== undefined) {
    if (!isPlainObject(localization.textDirectionByLanguage)) return 'Text direction map must be a JSON object'
    for (const [code, direction] of Object.entries(localization.textDirectionByLanguage)) if (!LANGUAGE_CODE_PATTERN.test(code) || !['ltr', 'rtl'].includes(direction)) return 'Text direction map must map valid language codes to ltr or rtl'
  }
  for (const key of ['dateFormats', 'numberFormats', 'currencyFormats', 'timezoneFormats']) {
    const map = localization[key]
    if (map === undefined) continue
    if (!isPlainObject(map)) return `${key} must be a JSON object`
    for (const [code, format] of Object.entries(map)) if (!LANGUAGE_CODE_PATTERN.test(code) || typeof format !== 'string' || format.length > 100) return `${key} must contain short text formats keyed by valid language codes`
  }
  if (localization.translations !== undefined) {
    if (!isPlainObject(localization.translations)) return 'Translation catalogs must be an object keyed by language code'
    if (Object.keys(localization.translations).length > 50) return 'Translation catalogs may contain at most 50 languages'
    for (const [language, catalog] of Object.entries(localization.translations)) {
      if (!LANGUAGE_CODE_PATTERN.test(language) || !isPlainObject(catalog) || Object.keys(catalog).length > 5000) return `Translation catalog ${language} must be an object with at most 5000 keys`
      for (const [key, translation] of Object.entries(catalog)) {
        if (!key || key.length > MAX_I18N_KEY_LENGTH || ['__proto__', 'prototype', 'constructor'].includes(key)) return `Translation keys must be 1 to ${MAX_I18N_KEY_LENGTH} safe characters`
        if (typeof translation !== 'string' || translation.length > 5000) return `Translation ${key} must be text of at most 5000 characters`
      }
    }
  }
  for (const key of ['missingKeys', 'translationMemory']) {
    if (localization[key] === undefined) continue
    if (!Array.isArray(localization[key]) || localization[key].length > I18N_MISSING_LIMIT || localization[key].some(row => !isPlainObject(row))) return `${key} must be a list of at most ${I18N_MISSING_LIMIT} JSON objects`
  }
  if (localization.approvalWorkflow !== undefined) {
    if (!isPlainObject(localization.approvalWorkflow)) return 'Translation approval workflow must be a JSON object'
    const enabledError = booleanField(localization.approvalWorkflow, 'enabled', 'Translation approval workflow')
    if (enabledError) return enabledError
    const statuses = localization.approvalWorkflow.statusByKey
    if (statuses !== undefined) {
      if (!isPlainObject(statuses) || Object.keys(statuses).length > I18N_MISSING_LIMIT) return 'Translation approval statuses must be an object of at most 2000 keys'
      if (Object.keys(statuses).some(key => !key || key.length > MAX_I18N_KEY_LENGTH)) return `Translation status keys must be 1 to ${MAX_I18N_KEY_LENGTH} characters`
      if (Object.values(statuses).some(status => !['draft', 'review', 'approved', 'rejected'].includes(status))) return 'Translation statuses must be draft, review, approved, or rejected'
    }
  }

  if (value.permissions?.roles !== undefined) {
    const roles = value.permissions.roles
    if (!isPlainObject(roles) || Object.keys(roles).length > 50) return 'Roles must be a JSON object containing at most 50 roles'
    const validPermissions = new Set(Object.values(ROLE_PERMISSIONS).flat())
    for (const [name, role] of Object.entries(roles)) {
      if (!name.trim() || name.length > 80 || ['__proto__', 'prototype', 'constructor'].includes(name) || !isPlainObject(role)) return 'Role names must be safe text keys of at most 80 characters'
      if (role.permissions !== undefined && (!Array.isArray(role.permissions) || role.permissions.length > 50 || role.permissions.some(permission => typeof permission !== 'string' || !validPermissions.has(permission)))) return `Role ${name} contains an unsupported permission`
      if (role.rank !== undefined && (!Number.isInteger(Number(role.rank)) || Number(role.rank) < 0 || Number(role.rank) > 100)) return `Role ${name} rank must be an integer from 0 to 100`
      for (const key of ['name', 'summary', 'description']) if (role[key] !== undefined && (typeof role[key] !== 'string' || role[key].length > 200)) return `Role ${name} ${key} must be text of at most 200 characters`
    }
  }
  for (const key of ['moduleAccess', 'fieldAccess', 'actionAccess', 'exportPermissions', 'reportingPermissions']) {
    if (value.permissions?.[key] !== undefined && !isPlainObject(value.permissions[key])) return `Permission policy ${key} must be a JSON object`
  }
  if (ui.navigationOrder !== undefined) {
    const error = stringArray(ui.navigationOrder, 'Navigation order', { maxRows: 50, maxLength: 80 }); if (error) return error
  }
  if (ui.navigationVisibility !== undefined) {
    if (!isPlainObject(ui.navigationVisibility) || Object.values(ui.navigationVisibility).some(enabled => typeof enabled !== 'boolean')) return 'Navigation visibility must map page keys to true or false'
  }
  if (ui.animations !== undefined && typeof ui.animations !== 'boolean') return 'Motion setting must be true or false'
  if (value.modules !== undefined) {
    if (Object.keys(value.modules).length > 100) return 'Module settings may contain at most 100 entries'
    for (const [key, module] of Object.entries(value.modules)) {
      if (!key || key.length > 80 || !isPlainObject(module)) return 'Module entries must have safe keys and JSON object values'
      for (const field of ['enabled']) if (module[field] !== undefined && typeof module[field] !== 'boolean') return `Module ${key} ${field} must be true or false`
      for (const field of ['labelKey', 'icon', 'route']) { const error = stringField(module, field, `Module ${key} ${field}`, 200); if (error) return error }
      if (module.permissions !== undefined) { const error = stringArray(module.permissions, `Module ${key} permissions`, { maxRows: 50, maxLength: 100 }); if (error) return error }
    }
  }

  const reports = value.reports || {}
  if (reports.defaultTemplate !== undefined && !BUILTIN_REPORT_TEMPLATES.includes(reports.defaultTemplate)) return `Default report template must be one of: ${BUILTIN_REPORT_TEMPLATES.join(', ')}`
  if (reports.templates !== undefined) {
    if (!Array.isArray(reports.templates) || !reports.templates.length || reports.templates.length > BUILTIN_REPORT_TEMPLATES.length || reports.templates.some(template => !BUILTIN_REPORT_TEMPLATES.includes(template)) || new Set(reports.templates).size !== reports.templates.length) return `Available report templates must be a non-empty list of: ${BUILTIN_REPORT_TEMPLATES.join(', ')}`
    if (reports.defaultTemplate !== undefined && !reports.templates.includes(reports.defaultTemplate)) return 'The default report template must be included in available templates'
  }
  if (reports.localizedOutput !== undefined && typeof reports.localizedOutput !== 'boolean') return 'Localized report output must be true or false'
  if (reports.branding !== undefined && !isPlainObject(reports.branding)) return 'Report branding must be a JSON object'
  if (reports.branding !== undefined) {
    const error = stringField(reports.branding, 'footerText', 'Report footer', 500); if (error) return error
    const logoError = booleanField(reports.branding, 'includeLogo', 'Include report logo'); if (logoError) return logoError
  }
  for (const key of ['customColumns', 'customFilters', 'customCalculations']) if (reports[key] !== undefined && !isPlainObject(reports[key])) return `Report metadata ${key} must be a JSON object`
  if (value.exports?.formats !== undefined) {
    if (!Array.isArray(value.exports.formats) || value.exports.formats.length > EXPORT_FORMATS.length || value.exports.formats.some(format => !EXPORT_FORMATS.includes(format)) || new Set(value.exports.formats).size !== value.exports.formats.length) return `Export formats must contain unique values from: ${EXPORT_FORMATS.join(', ')}`
  }
  for (const key of ['respectLanguage', 'respectDirection', 'includeBranding']) { const error = booleanField(value.exports, key, `Export ${key}`); if (error) return error }
  if (value.exports?.pdf !== undefined && !isPlainObject(value.exports.pdf)) return 'PDF export settings must be a JSON object'
  for (const [key, label, options] of [['orientation', 'PDF orientation', ['landscape', 'portrait']], ['margins', 'PDF margins', ['narrow', 'standard', 'wide']]]) {
    const error = enumField(value.exports?.pdf, key, label, options); if (error) return error
  }
  if (value.notifications?.enabled !== undefined && typeof value.notifications.enabled !== 'boolean') return 'Notifications enabled must be true or false'
  for (const key of ['channels', 'events']) {
    const map = value.notifications?.[key]
    if (map !== undefined && (!isPlainObject(map) || Object.keys(map).some(name => !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(name)) || Object.values(map).some(enabled => typeof enabled !== 'boolean'))) return `Notification ${key} must map safe names to true or false`
  }
  const webhookEndpointError = stringField(value.notifications, 'webhookEndpoint', 'Webhook endpoint metadata', 2000)
  if (webhookEndpointError) return webhookEndpointError
  const integrationTypes = new Set(['webhook', 'storage', 'identity', 'reporting', 'module'])
  if (value.integrations?.registry !== undefined) {
    if (!Array.isArray(value.integrations.registry) || value.integrations.registry.length > 100 || value.integrations.registry.some(row => !isPlainObject(row))) return 'Integration registry must be a list of at most 100 JSON objects'
    const ids = new Set()
    for (const row of value.integrations.registry) {
      if (row.id !== undefined && (typeof row.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(row.id))) return 'Integration IDs must be safe identifiers of at most 100 characters'
      if (row.id && ids.has(row.id)) return `Integration ID ${row.id} is duplicated`
      if (row.id) ids.add(row.id)
      const nameError = stringField(row, 'name', 'Integration name', 120, false); if (nameError) return nameError
      if (row.type !== undefined && !integrationTypes.has(row.type)) return 'Integration type is unsupported'
      for (const key of ['endpoint', 'route']) { const error = stringField(row, key, `Integration ${key}`, 2000); if (error) return error }
      const enabledError = booleanField(row, 'enabled', 'Integration enabled state'); if (enabledError) return enabledError
      for (const key of ['permissions', 'events']) if (row[key] !== undefined) { const error = stringArray(row[key], `Integration ${key}`, { maxRows: 100, maxLength: 100 }); if (error) return error }
    }
  }
  if (value.integrations?.webhooks !== undefined) {
    if (!Array.isArray(value.integrations.webhooks) || value.integrations.webhooks.length > 100 || value.integrations.webhooks.some(row => !isPlainObject(row))) return 'Webhook registry must be a list of at most 100 JSON objects'
    for (const row of value.integrations.webhooks) {
      for (const key of ['id', 'name', 'endpoint', 'url', 'event']) { const error = stringField(row, key, `Webhook ${key}`, key === 'endpoint' || key === 'url' ? 2000 : 120); if (error) return error }
      const enabledError = booleanField(row, 'enabled', 'Webhook enabled state'); if (enabledError) return enabledError
      if (row.events !== undefined) { const error = stringArray(row.events, 'Webhook events', { maxRows: 100, maxLength: 100 }); if (error) return error }
      if (Object.keys(row).some(key => /^(secret|token|password|authorization)$/i.test(key))) return 'Webhook credentials must not be stored in the settings registry'
    }
  }
  if (value.integrations?.apiAccess !== undefined && typeof value.integrations.apiAccess !== 'boolean') return 'API access metadata must be true or false'

  const states = value.workflows?.task?.states
  if (value.workflows !== undefined && !isPlainObject(value.workflows)) return 'Workflow settings must be a JSON object'
  if (value.workflows?.task !== undefined && !isPlainObject(value.workflows.task)) return 'Task workflow must be a JSON object'
  const taskWorkflow = value.workflows?.task || {}
  const workflowNameError = stringField(taskWorkflow, 'name', 'Task workflow name', 120)
  if (workflowNameError) return workflowNameError
  let workflowLabels = []
  if (states !== undefined) {
    if (!Array.isArray(states) || states.length < 1 || states.length > 50) return 'Task workflow must contain between 1 and 50 states'
    if (states.some(state => typeof state !== 'string' && !isPlainObject(state))) return 'Each workflow state must be a label or a JSON object'
    workflowLabels = states.map(state => String(typeof state === 'string' ? state : state.label || state.name || '').trim())
    if (workflowLabels.some(label => !label || label.length > 80)) return 'Workflow states must have names between 1 and 80 characters'
    if (new Set(workflowLabels.map(label => label.toLocaleLowerCase())).size !== workflowLabels.length) return 'Workflow state names must be unique'
    const stateIds = states.filter(isPlainObject).map(state => state.id).filter(id => id !== undefined)
    if (stateIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id))) return 'Workflow state IDs must be safe identifiers of at most 80 characters'
    if (new Set(stateIds).size !== stateIds.length) return 'Workflow state IDs must be unique'
    for (const state of states.filter(isPlainObject)) {
      if (state.color !== undefined && !WORKFLOW_COLORS.includes(state.color)) return `Workflow state color must be one of: ${WORKFLOW_COLORS.join(', ')}`
      if (state.terminal !== undefined && typeof state.terminal !== 'boolean') return 'Workflow terminal flags must be true or false'
    }
    if (states.some(state => isPlainObject(state) && state.terminal === true) === false && states.some(state => typeof state !== 'string')) return 'At least one workflow state must be terminal'
  }
  if (taskWorkflow.transitions !== undefined) {
    if (!Array.isArray(taskWorkflow.transitions) || taskWorkflow.transitions.length > 250) return 'Workflow transitions must be a list of at most 250 entries'
    for (const transition of taskWorkflow.transitions) {
      if (!isPlainObject(transition) || typeof transition.from !== 'string' || typeof transition.to !== 'string' || transition.from.length > 80 || transition.to.length > 80) return 'Every workflow transition must have valid from and to state labels'
      if (workflowLabels.length && (!workflowLabels.includes(transition.from) || !workflowLabels.includes(transition.to))) return 'Workflow transitions may only reference configured states'
      const permissionError = stringField(transition, 'permission', 'Workflow permission metadata', 100)
      if (permissionError) return permissionError
      const approvalError = booleanField(transition, 'approvalRequired', 'Workflow approval metadata')
      if (approvalError) return approvalError
    }
  }
  for (const key of ['approvalSteps', 'automatedActions']) if (taskWorkflow[key] !== undefined) {
    const error = stringArray(taskWorkflow[key], key === 'approvalSteps' ? 'Workflow approval steps' : 'Workflow automated actions', { maxRows: 100, maxLength: 200 })
    if (error) return error
  }
  const customFields = value.customFields
  if (customFields !== undefined) {
    const allowedTypes = new Set(['text','number','date','datetime','checkbox','dropdown','multi-select','user','attachment','url','calculated'])
    for (const [entity, definitions] of Object.entries(customFields)) {
      if (!Array.isArray(definitions) || definitions.length > 200) return `Custom fields for ${entity} must be an array of at most 200 definitions`
      const keys = new Set()
      for (const field of definitions) {
        if (!isPlainObject(field) || typeof field.key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(field.key) || ['__proto__', 'prototype', 'constructor'].includes(field.key)) return `Custom fields for ${entity} need valid, non-empty field keys`
        if (keys.has(field.key)) return `Custom field key ${field.key} is duplicated for ${entity}`
        keys.add(field.key)
        if (field.type !== undefined && !allowedTypes.has(field.type)) return `Custom field ${field.key} has an unsupported type`
        if (field.required !== undefined && typeof field.required !== 'boolean') return `Required setting for ${field.key} must be true or false`
        if (field.visible !== undefined && typeof field.visible !== 'boolean') return `Visibility setting for ${field.key} must be true or false`
        if (field.required === true && field.visible === false) return `Required custom field ${field.key} cannot be hidden`
        if (field.validation !== undefined && (typeof field.validation !== 'string' || field.validation.length > 200)) return `Validation metadata for ${field.key} must be 200 characters or fewer`
        if (field.permissions !== undefined && (!Array.isArray(field.permissions) || field.permissions.length > 50 || field.permissions.some(permission => typeof permission !== 'string' || permission.length > 100))) return `Permission metadata for ${field.key} is invalid`
      }
    }
  }
  return ''
}
function slugifyState(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || id('state') }

  return { DEFAULT_NAVIGATION, DEFAULT_WORKFLOW_STATES, DEFAULT_TRANSLATIONS, ROLE_DESCRIPTIONS, roleRegistryDefaults, defaultSettings, mergeDeep, mergeSettingsUpdate, withLegacySettings, normalizeSettings, settingsInputError, slugifyState }
}
