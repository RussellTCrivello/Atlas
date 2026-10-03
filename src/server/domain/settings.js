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

export function createSettingsService({
  ROLE_PERMISSIONS, boundedInteger, isPlainObject, isValidTimezone, id, env = process.env,
  DATABASE_MODEL, STORE_SCHEMA_VERSION, I18N_MISSING_LIMIT = 2000,
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
    reports: { defaultTemplate: 'executive', templates: ['standard', 'compact', 'executive'], customColumns: {}, customFilters: {}, customCalculations: {}, localizedOutput: true, branding: { includeLogo: true, footerText: '' } },
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
  next.audit.retentionDays = boundedInteger(next.audit.retentionDays, 365, 1, 3650)
  next.workLedger.retentionMonths = boundedInteger(next.workLedger.retentionMonths, 24, 0, 120)
  next.interface.tableBehavior.pageSize = boundedInteger(next.interface.tableBehavior.pageSize, 50, 1, 500)

  const activeLanguages = Array.isArray(next.localization.activeLanguages) ? next.localization.activeLanguages.filter(code => typeof code === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(code)) : ['en']
  next.localization.activeLanguages = [...new Set(activeLanguages.length ? activeLanguages : ['en'])]
  if (!next.localization.activeLanguages.includes(next.localization.defaultLanguage)) next.localization.activeLanguages.push(next.localization.defaultLanguage || 'en')
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

  next.permissions.roles = mergeDeep(roleRegistryDefaults(), next.permissions.roles)
  const administratorPermissions = next.permissions.roles.Administrator.permissions
  next.permissions.roles.Administrator.permissions = [...new Set([...(Array.isArray(administratorPermissions) ? administratorPermissions : []), ...ROLE_PERMISSIONS.Administrator])]
  if (!Array.isArray(next.permissions.roles.Administrator.permissions)) next.permissions.roles.Administrator.permissions = [...ROLE_PERMISSIONS.Administrator]

  const configuredStates = next.workflows.task.states
  const stateSource = Array.isArray(configuredStates) && configuredStates.length ? configuredStates : DEFAULT_WORKFLOW_STATES
  const normalizedStates = []
  const seenStateLabels = new Set()
  stateSource.forEach((state, index) => {
    const rawLabel = typeof state === 'string' ? state : isPlainObject(state) ? state.label || state.name : ''
    const label = String(rawLabel || `State ${index + 1}`).trim().slice(0, 80)
    const key = label.toLocaleLowerCase()
    if (!label || seenStateLabels.has(key)) return
    seenStateLabels.add(key)
    normalizedStates.push(typeof state === 'string'
      ? { id: slugifyState(label), label, color: index === stateSource.length - 1 ? 'green' : 'blue', terminal: index === stateSource.length - 1 }
      : { id: String(state?.id || slugifyState(label)).slice(0, 80), label, color: String(state?.color || 'blue').slice(0, 30), terminal: Boolean(state?.terminal || index === stateSource.length - 1) })
  })
  next.workflows.task.states = normalizedStates.length ? normalizedStates : DEFAULT_WORKFLOW_STATES.map(state => ({ ...state }))
  if (!Array.isArray(next.workflows.task.transitions) || !next.workflows.task.transitions.length) next.workflows.task.transitions = next.workflows.task.states.slice(0, -1).map((state, index) => ({ from: state.label, to: next.workflows.task.states[index + 1].label, permission: 'writeTasks' }))
  Object.keys(defaultSettings().customFields).forEach(key => { if (!Array.isArray(next.customFields[key])) next.customFields[key] = [] })
  return withLegacySettings(next)
}
function settingsInputError(value) {
  if (!isPlainObject(value)) return 'Settings must be a JSON object'
  const timezone = value.workspace?.defaultTimezone
  if (timezone !== undefined && !isValidTimezone(timezone)) return 'Workspace timezone must be a valid IANA timezone'
  const passwordLength = value.security?.passwordMinLength
  if (passwordLength !== undefined && (!Number.isInteger(Number(passwordLength)) || Number(passwordLength) < MIN_PASSWORD_LENGTH || Number(passwordLength) > 128)) return 'Password minimum length must be between 8 and 128'
  const sessionDays = value.security?.sessionDays
  if (sessionDays !== undefined && (!Number.isInteger(Number(sessionDays)) || Number(sessionDays) < 1 || Number(sessionDays) > 365)) return 'Session duration must be between 1 and 365 days'
  const backupRetention = value.storage?.backupRetention
  if (backupRetention !== undefined && (!Number.isInteger(Number(backupRetention)) || Number(backupRetention) < 3 || Number(backupRetention) > 100)) return 'Backup retention must be between 3 and 100 files'
  const auditRetention = value.audit?.retentionDays
  if (auditRetention !== undefined && (!Number.isInteger(Number(auditRetention)) || Number(auditRetention) < 1 || Number(auditRetention) > 3650)) return 'Audit retention must be between 1 and 3650 days'
  const workLedgerRetention = value.workLedger?.retentionMonths
  if (workLedgerRetention !== undefined && (!Number.isInteger(Number(workLedgerRetention)) || Number(workLedgerRetention) < 0 || Number(workLedgerRetention) > 120)) return 'Work-ledger retention must be 0 (keep indefinitely) or 1 to 120 months'
  const states = value.workflows?.task?.states
  if (states !== undefined) {
    if (!Array.isArray(states) || states.length < 1 || states.length > 50) return 'Task workflow must contain between 1 and 50 states'
    const labels = states.map(state => String(typeof state === 'string' ? state : state?.label || state?.name || '').trim())
    if (labels.some(label => !label || label.length > 80)) return 'Workflow states must have names between 1 and 80 characters'
    if (new Set(labels.map(label => label.toLocaleLowerCase())).size !== labels.length) return 'Workflow state names must be unique'
  }
  const customFields = value.customFields
  if (customFields !== undefined) {
    if (!isPlainObject(customFields)) return 'Custom field definitions must be an object of field arrays'
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

  return { DEFAULT_NAVIGATION, DEFAULT_WORKFLOW_STATES, DEFAULT_TRANSLATIONS, ROLE_DESCRIPTIONS, roleRegistryDefaults, defaultSettings, mergeDeep, withLegacySettings, normalizeSettings, settingsInputError, slugifyState }
}
