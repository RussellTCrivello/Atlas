import React, { useEffect, useState } from 'react'
import { Icon } from '../Icon.jsx'
import { Avatar, Logo } from '../common.jsx'
import { actionVisible } from '../../lib/advanced-filters.js'
import { enabledPages, t, userLanguageOptions } from '../../lib/workspace.js'

export function Sidebar({ page, setPage, user, settings, onLogout, onProfile, mobileOpen, onClose, isAdministrator = false }) {
  const pageLabels = {
    overview: 'Overview', projects: 'Projects', tasks: 'My work', people: 'People', activity: 'Activity',
    reports: 'Reports', alerts: 'Alerts', settings: 'Settings', users: 'Users'
  }
  const pages = [
    ['overview', 'Overview'], ['projects', 'Projects'], ['tasks', 'My work'], ['people', 'People'],
    ['activity', 'Activity'], ['reports', 'Reports'], ['alerts', 'Alerts'], ['users', 'Users'], ['settings', 'Settings']
  ].filter(([id]) => {
    if (id === 'settings' || id === 'users') return isAdministrator
    return enabledPages(settings).includes(id)
  })
  const goToPage = target => {
    setPage(target)
    onClose?.()
  }

  return <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
    <div className="brand">
      <Logo/>
      <span>{settings.workspace?.applicationName || 'atlas'}</span>
      <span className="brand-beta">workspace</span>
      <button type="button" className="icon-button mobile-close" onClick={onClose} aria-label={t(settings, 'actions.close_navigation', 'Close navigation')}>
        <Icon name="close" size={15}/>
      </button>
    </div>
    <div className="workspace-switcher">
      <div className="workspace-logo">{(settings.workspaceName || 'A')[0]}</div>
      <div><strong>{settings.workspaceName}</strong><small>{settings.workspaceUnit}</small></div>
      <Icon name="down" size={14}/>
    </div>
    <div className="sidebar-section-label">Workspace</div>
    <nav className="nav-list" aria-label={t(settings, 'navigation.workspace', 'Workspace navigation')}>
      {pages.map(([id, label]) => <button
        type="button"
        key={id}
        className={`nav-item ${page === id ? 'active' : ''}`}
        aria-current={page === id ? 'page' : undefined}
        onClick={() => goToPage(id)}
      >
        <Icon name={id === 'settings' ? 'settings' : id === 'users' ? 'people' : id} size={18}/>
        <span>{t(settings, `nav.${id}`, pageLabels[id] || label)}</span>
        {id === 'tasks' && <span className="nav-count">{user?.openTasks || 0}</span>}
        {id === 'alerts' && user?.openAlerts > 0 && <span className="alert-dot"/>}
      </button>)}
    </nav>
    <div className="sidebar-spacer"/>
    <div className="profile-row">
      <button
        type="button"
        className={`profile-trigger ${page === 'profile' ? 'active' : ''}`}
        onClick={() => { onProfile?.(); onClose?.() }}
        aria-label={t(settings, 'actions.open_profile', 'Open your profile')}
        aria-current={page === 'profile' ? 'page' : undefined}
      >
        <Avatar name={user?.name} color={user?.avatarColor}/>
        <span className="profile-copy"><strong>{user?.name}</strong><small>{t(settings, 'nav.profile', 'My profile')} · {t(settings, `role.${String(user?.role || '').toLowerCase()}`, user?.role || 'User')}</small></span>
        <Icon className="profile-arrow" name="arrow" size={14}/>
      </button>
      <button type="button" className="logout-button" onClick={onLogout} aria-label={t(settings, 'actions.sign_out', 'Sign out')} title={t(settings, 'actions.sign_out', 'Sign out')}>
        <Icon name="logout" size={15}/>
      </button>
    </div>
  </aside>
}

export function Topbar({
  page, user, setPage, onCreate, onSearch, onToggleTheme, onOpenNav, onLanguageChange,
  languagePreference = '', languagePreferenceEnabled = true, canCreate = true, settings
}) {
  const titles = {
    overview: ['Overview', 'Key metrics and attention items.'],
    projects: ['Projects', 'Health, owners, milestones.'],
    tasks: ['My work', 'Manage workflow state.'],
    people: ['People', 'Teams and capacity.'],
    activity: ['Activity', 'Updates and blockers.'],
    reports: ['Reports', 'Trends, evidence, exports.'],
    alerts: ['Alerts', 'Risks and deadlines.'],
    users: ['Users', 'Manage workspace access and accounts.'],
    profile: ['My profile', 'Your account details and personal workspace identity.'],
    settings: ['Settings', 'Workspace administration.']
  }
  const [rawTitle, subtitle] = titles[page] || titles.overview
  const title = t(settings, `nav.${page}`, rawTitle)
  const languages = userLanguageOptions(settings)
  const defaultLanguage = settings.localization?.defaultLanguage || settings.language || 'en'
  const defaultLanguageName = languages.find(language => language.code === defaultLanguage)?.name || defaultLanguage
  const languageLabel = t(settings, 'actions.change_language', 'Change interface language')

  return <header className="topbar">
    <div className="mobile-brand"><Logo/><span>atlas</span></div>
    <div className="page-heading"><h1>{title}</h1><p>{subtitle}</p></div>
    <div className="top-actions">
      <button type="button" className="search-box" onClick={onSearch} aria-label={t(settings, 'actions.search', 'Search anything')}>
        <Icon name="search" size={16}/><span>{t(settings, 'actions.search', 'Search anything')}</span><kbd>⌘K</kbd>
      </button>
      <label className="language-switcher" title={languageLabel}>
        <Icon name="globe" size={16}/>
        <select
          aria-label={languageLabel}
          value={languagePreference || ''}
          disabled={!languagePreferenceEnabled || languages.length < 2}
          onChange={event => onLanguageChange?.(event.target.value)}
        >
          <option value="">{t(settings, 'settings.workspace_default', 'Workspace default')} · {defaultLanguageName}</option>
          {languages.map(language => <option key={language.code} value={language.code}>{language.code} · {language.name}</option>)}
        </select>
      </label>
      <button type="button" className="icon-button" onClick={onToggleTheme} aria-label={t(settings, 'actions.toggle_theme', 'Toggle theme')} title={t(settings, 'actions.toggle_theme', 'Toggle theme')}>
        <Icon name="moon" size={18}/>
      </button>
      {enabledPages(settings).includes('alerts') && <button type="button" className="notification-button" onClick={() => setPage('alerts')} aria-label={t(settings, 'nav.alerts', 'Alerts')}>
        <Icon name="alerts" size={18}/>{user?.openAlerts > 0 && <span/>}
      </button>}
      {page !== 'settings' && page !== 'users' && page !== 'profile' && canCreate && <button type="button" className="primary-button top-add" onClick={onCreate}>
        <Icon name="plus" size={16}/><span>{t(settings, 'actions.new', 'New')}</span>
      </button>}
      <button type="button" className="mobile-menu" onClick={onOpenNav} aria-label={t(settings, 'actions.open_navigation', 'Open navigation')}>
        <Icon name="menu"/>
      </button>
    </div>
  </header>
}

export function CommandSearch({
  open, onClose, data, setPage, openModal, settings, canEditTasks = false,
  canEditProjects = false, canEditPeople = false, isAdministrator = false
}) {
  const [query, setQuery] = useState('')
  useEffect(() => { if (!open) setQuery('') }, [open])
  if (!open) return null

  const q = query.toLowerCase()
  const visiblePages = new Set(enabledPages(settings))
  const pages = [
    ['overview', 'Overview'], ['projects', 'Projects'], ['tasks', 'My work'], ['people', 'People'],
    ['activity', 'Activity'], ['reports', 'Reports'], ['alerts', 'Alerts'], ['profile', 'My profile'],
    ['users', 'Users'], ['settings', 'Settings']
  ].filter(([id, label]) => {
    const visible = id === 'profile' || (id === 'users' || id === 'settings' ? isAdministrator : visiblePages.has(id))
    return visible && (label.toLowerCase().includes(q) || t(settings, `nav.${id}`, label).toLowerCase().includes(q))
  })
  const tasks = data.tasks.filter(task => `${task.title} ${task.project} ${task.id}`.toLowerCase().includes(q)).slice(0, 6)
  const projects = data.projects.filter(project => `${project.name} ${project.code}`.toLowerCase().includes(q)).slice(0, 6)
  const people = data.people.filter(person => `${person.name} ${person.email}`.toLowerCase().includes(q)).slice(0, 6)
  const go = (target, action) => { setPage(target); action?.(); onClose() }

  return <div className="command-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div className="command-panel">
      <div className="command-input">
        <Icon name="search" size={17}/>
        <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder={t(settings, 'command.search_placeholder', 'Search pages, tasks, people, projects…')}/>
        <kbd>Esc</kbd>
      </div>
      <div className="command-sections">
        <section><h4>{t(settings, 'command.pages', 'Pages')}</h4>{pages.map(([id, label]) => <button type="button" key={id} onClick={() => go(id)}>
          <Icon name={id === 'settings' ? 'settings' : id === 'users' ? 'people' : id === 'profile' ? 'people' : id} size={15}/>
          <span>{t(settings, `nav.${id}`, label)}</span>
        </button>)}</section>
        {projects.length > 0 && <section><h4>{t(settings, 'nav.projects', 'Projects')}</h4>{projects.map(project => <button type="button" key={project.numericId} onClick={() => go('projects', canEditProjects && actionVisible(settings, 'edit') ? () => openModal('project', project) : undefined)}>
          <Icon name="projects" size={15}/><span data-no-i18n>{project.name}</span><small data-no-i18n>{project.code}</small>
        </button>)}</section>}
        {tasks.length > 0 && <section><h4>{t(settings, 'nav.tasks', 'Tasks')}</h4>{tasks.map(task => <button type="button" key={task.numericId} onClick={() => go('tasks', canEditTasks && actionVisible(settings, 'edit') ? () => openModal('task', task) : undefined)}>
          <Icon name="tasks" size={15}/><span data-no-i18n>{task.title}</span><small data-no-i18n>{task.id}</small>
        </button>)}</section>}
        {people.length > 0 && <section><h4>{t(settings, 'nav.people', 'People')}</h4>{people.map(person => <button type="button" key={person.id} onClick={() => go('people', canEditPeople && actionVisible(settings, 'edit') ? () => openModal('person', person) : undefined)}>
          <Icon name="people" size={15}/><span data-no-i18n>{person.name}</span><small data-no-i18n>{person.team}</small>
        </button>)}</section>}
      </div>
    </div>
  </div>
}

export function QuickActionRail({ openModal, setPage, canManage, canCreateTasks = false, canLogActivity = true, settings, onSearch }) {
  const actions = []
  if (canCreateTasks) actions.push(['New task', 'tasks', () => openModal('task')])
  if (canManage && actionVisible(settings, 'create')) actions.push(['New project', 'projects', () => openModal('project')])
  if (canLogActivity && actionVisible(settings, 'create')) actions.push(['Log update', 'activity', () => openModal('activity')])
  if (enabledPages(settings).includes('reports')) actions.push(['Reports', 'reports', () => setPage('reports')])
  if (enabledPages(settings).includes('alerts')) actions.push(['Alerts', 'alerts', () => setPage('alerts')])
  actions.push(['Search', 'search', onSearch])
  return <div className="quick-action-rail">{actions.map(([label, icon, run]) => <button type="button" key={label} onClick={run}><Icon name={icon} size={14}/>{label}</button>)}</div>
}
