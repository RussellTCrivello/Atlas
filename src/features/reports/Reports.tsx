// Delivery reports.
import React, { useState } from 'react'
import { errorMessage } from '../../lib/api'
import { tr, translateUiText } from '../../lib/i18n'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { ExportMenu } from '../export/ExportMenu'

export function Reports({ report, onPeriodChange, settings, setPage }) {
  const { notify } = useApp()
  const [period, setPeriod] = useState('Weekly')
  const [metric, setMetric] = useState('rate')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState(null)
  const columns = [
    { key: 'label', label: 'Period' },
    { key: 'created', label: 'Created' },
    { key: 'completed', label: 'Completed' },
    { key: 'planned', label: 'Due' },
    { key: 'delivered', label: 'Delivered on time' },
    { key: 'rate', label: 'On-time rate %' }
  ]
  const series = report?.series || []
  const rated = series.filter(p => p.rate !== null && p.rate !== undefined)
  const peak = rated.reduce((best, p) => (p.rate > (best?.rate ?? -1) ? p : best), null)
  const maxCount = Math.max(1, ...series.map(p => Math.max(p.completed || 0, p.created || 0)))
  const deliveryRate = report?.deliveryRate
  const hasRate = deliveryRate !== null && deliveryRate !== undefined
  const change = async p => {
    setPeriod(p)
    setLoading(true)
    setSelected(null)
    try {
      await onPeriodChange(p.toLowerCase())
    } catch (error) {
      notify({ title: 'Could not load the report', body: errorMessage(error), tone: 'warning' })
    } finally {
      setLoading(false)
    }
  }
  const barHeight = p => (metric === 'rate' ? (p.rate ?? 0) : Math.round(((p.completed || 0) / maxCount) * 100))
  const lineHeight = p => (metric === 'rate' ? 0 : Math.round(((p.created || 0) / maxCount) * 100))
  const yAxis =
    metric === 'rate'
      ? ['100%', '75%', '50%', '25%', '0%']
      : [maxCount, Math.round(maxCount * 0.75), Math.round(maxCount * 0.5), Math.round(maxCount * 0.25), 0].map(String)
  return (
    <div className="page-content">
      <div className="report-hero">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-dot" /> Delivery intelligence
          </span>
          <h2>A clearer picture of momentum.</h2>
          <p>
            Daily, weekly, monthly, quarterly and annual reports are built from the work ledger (what was created and
            completed, and when) and from current task due dates. History does not change when a task is later edited,
            re-opened or deleted.
          </p>
        </div>
        <div className="report-hero-actions">
          <button type="button" className="secondary-button" onClick={() => setPage('tasks')}>
            <Icon name="tasks" size={14} /> Open tasks
          </button>
          <ExportMenu
            dataset="report"
            title={`${period} Atlas report`}
            scope={{ period: period.toLowerCase() }}
            rowsHint={series.length}
          />
        </div>
      </div>
      <div className="report-tabs" role="group" aria-label="Report period">
        {['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Yearly'].map(p => (
          <button
            type="button"
            key={p}
            className={period === p ? 'selected' : ''}
            aria-pressed={period === p}
            onClick={() => change(p)}
          >
            {p}
          </button>
        ))}
      </div>
      {loading && (
        <div className="report-loading" role="status">
          Refreshing report…
        </div>
      )}
      <div className="report-insight-strip">
        <div>
          <strong>{hasRate ? `${deliveryRate}%` : '—'}</strong>
          <span>On-time delivery</span>
        </div>
        <div>
          <strong>{report?.completed || 0}</strong>
          <span>Completed</span>
        </div>
        <div>
          <strong>{report?.blockedTasks || 0}</strong>
          <span>Blocked now</span>
        </div>
        <div>
          <strong>{peak?.label || '—'}</strong>
          <span>Best period{peak ? ` · ${peak.rate}%` : ''}</span>
        </div>
      </div>
      <div className="report-grid">
        <section className="panel chart-panel">
          <div className="section-head">
            <div>
              <h2>{metric === 'rate' ? `${period} on-time delivery rate` : `${period} throughput`}</h2>
              <p>Select a bar for details. Export includes every period shown.</p>
            </div>
            <div className="view-toggle" role="group" aria-label="Metric">
              <button
                type="button"
                className={metric === 'rate' ? 'selected' : ''}
                aria-pressed={metric === 'rate'}
                onClick={() => setMetric('rate')}
              >
                On-time rate
              </button>
              <button
                type="button"
                className={metric === 'count' ? 'selected' : ''}
                aria-pressed={metric === 'count'}
                onClick={() => setMetric('count')}
              >
                Throughput
              </button>
            </div>
          </div>
          <div className="chart-legend">
            {metric === 'rate' ? (
              <span>
                <i className="legend-purple" /> Delivered on time ÷ due
              </span>
            ) : (
              <>
                <span>
                  <i className="legend-purple" /> Completed
                </span>
                <span>
                  <i className="legend-muted" /> Created
                </span>
              </>
            )}
          </div>
          <div className="chart-area">
            <div className="y-axis" aria-hidden="true">
              {yAxis.map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
            <div className="chart">
              <div className="grid-lines">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="bars">
                {series.map((p, i) => (
                  <button
                    type="button"
                    className={`bar-group ${selected?.label === p.label ? 'selected' : ''}`}
                    key={`${p.label}-${i}`}
                    aria-label={`${p.label}: ${p.created} created, ${p.completed} completed, ${p.planned} due, ${p.rate === null ? 'no rate' : `${p.rate}% on time`}`}
                    onClick={() => setSelected(p)}
                  >
                    <div
                      className="bar-value"
                      style={{ height: `${Math.max(barHeight(p), p.completed || p.rate ? 4 : 1)}%` }}
                    >
                      <span>{metric === 'rate' ? (p.rate === null ? '—' : `${p.rate}%`) : p.completed}</span>
                    </div>
                    {metric === 'count' && (
                      <div className="planned-line" style={{ height: `${Math.max(lineHeight(p), 2)}%` }} />
                    )}
                    <label>{p.label}</label>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="chart-footer">
            <span>
              <strong>{report?.completed || 0}</strong> completed · <strong>{report?.created || 0}</strong> created
            </span>
            <span>{report?.activities || 0} activity updates</span>
          </div>
          {selected && (
            <div className="report-drilldown">
              <div>
                <strong>{selected.label}</strong>
                <span>
                  {tr(
                    settings,
                    '{created} created · {completed} completed · {planned} due · {delivered} on time · {rate}',
                    {
                      created: selected.created,
                      completed: selected.completed,
                      planned: selected.planned,
                      delivered: selected.delivered,
                      rate:
                        selected.rate === null
                          ? translateUiText(settings, 'no rate (nothing was due)')
                          : `${selected.rate}%`
                    }
                  )}
                </span>
              </div>
              <button type="button" className="text-button" onClick={() => setSelected(null)}>
                Clear
              </button>
            </div>
          )}
        </section>
        <section className="panel report-score">
          <div className="section-head">
            <div>
              <h2>On-time delivery</h2>
              <p>Tasks that came due in this window</p>
            </div>
          </div>
          <div
            className="score-ring"
            role="img"
            aria-label={hasRate ? `${deliveryRate} percent delivered on time` : 'No tasks came due in this window'}
            style={{
              background: `conic-gradient(var(--purple) 0 ${hasRate ? deliveryRate : 0}%, #ecebf8 ${hasRate ? deliveryRate : 0}% 100%)`
            }}
          >
            <div>
              <strong>{hasRate ? deliveryRate : '—'}</strong>
              <span>{hasRate ? '%' : ''}</span>
            </div>
          </div>
          <p>
            {hasRate
              ? `${report?.delivered || 0} of ${report?.planned || 0} tasks that came due were completed on or before their due date.`
              : 'No task came due in this window, so there is nothing to measure yet.'}
          </p>
          <button type="button" className="full-width-button" onClick={() => setPage('alerts')}>
            View attention items <Icon name="arrow" size={13} />
          </button>
        </section>
      </div>
      <div className="report-highlights">
        <div>
          <span className="highlight-icon green">
            <Icon name="check" size={16} />
          </span>
          <div>
            <strong>{report?.completed || 0} tasks completed</strong>
            <span>Selected period</span>
          </div>
        </div>
        <div>
          <span className="highlight-icon blue">
            <Icon name="clock" size={16} />
          </span>
          <div>
            <strong>{report?.remainingTasks || 0} tasks remaining</strong>
            <span>{report?.activeProjects || 0} active projects (now)</span>
          </div>
        </div>
        <div>
          <span className="highlight-icon orange">
            <Icon name="warning" size={16} />
          </span>
          <div>
            <strong>{report?.blockedTasks || 0} blocked tasks</strong>
            <span>
              {report?.overdue || 0} overdue · {report?.alerts || 0} open alerts (now)
            </span>
          </div>
        </div>
      </div>
      {report?.definitions && (
        <details className="report-definitions">
          <summary>How these numbers are calculated</summary>
          <dl>
            {Object.entries(report.definitions).map(([key, text]) => (
              <React.Fragment key={key}>
                <dt>{key}</dt>
                <dd>{String(text)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}
