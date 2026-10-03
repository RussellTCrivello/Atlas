// The command palette (Ctrl/Cmd+K).
import { useState, useEffect } from 'react'
import { Icon } from '../../ui/icons'

export function CommandSearch({ open, onClose, data, setPage, openModal }) {
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  if (!open) return null
  const q = query.toLowerCase()
  const pages = [
    ['overview', 'Overview'],
    ['projects', 'Projects'],
    ['tasks', 'My work'],
    ['people', 'People'],
    ['activity', 'Activity'],
    ['reports', 'Reports'],
    ['alerts', 'Alerts'],
    ['settings', 'Settings']
  ].filter(x => x[1].toLowerCase().includes(q))
  const tasks = data.tasks.filter(t => `${t.title} ${t.project} ${t.id}`.toLowerCase().includes(q)).slice(0, 6)
  const projects = data.projects.filter(p => `${p.name} ${p.code}`.toLowerCase().includes(q)).slice(0, 6)
  const people = data.people.filter(p => `${p.name} ${p.email}`.toLowerCase().includes(q)).slice(0, 6)
  const go = (page, fn = undefined) => {
    setPage(page)
    fn?.()
    onClose()
  }
  return (
    <div className="command-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="command-panel" role="dialog" aria-modal="true" aria-label="Search">
        <div className="command-input">
          <Icon name="search" size={17} />
          <input
            autoFocus
            aria-label="Search pages, tasks, people and projects"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search pages, tasks, people, projects…"
          />
          <kbd>Esc</kbd>
        </div>
        <div className="command-sections">
          <section>
            <h4>Pages</h4>
            {pages.map(([id, label]) => (
              <button type="button" key={id} onClick={() => go(id)}>
                <Icon name={id === 'settings' ? 'settings' : id} size={15} />
                <span>{label}</span>
              </button>
            ))}
          </section>
          {projects.length > 0 && (
            <section>
              <h4>Projects</h4>
              {projects.map(p => (
                <button key={p.numericId} onClick={() => go('projects', () => openModal('project', p))}>
                  <Icon name="projects" size={15} />
                  <span>{p.name}</span>
                  <small>{p.code}</small>
                </button>
              ))}
            </section>
          )}
          {tasks.length > 0 && (
            <section>
              <h4>Tasks</h4>
              {tasks.map(t => (
                <button key={t.numericId} onClick={() => go('tasks', () => openModal('task', t))}>
                  <Icon name="tasks" size={15} />
                  <span>{t.title}</span>
                  <small>{t.id}</small>
                </button>
              ))}
            </section>
          )}
          {people.length > 0 && (
            <section>
              <h4>People</h4>
              {people.map(p => (
                <button key={p.id} onClick={() => go('people', () => openModal('person', p))}>
                  <Icon name="people" size={15} />
                  <span>{p.name}</span>
                  <small>{p.team}</small>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
