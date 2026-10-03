// Saved views: a named set of columns, sort, filters and page size, kept in the database for this person (or shared with
// everybody by an administrator). Opening a screen applies the person's default view; "Save current view" captures what the
// grid looks like now.
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { api, errorMessage } from '../../../lib/api'
import type { GridConfig } from '../../../lib/grid-model'
import { tr } from '../../../lib/i18n'
import { hasPermission } from '../../../lib/settings'
import { useApp } from '../../../ui/app-context'
import { confirmAction } from '../../../ui/confirm'
import { Icon } from '../../../ui/icons'

interface SavedView {
  id: string
  name: string
  config: unknown
  shared: boolean
  isDefault: boolean
  mine: boolean
}
interface Props {
  scope: string
  activeView: string
  snapshot: () => GridConfig
  onApply: (id: string, config: unknown) => void
  /** Apply the person's default view when the grid opens (only if they have not changed anything yet). */
  applyDefault?: boolean
}

export function ViewsMenu({ scope, activeView, snapshot, onApply, applyDefault = true }: Props) {
  const { user, settings, notify } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const canShare = hasPermission(user, 'manageSettings')
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState<SavedView[]>([])
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [makeDefault, setMakeDefault] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const startedWith = useRef(applyDefault)

  const load = useCallback(async () => {
    try {
      const result = await api.get(`/api/views?scope=${encodeURIComponent(scope)}`)
      setViews(result.views || [])
      return result.views as SavedView[]
    } catch {
      return [] as SavedView[]
    }
  }, [scope])
  useEffect(() => {
    let alive = true
    load().then(list => {
      if (!alive || !startedWith.current) return
      startedWith.current = false
      const preferred = list.find(view => view.mine && view.isDefault)
      if (preferred) onApply(preferred.id, preferred.config)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])
  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => !box.current?.contains(event.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const created = await api.post('/api/views', {
        scope,
        name: name.trim(),
        config: snapshot(),
        shared,
        isDefault: makeDefault
      })
      await load()
      onApply(created.id, created.config)
      setNaming(false)
      setName('')
      setShared(false)
      setMakeDefault(false)
      notify({ title: t('View saved'), body: created.name, tone: 'success' })
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }
  const change = async (view: SavedView, patch: Record<string, unknown>, done: string) => {
    try {
      await api.patch(`/api/views/${view.id}`, patch)
      await load()
      notify({ title: done, body: view.name, tone: 'success' })
    } catch (failure) {
      notify({ title: t('Could not change the view'), body: errorMessage(failure), tone: 'warning' })
    }
  }
  const remove = async (view: SavedView) => {
    const proceed = await confirmAction({
      title: t('Delete the view “{name}”?', { name: view.name }),
      message: view.shared ? t('It is shared, so it disappears for everybody who uses it.') : undefined,
      tone: 'danger',
      irreversible: true,
      confirmLabel: t('Delete view')
    })
    if (!proceed) return
    try {
      await api.delete(`/api/views/${view.id}`)
      await load()
    } catch (failure) {
      notify({ title: t('Could not delete the view'), body: errorMessage(failure), tone: 'warning' })
    }
  }
  const active = views.find(view => view.id === activeView)
  return (
    <div
      className="menu-wrap"
      ref={box}
      onKeyDown={event => event.key === 'Escape' && open && (event.stopPropagation(), setOpen(false))}
    >
      <button
        type="button"
        className="secondary-button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen(!open)}
      >
        <Icon name="bookmark" size={15} /> {active ? active.name : t('Views')}
      </button>
      {open && (
        <div className="menu-panel views-panel" id={`${id}-panel`} role="group" aria-label={t('Saved views')}>
          {views.length === 0 && (
            <p className="menu-note">{t('No saved views yet. Arrange the table, then save it here.')}</p>
          )}
          <ul className="view-list">
            {views.map(view => (
              <li key={view.id} className={view.id === activeView ? 'active' : ''}>
                <button
                  type="button"
                  className="view-apply"
                  aria-pressed={view.id === activeView}
                  onClick={() => {
                    onApply(view.id, view.config)
                    setOpen(false)
                  }}
                >
                  {view.name}
                  {view.shared && <span className="mini-badge">{t('Shared')}</span>}
                  {view.isDefault && view.mine && <span className="mini-badge">{t('Default')}</span>}
                </button>
                {view.mine && (
                  <>
                    <button
                      type="button"
                      className="icon-button subtle"
                      aria-label={t('Update “{name}” to the current table', { name: view.name })}
                      title={t('Update to the current table')}
                      onClick={() => change(view, { config: snapshot() }, t('View updated'))}
                    >
                      <Icon name="reset" size={13} />
                    </button>
                    <button
                      type="button"
                      className="icon-button subtle"
                      aria-pressed={view.isDefault}
                      aria-label={
                        view.isDefault
                          ? t('Stop opening “{name}” by default', { name: view.name })
                          : t('Open “{name}” by default', { name: view.name })
                      }
                      title={view.isDefault ? t('Stop opening by default') : t('Open by default')}
                      onClick={() =>
                        change(
                          view,
                          { isDefault: !view.isDefault },
                          view.isDefault ? t('No longer the default') : t('Now the default')
                        )
                      }
                    >
                      <Icon name="check" size={13} />
                    </button>
                  </>
                )}
                {(view.mine || (view.shared && canShare)) && (
                  <button
                    type="button"
                    className="icon-button subtle"
                    aria-label={t('Delete the view “{name}”', { name: view.name })}
                    onClick={() => remove(view)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {naming ? (
            <form className="view-form" onSubmit={save}>
              <label>
                {t('Name this view')}
                <input autoFocus value={name} maxLength={80} required onChange={event => setName(event.target.value)} />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" checked={makeDefault} onChange={event => setMakeDefault(event.target.checked)} />{' '}
                {t('Open this view by default')}
              </label>
              {canShare && (
                <label className="checkbox-label">
                  <input type="checkbox" checked={shared} onChange={event => setShared(event.target.checked)} />{' '}
                  {t('Share with everybody')}
                </label>
              )}
              {error && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
              <div className="view-form-actions">
                <button type="button" className="text-button" onClick={() => setNaming(false)}>
                  {t('Cancel')}
                </button>
                <button className="primary-button" disabled={!name.trim() || busy}>
                  {t('Save view')}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="text-button" onClick={() => setNaming(true)}>
              <Icon name="plus" size={13} /> {t('Save current view…')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
