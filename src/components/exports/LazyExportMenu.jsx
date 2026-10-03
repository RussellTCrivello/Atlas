import { lazy, Suspense } from 'react'

const ExportMenu = lazy(() => import('./ExportMenu.jsx').then(module => ({ default: module.ExportMenu })))

export function LazyExportMenu(props) {
  return <Suspense fallback={<span className="export-wrap"><button className="secondary-button" type="button" disabled>Loading report tools…</button></span>}>
    <ExportMenu {...props}/>
  </Suspense>
}
