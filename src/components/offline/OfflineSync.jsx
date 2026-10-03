import React, { useEffect, useState } from 'react'
import {
  flushOfflineOutbox, resolveOfflineConflict, retryFailedOperation
} from '../../api/offline-sync.js'
import { Icon } from '../Icon.jsx'
import './offline.css'

function present(value) {
  if (value === undefined) return 'Not set'
  if (value === null) return 'None'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  if (value === '') return 'Empty'
  return String(value)
}

function ConflictCard({ operation, onResolve }) {
  const [choices, setChoices] = useState({})
  const conflict = operation.conflict || {}
  const fields = conflict.fields || []
  const missingBase = fields.some(field => field.path === '*')
  const entityLabel = `${conflict.collection || operation.collection} ${conflict.entityId || operation.entityId || ''}`.trim()
  const choose = (path, value) => setChoices(current => ({ ...current, [path]: value }))
  return <article className="offline-operation offline-operation-conflict">
    <div className="offline-operation-heading"><div><strong>{entityLabel}</strong><span>Needs a decision</span></div><span className="offline-state-pill conflict">Conflict</span></div>
    <p className="offline-operation-error">{conflict.error || operation.lastError || 'This change overlaps a newer edit on the local host.'}</p>
    {conflict.remoteDeleted && <div className="offline-conflict-actions"><button className="secondary-button" onClick={() => onResolve(operation, { action: 'keep-server' })}>Keep server deletion</button><button className="primary-button" onClick={() => onResolve(operation, { action: 'recreate' })}>Re-create my version</button></div>}
    {conflict.localDelete && <div className="offline-conflict-actions"><button className="secondary-button" onClick={() => onResolve(operation, { action: 'keep-server' })}>Keep the server version</button><button className="primary-button" onClick={() => onResolve(operation, { action: 'delete-anyway' })}>Delete after reviewing server changes</button></div>}
    {conflict.code === 'offline-id-collision' && <div className="offline-conflict-actions"><button className="secondary-button" onClick={() => onResolve(operation, { action: 'keep-server' })}>Keep existing server record</button><button className="primary-button" onClick={() => onResolve(operation, { action: 'new-id' })}>Retry with a new local ID</button></div>}
    {!conflict.remoteDeleted && !conflict.localDelete && conflict.code !== 'offline-id-collision' && missingBase && <><p className="offline-operation-error">Atlas could not find the original version on this device. Choosing your edit retries it against the current server version; review the record carefully.</p><div className="offline-conflict-actions"><button className="secondary-button" onClick={() => onResolve(operation, { action: 'keep-server' })}>Keep server version</button><button className="primary-button" onClick={() => onResolve(operation, { action: 'overwrite' })}>Retry my edit against server version</button></div></>}
    {!conflict.remoteDeleted && !conflict.localDelete && conflict.code !== 'offline-id-collision' && fields.length > 0 && !missingBase && <>
      <div className="offline-conflict-fields">{fields.map(field => <fieldset className="offline-conflict-field" key={field.path}>
        <legend>{field.path}</legend>
        <label><input type="radio" name={`${operation.operationId}-${field.path}`} checked={choices[field.path] !== 'server'} onChange={() => choose(field.path, 'local')}/><span><b>Keep my edit</b><pre>{present(field.local)}</pre></span></label>
        <label><input type="radio" name={`${operation.operationId}-${field.path}`} checked={choices[field.path] === 'server'} onChange={() => choose(field.path, 'server')}/><span><b>Keep server edit</b><pre>{present(field.server)}</pre></span></label>
      </fieldset>)}</div>
      <div className="offline-conflict-actions"><button className="secondary-button" onClick={() => onResolve(operation, { action: 'keep-server' })}>Discard my pending edit</button><button className="primary-button" onClick={() => onResolve(operation, { action: 'merge', fields: choices })}>Apply choices and sync</button></div>
    </>}
    {!conflict.remoteDeleted && !conflict.localDelete && conflict.code !== 'offline-id-collision' && fields.length === 0 && <div className="offline-conflict-actions"><button className="secondary-button" onClick={() => onResolve(operation, { action: 'keep-server' })}>Discard pending change</button></div>}
  </article>
}

export function OfflineSyncBar({ userId, connected, status, onOpen }) {
  if (!userId) return null
  const count = status.pending + status.conflicts + status.failed
  const label = !connected ? 'Offline — edits are stored on this device' : status.conflicts ? 'Sync paused — resolve a conflict' : status.failed ? 'Sync needs attention' : status.pending ? 'Syncing local changes' : 'All changes synced'
  return <div className={`offline-sync-bar ${connected ? 'is-connected' : 'is-disconnected'} ${count ? 'has-work' : ''}`} role="status" aria-live="polite">
    <span className="offline-sync-indicator" aria-hidden="true"><span/></span>
    <span className="offline-sync-label">{label}</span>
    {count > 0 && <span className="offline-sync-count">{count} {count === 1 ? 'change' : 'changes'} waiting</span>}
    {status.otherUserPending > 0 && <span className="offline-sync-other">Another signed-in account has {status.otherUserPending} local change{status.otherUserPending === 1 ? '' : 's'} waiting.</span>}
    {(count > 0 || !connected) && <button type="button" className="offline-sync-open" onClick={onOpen}>{status.conflicts ? 'Review conflict' : !connected ? 'View sync status' : 'View changes'} <Icon name="arrow" size={13}/></button>}
  </div>
}

export function OfflineSyncPanel({ open, onClose, userId, status, connected, onRefresh }) {
  useEffect(() => { if (!open) return; const closeOnEscape = event => { if (event.key === 'Escape') onClose() }; window.addEventListener('keydown', closeOnEscape); return () => window.removeEventListener('keydown', closeOnEscape) }, [open, onClose])
  if (!open) return null
  const operations = status.operations || []
  const handleResolve = async (operation, resolution) => {
    await resolveOfflineConflict(operation.operationId, userId, resolution)
    await onRefresh()
    if (resolution.action === 'merge' || resolution.action === 'delete-anyway' || resolution.action === 'recreate' || resolution.action === 'new-id') await flushOfflineOutbox(userId, { force: true })
  }
  const handleRetry = async operation => { await retryFailedOperation(operation.operationId, userId); await onRefresh(); if (connected) await flushOfflineOutbox(userId, { force: true }) }
  return <div className="offline-panel-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="offline-panel" role="dialog" aria-modal="true" aria-labelledby="offline-panel-title">
      <header className="offline-panel-header"><div><span className="eyebrow">Local synchronization</span><h2 id="offline-panel-title">Changes on this device</h2><p>{connected ? 'Atlas will retry safely until every change is synchronized.' : 'You can continue editing. Changes are saved in this browser until the local host is reachable.'}</p></div><button type="button" className="icon-button" aria-label="Close sync panel" onClick={onClose}><Icon name="close" size={18}/></button></header>
      <div className="offline-panel-summary"><span>{status.pending} waiting</span><span>{status.conflicts} conflicts</span><span>{status.failed} need attention</span>{connected && status.pending > 0 && <button className="text-button" onClick={() => flushOfflineOutbox(userId, { force: true }).then(onRefresh)}>Sync now</button>}</div>
      {!status.storagePersistent && <div className="offline-panel-note">This browser did not confirm persistent site storage. Atlas writes the outbox to IndexedDB before acknowledging an offline edit, but browser cleanup or profile loss can still remove local data. Keep this device profile intact until changes sync.</div>}
      {status.otherUserPending > 0 && <div className="offline-panel-note">{status.otherUserPending} change{status.otherUserPending === 1 ? '' : 's'} belong to a different Atlas account on this browser. Sign in to that account to synchronize them.</div>}
      <div className="offline-operation-list">
        {operations.map(operation => operation.status === 'conflict'
          ? <ConflictCard key={operation.operationId} operation={operation} onResolve={handleResolve}/>
          : <article className="offline-operation" key={operation.operationId}>
            <div className="offline-operation-heading"><div><strong>{operation.collection} · {operation.action}</strong><span>{new Date(operation.createdAt).toLocaleString()}</span></div><span className={`offline-state-pill ${operation.status}`}>{operation.status === 'retrying' ? 'Retry scheduled' : operation.status === 'failed' ? 'Needs attention' : operation.status}</span></div>
            {operation.lastError && <p className="offline-operation-error">{operation.lastError}</p>}
            <div className="offline-operation-actions"><button className="text-button" onClick={() => handleRetry(operation)}>Retry</button></div>
          </article>)}
        {!operations.length && <div className="offline-empty"><span className="offline-sync-indicator"><span/></span><h3>No pending changes</h3><p>Your latest saved edits are synchronized with the local Atlas host.</p></div>}
      </div>
      <footer className="offline-panel-footer"><span>Pending edits stay on this device until acknowledged by the host. Do not clear browser data while changes are waiting.</span><button className="secondary-button" onClick={onClose}>Done</button></footer>
    </section>
  </div>
}
