// JSON: the whole document, typed. Numbers stay numbers, dates stay ISO strings, and every column names the database field it
// reads, so the file documents itself.
import { type ExportDocument, type Rendered } from '../model'

export function renderJson(doc: ExportDocument): Rendered {
  const out = {
    document: {
      id: doc.id,
      title: doc.title,
      subtitle: doc.subtitle,
      workspace: doc.workspace,
      generatedAt: doc.generatedAt,
      generatedBy: doc.generatedBy,
      language: doc.language,
      filters: doc.filters
    },
    sections: doc.sections.map(section =>
      section.kind === 'table'
        ? {
            kind: 'table',
            id: section.id,
            title: section.title,
            columns: section.columns.map(({ key, label, type, source }) => ({ key, label, type, source })),
            rows: section.rows.map(row =>
              Object.fromEntries(section.columns.map(column => [column.key, row[column.key] ?? null]))
            ),
            totals: section.totals
          }
        : section
    )
  }
  return { body: JSON.stringify(out, null, 2), mime: 'application/json; charset=utf-8', extension: 'json' }
}
