// What every dataset needs: the request, the person asking, today's date, a translator for labels, and a few helpers to
// describe columns and filters. Datasets stay short because this file does the repeated work.
import { UI_I18N_SOURCES, buildTranslationCatalog, uiPhraseKey } from '../../../shared/i18n/catalog'
import { type Condition, VALUELESS_OPERATORS, FIELD_OPERATORS, isActive } from '../../../shared/filters'
import type { Column, ColumnType, DocumentWords, Section, Tone } from '../../export/model'
import type { User } from '../../domain/types'
import type { ReferenceIndex } from '../../presenters/reference-index'
import type { ExportRequest } from '../../validation/exports'
import type { ServiceContext } from '../context'
import type { ProjectService } from '../projects'
import type { ReportService } from '../reports'

export type Label = (phrase: string) => string

export interface DatasetContext {
  ctx: ServiceContext
  user: User
  ref: ReferenceIndex
  request: ExportRequest
  label: Label
  /** The fixed words every format prints (Generated, Page, Total, Yes, No…). */
  words: DocumentWords
  terminal: string[]
  language: string
  /** Services a composite document draws on (the project page's numbers, the report windows). */
  services: { reports: ReportService; projects: ProjectService }
  /** A scalar the page passed along (a project id, a period…), as text. */
  scope(name: string): string | undefined
}

export interface DatasetResult {
  sections: Section[]
  /** Human-readable description of what narrowed the data (printed under the title). */
  filters: string[]
  subtitle?: string
}

export interface DatasetDefinition {
  id: string
  /** English phrase; translated when shown. */
  title: string
  description: string
  /** Permissions needed in addition to `exportData`. */
  permissions: string[]
  /** All columns the dataset can produce (the person picks among them). */
  columns(dc: Pick<DatasetContext, 'ctx' | 'label'>): Column[]
  run(dc: DatasetContext): DatasetResult
}

/**
 * Translate a phrase: the administrator's override first, then the built-in catalogue, else keep the English. English phrases
 * are never looked up in the built-in catalogue: its keys ignore letter case ("People" and "people" share one key), so a
 * lookup could return the wrong capitalisation, and for English the phrase already is the text.
 */
export function translator(settings: any, language: string): Label {
  const overrides = settings?.localization?.translations?.[language] || {}
  const builtin = language === 'en' ? {} : buildTranslationCatalog()[language] || {}
  const known = new Set(UI_I18N_SOURCES.map(uiPhraseKey))
  return phrase => {
    const key = uiPhraseKey(phrase)
    return overrides[key] || (known.has(key) ? (builtin as Record<string, string>)[key] : undefined) || phrase
  }
}

export const wordsFor = (label: Label): DocumentWords => ({
  generated: label('Generated'),
  by: label('by'),
  page: label('Page'),
  of: label('of'),
  filters: label('Filters'),
  rows: label('rows'),
  total: label('Total'),
  summary: label('Summary'),
  yes: label('Yes'),
  no: label('No'),
  empty: label('Nothing to show'),
  translate: label
})

export function col(
  key: string,
  label: string,
  type: ColumnType,
  source?: string,
  extra: Partial<Column> = {}
): Column {
  return { key, label, type, source, defaultVisible: true, ...extra }
}

/** One column per custom field the administrator defined for this kind of record. */
export function customFieldColumns(settings: any, kind: string, label: Label): Column[] {
  const definitions: any[] = settings?.customFields?.[kind] || []
  return definitions
    .filter(definition => definition?.key && definition.visible !== false)
    .map(definition =>
      col(
        `customFields.${definition.key}`,
        String(definition.label || definition.key),
        definition.type === 'number' ? 'number' : 'text',
        `custom_fields.${definition.key}`,
        {
          defaultVisible: false,
          width: 16
        }
      )
    )
    .map(column => ({ ...column, label: column.label || label(column.key) }))
}

/** A custom field's value out of the stored JSON. */
export const customValue = (json: unknown, key: string): string | number | boolean | null => {
  try {
    const parsed = typeof json === 'string' ? JSON.parse(json) : (json as Record<string, any>)
    const value = parsed?.[key]
    return value === undefined ? null : value
  } catch {
    return null
  }
}

/** A sentence for each active condition, so a printed report says what it was narrowed by. */
export function describeConditions(conditions: Condition[] = [], columns: Column[], label: Label): string[] {
  const operator = new Map(FIELD_OPERATORS)
  return conditions.filter(isActive).map(condition => {
    const column = columns.find(c => c.key === condition.field)
    const field = column?.label || condition.field
    const how = label(operator.get(condition.operator) || condition.operator).toLowerCase()
    return VALUELESS_OPERATORS.has(condition.operator) ? `${field} ${how}` : `${field} ${how} “${condition.value}”`
  })
}

export const tones = {
  status: (done: boolean, blocked: boolean, status: string): Tone | undefined =>
    done ? 'good' : blocked ? 'bad' : /progress|review|test/i.test(status) ? 'info' : undefined,
  priority: (priority: string): Tone | undefined =>
    priority === 'High' ? 'bad' : priority === 'Medium' ? 'warn' : priority === 'Low' ? 'muted' : undefined,
  health: (health: string): Tone | undefined =>
    health === 'At risk' ? 'bad' : health === 'Completed' ? 'good' : health === 'On track' ? 'good' : undefined
}
