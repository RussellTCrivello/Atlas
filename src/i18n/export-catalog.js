import { translateUiText } from './catalog.js'

const TRANSLATABLE_EXPORT_VALUES = {
  projects: new Set(['health', 'status']),
  tasks: new Set(['status', 'priority', 'type']),
  people: new Set(['status']),
  activity: new Set(['status']),
  alerts: new Set(['type']),
  milestones: new Set(['status']),
  users: new Set(['role']),
  'activity-evidence': new Set(['action', 'status'])
}

export const EXPORT_DATASET_LABELS = {
  projects: 'Projects',
  tasks: 'Tasks',
  people: 'People',
  activity: 'Activity',
  alerts: 'Alerts',
  milestones: 'Milestones',
  users: 'Users',
  'delivery-report': 'Delivery report',
  'activity-evidence': 'Activity evidence',
  'activity-summary': 'Activity summary',
  'project-contributions': 'Project contributions'
}

export function exportText(settings, value) {
  return translateUiText(settings, value)
}

export function localizeExportColumns(dataset, columns = [], settings) {
  const fixedValues = TRANSLATABLE_EXPORT_VALUES[dataset] || new Set()
  return columns.map(column => ({
    ...column,
    label: exportText(settings, column.label),
    translateValue: fixedValues.has(column.key)
  }))
}

export function localizeExportValue(value, column, settings) {
  if (column?.type === 'boolean') {
    if (value === true || value === 1) return exportText(settings, 'Yes')
    if (value === false || value === 0) return exportText(settings, 'No')
  }
  if (column?.translateValue && value !== null && value !== undefined && !(Array.isArray(value) || typeof value === 'object')) {
    return exportText(settings, String(value))
  }
  return String(value ?? '')
}
