// Turning an export document into bytes. One entry point, one function per format; none of them knows where the data came from.
import { renderCsv } from './formats/csv'
import { renderHtml } from './formats/html'
import { renderJson } from './formats/json'
import { renderPdf } from './formats/pdf'
import { renderXlsx } from './formats/xlsx'
import type { ExportDocument, RenderOptions, Rendered } from './model'

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'pdf' | 'html'
export const EXPORT_FORMATS: readonly ExportFormat[] = ['pdf', 'xlsx', 'csv', 'json', 'html']

export const DEFAULT_RENDER: RenderOptions = {
  orientation: 'landscape',
  margin: 14,
  template: 'executive',
  branding: true,
  fonts: null
}

export function renderDocument(
  doc: ExportDocument,
  format: ExportFormat,
  options: Partial<RenderOptions> = {}
): Rendered {
  const merged: RenderOptions = { ...DEFAULT_RENDER, ...options }
  switch (format) {
    case 'csv':
      return renderCsv(doc)
    case 'json':
      return renderJson(doc)
    case 'xlsx':
      return renderXlsx(doc, merged)
    case 'pdf':
      return renderPdf(doc, merged)
    case 'html':
      return renderHtml(doc, merged)
  }
}

export * from './model'
export { safeFilename } from './values'
