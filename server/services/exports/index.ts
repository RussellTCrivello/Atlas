// Exports and printing. A person asks for a dataset in a format; the service checks they may, builds the document from the
// database, narrows it to the columns and filters they chose, renders it, and records that it happened. The same document
// feeds CSV, JSON, spreadsheet, PDF and the print view, so they never disagree.
import path from 'node:path'
import { RTL_LANGUAGES } from '../../../shared/i18n/catalog'
import { can } from '../../domain/permissions'
import type { User } from '../../domain/types'
import {
  type ExportDocument,
  type Row,
  type TableSection,
  renderDocument,
  rowCount,
  safeFilename,
  tableSections
} from '../../export'
import { displayCell } from '../../export/values'
import { HttpError, badRequest, forbidden, notFound } from '../../util'
import type { ExportFormatName, ExportRequest } from '../../validation/exports'
import type { AuditContext } from '../../domain/audit-chain'
import type { AuditService } from '../audit'
import type { ServiceContext } from '../context'
import type { ProjectService } from '../projects'
import type { ReportService } from '../reports'
import { DATASETS, datasetById } from './datasets'
import { loadFonts } from './fonts'
import { type DatasetContext, translator, wordsFor } from './kit'
import { workflowStates, isDone } from '../../domain/workflow'

const MARGINS: Record<string, number> = { narrow: 10, standard: 14, wide: 20 }
/** PDF and print lay every row out on a page, so they have a lower ceiling than the formats that hand the data over as it is. */
const ROW_LIMITS: Record<ExportFormatName, number> = {
  pdf: 5000,
  print: 5000,
  xlsx: 200_000,
  csv: 200_000,
  json: 200_000
}
const FORMAT_OF: Record<ExportFormatName, 'pdf' | 'html' | 'xlsx' | 'csv' | 'json'> = {
  pdf: 'pdf',
  print: 'html',
  xlsx: 'xlsx',
  csv: 'csv',
  json: 'json'
}

export interface ExportResult {
  body: Uint8Array | string
  mime: string
  filename: string
  rows: number
  /** Set when the PDF had to use a font without Arabic, Persian or Hebrew glyphs. */
  basicFont: boolean
}

export class ExportService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService,
    private reports: ReportService,
    private projects: ProjectService
  ) {}

  private allowedFormats(): string[] {
    const configured = this.ctx.settings.exports?.formats
    return Array.isArray(configured) && configured.length ? configured : ['csv', 'xlsx', 'json', 'pdf', 'print']
  }

  private languageFor(requested?: string) {
    const settings = this.ctx.settings
    const active: string[] = settings.localization?.activeLanguages || ['en']
    const fallback = settings.localization?.defaultLanguage || 'en'
    const language =
      settings.exports?.respectLanguage === false
        ? fallback
        : requested && active.includes(requested)
          ? requested
          : fallback
    const direction =
      settings.exports?.respectDirection === false
        ? 'ltr'
        : ((settings.localization?.textDirectionByLanguage?.[language] ||
            (RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr')) as 'ltr' | 'rtl')
    return { language, direction }
  }

  private permitted(user: User, permissions: string[]): boolean {
    return (
      can(this.ctx.settings, user, 'exportData') &&
      permissions.every(permission => can(this.ctx.settings, user, permission))
    )
  }

  /** The datasets this person may export, with their columns, so the screen never hard-codes what can be exported. */
  catalog(user: User, requestedLanguage?: string) {
    const { language } = this.languageFor(requestedLanguage)
    const label = translator(this.ctx.settings, language)
    const formats = this.allowedFormats()
    return {
      formats: ['pdf', 'xlsx', 'csv', 'json', 'print'].filter(format => formats.includes(format)),
      templates: ['executive', 'standard', 'compact'],
      defaults: {
        orientation: this.ctx.settings.exports?.pdf?.orientation === 'portrait' ? 'portrait' : 'landscape',
        margin: MARGINS[this.ctx.settings.exports?.pdf?.margins] ?? 14,
        template: this.defaultTemplate()
      },
      datasets: DATASETS.filter(dataset => this.permitted(user, dataset.permissions)).map(dataset => ({
        id: dataset.id,
        title: label(dataset.title),
        description: dataset.description,
        columns: dataset
          .columns({ ctx: this.ctx, label })
          .filter(column => !column.filterOnly)
          .map(({ key, label: text, type, defaultVisible, source }) => ({
            key,
            label: text,
            type,
            defaultVisible: Boolean(defaultVisible),
            source
          }))
      }))
    }
  }

  private defaultTemplate(): 'executive' | 'standard' | 'compact' {
    const template = this.ctx.settings.reports?.defaultTemplate
    return template === 'compact' || template === 'standard' ? template : 'executive'
  }

  private build(user: User, request: ExportRequest): { doc: ExportDocument; dataset: string } {
    const { settings } = this.ctx
    const dataset = datasetById(request.dataset)
    if (!dataset) throw notFound(`There is nothing to export called "${request.dataset}"`)
    if (!can(settings, user, 'exportData')) throw forbidden('Your role is not allowed to export data')
    const missing = dataset.permissions.find(permission => !can(settings, user, permission))
    if (missing)
      throw new HttpError(403, `Exporting "${dataset.title}" needs the "${missing}" permission`, 'FORBIDDEN', {
        permission: missing
      })

    const { language, direction } = this.languageFor(request.language)
    const label = translator(settings, language)
    const ref = this.ctx.reference()
    const terminal = workflowStates(settings).filter(state => isDone(settings, { status: state }))
    const dc: DatasetContext = {
      ctx: this.ctx,
      user,
      ref,
      request,
      label,
      words: wordsFor(label),
      language,
      terminal,
      services: { reports: this.reports, projects: this.projects },
      scope: name => (request.scope?.[name] === undefined ? undefined : String(request.scope[name]))
    }
    const result = dataset.run(dc)

    // Narrow the main table to the columns the person chose (in their order), then group it if asked.
    const sections = result.sections.map(section =>
      section.kind === 'table' && section.primary ? this.narrow(section, request) : section
    )
    const title = request.title || label(dataset.title)
    const doc: ExportDocument = {
      id: dataset.id,
      title,
      subtitle: result.subtitle,
      workspace: settings.workspace?.name || 'Atlas Workspace',
      generatedAt: new Date().toISOString(),
      generatedBy: user.name,
      language,
      direction,
      filters: result.filters,
      footerText: settings.reports?.branding?.footerText || undefined,
      sections,
      words: dc.words
    }
    return { doc, dataset: dataset.id }
  }

  private narrow(section: TableSection, request: ExportRequest): TableSection {
    const available = section.columns.filter(column => !column.filterOnly)
    const chosen = request.columns?.length
      ? request.columns
          .map(key => available.find(column => column.key === key))
          .filter((column): column is NonNullable<typeof column> => Boolean(column))
      : available.filter(column => column.defaultVisible !== false)
    if (!chosen.length) throw badRequest('Choose at least one column to export')
    let rows: Row[] = section.rows
    let groupBy = section.groupBy
    if (request.groupBy && chosen.some(column => column.key === request.groupBy) && !groupBy) {
      groupBy = request.groupBy
      const order = new Map<string, number>()
      rows.forEach(row => order.has(String(row[groupBy!])) || order.set(String(row[groupBy!]), order.size))
      // keep the original order inside each group
      const indexed = rows.map((row, index) => ({ row, index }))
      indexed.sort(
        (a, b) => order.get(String(a.row[groupBy!]))! - order.get(String(b.row[groupBy!]))! || a.index - b.index
      )
      const remap = new Map(indexed.map((entry, to) => [entry.index, to]))
      rows = indexed.map(entry => entry.row)
      const tones =
        section.tones &&
        Object.fromEntries(
          Object.entries(section.tones).map(([from, value]) => [String(remap.get(Number(from))), value])
        )
      return { ...section, columns: chosen, rows, groupBy, tones: tones as TableSection['tones'] }
    }
    return { ...section, columns: chosen, rows, groupBy }
  }

  /** Count and a small sample of what an export would contain, without producing a file. */
  preview(user: User, request: ExportRequest) {
    const { doc } = this.build(user, request)
    const table = tableSections(doc).find(section => section.primary) || tableSections(doc)[0]
    return {
      title: doc.title,
      rows: rowCount(doc),
      columns: table?.columns.map(({ key, label, type }) => ({ key, label, type })) ?? [],
      sample: (table?.rows ?? [])
        .slice(0, 5)
        .map(row =>
          Object.fromEntries(
            table!.columns.map(column => [
              column.key,
              displayCell(row[column.key] ?? null, column, doc.language, doc.words)
            ])
          )
        ),
      filters: doc.filters
    }
  }

  run(user: User, request: ExportRequest, who: AuditContext): ExportResult {
    const settings = this.ctx.settings
    if (!this.allowedFormats().includes(request.format))
      throw new HttpError(403, 'This export format is turned off (Settings > Reports & exports).', 'FORMAT_DISABLED')
    const { doc, dataset } = this.build(user, request)
    const rows = rowCount(doc)
    if (rows > ROW_LIMITS[request.format])
      throw new HttpError(
        413,
        `This export has ${rows.toLocaleString('en')} rows; ${request.format === 'pdf' || request.format === 'print' ? 'PDF and print are' : 'exports are'} limited to ${ROW_LIMITS[request.format].toLocaleString('en')}. Narrow the filters${request.format === 'pdf' || request.format === 'print' ? ', or export CSV or Excel for the full list' : ''}.`,
        'TOO_MANY_ROWS',
        { rows, limit: ROW_LIMITS[request.format] }
      )
    const fonts =
      request.format === 'pdf'
        ? loadFonts([
            path.join(this.ctx.config.staticDir, 'fonts'),
            path.join(this.ctx.config.appRoot, 'public', 'fonts')
          ])
        : null
    const rendered = renderDocument(doc, FORMAT_OF[request.format], {
      orientation:
        request.orientation ?? (settings.exports?.pdf?.orientation === 'portrait' ? 'portrait' : 'landscape'),
      margin: request.margin ?? MARGINS[settings.exports?.pdf?.margins] ?? 14,
      template: request.template ?? this.defaultTemplate(),
      branding: settings.exports?.includeBranding !== false,
      fonts
    })
    // Recorded before the file leaves the server, in its own small transaction: an export that was handed over is always on the record.
    if (settings.audit?.trackExports !== false)
      this.ctx.transaction(
        () =>
          this.audit.record('data.exported', who, {
            page: dataset,
            dataset,
            format: request.format,
            rows,
            columns: tableSections(doc)[0]?.columns.length ?? 0
          }),
        { revision: false }
      )
    return {
      body: rendered.body,
      mime: rendered.mime,
      filename: `${safeFilename(doc.title)}.${rendered.extension}`,
      rows,
      basicFont: Boolean(rendered.basicFont)
    }
  }
}
