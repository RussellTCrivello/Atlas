// Honest labelling of the Settings console. Every setting the console can edit is either applied by Atlas or merely stored
// for later. Stored-only settings are shown disabled with a badge, so nobody believes a control is protecting them when
// nothing reads it (the audit found 27 such keys, including security-sounding ones).
const NOT_APPLIED = [
  'notifications',
  'integrations',
  'workflows.task.approvalSteps',
  'workflows.task.automatedActions',
  'workspace.workingDays',
  'workspace.workingHours',
  'workspace.holidays',
  'workspace.logo',
  'workspace.organization',
  'workspace.branding.reportLogo',
  'workspace.branding.loginHeadline',
  'workspace.branding.primaryColor',
  'interface.colors.primary',
  'workspace.regionalFormats',
  'dateFormat',
  'permissions.moduleAccess',
  'permissions.fieldAccess',
  'permissions.actionAccess',
  'permissions.exportPermissions',
  'permissions.reportingPermissions',
  'security.requireApprovalForRoleChanges',
  'localization.numberFormats',
  'localization.currencyFormats',
  'localization.dateFormats',
  'localization.timezoneFormats',
  'localization.keyPolicy',
  'localization.approvalWorkflow',
  'reports.customColumns',
  'reports.customFilters',
  'reports.customCalculations',
  'reports.localizedOutput',
  'reports.branding',
  'interface.spacing',
  'interface.typography',
  'interface.accessibility.scalableText',
  'interface.accessibility.screenReaderLabels',
  'interface.tableColumns',
  'interface.formLayouts',
  'exports.respectLanguage',
  'modules.metadata',
  'interface.actionVisibility.create',
  'interface.actionVisibility.edit',
  'interface.actionVisibility.delete'
]

export function isNotApplied(path?: string): boolean {
  return Boolean(path) && NOT_APPLIED.some(entry => path === entry || path!.startsWith(`${entry}.`))
}

export const NOT_APPLIED_HINT = 'This value is saved, but nothing in Atlas reads it yet, so changing it has no effect.'
