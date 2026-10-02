// Workspace settings model: defaults, safe merging, normalisation and sanitisation.
// Pure functions only (no I/O, no environment access) so the same code runs in the browser and on the server.
import { BUILTIN_LANGUAGES, RTL_LANGUAGES, buildTranslationCatalog, stripBuiltinTranslations } from './i18n/catalog'

export const DATABASE_MODEL = 'embedded-json-document-store'
export const STORE_SCHEMA_VERSION = '3.1.0'

export const DEFAULT_NAVIGATION = ['overview', 'projects', 'tasks', 'people', 'activity', 'reports', 'alerts']

export interface WorkflowState {
  id: string
  label: string
  color: string
  terminal: boolean
}
export const DEFAULT_WORKFLOW_STATES: WorkflowState[] = [
  { id: 'todo', label: 'To do', color: 'muted', terminal: false },
  { id: 'in_progress', label: 'In progress', color: 'blue', terminal: false },
  { id: 'review', label: 'Review', color: 'purple', terminal: false },
  { id: 'testing', label: 'Testing', color: 'orange', terminal: false },
  { id: 'done', label: 'Done', color: 'green', terminal: true }
]

/** Every permission the server knows how to enforce. Unknown names are dropped from role definitions. */
export const PERMISSIONS = [
  'manageSettings',
  'manageUsers',
  'manageProjects',
  'managePeople',
  'manageAlerts',
  'manageTasks',
  'writeTasks',
  'logActivity',
  'viewReports',
  'exportData',
  'removeDemoData'
] as const
export type Permission = (typeof PERMISSIONS)[number]

export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  Administrator: [
    'manageSettings',
    'manageUsers',
    'manageProjects',
    'managePeople',
    'manageAlerts',
    'manageTasks',
    'writeTasks',
    'logActivity',
    'viewReports',
    'exportData',
    'removeDemoData'
  ],
  Manager: [
    'manageProjects',
    'managePeople',
    'manageAlerts',
    'manageTasks',
    'writeTasks',
    'logActivity',
    'viewReports',
    'exportData'
  ],
  Developer: ['writeTasks', 'logActivity', 'viewReports', 'exportData'],
  Viewer: ['viewReports', 'exportData']
}
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  Administrator: 'Full workspace ownership, security, settings, users, and all operational data.',
  Manager: 'Manage projects, people, alerts, delivery plans, tasks, reports, and exports.',
  Developer:
    'Update task progress, edit tasks assigned to or created by you, log daily activity, and read/export operational reports.',
  Viewer: 'Read-only access to dashboards, reports, exports, and team context.'
}
export const ROLE_TONES: Record<string, string> = {
  Administrator: 'purple',
  Manager: 'blue',
  Developer: 'green',
  Viewer: 'orange'
}
export const SYSTEM_ROLES = Object.keys(ROLE_PERMISSIONS)
/** Higher outranks lower: nobody can grant or modify a role that outranks their own. */
export const ROLE_RANKS: Record<string, number> = { Viewer: 1, Developer: 2, Manager: 3, Administrator: 4 }

export function roleRegistryDefaults() {
  return Object.fromEntries(
    Object.entries(ROLE_PERMISSIONS).map(([name, permissions]) => [
      name,
      {
        name,
        description: ROLE_DESCRIPTIONS[name] || `${name} role`,
        summary: ROLE_DESCRIPTIONS[name] || `${name} role`,
        tone: ROLE_TONES[name] || 'blue',
        permissions: [...permissions],
        rank: ROLE_RANKS[name],
        system: name === 'Administrator'
      }
    ])
  )
}

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
export function isPlainObject(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  // Realm-independent: a plain object's prototype is Object.prototype (whose own prototype is null) or null itself.
  // Comparing against *this* realm's Object.prototype would reject objects created in an iframe or another VM context.
  const proto = Object.getPrototypeOf(value)
  return proto === null || Object.getPrototypeOf(proto) === null
}

/** Deep merge that never touches the prototype chain (`__proto__`, `constructor`, `prototype` keys are skipped). */
export function mergeDeep(target: any, source: any): any {
  const out: Record<string, any> = isPlainObject(target) ? { ...target } : {}
  if (!isPlainObject(source)) return out
  for (const [key, value] of Object.entries(source)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    out[key] = isPlainObject(value) ? mergeDeep(out[key], value) : value
  }
  return out
}

/**
 * RFC 7386 JSON merge-patch: objects merge recursively, `null` removes a key, arrays and scalars replace.
 * Used for settings updates so a partial document never resets the values it does not mention.
 */
export function mergePatch(target: any, patch: any): any {
  if (!isPlainObject(patch)) return patch
  const out: Record<string, any> = isPlainObject(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    if (value === null) delete out[key]
    else out[key] = isPlainObject(value) ? mergePatch(out[key], value) : value
  }
  return out
}

/** The merge-patch that turns `before` into `after` (keys that disappeared become `null`). Empty object = no change. */
export function diffPatch(before: any, after: any): Record<string, any> {
  const patch: Record<string, any> = {}
  const a = isPlainObject(before) ? before : {}
  const b = isPlainObject(after) ? after : {}
  for (const key of Object.keys(a)) if (!(key in b)) patch[key] = null
  for (const [key, value] of Object.entries(b)) {
    if (value === undefined) continue
    if (isPlainObject(value) && isPlainObject(a[key])) {
      const nested = diffPatch(a[key], value)
      if (Object.keys(nested).length) patch[key] = nested
    } else if (JSON.stringify(a[key]) !== JSON.stringify(value)) patch[key] = value
  }
  return patch
}

const timeZoneCache = new Map<string, boolean>()
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false
  const cached = timeZoneCache.get(value)
  if (cached !== undefined) return cached
  let ok = false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    ok = true
  } catch {
    ok = false
  }
  timeZoneCache.set(value, ok)
  return ok
}

export function systemTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimeZone(tz) ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

export interface SettingsOptions {
  /** Default workspace timezone for new workspaces (the host's own zone unless overridden). */
  timezone?: string
  /** Client side only: include the built-in translation catalog in `localization.translations`. */
  builtinTranslations?: boolean
}

export function slugifyState(value: unknown): string {
  return (
    String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '') || ''
  )
}

export function defaultSettings(opts: SettingsOptions = {}): any {
  const timezone = isValidTimeZone(opts.timezone) ? opts.timezone : systemTimeZone()
  const settings = {
    workspace: {
      name: 'Atlas Workspace',
      unit: 'Operations',
      logo: '',
      applicationName: 'Atlas Workspace',
      branding: {
        primaryColor: '#6d5dfc',
        accentColor: 'purple',
        reportLogo: '',
        loginHeadline: 'Operate with clarity.'
      },
      organization: { legalName: '', website: '', address: '', contactEmail: '' },
      defaultTimezone: timezone,
      defaultLanguage: 'en',
      weekStartsOn: 'monday',
      regionalFormats: { date: 'MMM d, yyyy', number: 'latn', currency: 'USD', timezone: 'short' },
      workingDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      workingHours: { start: '09:00', end: '17:00' },
      holidays: []
    },
    interface: {
      theme: 'light',
      colors: { accent: 'purple', primary: '#6d5dfc' },
      density: 'comfortable',
      spacing: 'comfortable',
      typography: { family: 'Atlas Sans', scale: 100 },
      sidebarBehavior: 'expanded',
      navigationVisibility: Object.fromEntries(DEFAULT_NAVIGATION.map(page => [page, true])),
      navigationOrder: [...DEFAULT_NAVIGATION],
      dashboardLayouts: { overview: ['stats', 'dailyPulse', 'projectHealth', 'myFocus'] },
      defaultLandingPage: 'overview',
      tableBehavior: { pageSize: 50, stickyHeaders: true, zebraRows: false },
      tableColumns: {
        projects: ['name', 'code', 'team', 'health', 'progress', 'deadline'],
        tasks: ['id', 'title', 'project', 'status', 'priority', 'assignee', 'due'],
        people: ['name', 'email', 'role', 'team', 'status', 'load'],
        activity: ['person', 'date', 'today', 'blocked'],
        alerts: ['title', 'type', 'project', 'resolved', 'time'],
        users: ['name', 'email', 'role', 'team', 'active']
      },
      formLayouts: {
        projects: ['name', 'code', 'description', 'teamId', 'ownerId', 'status', 'deadline'],
        tasks: ['title', 'projectId', 'assigneeId', 'priority', 'dueDate', 'status', 'type', 'blocked'],
        people: ['name', 'email', 'jobTitle', 'teamId', 'focus', 'capacity', 'status'],
        users: ['name', 'email', 'role', 'personId', 'active']
      },
      actionVisibility: { create: true, edit: true, delete: true, export: true, print: true },
      cardLayouts: { projects: 'grid', tasks: 'board' },
      animations: true,
      accessibility: { highContrast: false, reducedMotion: false, scalableText: 100, screenReaderLabels: true }
    },
    localization: {
      activeLanguages: [...BUILTIN_LANGUAGES],
      defaultLanguage: 'en',
      fallbackLanguage: 'en',
      userLanguagePreference: true,
      textDirectionByLanguage: { en: 'ltr', ar: 'rtl', fa: 'rtl', he: 'rtl' },
      dateFormats: { en: 'MMM d, yyyy', ar: 'd MMM yyyy', fa: 'yyyy/MM/dd', he: 'd MMM yyyy' },
      numberFormats: { en: 'latn', ar: 'arab', fa: 'arabext', he: 'latn' },
      currencyFormats: { en: 'USD', ar: 'USD', fa: 'USD', he: 'USD' },
      timezoneFormats: { en: 'short', ar: 'short', fa: 'short', he: 'short' },
      translations: (opts.builtinTranslations ? structuredClone(buildTranslationCatalog()) : {}) as Record<
        string,
        Record<string, string>
      >,
      missingTranslationDetection: true,
      languagePackages: [
        { code: 'en', name: 'English', direction: 'ltr', enabled: true },
        { code: 'ar', name: 'العربية', direction: 'rtl', enabled: true },
        { code: 'fa', name: 'فارسی', direction: 'rtl', enabled: true },
        { code: 'he', name: 'עברית', direction: 'rtl', enabled: true }
      ],
      approvalWorkflow: { enabled: true, statusByKey: {} },
      interfaces: builtinInterfaces(),
      missingKeys: [] as any[],
      translationMemory: [] as any[],
      keyPolicy: { prefixByNamespace: true, fallbackRequired: true, approvalRequired: true },
      runtime: { domLocalization: true, attributeLocalization: true, optionLocalization: true, reportMissing: true }
    },
    modules: {
      overview: { enabled: true, labelKey: 'nav.overview', icon: 'overview', permissions: ['viewReports'] },
      projects: {
        enabled: true,
        labelKey: 'nav.projects',
        icon: 'projects',
        permissions: ['manageProjects', 'viewReports']
      },
      tasks: { enabled: true, labelKey: 'nav.tasks', icon: 'tasks', permissions: ['writeTasks', 'viewReports'] },
      people: { enabled: true, labelKey: 'nav.people', icon: 'people', permissions: ['managePeople', 'viewReports'] },
      activity: {
        enabled: true,
        labelKey: 'nav.activity',
        icon: 'activity',
        permissions: ['logActivity', 'viewReports']
      },
      reports: { enabled: true, labelKey: 'nav.reports', icon: 'reports', permissions: ['viewReports'] },
      alerts: {
        enabled: true,
        labelKey: 'nav.alerts',
        icon: 'alerts',
        permissions: ['manageAlerts', 'writeTasks', 'viewReports']
      }
    },
    workflows: {
      task: {
        name: 'Default task workflow',
        states: DEFAULT_WORKFLOW_STATES.map(state => ({ ...state })),
        transitions: defaultTransitions(DEFAULT_WORKFLOW_STATES),
        enforceTransitions: false,
        approvalSteps: [] as any[],
        automatedActions: [] as any[]
      }
    },
    customFields: { projects: [], tasks: [], people: [], teams: [], activities: [], alerts: [], reports: [] },
    permissions: {
      roles: roleRegistryDefaults() as Record<string, any>,
      moduleAccess: {},
      fieldAccess: {},
      actionAccess: {},
      exportPermissions: {},
      reportingPermissions: {}
    },
    notifications: {
      enabled: true,
      channels: { inApp: true, email: false, webhook: false },
      events: { taskAssigned: true, alertCreated: true, reportReady: true }
    },
    reports: {
      defaultTemplate: 'executive',
      templates: ['standard', 'compact', 'executive'],
      customColumns: {},
      customFilters: {},
      customCalculations: {},
      localizedOutput: true,
      activityVisibility: 'managers',
      branding: { includeLogo: true, footerText: '' }
    },
    exports: {
      formats: ['csv', 'xlsx', 'json', 'pdf', 'print'],
      respectLanguage: true,
      respectDirection: true,
      includeBranding: true,
      pdf: { orientation: 'landscape', margins: 'standard' }
    },
    integrations: { registry: [], webhooks: [], apiAccess: false },
    storage: { importExportEnabled: true },
    security: { passwordMinLength: 8, sessionDays: 14, requireApprovalForRoleChanges: false },
    audit: {
      enabled: true,
      retentionDays: 365,
      workLogRetentionDays: 0,
      trackReads: false,
      trackWrites: true,
      trackExports: true
    }
  }
  return withLegacySettings(settings)
}

function builtinInterfaces(): Record<string, any> {
  return {
    core: { namespace: 'core', label: 'Core application', registeredAt: 'built-in', status: 'active' },
    setup: { namespace: 'setup', label: 'First-run setup', registeredAt: 'built-in', status: 'active' },
    settings: { namespace: 'settings', label: 'Configuration console', registeredAt: 'built-in', status: 'active' },
    extensions: { namespace: 'extensions', label: 'Extension interfaces', registeredAt: 'runtime', status: 'active' }
  }
}

function defaultTransitions(states: WorkflowState[]) {
  return states.slice(0, -1).map((state, index) => ({
    from: state.label,
    to: states[index + 1].label,
    permission: 'writeTasks'
  }))
}

/** Derive the flat legacy keys (`settings.language`, `settings.theme`, ...) that older clients still read. */
export function withLegacySettings(settings: any): any {
  const visibility = settings.interface?.navigationVisibility || {}
  settings.language = settings.localization?.defaultLanguage || settings.workspace?.defaultLanguage || 'en'
  settings.density = settings.interface?.density || 'comfortable'
  settings.dateFormat =
    settings.workspace?.regionalFormats?.date ||
    settings.localization?.dateFormats?.[settings.language] ||
    'MMM d, yyyy'
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
  const navOrder =
    Array.isArray(settings.interface?.navigationOrder) && settings.interface.navigationOrder.length
      ? settings.interface.navigationOrder
      : DEFAULT_NAVIGATION
  settings.interface.navigationOrder = [
    ...new Set([...navOrder.filter((page: string) => DEFAULT_NAVIGATION.includes(page)), ...DEFAULT_NAVIGATION])
  ].filter(page => DEFAULT_NAVIGATION.includes(page))
  settings.enabledPages = settings.interface.navigationOrder.filter(
    (page: string) => visibility[page] !== false && settings.modules?.[page]?.enabled !== false
  )
  return settings
}

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const ROLE_NAME = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/

/** Normalise stored or incoming settings. Invalid values fall back to safe defaults ("safe mode"): bad settings must
 *  never be able to break every data route (for example an unknown time zone). */
export function normalizeSettings(raw: any = {}, opts: SettingsOptions = {}): any {
  const input = isPlainObject(raw) ? raw : {}
  const next = mergeDeep(defaultSettings(opts), input)

  // Flat legacy keys are honoured only when the nested equivalent is missing.
  if (input.workspaceName && !input.workspace?.name) next.workspace.name = input.workspaceName
  if (input.workspaceUnit && !input.workspace?.unit) next.workspace.unit = input.workspaceUnit
  if (input.language && !input.localization?.defaultLanguage) {
    next.localization.defaultLanguage = input.language
    next.workspace.defaultLanguage = input.language
  }
  if (input.dateFormat && !input.workspace?.regionalFormats?.date)
    next.workspace.regionalFormats.date = input.dateFormat
  if (input.theme && !input.interface?.theme) next.interface.theme = input.theme
  if (input.accentColor && !input.interface?.colors?.accent) {
    next.interface.colors.accent = input.accentColor
    next.workspace.branding.accentColor = input.accentColor
  }
  if (input.density && !input.interface?.density) next.interface.density = input.density
  if (input.sidebarMode && !input.interface?.sidebarBehavior) next.interface.sidebarBehavior = input.sidebarMode
  if (input.defaultPage && !input.interface?.defaultLandingPage) next.interface.defaultLandingPage = input.defaultPage
  if (input.defaultTaskView && !input.interface?.cardLayouts?.tasks)
    next.interface.cardLayouts.tasks = input.defaultTaskView
  if (input.pageSize && !input.interface?.tableBehavior?.pageSize)
    next.interface.tableBehavior.pageSize = Number(input.pageSize)
  if (typeof input.showAnimations === 'boolean' && typeof input.interface?.animations !== 'boolean')
    next.interface.animations = input.showAnimations
  if (Array.isArray(input.enabledPages) && !input.interface?.navigationVisibility && !input.modules)
    DEFAULT_NAVIGATION.forEach(page => {
      next.interface.navigationVisibility[page] = input.enabledPages.includes(page)
      if (next.modules[page]) next.modules[page].enabled = input.enabledPages.includes(page)
    })

  // ---- workspace ----
  if (!isValidTimeZone(next.workspace.defaultTimezone))
    next.workspace.defaultTimezone = defaultSettings(opts).workspace.defaultTimezone
  next.workspace.weekStartsOn = oneOf(next.workspace.weekStartsOn, ['monday', 'sunday', 'saturday'] as const, 'monday')
  for (const key of ['name', 'unit', 'applicationName'] as const) {
    next.workspace[key] = String(next.workspace[key] ?? '').slice(0, 120) || defaultSettings(opts).workspace[key]
  }

  // ---- localization ----
  const loc = next.localization
  const languages = (Array.isArray(loc.activeLanguages) ? loc.activeLanguages : [])
    .filter((code: unknown) => typeof code === 'string' && LANGUAGE_CODE.test(code))
    .slice(0, 20)
  loc.activeLanguages = [...new Set<string>(languages.length ? languages : ['en'])]
  loc.fallbackLanguage = loc.activeLanguages.includes(loc.fallbackLanguage)
    ? loc.fallbackLanguage
    : loc.activeLanguages[0]
  loc.defaultLanguage = loc.activeLanguages.includes(loc.defaultLanguage) ? loc.defaultLanguage : loc.fallbackLanguage
  next.workspace.defaultLanguage = loc.defaultLanguage
  loc.translations = isPlainObject(loc.translations) ? loc.translations : {}
  loc.activeLanguages.forEach((code: string) => {
    loc.translations[code] = isPlainObject(loc.translations[code]) ? loc.translations[code] : {}
  })
  if (opts.builtinTranslations) {
    const builtin = buildTranslationCatalog()
    loc.activeLanguages.forEach((code: string) => {
      loc.translations[code] = { ...(builtin[code] || {}), ...loc.translations[code] }
    })
  }
  loc.interfaces = mergeDeep(builtinInterfaces(), loc.interfaces || {})
  // The runtime missing-key log is diagnostic data held in server memory; it is never persisted with settings.
  loc.missingKeys = []
  if (!Array.isArray(loc.translationMemory)) loc.translationMemory = []
  loc.translationMemory = loc.translationMemory.slice(-500)
  loc.keyPolicy = mergeDeep(
    { prefixByNamespace: true, fallbackRequired: true, approvalRequired: true },
    loc.keyPolicy || {}
  )
  loc.runtime = mergeDeep(
    { domLocalization: true, attributeLocalization: true, optionLocalization: true, reportMissing: true },
    loc.runtime || {}
  )

  // ---- interface ----
  next.interface.theme = oneOf(next.interface.theme, ['light', 'dark', 'system'] as const, 'light')
  next.interface.tableBehavior.pageSize = clampInt(next.interface.tableBehavior.pageSize, 10, 500, 50)

  // ---- roles & permissions (own properties only; known permission names only) ----
  const known = new Set<string>(PERMISSIONS)
  const defaults = roleRegistryDefaults()
  const merged: Record<string, any> = {}
  const incoming = isPlainObject(next.permissions.roles) ? next.permissions.roles : {}
  for (const name of Object.keys(defaults)) merged[name] = mergeDeep(defaults[name], incoming[name] || {})
  for (const [name, role] of Object.entries<any>(incoming)) {
    if (name in merged || !ROLE_NAME.test(name) || name in Object.prototype || !isPlainObject(role)) continue
    merged[name] = {
      name,
      description: String(role.description || role.summary || `${name} role`).slice(0, 300),
      summary: String(role.summary || role.description || `${name} role`).slice(0, 300),
      tone: String(role.tone || 'blue'),
      permissions: Array.isArray(role.permissions) ? role.permissions : [],
      rank: clampInt(role.rank, 1, 99, 2),
      system: false
    }
  }
  for (const [name, role] of Object.entries<any>(merged)) {
    role.name = name
    role.permissions = [
      ...new Set<string>((Array.isArray(role.permissions) ? role.permissions : []).filter((p: string) => known.has(p)))
    ]
    role.rank = clampInt(role.rank, 1, 99, 2)
  }
  // Built-in roles keep their canonical rank (older stores recorded it inverted).
  for (const name of SYSTEM_ROLES) merged[name].rank = ROLE_RANKS[name]
  // The built-in administrator can never lose the permissions required to administer the workspace.
  merged.Administrator.permissions = [
    ...new Set([...merged.Administrator.permissions, 'manageSettings', 'manageUsers'])
  ]
  merged.Administrator.system = true
  next.permissions.roles = merged

  // ---- workflow ----
  const rawStates =
    Array.isArray(next.workflows?.task?.states) && next.workflows.task.states.length
      ? next.workflows.task.states
      : DEFAULT_WORKFLOW_STATES
  const seenLabels = new Set<string>()
  const seenIds = new Set<string>()
  const states: WorkflowState[] = []
  rawStates.slice(0, 20).forEach((state: any, index: number, all: any[]) => {
    const label = String(typeof state === 'string' ? state : state?.label || state?.name || '')
      .trim()
      .slice(0, 40)
    if (!label || seenLabels.has(label.toLowerCase())) return
    seenLabels.add(label.toLowerCase())
    let stateId = typeof state === 'object' && state?.id ? String(state.id).slice(0, 40) : slugifyState(label)
    if (!stateId || seenIds.has(stateId)) stateId = `state_${index + 1}`
    while (seenIds.has(stateId)) stateId += '_'
    seenIds.add(stateId)
    states.push({
      id: stateId,
      label,
      color:
        typeof state === 'object' && state?.color
          ? String(state.color).slice(0, 20)
          : index === all.length - 1
            ? 'green'
            : 'blue',
      terminal: typeof state === 'object' ? Boolean(state?.terminal) : index === all.length - 1
    })
  })
  if (!states.length) states.push(...DEFAULT_WORKFLOW_STATES.map(state => ({ ...state })))
  // The final state is always terminal so that every workflow can be completed.
  states[states.length - 1].terminal = true
  next.workflows.task.states = states
  const labels = new Set(states.map(state => state.label))
  const transitions = (Array.isArray(next.workflows.task.transitions) ? next.workflows.task.transitions : []).filter(
    (row: any) => isPlainObject(row) && labels.has(row.from) && labels.has(row.to)
  )
  next.workflows.task.transitions = transitions.length ? transitions : defaultTransitions(states)
  next.workflows.task.enforceTransitions = next.workflows.task.enforceTransitions === true

  // ---- custom fields ----
  Object.keys(defaultSettings(opts).customFields).forEach(key => {
    if (!Array.isArray(next.customFields[key])) next.customFields[key] = []
  })

  // ---- reports / security / audit ----
  next.reports.activityVisibility = oneOf(
    next.reports.activityVisibility,
    ['managers', 'everyone'] as const,
    'managers'
  )
  if (!Array.isArray(next.reports.templates) || !next.reports.templates.length)
    next.reports.templates = ['standard', 'compact', 'executive']
  if (!next.reports.templates.includes(next.reports.defaultTemplate))
    next.reports.defaultTemplate = next.reports.templates[0]
  next.security.passwordMinLength = clampInt(next.security.passwordMinLength, 8, 128, 8)
  next.security.sessionDays = clampInt(next.security.sessionDays, 1, 90, 14)
  next.audit.retentionDays = clampInt(next.audit.retentionDays, 30, 3650, 365)
  next.audit.workLogRetentionDays = clampInt(next.audit.workLogRetentionDays, 0, 3650, 0)

  return withLegacySettings(next)
}

/** The settings tree as persisted: administrator translation *overrides* only, never the built-in catalog. */
export function compactSettingsForStorage(settings: any): any {
  const copy = structuredClone(settings)
  if (copy?.localization) copy.localization.translations = stripBuiltinTranslations(copy.localization.translations)
  return copy
}
