// The people directory and team management entry points.
import { useState } from 'react'
import { applyAdvancedFilters } from '../../lib/filters'
import { AdvancedFilter } from '../export/AdvancedFilter'
import { ExportMenu } from '../export/ExportMenu'
import { Icon } from '../../ui/icons'
import { Avatar, EmptyState } from '../../ui/primitives'

export function People({ data, openModal, canManage }) {
  const [team, setTeam] = useState('Everyone')
  const [advanced, setAdvanced] = useState([])
  const fields = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'team', label: 'Team' },
    { key: 'status', label: 'Status' },
    { key: 'load', label: 'Planned capacity' }
  ]
  const rows = applyAdvancedFilters(
    data.people.filter(p => team === 'Everyone' || p.team === team),
    advanced
  )
  const avg = data.people.length ? Math.round(data.people.reduce((s, p) => s + p.load, 0) / data.people.length) : 0
  return (
    <div className="page-content">
      <div className="people-summary">
        <div className="people-summary-main">
          <span className="eyebrow">
            <span className="eyebrow-dot green" /> Team pulse
          </span>
          <h2>{data.people.length} people, one clear view.</h2>
          <p>Planned capacity is entered by hand on each profile; it is not calculated from assigned work.</p>
        </div>
        <div className="people-stats">
          <div>
            <strong>{avg}%</strong>
            <span>Avg. planned capacity</span>
          </div>
          <div>
            <strong>{data.activity.filter(a => a.date === data.today).length}</strong>
            <span>Updates today</span>
          </div>
          <div>
            <strong>{data.people.filter(p => p.status !== 'On track').length}</strong>
            <span>Need support</span>
          </div>
        </div>
      </div>
      <div className="toolbar">
        <div className="filter-tabs">
          {['Everyone', ...data.teams.map(t => t.name)].map(tab => (
            <button className={team === tab ? 'selected' : ''} onClick={() => setTeam(tab)} key={tab}>
              {tab}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <AdvancedFilter filterKey="people" fields={fields} onApply={setAdvanced} />
          <ExportMenu
            dataset="people"
            title="Atlas people"
            scope={team === 'Everyone' ? {} : { team }}
            filters={advanced}
            rowsHint={rows.length}
          />
          {canManage && (
            <button className="secondary-button" onClick={() => openModal('team')}>
              <Icon name="team" size={15} /> Manage teams
            </button>
          )}
          {canManage && (
            <button className="primary-button" onClick={() => openModal('person')}>
              <Icon name="plus" size={15} /> Add person
            </button>
          )}
        </div>
      </div>
      <div className="team-strip">
        {data.teams.map(t => (
          <button className="team-chip" key={t.id} onClick={() => canManage && openModal('team', t)}>
            <span className={`team-chip-dot team-chip-${t.color}`} />
            {t.name}
            <small>{t.peopleCount}</small>
          </button>
        ))}
      </div>
      <div className="people-grid">
        {rows.map(p => (
          <PersonCard person={p} key={p.id} onEdit={canManage ? () => openModal('person', p) : null} />
        ))}
      </div>
      {!rows.length && <EmptyState title="No people match" message="Clear filters or add a person." />}
    </div>
  )
}

export function PersonCard({ person, onEdit }) {
  return (
    <article className="person-card">
      <div className="person-card-head">
        <Avatar name={person.name} color={person.color} />
        <span className={`online-status ${person.status !== 'On track' ? 'attention' : ''}`}>
          <i /> {person.status}
        </span>
        {onEdit && (
          <button aria-label="Edit" className="icon-button subtle" onClick={onEdit}>
            <Icon name="more" size={16} />
          </button>
        )}
      </div>
      <div className="person-name">
        <h3>{person.name}</h3>
        <p>{person.role}</p>
      </div>
      <div className="person-focus">
        <span>Current focus</span>
        <strong>{person.focus}</strong>
      </div>
      <div className="person-card-foot">
        <span>{person.team}</span>
        <div className="capacity">
          <span>Planned capacity</span>
          <strong>{person.load}%</strong>
          <div className="capacity-track">
            <i style={{ width: `${person.load}%` }} />
          </div>
        </div>
      </div>
    </article>
  )
}
