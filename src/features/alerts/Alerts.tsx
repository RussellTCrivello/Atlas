// Alerts.
import { useState } from 'react'
import { applyAdvancedFilters } from '../../lib/filters'
import { api, errorMessage } from '../../lib/api'
import { useApp } from '../../ui/app-context'
import { AdvancedFilter } from '../export/AdvancedFilter'
import { ExportMenu } from '../export/ExportMenu'
import { Icon } from '../../ui/icons'
import { EmptyState, StatusPill } from '../../ui/primitives'

export function Alerts({ data, refresh, openModal, canManage, canResolve = false }) {
  const { notify } = useApp()
  const [filter, setFilter] = useState('Open')
  const [advanced, setAdvanced] = useState([])
  const fields = [
    { key: 'title', label: 'Alert' },
    { key: 'type', label: 'Type' },
    { key: 'project', label: 'Project' },
    { key: 'resolved', label: 'Resolved' },
    { key: 'time', label: 'Created' }
  ]
  const rows = applyAdvancedFilters(
    data.alerts.filter(a => filter === 'All' || (filter === 'Open' ? !a.resolved : a.resolved)),
    advanced
  )
  const toggle = async alert => {
    if (!canResolve) return
    try {
      await api.patch(`/api/alerts/${alert.id}`, { resolved: !alert.resolved })
    } catch (error) {
      notify({ title: 'Could not update the alert', body: errorMessage(error), tone: 'warning' })
    } finally {
      refresh()
    }
  }
  return (
    <div className="page-content">
      <div className="alerts-summary">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-dot orange" /> Attention center
          </span>
          <h2>Nothing should surprise you.</h2>
          <p>Risks and blockers are linked to work and included in exportable reporting.</p>
        </div>
        <div className="alert-count">
          <strong>{data.alerts.filter(a => !a.resolved).length}</strong>
          <span>open alerts</span>
        </div>
      </div>
      <div className="toolbar">
        <div className="filter-tabs">
          {['Open', 'All', 'Resolved'].map(tab => (
            <button className={filter === tab ? 'selected' : ''} key={tab} onClick={() => setFilter(tab)}>
              {tab}
              <span>
                {tab === 'Open'
                  ? data.alerts.filter(a => !a.resolved).length
                  : tab === 'Resolved'
                    ? data.alerts.filter(a => a.resolved).length
                    : data.alerts.length}
              </span>
            </button>
          ))}
        </div>
        <div className="toolbar-actions">
          <AdvancedFilter filterKey="alerts" fields={fields} onApply={setAdvanced} />
          <ExportMenu
            dataset="alerts"
            title="Atlas alerts"
            scope={filter === 'All' ? {} : { state: filter.toLowerCase() }}
            filters={advanced}
            rowsHint={rows.length}
          />
          {canManage && (
            <button className="primary-button" onClick={() => openModal('alert')}>
              <Icon name="plus" size={15} /> New alert
            </button>
          )}
        </div>
      </div>
      <div className="alert-list">
        {rows.map(alert => (
          <div className={`alert-row ${alert.resolved ? 'alert-resolved' : ''}`} key={alert.id}>
            <span className={`alert-type alert-${alert.tone}`}>
              <Icon
                name={
                  alert.type === 'blocker' || alert.type === 'risk' || alert.type === 'overdue' ? 'warning' : 'alerts'
                }
                size={18}
              />
            </span>
            <div className="alert-content">
              <div className="alert-title-row">
                <h3>{alert.title}</h3>
                <span>{alert.time}</span>
              </div>
              <p>{alert.body}</p>
              <div className="alert-meta">
                <span>{alert.project}</span>
                {alert.resolved && <StatusPill tone="resolved">Resolved</StatusPill>}
              </div>
            </div>
            {canResolve && (
              <button className={alert.resolved ? 'secondary-button' : 'resolve-button'} onClick={() => toggle(alert)}>
                {alert.resolved ? 'Re-open' : 'Mark resolved'}
                {!alert.resolved && <Icon name="check" size={14} />}
              </button>
            )}
            {canManage && (
              <button aria-label="Edit" className="icon-button subtle" onClick={() => openModal('alert', alert)}>
                <Icon name="more" size={16} />
              </button>
            )}
          </div>
        ))}
        {!rows.length && <EmptyState title="All clear" message="No alerts in this view." />}
      </div>
    </div>
  )
}
