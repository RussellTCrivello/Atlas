import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, logOutOfflineState } from './api/client.js'
import { ensureSessionNotExpired, flushOfflineOutbox, getCachedBootstrap, getOfflineSession, getOfflineSyncStatus, offlineEvents } from './api/offline-sync.js'
import { OfflineSyncBar, OfflineSyncPanel } from './components/offline/OfflineSync.jsx'
import { Icon } from './components/Icon.jsx'
import { LoadingScreen, ToastHost } from './components/common.jsx'
import { UserPreferencesProvider } from './context/user-preferences.jsx'
import { ActivityLog, Alerts, MyWork, Overview, People, Projects, Reports, UserActivityReports } from './pages/WorkspacePages.jsx'
import { SettingsPage } from './pages/SettingsPage.jsx'
import { LoginScreen, SetupWizard } from './pages/AccessPages.jsx'
import { CommandSearch, QuickActionRail, Sidebar, Topbar } from './components/navigation/WorkspaceNavigation.jsx'
import { EntityFormModal } from './components/forms/EntityFormModal.jsx'
import { actionVisible } from './lib/advanced-filters.js'
import { clearLegacyFilterPreferences, mergeLegacyFilterPreferences, readLegacyFilterPreferences } from './lib/legacy-filter-preferences.js'
import { textDirection } from './lib/localization.js'
import { enabledPages, hasPermission, mergeDeep } from './lib/workspace.js'
import { defaultSettings, emptyData } from './config/workspace-defaults.js'
import { useUiLocalization } from './i18n/runtime.js'
import './styles.css'
import { detectDisplayMode } from './desktop.js'

async function runLimited(items, limit, worker, onProgress) {
  const results = Array(items.length)
  let nextIndex = 0
  let completed = 0
  const count = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: count }, async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      try { results[index] = { ok: true, value: await worker(items[index], index) } }
      catch (error) { results[index] = { ok: false, error } }
      completed++
      onProgress?.(completed)
    }
  }))
  return results
}

function App() {
  const [setup, setSetup] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [data, setData] = useState(emptyData)
  const [userPreferences, setUserPreferences] = useState({ filters: {} })
  const userPreferencesRef = useRef({ filters: {} })
  const preferenceSaveQueue = useRef(Promise.resolve())
  const [page, setPage] = useState('overview')
  const [modal, setModal] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [runtime, setRuntime] = useState(null)
  const [system, setSystem] = useState(null)
  const [error, setError] = useState('')
  const [connectionReachable, setConnectionReachable] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
  const [syncStatus, setSyncStatus] = useState({ pending: 0, conflicts: 0, failed: 0, otherUserPending: 0, operations: [] })
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [toasts, setToasts] = useState([])
  const [displayMode, setDisplayMode] = useState(() => detectDisplayMode())
  const [languagePreview, setLanguagePreview] = useState('')
  const defaultPageApplied = useRef(false)
  const settings = useMemo(() => {
    const next = mergeDeep(defaultSettings, data.settings || {})
    if (languagePreview) {
      next.language = languagePreview
      next.localization = { ...(next.localization || {}), defaultLanguage: languagePreview }
      next.workspace = { ...(next.workspace || {}), defaultLanguage: languagePreview }
    }
    return next
  }, [data.settings, languagePreview])
  useUiLocalization(settings)
  const isAdministrator = user?.role === 'Administrator' && hasPermission(user, 'manageSettings')
  const canManage = hasPermission(user, 'manageProjects') || hasPermission(user, 'managePeople') || hasPermission(user, 'manageAlerts')
  const canManageTasks = hasPermission(user, 'manageTasks')
  const canManageProjects = hasPermission(user, 'manageProjects')
  const canManagePeople = hasPermission(user, 'managePeople')
  const canManageAlerts = hasPermission(user, 'manageAlerts')
  const canWriteTasks = hasPermission(user, 'writeTasks')
  const canLogActivity = hasPermission(user, 'logActivity')
  const canExport = hasPermission(user, 'exportData')
  const canCreateTasks = canManageTasks && actionVisible(settings, 'create')
  const notify = useCallback(toast => { const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`; setToasts(t => [...t.slice(-4), { id, ...toast }]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200) }, [])
  const loadData = useCallback(async () => {
    try {
      const [next, storedPreferences] = await Promise.all([api.get('/api/bootstrap'), api.get('/api/preferences')])
      const legacyFilters = readLegacyFilterPreferences()
      const savedFilters = storedPreferences.filters || {}
      const mergedFilters = mergeLegacyFilterPreferences(savedFilters, legacyFilters)
      const hasLegacyFiltersToImport = Object.keys(mergedFilters).some((key) => !Object.hasOwn(savedFilters, key))
      const preferences = hasLegacyFiltersToImport
        ? await api.put('/api/preferences', { filters: mergedFilters })
        : storedPreferences
      clearLegacyFilterPreferences()
      userPreferencesRef.current = preferences
      setUserPreferences(preferences)
      setData(next)
      setUser((current) => JSON.stringify(current) === JSON.stringify(next.user) ? current : next.user)
      setError('')
      if (!defaultPageApplied.current && next.settings?.defaultPage) {
        const requestedPage = next.settings.defaultPage
        setPage(requestedPage === 'settings' && next.user?.role !== 'Administrator' ? 'overview' : requestedPage)
        defaultPageApplied.current = true
      }
    } catch (err) {
      setError(err.message)
    }
  }, [])
  const saveUserFilter = useCallback((filterKey, conditions) => {
    const save = async () => {
      const latestFilters = userPreferencesRef.current?.filters || {}
      const filters = { ...latestFilters, [filterKey]: conditions }
      const saved = await api.put('/api/preferences', { filters })
      userPreferencesRef.current = saved
      setUserPreferences(saved)
      return saved
    }
    const queued = preferenceSaveQueue.current.then(save, save)
    preferenceSaveQueue.current = queued.catch(() => {})
    return queued
  }, [])
  const preferencesContext = useMemo(() => ({
    filters: userPreferences.filters || {},
    saveFilter: saveUserFilter
  }), [userPreferences.filters, saveUserFilter])
  const refreshSyncStatus = useCallback(async () => {
    try { setSyncStatus(await getOfflineSyncStatus(user?.id || '')) }
    catch { setSyncStatus({ pending: 0, conflicts: 0, failed: 0, otherUserPending: 0, operations: [] }) }
  }, [user?.id])
  useEffect(() => {
    const eventNames = offlineEvents()
    const refresh = () => { refreshSyncStatus() }
    const connectivity = event => {
      const connected = Boolean(event.detail?.connected)
      setConnectionReachable(connected)
      if (connected && user?.id) flushOfflineOutbox(user.id).then(refreshSyncStatus).catch(() => {})
    }
    const syncComplete = event => {
      refreshSyncStatus()
      if (user?.id && String(event.detail?.userId || '') === String(user.id)) loadData()
    }
    const browserOnline = () => {
      setConnectionReachable(true)
      if (user?.id) flushOfflineOutbox(user.id).then(refreshSyncStatus).catch(() => {})
    }
    const browserOffline = () => setConnectionReachable(false)
    window.addEventListener(eventNames.sync, refresh)
    window.addEventListener(eventNames.connectivity, connectivity)
    window.addEventListener('atlas:offline-sync-complete', syncComplete)
    window.addEventListener('online', browserOnline)
    window.addEventListener('offline', browserOffline)
    refreshSyncStatus()
    if (user?.id && navigator.onLine) flushOfflineOutbox(user.id).then(refreshSyncStatus).catch(() => {})
    return () => {
      window.removeEventListener(eventNames.sync, refresh)
      window.removeEventListener(eventNames.connectivity, connectivity)
      window.removeEventListener('atlas:offline-sync-complete', syncComplete)
      window.removeEventListener('online', browserOnline)
      window.removeEventListener('offline', browserOffline)
    }
  }, [user?.id, refreshSyncStatus, loadData])
  useEffect(() => {
    let current = true
    const restoreCachedSession = async () => {
      const session = await getOfflineSession()
      if (!ensureSessionNotExpired(session)) return false
      const cached = await getCachedBootstrap(session.userId)
      if (!cached) return false
      if (!current) return true
      setSetup({ configured: true, demoAllowed: false, demo: null })
      setUser(session.user)
      setData(cached)
      setConnectionReachable(false)
      setError('')
      setAuthChecked(true)
      return true
    }
    const start = async () => {
      try {
        const status = await api.get('/api/setup/status')
        if (!current) return
        setSetup(status)
        if (!status.configured) { setAuthChecked(true); return }
        try {
          const result = await api.get('/api/auth/me')
          if (!current) return
          setUser(result.user)
          setAuthChecked(true)
        } catch (authError) {
          if ((authError.status === 0 || authError.status >= 500) && await restoreCachedSession()) return
          if (!current) return
          setUser(null)
          setAuthChecked(true)
          if (authError.status === 0 || authError.status >= 500) setError(authError.message)
        }
      } catch (startupError) {
        if (await restoreCachedSession()) return
        if (!current) return
        setError(startupError.message)
        setAuthChecked(true)
      }
    }
    start()
    return () => { current = false }
  }, [])
  useEffect(() => {
    if (!isAdministrator) { setRuntime(null); setSystem(null); return }
    api.get('/api/runtime-config').then(setRuntime).catch(() => setRuntime(null))
  }, [isAdministrator])
  useEffect(() => { if (user) loadData() }, [user, loadData])
  useEffect(() => { if (isAdministrator) api.get('/api/system').then(setSystem).catch(() => setSystem(null)); else setSystem(null) }, [isAdministrator, user, data.tasks, data.projects, data.people])
  useEffect(() => { if (!isAdministrator && page === 'settings') setPage('overview') }, [isAdministrator, page])
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}) }, [])
  useEffect(() => { const detect = () => setDisplayMode(detectDisplayMode()); const media = window.matchMedia?.('(display-mode: standalone)'); media?.addEventListener?.('change', detect); return () => media?.removeEventListener?.('change', detect) }, [])
  useEffect(() => {
    const onKey = event => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(v => !v) }
      if (meta && event.key.toLowerCase() === 'n') { event.preventDefault(); if (canCreateTasks) setModal({ type: 'task' }); else notify({ title: 'Task creation unavailable', body: 'Your role or workspace action settings do not allow creating tasks.', tone: 'warning' }) }
      if (event.key === 'Escape') { setSearchOpen(false); setNavOpen(false); setModal(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canCreateTasks, notify])
  useEffect(() => {
    const accentName = settings.interface?.colors?.accent || settings.accentColor || 'purple'
    const accent = { purple: ['#6d5dfc', '#5144dd', '#f0eeff'], blue: ['#3b82f6', '#2563c7', '#ebf3ff'], green: ['#28a778', '#20835e', '#e9f8f2'], orange: ['#f2994a', '#c87825', '#fff4e9'] }[accentName] || ['#6d5dfc', '#5144dd', '#f0eeff']
    const lang = settings.localization?.defaultLanguage || settings.language || 'en'
    document.documentElement.lang = lang
    document.documentElement.dir = textDirection(settings)
    document.body.dir = textDirection(settings)
    document.documentElement.dataset.theme = settings.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : settings.theme || settings.interface?.theme || 'light'
    document.documentElement.style.setProperty('--purple', accent[0]); document.documentElement.style.setProperty('--purple-deep', accent[1]); document.documentElement.style.setProperty('--purple-pale', accent[2])
    document.body.dataset.density = settings.density || settings.interface?.density || 'comfortable'; document.body.dataset.sidebar = settings.sidebarMode || settings.interface?.sidebarBehavior || 'expanded'; document.body.dataset.motion = settings.showAnimations === false || settings.interface?.accessibility?.reducedMotion ? 'off' : 'on'
    document.body.dataset.contrast = settings.interface?.accessibility?.highContrast ? 'high' : 'normal'
  }, [settings])
  const login = async (email, password) => { const result = await api.post('/api/auth/login', { email, password }); setUser(result.user) }
  const logout = async () => {
    if (user?.id) {
      let status = await getOfflineSyncStatus(user.id)
      if (status.pending && connectionReachable) {
        await flushOfflineOutbox(user.id, { force: true })
        status = await getOfflineSyncStatus(user.id)
      }
      if (status.pending + status.conflicts + status.failed > 0) {
        setSyncPanelOpen(true)
        notify({ title: 'Sync before signing out', body: 'Pending changes must be synchronized or resolved first. They remain saved on this device.', tone: 'warning' })
        return
      }
    }
    try { await api.post('/api/auth/logout', {}) } catch {}
    if (user?.id) await logOutOfflineState(user.id).catch(() => {})
    setUser(null)
    setData(emptyData)
    setSyncStatus({ pending: 0, conflicts: 0, failed: 0, otherUserPending: 0, operations: [] })
    userPreferencesRef.current = { filters: {} }
    setUserPreferences({ filters: {} })
    defaultPageApplied.current = false
    setPage('overview')
  }
  const openModal = (type, record = null) => setModal({ type, record })
  const navigateTo = target => {
    if (target === 'settings' && isAdministrator) setPage(target)
    else if (target !== 'settings' && enabledPages(settings).includes(target)) setPage(target)
    else notify({ title: 'Section unavailable', body: target === 'settings' ? 'Settings are available only to the administrator.' : 'This section is hidden in workspace settings.', tone: 'warning' })
  }
  const saveEntity = async (type, record, form) => {
    const permissions = { task: 'manageTasks', project: 'manageProjects', person: 'managePeople', team: 'managePeople', milestone: 'manageProjects', activity: 'logActivity', alert: 'manageAlerts', user: 'manageUsers' }
    if (!hasPermission(user, permissions[type]) || !actionVisible(settings, record ? 'edit' : 'create')) throw new Error('Your role or workspace action settings do not allow this change.')
    let result = null
    if (type === 'task') result = await (record?.numericId ? api.put(`/api/tasks/${record.numericId}`, form) : api.post('/api/tasks', form))
    if (type === 'project') result = await (record?.numericId ? api.put(`/api/projects/${record.numericId}`, form) : api.post('/api/projects', form))
    if (type === 'person') result = await (record?.id ? api.put(`/api/people/${record.id}`, form) : api.post('/api/people', form))
    if (type === 'team') result = await (record?.id ? api.put(`/api/teams/${record.id}`, form) : api.post('/api/teams', form))
    if (type === 'milestone') result = await (record?.id ? api.put(`/api/milestones/${record.id}`, form) : api.post('/api/milestones', form))
    if (type === 'activity') result = await (record?.id ? api.put(`/api/activity/${encodeURIComponent(record.id)}`, form) : api.post('/api/activity', form))
    if (type === 'alert') result = await (record?.id ? api.patch(`/api/alerts/${record.id}`, form) : api.post('/api/alerts', form))
    if (type === 'user') result = await (record?.id ? api.put(`/api/users/${record.id}`, form) : api.post('/api/users', form))
    notify(result?.offlineQueued
      ? { title: 'Saved on this device', body: 'Atlas will synchronize this change with the local host when it is reachable.', tone: 'warning' }
      : { title: record ? 'Changes saved' : 'Record created', tone: 'success' })
    await loadData()
    return result
  }
  const deleteEntity = async (type, record, { confirmed = false } = {}) => {
    const permissions = { task: 'manageTasks', project: 'manageProjects', person: 'managePeople', team: 'managePeople', milestone: 'manageProjects', activity: 'manageTasks', alert: 'manageAlerts', user: 'manageUsers' }
    if (!hasPermission(user, permissions[type]) || !actionVisible(settings, 'delete')) throw new Error('Your role or workspace action settings do not allow deleting this record.')
    if (!confirmed && !window.confirm(`Delete this ${type} record? There is no per-record undo. An administrator can restore an earlier full-workspace backup, which also rolls back other changes.`)) return false
    const paths = { task: 'tasks', project: 'projects', person: 'people', team: 'teams', milestone: 'milestones', activity: 'activity', alert: 'alerts', user: 'users' }
    const key = type === 'task' || type === 'project' ? record.numericId : record.id
    const result = await api.delete(`/api/${paths[type]}/${encodeURIComponent(key)}`)
    setModal(null)
    await loadData()
    requestAnimationFrame(() => (document.querySelector('.record-table-shell') || document.querySelector('.content'))?.focus?.({ preventScroll: true }))
    return result
  }
  const taskItemRequest = (id, field, value) => field === 'status'
    ? api.patch(`/api/tasks/${encodeURIComponent(id)}/status`, { status: value })
    : api.put(`/api/tasks/${encodeURIComponent(id)}`, { [field]: value })
  const bulkEditTasks = async ({ field, value, ids = [], reportProgress }) => {
    const statusOnly = field === 'status'
    if (!(statusOnly ? canWriteTasks : canManageTasks) || !actionVisible(settings, 'edit')) throw new Error('Your role or workspace action settings do not allow this bulk edit.')
    const uniqueIds = [...new Set(ids.map(String))]
    const failures = []
    let affected = 0, processed = 0, offlineQueuedCount = 0
    const chunks = []
    for (let index = 0; index < uniqueIds.length; index += 500) chunks.push(uniqueIds.slice(index, index + 500))
    const useBatchRoute = connectionReachable && (typeof navigator === 'undefined' || navigator.onLine !== false)
    for (const chunk of chunks) {
      if (useBatchRoute) {
        try {
          const result = await api.post('/api/tasks/bulk', { action: 'edit', ids: chunk, changes: { [field]: value } })
          affected += Number(result.affected) || 0
          failures.push(...(result.failures || []))
          processed += chunk.length
          reportProgress?.(processed)
          continue
        } catch (error) {
          if (error.status !== 0) {
            failures.push(...chunk.map(id => ({ id, error: error.message || 'Bulk edit failed' })))
            processed += chunk.length
            reportProgress?.(processed)
            continue
          }
        }
      }
      const results = await runLimited(chunk, 8, id => taskItemRequest(id, field, value), done => reportProgress?.(processed + done))
      results.forEach((result, index) => {
        if (result.ok) { affected++; if (result.value?.offlineQueued) offlineQueuedCount++ }
        else failures.push({ id: chunk[index], error: result.error?.message || 'Task update failed' })
      })
      processed += chunk.length
      reportProgress?.(processed)
    }
    await loadData()
    return { affected, failures, offlineQueuedCount }
  }
  const bulkDeleteTasks = async ({ records = [], ids = [], reportProgress }) => {
    if (!canManageTasks || !actionVisible(settings, 'delete')) throw new Error('Your role or workspace action settings do not allow task deletion.')
    const uniqueIds = [...new Set(ids.map(String))]
    const failures = []
    let affected = 0, processed = 0, offlineQueuedCount = 0
    const chunks = []
    for (let index = 0; index < uniqueIds.length; index += 500) chunks.push(uniqueIds.slice(index, index + 500))
    const useBatchRoute = connectionReachable && (typeof navigator === 'undefined' || navigator.onLine !== false)
    for (const chunk of chunks) {
      if (useBatchRoute) {
        try {
          const result = await api.post('/api/tasks/bulk', { action: 'delete', ids: chunk })
          affected += Number(result.affected) || 0
          failures.push(...(result.failures || []))
          processed += chunk.length
          reportProgress?.(processed)
          continue
        } catch (error) {
          if (error.status !== 0) {
            failures.push(...chunk.map(id => ({ id, error: error.message || 'Bulk delete failed' })))
            processed += chunk.length
            reportProgress?.(processed)
            continue
          }
        }
      }
      const results = await runLimited(chunk, 8, id => api.delete(`/api/tasks/${encodeURIComponent(id)}`), done => reportProgress?.(processed + done))
      results.forEach((result, index) => {
        if (result.ok || result.error?.status === 404) { affected++; if (result.value?.offlineQueued) offlineQueuedCount++ }
        else failures.push({ id: chunk[index], error: result.error?.message || 'Task deletion failed' })
      })
      processed += chunk.length
      reportProgress?.(processed)
    }
    await loadData()
    return { affected, failures, offlineQueuedCount }
  }
  const bulkDeleteRecords = async (type, { records = [], ids = [], reportProgress }) => {
    if (type === 'task') return bulkDeleteTasks({ records, ids, reportProgress })
    const permission = { project: 'manageProjects', person: 'managePeople', alert: 'manageAlerts', milestone: 'manageProjects', team: 'managePeople', activity: 'manageTasks' }[type]
    if (!permission || !hasPermission(user, permission) || !actionVisible(settings, 'delete')) throw new Error('Your role or workspace action settings do not allow deleting these records.')
    const paths = { project: 'projects', person: 'people', alert: 'alerts', milestone: 'milestones', team: 'teams', activity: 'activity' }
    const byId = new Map(records.map(record => [String(record.numericId ?? record.id), record]))
    const uniqueIds = [...new Set(ids.map(String))]
    const results = await runLimited(uniqueIds, 5, id => api.delete(`/api/${paths[type]}/${encodeURIComponent(id)}`), reportProgress)
    const failures = []
    let affected = 0, offlineQueuedCount = 0
    results.forEach((result, index) => {
      if (result.ok || result.error?.status === 404) { affected++; if (result.value?.offlineQueued) offlineQueuedCount++ }
      else failures.push({ id: uniqueIds[index], name: byId.get(uniqueIds[index])?.name || byId.get(uniqueIds[index])?.title || '', error: result.error?.message || 'Delete failed' })
    })
    await loadData()
    return { affected, failures, offlineQueuedCount }
  }
  const bulkEditRecords = async (type, payload) => {
    if (type === 'task') return bulkEditTasks(payload)
    const { field, value, records = [], ids = [], reportProgress } = payload
    const permission = { project: 'manageProjects', person: 'managePeople', alert: 'manageAlerts', milestone: 'manageProjects' }[type]
    const alertResolution = type === 'alert' && field === 'resolved' && canWriteTasks
    if (!permission || (!hasPermission(user, permission) && !alertResolution) || !actionVisible(settings, 'edit')) throw new Error('Your role or workspace action settings do not allow this bulk edit.')
    const path = { project: 'projects', person: 'people', alert: 'alerts', milestone: 'milestones' }[type]
    const method = type === 'alert' ? api.patch : api.put
    const byId = new Map(records.map(record => [String(record.numericId ?? record.id), record]))
    const uniqueIds = [...new Set(ids.map(String))]
    const results = await runLimited(uniqueIds, 5, id => method(`/api/${path}/${encodeURIComponent(id)}`, { [field]: value }), reportProgress)
    const failures = []
    let affected = 0, offlineQueuedCount = 0
    results.forEach((result, index) => {
      if (result.ok) { affected++; if (result.value?.offlineQueued) offlineQueuedCount++ }
      else failures.push({ id: uniqueIds[index], name: byId.get(uniqueIds[index])?.name || byId.get(uniqueIds[index])?.title || '', error: result.error?.message || 'Update failed' })
    })
    await loadData()
    return { affected, failures, offlineQueuedCount }
  }
  const importRecords = async (type, records, reportProgress) => {
    const permission = { task: 'manageTasks', project: 'manageProjects', person: 'managePeople', alert: 'manageAlerts', milestone: 'manageProjects', activity: 'logActivity' }[type]
    if (!permission || !hasPermission(user, permission) || !actionVisible(settings, 'create')) throw new Error('Your role or workspace action settings do not allow importing these records.')
    const path = { task: 'tasks', project: 'projects', person: 'people', alert: 'alerts', milestone: 'milestones', activity: 'activity' }[type]
    const results = await runLimited(records, 8, record => api.post(`/api/${path}`, record), reportProgress)
    const failures = []
    let affected = 0, offlineQueuedCount = 0
    results.forEach((result, index) => {
      if (result.ok) { affected++; if (result.value?.offlineQueued) offlineQueuedCount++ }
      else failures.push({ id: records[index]?.id || records[index]?.title || records[index]?.name || index + 1, rowIndex: index, error: result.error?.message || 'Import failed' })
    })
    await loadData()
    return { affected, failures, offlineQueuedCount }
  }
  const inlineEditRecord = async (type, record, field, value) => {
    let result
    if (type === 'task') {
      if (field === 'status') {
        if (!canWriteTasks || !actionVisible(settings, 'edit')) throw new Error('Task workflow updates are not allowed.')
        result = await api.patch(`/api/tasks/${encodeURIComponent(record.numericId)}/status`, { status: value })
      } else {
        if (!canManageTasks || !actionVisible(settings, 'edit')) throw new Error('Task detail edits are not allowed.')
        const key = field === 'due' ? 'dueDate' : field
        result = await api.put(`/api/tasks/${encodeURIComponent(record.numericId)}`, { [key]: value })
      }
    } else {
      const permission = { project: 'manageProjects', person: 'managePeople', alert: 'manageAlerts', milestone: 'manageProjects' }[type]
      if (!permission || !hasPermission(user, permission) || !actionVisible(settings, 'edit')) throw new Error('Your role does not allow this inline edit.')
      const paths = { project: 'projects', person: 'people', alert: 'alerts', milestone: 'milestones' }
      const method = type === 'alert' ? api.patch : api.put
      const id = record.numericId ?? record.id
      result = await method(`/api/${paths[type]}/${encodeURIComponent(id)}`, { [field]: value })
    }
    await loadData()
    if (result?.offlineQueued) notify({ title: 'Edit saved offline', body: 'It will synchronize when the local host is reachable.', tone: 'warning' })
    return result
  }
  const updateSettings = async values => {
    const response = await api.put('/api/settings', values)
    const next = response?.offlineQueued ? mergeDeep(data.settings || {}, values) : response
    setData(current => ({ ...current, settings: response?.offlineQueued ? mergeDeep(current.settings || {}, values) : response }))
    setLanguagePreview('')
    if (next.enabledPages && !next.enabledPages.includes(page)) setPage('overview')
    return next
  }
  const removeDemo = async () => { if (!window.confirm('Remove all sample rows while preserving live data?')) return; await api.delete('/api/setup/seed'); await loadData(); api.get('/api/system').then(setSystem).catch(() => {}) }
  const toggleTheme = async () => { const theme = settings.theme === 'dark' ? 'light' : 'dark'; const next = { ...settings, theme, interface: { ...(settings.interface || {}), theme } }; if (isAdministrator) await updateSettings(next); else setData(current => ({ ...current, settings: next })) }
  const periodChange = async period => { const report = await api.get(`/api/reports/${period}`); setData(current => ({ ...current, reports: report })) }
  const createForPage = () => {
    if (page === 'projects' && canManageProjects && actionVisible(settings, 'create')) openModal('project')
    else if (page === 'people' && canManagePeople && actionVisible(settings, 'create')) openModal('person')
    else if (page === 'activity' && canLogActivity && actionVisible(settings, 'create')) openModal('activity')
    else if (page === 'alerts' && canManageAlerts && actionVisible(settings, 'create')) openModal('alert')
    else if (['overview', 'tasks'].includes(page) && canCreateTasks) openModal('task')
    else notify({ title: 'Action unavailable', body: 'Your role or workspace action settings do not allow creating this record.', tone: 'warning' })
  }
  const canCreate = page === 'projects' ? canManageProjects && actionVisible(settings, 'create') : page === 'people' ? canManagePeople && actionVisible(settings, 'create') : page === 'activity' ? canLogActivity && actionVisible(settings, 'create') : page === 'alerts' ? canManageAlerts && actionVisible(settings, 'create') : ['overview','tasks'].includes(page) ? canCreateTasks : false
  if (!setup && !error) return <LoadingScreen />
  if (error && !user) return <LoadingScreen message={error}/>
  if (setup && !setup.configured) return <SetupWizard setup={setup} onPreviewLanguage={setLanguagePreview} onComplete={result => { setSetup(result.setup); setUser(result.user); setAuthChecked(true); setLanguagePreview('') }}/>
  if (!authChecked) return <LoadingScreen />
  if (!user) return <LoginScreen onLogin={login} setup={setup}/>
  if (!data.reports?.series) return <LoadingScreen />
  const shellUser = { ...user, openTasks: data.dashboard.stats?.openTasks, openAlerts: data.alerts.filter(a => !a.resolved).length }
  return <UserPreferencesProvider value={preferencesContext}><div className={`app-shell ${navOpen ? 'nav-open' : ''}`}><div className="nav-backdrop" onClick={() => setNavOpen(false)}/><Sidebar page={page} setPage={navigateTo} user={shellUser} settings={settings} onLogout={logout} mobileOpen={navOpen} onClose={() => setNavOpen(false)}/><main className="main"><Topbar page={page} user={shellUser} setPage={navigateTo} onCreate={createForPage} onSearch={() => setSearchOpen(true)} onToggleTheme={toggleTheme} onOpenNav={() => setNavOpen(true)} canCreate={canCreate} settings={settings}/><OfflineSyncBar userId={user.id} connected={connectionReachable} status={syncStatus} onOpen={() => setSyncPanelOpen(true)}/><div className="content" tabIndex={-1}>{page === 'overview' && <QuickActionRail openModal={openModal} setPage={navigateTo} canManage={canManageProjects} canCreateTasks={canCreateTasks} canLogActivity={canLogActivity} settings={settings} onSearch={() => setSearchOpen(true)}/>}{error && <div className="global-error"><Icon name="warning" size={15}/>{error}<button onClick={loadData}>Retry</button></div>}{page === 'overview' && <Overview data={data} setPage={navigateTo}/>} {page === 'projects' && <Projects data={data} openModal={openModal} canManage={canManageProjects} canManageTasks={canManageTasks} canExport={canExport} setPage={navigateTo} userId={user.id} deleteRecord={deleteEntity} bulkEditRecords={bulkEditRecords} bulkDeleteRecords={bulkDeleteRecords} importRecords={(rows, report) => importRecords('project', rows, report)} importMilestones={(rows, report) => importRecords('milestone', rows, report)} inlineEditRecord={(record, field, value) => inlineEditRecord('project', record, field, value)} inlineEditMilestone={(record, field, value) => inlineEditRecord('milestone', record, field, value)} notify={notify}/>} {page === 'tasks' && <MyWork data={data} openModal={openModal} refresh={loadData} notify={notify} userId={user.id} canWriteTasks={canWriteTasks} canManageTasks={canManageTasks} userPersonId={user.personId} canExport={canExport} deleteRecord={deleteEntity} bulkEditTasks={bulkEditTasks} bulkDeleteTasks={bulkDeleteTasks} importTasks={(rows, report) => importRecords('task', rows, report)} inlineEditTask={(record, field, value) => inlineEditRecord('task', record, field, value)}/>} {page === 'people' && <People data={data} openModal={openModal} canManage={canManagePeople} canExport={canExport} userId={user.id} deleteRecord={deleteEntity} bulkEditRecords={bulkEditRecords} bulkDeleteRecords={bulkDeleteRecords} importRecords={(rows, report) => importRecords('person', rows, report)} inlineEditRecord={(record, field, value) => inlineEditRecord('person', record, field, value)} notify={notify}/>} {page === 'activity' && <ActivityLog data={data} openModal={openModal} setPage={navigateTo} canLogActivity={canLogActivity} canExport={canExport} canViewAllActivity={isAdministrator} canManageTasks={canManageTasks} userId={user.id} deleteRecord={deleteEntity} bulkDeleteRecords={bulkDeleteRecords} importActivity={(rows, report) => importRecords('activity', rows, report)} notify={notify}/>} {page === 'reports' && <><Reports report={data.reports} onPeriodChange={periodChange} settings={settings} setPage={navigateTo} canExport={canExport}/><UserActivityReports people={data.people || []} settings={settings} canExport={canExport} canViewAllActivity={isAdministrator} userPersonId={user.personId}/></>} {page === 'alerts' && <Alerts data={data} refresh={loadData} openModal={openModal} canManage={canManageAlerts} canManageTasks={canManageTasks} userPersonId={user.personId} canResolve={canWriteTasks || canManageAlerts} canExport={canExport} userId={user.id} deleteRecord={deleteEntity} bulkEditRecords={bulkEditRecords} bulkDeleteRecords={bulkDeleteRecords} importRecords={(rows, report) => importRecords('alert', rows, report)} inlineEditRecord={(record, field, value) => inlineEditRecord('alert', record, field, value)} notify={notify}/>} {page === 'settings' && isAdministrator && <SettingsPage data={data} user={user} updateSettings={updateSettings} onRemoveDemo={removeDemo} runtime={runtime} system={system} displayMode={displayMode} openModal={openModal} onDelete={deleteEntity} onPreviewLanguage={setLanguagePreview}/>}</div></main><CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} data={data} setPage={navigateTo} openModal={openModal} settings={settings} canEditTasks={canManageTasks} canEditProjects={canManageProjects} canEditPeople={canManagePeople} isAdministrator={isAdministrator}/><EntityFormModal modal={modal} data={data} user={user} onClose={() => setModal(null)} onCreateAnother={type => setModal({ type, record: null })} onSave={saveEntity} onDelete={deleteEntity} notify={notify}/><OfflineSyncPanel open={syncPanelOpen} onClose={() => setSyncPanelOpen(false)} userId={user.id} status={syncStatus} connected={connectionReachable} onRefresh={async () => { await refreshSyncStatus(); await loadData() }}/><ToastHost toasts={toasts} dismiss={id => setToasts(t => t.filter(x => x.id !== id))}/></div></UserPreferencesProvider>
}

createRoot(document.getElementById('root')).render(<App />)
