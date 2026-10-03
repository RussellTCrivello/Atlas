// The application: sign-in state, data loading and refresh, routing between pages, global shortcuts, theme.
import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { detectDisplayMode } from '../desktop.js'
import {
  clientSettings,
  withPreferences,
  hasPermission,
  clearSessionStorage,
  loadPreferences,
  savePreferences,
  diffPatch
} from '../lib/settings'
import { useUiLocalization, setMissingKeyReporting, tr, uiLanguage } from '../lib/i18n'
import { api, ApiError, errorMessage, UNAUTHENTICATED_EVENT, PASSWORD_CHANGE_EVENT } from '../lib/api'
import { emptyData } from '../state/empty-data'
import { PAGE_IDS, pageFromHash, projectIdFromHash, taskFromHash } from './routes'
import { EmptyState, LoadingScreen, ToastHost } from '../ui/primitives'
import { ErrorBoundary, LoadErrorScreen } from './ErrorBoundary'
import { AppContext } from '../ui/app-context'
import { SetupWizard } from '../features/auth/SetupWizard'
import { LoginScreen } from '../features/auth/LoginScreen'
import { PasswordChangeScreen } from '../features/auth/PasswordScreens'
import { Sidebar } from '../features/shell/Sidebar'
import { Topbar } from '../features/shell/Topbar'
import { Icon } from '../ui/icons'
import { QuickActionRail } from '../features/shell/QuickActionRail'
import { Overview } from '../features/overview/Overview'
import { Projects } from '../features/projects/Projects'
import { MyWork } from '../features/work/MyWork'
import { People } from '../features/people/People'
import { ActivityLog } from '../features/activity/ActivityLog'
import { Reports } from '../features/reports/Reports'
import { UserActivityReports } from '../features/reports/UserActivityReports'
import { Alerts } from '../features/alerts/Alerts'
import { SettingsPage } from '../features/settings/SettingsPage'
import { AccountPanel } from '../features/account/AccountPanel'
import { CommandSearch } from '../features/shell/CommandSearch'
import { FormModal } from '../features/records/FormModal'
import { PrintPreviewHost } from '../features/export/PrintPreview'
import { openPrintPreview, printCurrentPage } from '../features/export/print'

export function App() {
  const [setup, setSetup] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [data, setData] = useState(emptyData)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [page, setPageState] = useState(() => pageFromHash() || 'overview')
  const [projectId, setProjectId] = useState<number | null>(() => projectIdFromHash())
  const [highlight, setHighlight] = useState<number | null>(() => taskFromHash())
  const [modal, setModal] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [runtime, setRuntime] = useState(null)
  const [system, setSystem] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [toasts, setToasts] = useState([])
  const [displayMode, setDisplayMode] = useState(() => detectDisplayMode())
  const [languagePreview, setLanguagePreview] = useState('')
  const [prefs, setPrefs] = useState({})
  const defaultPageApplied = useRef(Boolean(pageFromHash()))
  const revision = useRef(0)
  const setPage = useCallback(next => {
    setPageState(next)
    setProjectId(null)
    setHighlight(null)
    if (window.location.hash !== `#/${next}`) window.location.hash = `/${next}`
  }, [])
  const baseSettings = useMemo(() => clientSettings(data.settings), [data.settings])
  const settings = useMemo(() => {
    let next = withPreferences(baseSettings, prefs)
    if (languagePreview) {
      next = {
        ...next,
        language: languagePreview,
        localization: { ...(next.localization || {}), defaultLanguage: languagePreview },
        workspace: { ...(next.workspace || {}), defaultLanguage: languagePreview }
      }
    }
    return next
  }, [baseSettings, prefs, languagePreview])
  useUiLocalization(settings, data)
  const canManage =
    hasPermission(user, 'manageProjects') || hasPermission(user, 'managePeople') || hasPermission(user, 'manageAlerts')
  const canWriteTasks = hasPermission(user, 'writeTasks')
  const canLogActivity = hasPermission(user, 'logActivity')
  const canAdmin = hasPermission(user, 'manageSettings')
  const notify = useCallback(toast => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts(t => [...t.slice(-4), { id, ...toast }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), toast.tone === 'warning' ? 8000 : 4200)
  }, [])
  const signedOut = useCallback((message = '') => {
    setUser(null)
    setData(emptyData)
    setLoaded(false)
    setLoadError('')
    revision.current = 0
    defaultPageApplied.current = false
    setMissingKeyReporting(false)
    clearSessionStorage()
    setNotice(message)
  }, [])

  const loadData = useCallback(async (silent = false) => {
    try {
      const next = await api.get('/api/bootstrap')
      revision.current = next.revision
      setData(next)
      setUser(next.user)
      setLoaded(true)
      setLoadError('')
      setError('')
      if (!defaultPageApplied.current && next.settings?.defaultPage) {
        setPage(next.settings.defaultPage)
        defaultPageApplied.current = true
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.code === 'PASSWORD_CHANGE_REQUIRED')) return
      // First load failed: say so (never show an empty workspace that looks like lost data). Later refresh: keep what we have.
      if (silent) setError(`${errorMessage(err)} Showing the last data we received.`)
      else setLoadError(errorMessage(err))
    }
  }, [])

  // ---- boot: is the workspace set up? who am I? ----
  useEffect(() => {
    api
      .get('/api/setup/status')
      .then(status => {
        setSetup(status)
        if (!status.configured) setAuthChecked(true)
      })
      .catch(err => setError(errorMessage(err)))
    api
      .get('/api/runtime-config')
      .then(setRuntime)
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (!setup?.configured) return
    api
      .get('/api/auth/me')
      .then(result => {
        setUser(result.user)
        setMissingKeyReporting(true)
      })
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true))
  }, [setup])
  useEffect(() => {
    if (user && !user.mustChangePassword) loadData()
  }, [user?.id, user?.mustChangePassword, loadData])
  useEffect(() => {
    setPrefs(user?.id ? loadPreferences(user.id) : {})
  }, [user?.id])
  useEffect(() => {
    if (user?.id) savePreferences(user.id, prefs)
  }, [prefs, user?.id])

  // ---- global events: expired session, forced password change, connectivity, navigation ----
  useEffect(() => {
    const onUnauthenticated = () => signedOut('Your session ended. Please sign in again.')
    const onPasswordRequired = () => setUser(u => (u ? { ...u, mustChangePassword: true } : u))
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    const onHash = () => {
      const next = pageFromHash()
      if (next) setPageState(next)
      setProjectId(projectIdFromHash())
      setHighlight(taskFromHash())
    }
    const onNavigate = event => {
      if (PAGE_IDS.includes(event.detail)) setPage(event.detail)
    }
    window.addEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated)
    window.addEventListener(PASSWORD_CHANGE_EVENT, onPasswordRequired)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('atlas:navigate', onNavigate)
    return () => {
      window.removeEventListener(UNAUTHENTICATED_EVENT, onUnauthenticated)
      window.removeEventListener(PASSWORD_CHANGE_EVENT, onPasswordRequired)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('atlas:navigate', onNavigate)
    }
  }, [signedOut, setPage])

  // ---- keep several people's screens in step: cheap revision check, full reload only when something changed ----
  useEffect(() => {
    if (!user || user.mustChangePassword) return
    let alive = true
    const check = async () => {
      if (document.visibilityState !== 'visible' || !revision.current) return
      try {
        const result = await api.get('/api/revision')
        if (alive && result.revision !== revision.current) await loadData(true)
        else if (alive) setError('')
      } catch (err) {
        if (alive && err instanceof ApiError && err.status === 0) setError(errorMessage(err))
      }
    }
    const timer = setInterval(check, 20000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [user?.id, user?.mustChangePassword, loadData])

  // ---- administrator-only diagnostics, fetched when needed rather than on every data change ----
  const refreshSystem = useCallback(() => {
    if (!canAdmin) return setSystem(null)
    api
      .get('/api/system')
      .then(setSystem)
      .catch(() => setSystem(null))
    api
      .get('/api/runtime-config')
      .then(setRuntime)
      .catch(() => {})
  }, [canAdmin])
  useEffect(() => {
    if (page === 'settings') refreshSystem()
  }, [page, refreshSystem, data.revision])
  useEffect(() => {
    const desktop = Boolean((window as any).atlasDesktop)
    if (!('serviceWorker' in navigator)) return
    if (desktop || __ATLAS_DEV__) {
      // The desktop shell and the dev server do not need (and must not be confused by) a cached shell.
      navigator.serviceWorker
        .getRegistrations()
        .then(list => list.forEach(r => r.unregister()))
        .catch(() => {})
      return
    }
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(__ATLAS_BUILD__)}`).catch(() => {})
  }, [])
  useEffect(() => {
    const detect = () => setDisplayMode(detectDisplayMode())
    const media = window.matchMedia?.('(display-mode: standalone)')
    media?.addEventListener?.('change', detect)
    return () => media?.removeEventListener?.('change', detect)
  }, [])
  // "Print" always means a report built from the database by the server: the current page's main export, or the workspace summary.
  const printPage = () => {
    if (!hasPermission(user, 'exportData')) {
      notify({
        title: 'Printing needs the export permission',
        body: 'Ask an administrator to allow it for your role.',
        tone: 'warning'
      })
      return
    }
    printCurrentPage(() =>
      openPrintPreview({
        dataset: 'workspace-summary',
        title: 'Workspace summary',
        language: uiLanguage(settings)
      }).catch(error => notify({ title: 'Could not print', body: errorMessage(error), tone: 'warning' }))
    )
  }
  const printRef = useRef(printPage)
  printRef.current = printPage
  useEffect(() => {
    const onPrint = () => printRef.current()
    window.addEventListener('atlas:print', onPrint)
    return () => window.removeEventListener('atlas:print', onPrint)
  }, [])
  useEffect(() => {
    const onKey = event => {
      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(v => !v)
      }
      if (meta && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'p') {
        // The browser would print the screen; Atlas prints a report built from the data instead.
        event.preventDefault()
        printRef.current()
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setModal({ type: 'task' })
      }
      // Escape closes the palette and the mobile menu; an open record dialog handles Escape itself (it may have unsaved edits).
      if (event.key === 'Escape') {
        setSearchOpen(false)
        setNavOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    const accentName = settings.interface?.colors?.accent || settings.accentColor || 'purple'
    const accent = {
      purple: ['#6d5dfc', '#5144dd', '#f0eeff'],
      blue: ['#3b82f6', '#2563c7', '#ebf3ff'],
      green: ['#28a778', '#20835e', '#e9f8f2'],
      orange: ['#f2994a', '#c87825', '#fff4e9']
    }[accentName] || ['#6d5dfc', '#5144dd', '#f0eeff']
    const theme = settings.theme || settings.interface?.theme || 'light'
    document.documentElement.dataset.theme =
      theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
    document.documentElement.style.setProperty('--purple', accent[0])
    document.documentElement.style.setProperty('--purple-deep', accent[1])
    document.documentElement.style.setProperty('--purple-pale', accent[2])
    document.body.dataset.density = settings.density || settings.interface?.density || 'comfortable'
    document.body.dataset.sidebar = settings.sidebarMode || settings.interface?.sidebarBehavior || 'expanded'
    document.body.dataset.motion =
      settings.showAnimations === false || settings.interface?.accessibility?.reducedMotion ? 'off' : 'on'
    document.body.dataset.contrast = settings.interface?.accessibility?.highContrast ? 'high' : 'normal'
  }, [settings])

  const login = async (email, password) => {
    const result = await api.post('/api/auth/login', { email, password })
    setNotice('')
    setMissingKeyReporting(true)
    setUser(result.user)
  }
  const logout = async (callServer = true) => {
    if (callServer) {
      try {
        await api.post('/api/auth/logout', {})
      } catch {
        /* the cookie is cleared client-side by the server response; nothing else to do */
      }
    }
    signedOut('')
    setPage('overview')
  }
  const openModal = (type, record = null) => setModal({ type, record })
  const saveEntity = async (type, record, form) => {
    if (type === 'task')
      await (record?.numericId ? api.put(`/api/tasks/${record.numericId}`, form) : api.post('/api/tasks', form))
    if (type === 'project')
      await (record?.numericId ? api.put(`/api/projects/${record.numericId}`, form) : api.post('/api/projects', form))
    if (type === 'person')
      await (record?.id ? api.put(`/api/people/${record.id}`, form) : api.post('/api/people', form))
    if (type === 'team') await (record?.id ? api.put(`/api/teams/${record.id}`, form) : api.post('/api/teams', form))
    if (type === 'milestone')
      await (record?.id ? api.put(`/api/milestones/${record.id}`, form) : api.post('/api/milestones', form))
    if (type === 'activity') await api.post('/api/activity', form)
    if (type === 'alert')
      await (record?.id ? api.patch(`/api/alerts/${record.id}`, form) : api.post('/api/alerts', form))
    if (type === 'user') await (record?.id ? api.put(`/api/users/${record.id}`, form) : api.post('/api/users', form))
    notify({ title: record?.numericId || record?.id ? 'Changes saved' : 'Record created', tone: 'success' })
    await loadData(true)
  }
  const deleteEntity = async (type, record) => {
    const paths = {
      task: 'tasks',
      project: 'projects',
      person: 'people',
      team: 'teams',
      milestone: 'milestones',
      activity: 'activity',
      alert: 'alerts',
      user: 'users'
    }
    let query = ''
    let message = tr(settings, 'Delete this {type}? This cannot be undone.', { type })
    if (type === 'task')
      message = tr(settings, 'Delete task {id}: “{title}”? This cannot be undone.', {
        id: record.id,
        title: record.title
      })
    if (type === 'project') {
      const tasks = data.tasks.filter(task => task.projectId === record.numericId).length
      const milestones = (record.milestoneRows || []).length
      if (tasks || milestones) {
        query = '?cascade=true'
        message = tr(
          settings,
          'Delete project “{name}” together with its {tasks} task(s) and {milestones} milestone(s)? This cannot be undone. A backup is taken first.',
          { name: record.name, tasks, milestones }
        )
      } else message = tr(settings, 'Delete project “{name}”? This cannot be undone.', { name: record.name })
    }
    if (type === 'person') {
      const tasks = data.tasks.filter(task => task.assigneeId === record.id).length
      message = tr(settings, 'Delete {name}? Their {tasks} assigned task(s) will become unassigned.', {
        name: record.name,
        tasks
      })
    }
    if (type === 'user')
      message = tr(settings, 'Delete the account for {name}? Their person profile stays.', { name: record.name })
    if (!window.confirm(message)) return
    const key = type === 'task' || type === 'project' ? record.numericId : record.id
    try {
      await api.delete(`/api/${paths[type]}/${key}${query}`)
      notify({ title: 'Deleted', tone: 'success' })
      setModal(null)
      await loadData(true)
    } catch (err) {
      notify({ title: 'Could not delete', body: errorMessage(err), tone: 'warning' })
    }
  }
  const updateSettings = async values => {
    // Send only what changed (as a merge patch); never re-send the built-in translation catalog or other people's edits.
    const patch = diffPatch(baseSettings, values)
    delete patch.localization?.missingKeys
    delete patch.localization?.missingKeyCount
    if (!Object.keys(patch).length) return data.settings
    const next = await api.put('/api/settings', patch)
    setData(current => ({ ...current, settings: next }))
    setLanguagePreview('')
    if (next.enabledPages && !next.enabledPages.includes(page) && page !== 'settings') setPage('overview')
    return next
  }
  const removeDemo = async () => {
    if (
      !window.confirm(
        tr(
          settings,
          'Remove all sample rows and the demo sign-in accounts, keeping your live data? A backup is taken first.'
        )
      )
    )
      return
    try {
      await api.delete('/api/setup/seed')
      notify({ title: 'Demo data removed', tone: 'success' })
      await loadData(true)
      refreshSystem()
    } catch (err) {
      notify({ title: 'Could not remove demo data', body: errorMessage(err), tone: 'warning' })
    }
  }
  const toggleTheme = () => {
    const current = settings.theme === 'dark' ? 'dark' : 'light'
    setPrefs(p => ({ ...p, theme: current === 'dark' ? 'light' : 'dark' }))
  }
  const periodChange = async period => {
    const report = await api.get(`/api/reports/${period}`)
    setData(current => ({ ...current, reports: report }))
  }
  const createForPage = () => {
    if (page === 'projects' && hasPermission(user, 'manageProjects')) openModal('project')
    else if (page === 'people' && hasPermission(user, 'managePeople')) openModal('person')
    else if (page === 'activity' && canLogActivity) openModal('activity')
    else if (page === 'alerts' && hasPermission(user, 'manageAlerts')) openModal('alert')
    else if (canWriteTasks) openModal('task')
    else notify({ title: 'Read-only role', body: 'Your role does not permit creating records here.', tone: 'warning' })
  }
  const canCreate =
    page === 'projects'
      ? hasPermission(user, 'manageProjects')
      : page === 'people'
        ? hasPermission(user, 'managePeople')
        : page === 'activity'
          ? canLogActivity
          : page === 'alerts'
            ? hasPermission(user, 'manageAlerts')
            : ['overview', 'tasks'].includes(page)
              ? canWriteTasks
              : false
  const context = useMemo(() => ({ user, settings, notify }), [user, settings, notify])

  if (!setup && !error) return <LoadingScreen />
  if (!setup) return <LoadErrorScreen message={error} onRetry={() => window.location.reload()} onLogout={null} />
  if (setup && !setup.configured)
    return (
      <AppContext.Provider value={context}>
        <SetupWizard
          setup={setup}
          onPreviewLanguage={setLanguagePreview}
          onComplete={result => {
            setSetup(result.setup)
            setUser(result.user)
            setAuthChecked(true)
            setLanguagePreview('')
            setMissingKeyReporting(true)
          }}
        />
      </AppContext.Provider>
    )
  if (!authChecked) return <LoadingScreen />
  if (!user)
    return (
      <AppContext.Provider value={context}>
        <LoginScreen onLogin={login} setup={setup} notice={notice} />
      </AppContext.Provider>
    )
  if (user.mustChangePassword)
    return (
      <AppContext.Provider value={context}>
        <PasswordChangeScreen
          user={user}
          minLength={8}
          onDone={() => setUser(u => ({ ...u, mustChangePassword: false }))}
          onLogout={() => logout()}
        />
      </AppContext.Provider>
    )
  if (!loaded)
    return loadError ? (
      <LoadErrorScreen message={loadError} onRetry={() => loadData()} onLogout={() => logout()} />
    ) : (
      <LoadingScreen />
    )
  const shellUser = {
    ...user,
    openTasks: data.dashboard.stats?.myOpenTasks ?? 0,
    openAlerts: data.alerts.filter(a => !a.resolved).length
  }
  return (
    <AppContext.Provider value={context}>
      <div className={`app-shell ${navOpen ? 'nav-open' : ''}`}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="nav-backdrop" aria-hidden="true" onClick={() => setNavOpen(false)} />
        <Sidebar
          page={page}
          setPage={setPage}
          user={shellUser}
          settings={settings}
          onLogout={() => logout()}
          mobileOpen={navOpen}
          onClose={() => setNavOpen(false)}
        />
        <main className="main" id="main-content" tabIndex={-1}>
          <Topbar
            page={page}
            user={shellUser}
            setPage={setPage}
            onCreate={createForPage}
            onSearch={() => setSearchOpen(true)}
            onToggleTheme={toggleTheme}
            onOpenNav={() => setNavOpen(true)}
            canCreate={canCreate}
            settings={settings}
          />
          <div className="content">
            {!online && (
              <div className="global-error" role="status">
                <Icon name="warning" size={15} />
                You appear to be offline. Changes cannot be saved until the connection returns.
              </div>
            )}
            {page === 'overview' && (
              <QuickActionRail
                openModal={openModal}
                setPage={setPage}
                canManage={hasPermission(user, 'manageProjects')}
                canWriteTasks={canWriteTasks}
                canLogActivity={canLogActivity}
                onSearch={() => setSearchOpen(true)}
              />
            )}
            {error && (
              <div className="global-error" role="alert">
                <Icon name="warning" size={15} />
                {error}
                <button type="button" onClick={() => loadData(true)}>
                  Retry
                </button>
              </div>
            )}
            <ErrorBoundary key={page}>
              {page === 'overview' && <Overview data={data} setPage={setPage} />}
              {page === 'projects' && (
                <Projects
                  data={data}
                  openModal={openModal}
                  canManage={hasPermission(user, 'manageProjects')}
                  canWriteTasks={canWriteTasks}
                  projectId={projectId}
                  highlight={highlight}
                  refresh={() => loadData(true)}
                  onBack={() => setPage('projects')}
                />
              )}
              {page === 'tasks' && (
                <MyWork
                  data={data}
                  openModal={openModal}
                  refresh={() => loadData(true)}
                  notify={notify}
                  canWriteTasks={canWriteTasks}
                />
              )}
              {page === 'people' && (
                <People data={data} openModal={openModal} canManage={hasPermission(user, 'managePeople')} />
              )}
              {page === 'activity' && (
                <ActivityLog data={data} openModal={openModal} setPage={setPage} canLogActivity={canLogActivity} />
              )}
              {page === 'reports' && (
                <>
                  {hasPermission(user, 'viewReports') ? (
                    <>
                      <Reports
                        report={data.reports}
                        onPeriodChange={periodChange}
                        settings={settings}
                        setPage={setPage}
                      />
                      <UserActivityReports people={data.people || []} settings={settings} />
                    </>
                  ) : (
                    <EmptyState title="Reports are not available" message="Your role does not include report access." />
                  )}
                </>
              )}
              {page === 'alerts' && (
                <Alerts
                  data={data}
                  refresh={() => loadData(true)}
                  openModal={openModal}
                  canManage={hasPermission(user, 'manageAlerts')}
                  canResolve={hasPermission(user, 'writeTasks') || hasPermission(user, 'manageAlerts')}
                />
              )}
              {page === 'settings' &&
                (canAdmin ? (
                  <SettingsPage
                    data={{ ...data, settings: baseSettings }}
                    user={user}
                    updateSettings={updateSettings}
                    onRemoveDemo={removeDemo}
                    runtime={runtime}
                    system={system}
                    refreshSystem={refreshSystem}
                    displayMode={displayMode}
                    openModal={openModal}
                    onDelete={deleteEntity}
                    onPreviewLanguage={setLanguagePreview}
                    account={{ prefs, setPrefs, onLogout: logout }}
                  />
                ) : (
                  <div className="page-content">
                    <AccountPanel
                      user={user}
                      settings={settings}
                      prefs={prefs}
                      setPrefs={setPrefs}
                      onLogout={logout}
                      notify={notify}
                    />
                  </div>
                ))}
            </ErrorBoundary>
          </div>
        </main>
        <CommandSearch
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          data={data}
          setPage={setPage}
          openModal={openModal}
        />
        <FormModal
          modal={modal}
          data={{ ...data, settings }}
          user={user}
          onClose={() => setModal(null)}
          onSave={saveEntity}
          onDelete={deleteEntity}
        />
        <PrintPreviewHost />
        <ToastHost toasts={toasts} dismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
      </div>
    </AppContext.Provider>
  )
}
