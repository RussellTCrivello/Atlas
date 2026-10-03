// Printing. A print job is a document the server builds from the database (format "print"); it is shown in a preview and only
// then handed to the browser's or the desktop app's print dialog. The interface itself is never printed: the stylesheet hides
// it when a print is attempted by any other route (see styles/22-print.css).
import { type ExportRequest, fetchExportCatalog, requestExport } from '../../lib/export'

export const PRINT_PREVIEW_EVENT = 'atlas:print-preview'
export interface PrintPreviewDetail {
  html: string
  title: string
}

/** Build the print document for a request and open the preview. Rejects with the server's explanation. */
export async function openPrintPreview(request: Omit<ExportRequest, 'format'>) {
  const file = await requestExport({ ...request, format: 'print' })
  window.dispatchEvent(
    new CustomEvent<PrintPreviewDetail>(PRINT_PREVIEW_EVENT, {
      detail: { html: await file.blob.text(), title: request.title || 'Atlas' }
    })
  )
}

/** Print chosen records (a selection, or one record) with the dataset's default columns. Rejects with the server's explanation. */
export async function printRecords(language: string, dataset: string, ids: (string | number)[], title: string) {
  const entry = (await fetchExportCatalog(language)).datasets.find(item => item.id === dataset)
  if (!entry) throw new Error('Your role cannot print this.')
  await openPrintPreview({
    dataset,
    ids,
    title,
    language,
    columns: entry.columns.filter(column => column.defaultVisible).map(column => column.key)
  })
}

// The page that is on screen says what "print" means for it: Ctrl/Cmd+P, the desktop File > Print item and the Print button all
// go through here. A page registers its main export when it appears and unregisters when it goes.
const printers: Array<() => void> = []
export function registerPrinter(print: () => void): () => void {
  printers.push(print)
  return () => {
    const index = printers.lastIndexOf(print)
    if (index >= 0) printers.splice(index, 1)
  }
}
/** Print what the current page offers, or `fallback` (the workspace summary) when it offers nothing. */
export function printCurrentPage(fallback: () => void) {
  const printer = printers[printers.length - 1]
  if (printer) printer()
  else fallback()
}
