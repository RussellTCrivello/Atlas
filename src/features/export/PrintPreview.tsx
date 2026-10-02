// The print preview: the document the server built, shown as it will print, with a Print button. The page runs in a sandboxed
// frame without scripts, so nothing inside it can act on the application.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../ui/icons'
import { PRINT_PREVIEW_EVENT, type PrintPreviewDetail } from './print'

/** Mounted once, at the root of the application: shows the preview whenever a print job is ready. */
export function PrintPreviewHost() {
  const [job, setJob] = useState<PrintPreviewDetail | null>(null)
  useEffect(() => {
    const open = (event: Event) => setJob((event as CustomEvent<PrintPreviewDetail>).detail)
    window.addEventListener(PRINT_PREVIEW_EVENT, open)
    return () => window.removeEventListener(PRINT_PREVIEW_EVENT, open)
  }, [])
  return job ? <PrintPreview job={job} onClose={() => setJob(null)} /> : null
}

function PrintPreview({ job, onClose }: { job: PrintPreviewDetail; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const printButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    printButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [onClose])
  const print = () => {
    const win = frame.current?.contentWindow
    win?.focus()
    win?.print()
  }
  return (
    <div
      className="print-preview-backdrop"
      role="presentation"
      onMouseDown={event => event.target === event.currentTarget && onClose()}
    >
      <div className="print-preview" role="dialog" aria-modal="true" aria-label={`Print preview: ${job.title}`}>
        <div className="print-preview-bar">
          <strong>{job.title}</strong>
          <span className="print-preview-note">Preview of the document that will be printed</span>
          <button type="button" className="primary-button" ref={printButton} onClick={print}>
            <Icon name="external" size={15} /> Print
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
        </div>
        <iframe
          ref={frame}
          title={`Print preview: ${job.title}`}
          sandbox="allow-same-origin allow-modals"
          srcDoc={job.html}
        />
      </div>
    </div>
  )
}
