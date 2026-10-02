// Settings > Interface: navigation, dashboard, surfaces, modules.
import { defaultSettings, enabledPages } from '../../lib/settings'
import { useState } from 'react'
import { slug } from '../../lib/format'
import { Icon, icons } from '../../ui/icons'
import { AdvancedSettingSelect, AdvancedTextListSetting, AdvancedToggleSetting, SettingInput } from './fields'

export function AdvancedNavigationAdmin({ form, patch, canAdmin }) {
  const labels = {
    overview: 'Overview',
    projects: 'Projects',
    tasks: 'Tasks',
    people: 'People',
    activity: 'Activity',
    reports: 'Reports',
    alerts: 'Alerts'
  }
  const pages = defaultSettings.enabledPages
  const visibility = form.interface?.navigationVisibility || {}
  const order = [...new Set([...(form.interface?.navigationOrder || pages), ...pages])].filter(page =>
    pages.includes(page)
  )
  const [drag, setDrag] = useState('')
  const apply = (nextOrder = order, nextVisibility = visibility, nextModules = form.modules || {}) => {
    patch('interface.navigationOrder', nextOrder)
    patch('interface.navigationVisibility', nextVisibility)
    patch('modules', nextModules)
    patch(
      'enabledPages',
      nextOrder.filter(page => nextVisibility[page] !== false && nextModules?.[page]?.enabled !== false)
    )
  }
  const move = (key, direction) => {
    const index = order.indexOf(key)
    const target = index + direction
    if (target < 0 || target >= order.length) return
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    apply(next)
  }
  const drop = key => {
    if (!drag || drag === key) return
    const next = order.filter(page => page !== drag)
    next.splice(next.indexOf(key), 0, drag)
    apply(next)
    setDrag('')
  }
  const toggle = (key, checked) =>
    apply(
      order,
      { ...visibility, [key]: checked },
      { ...(form.modules || {}), [key]: { ...((form.modules || {})[key] || {}), enabled: checked } }
    )
  return (
    <div className="navigation-admin">
      <div className="settings-note">
        <Icon name="menu" size={15} />
        <span>
          Drag sections, use arrows, or toggle visibility. Saved order is used by the sidebar and default landing
          choices.
        </span>
      </div>
      <div className="nav-builder-list">
        {order.map((key, index) => (
          <div
            className="nav-builder-row"
            key={key}
            draggable={canAdmin}
            onDragStart={() => setDrag(key)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => drop(key)}
          >
            <span className="drag-handle">⋮⋮</span>
            <Icon name={key} size={16} />
            <strong>{labels[key]}</strong>
            <small>{(form.modules || {})[key]?.labelKey || `nav.${key}`}</small>
            <label className="switch-inline">
              <input
                disabled={!canAdmin || key === 'overview'}
                type="checkbox"
                checked={visibility[key] !== false && (form.modules || {})[key]?.enabled !== false}
                onChange={e => toggle(key, e.target.checked)}
              />{' '}
              Visible
            </label>
            <button
              type="button"
              className="icon-button subtle"
              disabled={!canAdmin || index === 0}
              onClick={() => move(key, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-button subtle"
              disabled={!canAdmin || index === order.length - 1}
              onClick={() => move(key, 1)}
            >
              ↓
            </button>
          </div>
        ))}
      </div>
      <div className="settings-fields compact-fields">
        <AdvancedSettingSelect
          path="interface.defaultLandingPage"
          disabled={!canAdmin}
          label="Default landing page"
          value={form.interface?.defaultLandingPage || 'overview'}
          onChange={v => {
            patch('interface.defaultLandingPage', v)
            patch('defaultPage', v)
          }}
          options={enabledPages(form).map(page => [page, labels[page] || page])}
        />
      </div>
    </div>
  )
}

export function AdvancedDashboardAdmin({ form, patch, canAdmin }) {
  const widgets = {
    stats: 'Workspace metrics',
    dailyPulse: 'Daily pulse',
    projectHealth: 'Project health',
    myFocus: 'My focus'
  }
  const active = form.interface?.dashboardLayouts?.overview || Object.keys(widgets)
  const all = [...new Set([...active, ...Object.keys(widgets)])]
  const [drag, setDrag] = useState('')
  const commit = next => patch('interface.dashboardLayouts.overview', next)
  const move = (key, direction) => {
    const index = active.indexOf(key)
    const target = index + direction
    if (target < 0 || target >= active.length) return
    const next = [...active]
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }
  const toggle = (key, checked) =>
    commit(
      checked
        ? [...active, key].filter((item, index, rows) => rows.indexOf(item) === index)
        : active.filter(item => item !== key)
    )
  const drop = key => {
    if (!drag || drag === key || !active.includes(drag) || !active.includes(key)) return
    const next = active.filter(item => item !== drag)
    next.splice(next.indexOf(key), 0, drag)
    commit(next)
    setDrag('')
  }
  return (
    <div className="dashboard-layout-admin">
      {all.map(key => (
        <div
          className="config-row config-row-draggable"
          key={key}
          draggable={canAdmin && active.includes(key)}
          onDragStart={() => setDrag(key)}
          onDragOver={e => e.preventDefault()}
          onDrop={() => drop(key)}
        >
          <span className="drag-handle">⋮⋮</span>
          <label className="switch-inline">
            <input
              disabled={!canAdmin}
              type="checkbox"
              checked={active.includes(key)}
              onChange={e => toggle(key, e.target.checked)}
            />{' '}
            {widgets[key]}
          </label>
          <span>{active.includes(key) ? `Position ${active.indexOf(key) + 1}` : 'Hidden'}</span>
          <button
            type="button"
            className="icon-button subtle"
            disabled={!canAdmin || !active.includes(key) || active.indexOf(key) === 0}
            onClick={() => move(key, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-button subtle"
            disabled={!canAdmin || !active.includes(key) || active.indexOf(key) === active.length - 1}
            onClick={() => move(key, 1)}
          >
            ↓
          </button>
        </div>
      ))}
    </div>
  )
}

export function AdvancedSurfaceAdmin({ form, patch, canAdmin }) {
  const [entity, setEntity] = useState('tasks')
  const tableColumns = form.interface?.tableColumns || {}
  const formLayouts = form.interface?.formLayouts || {}
  const actions = form.interface?.actionVisibility || {}
  return (
    <div className="settings-fields">
      <div className="admin-toolbar">
        <label>
          Surface
          <select value={entity} onChange={e => setEntity(e.target.value)}>
            {['projects', 'tasks', 'people', 'activity', 'alerts', 'users'].map(item => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="settings-fields compact-fields">
        <AdvancedTextListSetting
          disabled={!canAdmin}
          path="interface.tableColumns"
          label="Visible table columns"
          value={tableColumns[entity] || []}
          onChange={rows => patch(`interface.tableColumns.${entity}`, rows)}
          hint="One field key per line."
        />
        <AdvancedTextListSetting
          disabled={!canAdmin}
          path="interface.formLayouts"
          label="Form field order"
          value={formLayouts[entity] || []}
          onChange={rows => patch(`interface.formLayouts.${entity}`, rows)}
          hint="One form key per line; custom fields are appended."
        />
      </div>
      <div className="permission-grid">
        {['create', 'edit', 'delete', 'export', 'print'].map(action => (
          <AdvancedToggleSetting
            key={action}
            disabled={!canAdmin}
            path={`interface.actionVisibility.${action}`}
            label={`${action} action`}
            checked={actions[action] !== false}
            onChange={value => patch(`interface.actionVisibility.${action}`, value)}
            description="Controls whether this action should be offered in configurable UI surfaces."
          />
        ))}
      </div>
    </div>
  )
}

export function AdvancedModulesAdmin({ form, patch, canAdmin }) {
  const modules = form.modules || {}
  const [draft, setDraft] = useState({ key: '', labelKey: '', icon: 'spark' })
  const updateModule = (key, patchRow) => {
    const nextModules = { ...modules, [key]: { ...(modules[key] || {}), ...patchRow } }
    patch('modules', nextModules)
    if ('enabled' in patchRow) {
      patch(`interface.navigationVisibility.${key}`, patchRow.enabled)
      const order = form.interface?.navigationOrder || defaultSettings.enabledPages
      patch(
        'enabledPages',
        order.filter(
          page =>
            (page === key ? patchRow.enabled : nextModules?.[page]?.enabled !== false) &&
            form.interface?.navigationVisibility?.[page] !== false
        )
      )
    }
  }
  const add = () => {
    const key = slug(draft.key).replaceAll('-', '_')
    if (!key || modules[key]) return
    patch('modules', {
      ...modules,
      [key]: {
        enabled: true,
        labelKey: draft.labelKey || `nav.${key}`,
        icon: draft.icon || 'spark',
        permissions: ['viewReports'],
        extension: true
      }
    })
    setDraft({ key: '', labelKey: '', icon: 'spark' })
  }
  return (
    <div className="module-admin">
      <div className="module-admin-grid advanced-module-grid">
        {Object.keys(modules).map(key => (
          <div className="module-config-card" key={key}>
            <div className="module-config-head">
              <label className="switch-inline">
                <input
                  disabled={!canAdmin || key === 'overview'}
                  type="checkbox"
                  checked={modules?.[key]?.enabled !== false}
                  onChange={e => updateModule(key, { enabled: e.target.checked })}
                />
                <strong>{key}</strong>
              </label>
              <Icon name={icons[modules[key]?.icon] ? modules[key].icon : 'spark'} size={16} />
            </div>
            <div className="settings-fields compact-fields">
              <SettingInput
                disabled={!canAdmin}
                path="modules.metadata"
                label="Label key"
                value={modules[key]?.labelKey || ''}
                onChange={v => updateModule(key, { labelKey: v })}
              />
              <SettingInput
                disabled={!canAdmin}
                path="modules.metadata"
                label="Icon"
                value={modules[key]?.icon || ''}
                onChange={v => updateModule(key, { icon: v })}
              />
              <SettingInput
                disabled={!canAdmin}
                path="modules.metadata"
                label="Route"
                value={modules[key]?.route || key}
                onChange={v => updateModule(key, { route: v })}
              />
              <SettingInput
                disabled={!canAdmin}
                path="modules.metadata"
                label="Permissions"
                value={(modules[key]?.permissions || []).join(', ')}
                onChange={v =>
                  updateModule(key, {
                    permissions: v
                      .split(',')
                      .map(x => x.trim())
                      .filter(Boolean)
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>
      <div className="admin-toolbar">
        <input
          disabled={!canAdmin}
          value={draft.key}
          onChange={e => setDraft({ ...draft, key: e.target.value })}
          placeholder="module_key"
        />
        <input
          disabled={!canAdmin}
          value={draft.labelKey}
          onChange={e => setDraft({ ...draft, labelKey: e.target.value })}
          placeholder="nav.module_key"
        />
        <input
          disabled={!canAdmin}
          value={draft.icon}
          onChange={e => setDraft({ ...draft, icon: e.target.value })}
          placeholder="icon"
        />
        <button type="button" className="secondary-button" disabled={!canAdmin} onClick={add}>
          Register module metadata
        </button>
      </div>
    </div>
  )
}
