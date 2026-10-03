// Daily updates.
import { useState } from 'react'
import { applyAdvancedFilters } from '../../lib/filters'
import { tr } from '../../lib/i18n'
import { useApp } from '../../ui/app-context'
import { AdvancedFilter } from '../export/AdvancedFilter'
import { ExportMenu } from '../export/ExportMenu'
import { Icon } from '../../ui/icons'
import { Avatar, PermissionNotice } from '../../ui/primitives'

export const shiftIsoDate = (iso, days) => {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function ActivityLog({ data, openModal, setPage, canLogActivity = true }) {
  const { settings } = useApp()
  const [visible, setVisible] = useState(16)
  const [range, setRange] = useState('All activity')
  const [advanced, setAdvanced] = useState([])
  const fields = [
    { key: 'person', label: 'Person' },
    { key: 'date', label: 'Date' },
    { key: 'today', label: 'Today' },
    { key: 'blocked', label: 'Blocked' }
  ]
  const rows = applyAdvancedFilters(
    range === 'Today'
      ? data.activity.filter(a => a.date === data.today)
      : range === 'Yesterday'
        ? data.activity.filter(a => a.date === shiftIsoDate(data.today, -1))
        : data.activity,
    advanced
  )
  const allTimeline = rows.flatMap(a =>
    [
      a.today && {
        a,
        action: 'is working on',
        detail: a.today,
        tone: a.blocked ? 'orange' : 'purple',
        icon: a.blocked ? 'warning' : 'bolt'
      },
      a.yesterday && { a, action: 'completed', detail: a.yesterday, tone: 'green', icon: 'check' }
    ].filter(Boolean)
  )
  const timeline = allTimeline.slice(0, visible)
  return (
    <div className="page-content">
      <div className="toolbar">
        <div className="filter-tabs">
          {['All activity', 'Today', 'Yesterday'].map(tab => (
            <button className={range === tab ? 'selected' : ''} key={tab} onClick={() => setRange(tab)}>
              {tab}
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <AdvancedFilter filterKey="activity" fields={fields} onApply={setAdvanced} />
          <ExportMenu
            dataset="activity"
            title="Atlas activity"
            scope={{ range: range === 'Today' ? 'today' : range === 'Yesterday' ? 'yesterday' : 'all' }}
            filters={advanced}
            rowsHint={rows.length}
          />
          {canLogActivity ? (
            <button className="secondary-button" onClick={() => openModal('activity')}>
              <Icon name="plus" size={15} /> Log update
            </button>
          ) : (
            <span className="readonly-pill">Read-only</span>
          )}
        </div>
      </div>
      {!canLogActivity && (
        <PermissionNotice>Your role can view activity and reports, but cannot log updates.</PermissionNotice>
      )}
      <p className="filter-hint" role="note">
        {tr(settings, 'Daily updates are visible to everyone in this workspace.')}{' '}
        {tr(
          settings,
          settings?.reports?.activityVisibility === 'everyone'
            ? 'Per-person activity reports are visible to everyone in this workspace.'
            : 'Per-person activity reports are limited to managers and administrators; everyone can see their own.'
        )}
      </p>
      <div className="activity-layout">
        <section className="panel timeline-panel">
          <div className="section-head">
            <div>
              <h2>Workspace timeline</h2>
              <p>Everything important, in context.</p>
            </div>
            <span className="live-label" title="This page checks for changes every 20 seconds">
              <i /> Updates automatically
            </span>
          </div>
          <div className="timeline">
            {timeline.map((item, i) => (
              <div className="timeline-row" key={`${item.a.id}-${i}`}>
                <div className="timeline-time">
                  <strong>{item.a.time}</strong>
                  <span>{item.a.date === data.today ? 'Today' : item.a.date}</span>
                </div>
                <div className={`timeline-line tone-${item.tone}`}>
                  <span>
                    <Icon name={item.icon} size={14} />
                  </span>
                </div>
                <div className="timeline-content">
                  <div>
                    <Avatar name={item.a.person} color={item.a.personColor} small />
                    <strong>{item.a.person}</strong>
                    <span>{item.action}</span>
                    <b>{item.detail}</b>
                  </div>
                  <p>{item.a.blocked ? `Blocked: ${item.a.blocked}` : 'Daily update confirmed'}</p>
                </div>
              </div>
            ))}
          </div>
          {allTimeline.length > visible && (
            <button type="button" className="text-button show-more" onClick={() => setVisible(v => v + 16)}>
              {tr(settings, 'Show {count} more ({remaining} left)', {
                count: Math.min(16, allTimeline.length - visible),
                remaining: allTimeline.length - visible
              })}
            </button>
          )}
        </section>
        <aside className="activity-aside">
          <section className="panel insight-card">
            <span className="insight-spark">
              <Icon name="spark" size={16} />
            </span>
            <h3>One thing to notice</h3>
            <p>
              Daily updates become operational intelligence: blockers surface in alerts, exports, and reports
              automatically.
            </p>
            <button className="text-button" onClick={() => setPage('reports')}>
              See trend <Icon name="arrow" size={13} />
            </button>
          </section>
          {data.dashboard.mostActive && (
            <section className="panel contributor-card">
              <div className="section-head compact">
                <div>
                  <h3>Most active this week</h3>
                  <p>By daily updates</p>
                </div>
              </div>
              {data.dashboard.mostActive.map((p, i) => (
                <div className="contributor-row" key={p.personId}>
                  <span className="rank">0{i + 1}</span>
                  <Avatar name={p.name} color={p.color} small />
                  <strong>{p.name}</strong>
                  <span>{p.updates} updates</span>
                </div>
              ))}
              {!data.dashboard.mostActive.length && <p className="filter-hint">No updates logged this week yet.</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  )
}
