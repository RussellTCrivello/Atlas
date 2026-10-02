import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api } from './api/client.js'
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
        setPage(next.settings.defaultPage)
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
  useEffect(() => { api.get('/api/setup/status').then(status => { setSetup(status); if (!status.configured) setAuthChecked(true) }).catch(err => setError(err.message)); api.get('/api/runtime-config').then(setRuntime).catch(() => {}) }, [])
  useEffect(() => { if (!setup?.configured) return; api.get('/api/auth/me').then(result => setUser(result.user)).catch(() => setUser(null)).finally(() => setAuthChecked(true)) }, [setup])
  useEffect(() => { if (user) loadData() }, [user, loadData])
  useEffect(() => { if (hasPermission(user, 'manageSettings')) api.get('/api/system').then(setSystem).catch(() => setSystem(null)); else setSystem(null) }, [user, data.tasks, data.projects, data.people])
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
    try { await api.post('/api/auth/logout', {}) } catch {}
    setUser(null)
    setData(emptyData)
    userPreferencesRef.current = { filters: {} }
    setUserPreferences({ filters: {} })
    defaultPageApplied.current = false
    setPage('overview')
  }
  const openModal = (type, record = null) => setModal({ type, record })
  const navigateTo = target => {
    if (target === 'settings' || enabledPages(settings).includes(target)) setPage(target)
    else notify({ title: 'Section unavailable', body: 'This section is hidden in workspace settings.', tone: 'warning' })
  }
  const saveEntity = async (type, record, form) => {
    const permissions = { task: 'manageTasks', project: 'manageProjects', person: 'managePeople', team: 'managePeople', milestone: 'manageProjects', activity: 'logActivity', alert: 'manageAlerts', user: 'manageUsers' }
    if (!hasPermission(user, permissions[type]) || !actionVisible(settings, record ? 'edit' : 'create')) throw new Error('Your role or workspace action settings do not allow this change.')
    if (type === 'task') await (record?.numericId ? api.put(`/api/tasks/${record.numericId}`, form) : api.post('/api/tasks', form))
    if (type === 'project') await (record?.numericId ? api.put(`/api/projects/${record.numericId}`, form) : api.post('/api/projects', form))
    if (type === 'person') await (record?.id ? api.put(`/api/people/${record.id}`, form) : api.post('/api/people', form))
    if (type === 'team') await (record?.id ? api.put(`/api/teams/${record.id}`, form) : api.post('/api/teams', form))
    if (type === 'milestone') await (record?.id ? api.put(`/api/milestones/${record.id}`, form) : api.post('/api/milestones', form))
    if (type === 'activity') await api.post('/api/activity', form)
    if (type === 'alert') await (record?.id ? api.patch(`/api/alerts/${record.id}`, form) : api.post('/api/alerts', form))
    if (type === 'user') await (record?.id ? api.put(`/api/users/${record.id}`, form) : api.post('/api/users', form))
    notify({ title: record ? 'Changes saved' : 'Record created', tone: 'success' })
    await loadData()
  }
  const deleteEntity = async (type, record) => {
    const permissions = { task: 'manageTasks', project: 'manageProjects', person: 'managePeople', team: 'managePeople', milestone: 'manageProjects', activity: 'manageTasks', alert: 'manageAlerts', user: 'manageUsers' }
    if (!hasPermission(user, permissions[type]) || !actionVisible(settings, 'delete')) throw new Error('Your role or workspace action settings do not allow deleting this record.')
    if (!window.confirm('Delete this record?')) return
    const paths = { task: 'tasks', project: 'projects', person: 'people', team: 'teams', milestone: 'milestones', activity: 'activity', alert: 'alerts', user: 'users' }
    const key = type === 'task' || type === 'project' ? record.numericId : record.id
    await api.delete(`/api/${paths[type]}/${key}`); setModal(null); await loadData()
  }
  const updateSettings = async values => { const next = await api.put('/api/settings', values); setData(current => ({ ...current, settings: next })); setLanguagePreview(''); if (next.enabledPages && !next.enabledPages.includes(page)) setPage('overview') }
  const removeDemo = async () => { if (!window.confirm('Remove all sample rows while preserving live data?')) return; await api.delete('/api/setup/seed'); await loadData(); api.get('/api/system').then(setSystem).catch(() => {}) }
  const toggleTheme = async () => { const theme = settings.theme === 'dark' ? 'light' : 'dark'; const next = { ...settings, theme, interface: { ...(settings.interface || {}), theme } }; if (hasPermission(user, 'manageSettings')) await updateSettings(next); else setData(current => ({ ...current, settings: next })) }
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
  return <UserPreferencesProvider value={preferencesContext}><div className={`app-shell ${navOpen ? 'nav-open' : ''}`}><div className="nav-backdrop" onClick={() => setNavOpen(false)}/><Sidebar page={page} setPage={navigateTo} user={shellUser} settings={settings} onLogout={logout} mobileOpen={navOpen} onClose={() => setNavOpen(false)}/><main className="main"><Topbar page={page} user={shellUser} setPage={navigateTo} onCreate={createForPage} onSearch={() => setSearchOpen(true)} onToggleTheme={toggleTheme} onOpenNav={() => setNavOpen(true)} canCreate={canCreate} settings={settings}/><div className="content">{page === 'overview' && <QuickActionRail openModal={openModal} setPage={navigateTo} canManage={canManageProjects} canCreateTasks={canCreateTasks} canLogActivity={canLogActivity} settings={settings} onSearch={() => setSearchOpen(true)}/>}{error && <div className="global-error"><Icon name="warning" size={15}/>{error}<button onClick={loadData}>Retry</button></div>}{page === 'overview' && <Overview data={data} setPage={navigateTo}/>} {page === 'projects' && <Projects data={data} openModal={openModal} canManage={canManageProjects} canManageTasks={canManageTasks} canExport={canExport} setPage={navigateTo}/>} {page === 'tasks' && <MyWork data={data} openModal={openModal} refresh={loadData} notify={notify} canWriteTasks={canWriteTasks} canManageTasks={canManageTasks} userPersonId={user.personId} canExport={canExport}/>} {page === 'people' && <People data={data} openModal={openModal} canManage={canManagePeople} canExport={canExport}/>} {page === 'activity' && <ActivityLog data={data} openModal={openModal} setPage={navigateTo} canLogActivity={canLogActivity} canExport={canExport}/>} {page === 'reports' && <><Reports report={data.reports} onPeriodChange={periodChange} settings={settings} setPage={navigateTo} canExport={canExport}/><UserActivityReports people={data.people || []} settings={settings} canExport={canExport}/></>} {page === 'alerts' && <Alerts data={data} refresh={loadData} openModal={openModal} canManage={canManageAlerts} canManageTasks={canManageTasks} userPersonId={user.personId} canResolve={canWriteTasks || canManageAlerts} canExport={canExport}/>} {page === 'settings' && <SettingsPage data={data} user={user} updateSettings={updateSettings} onRemoveDemo={removeDemo} runtime={runtime} system={system} displayMode={displayMode} openModal={openModal} onDelete={deleteEntity} onPreviewLanguage={setLanguagePreview}/>}</div></main><CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} data={data} setPage={navigateTo} openModal={openModal} settings={settings} canEditTasks={canManageTasks} canEditProjects={canManageProjects} canEditPeople={canManagePeople}/><EntityFormModal modal={modal} data={data} user={user} onClose={() => setModal(null)} onSave={saveEntity} onDelete={deleteEntity}/><ToastHost toasts={toasts} dismiss={id => setToasts(t => t.filter(x => x.id !== id))}/></div></UserPreferencesProvider>
}

createRoot(document.getElementById('root')).render(<App />)
