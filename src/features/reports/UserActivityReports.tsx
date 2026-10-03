// Activity reports: who did what, per person and per project.
import { useState, useCallback, useEffect } from 'react'
import { hasPermission } from '../../lib/settings'
import { api, errorMessage } from '../../lib/api'
import { tr } from '../../lib/i18n'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { Avatar, EmptyState, PermissionNotice, ProgressBar } from '../../ui/primitives'
import { ExportMenu } from '../export/ExportMenu'

export function UserActivityReports({ people = [], settings }) {
  const { user } = useApp()
  const [period, setPeriod] = useState('weekly')
  const [scope, setScope] = useState('all')
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedRow, setSelectedRow] = useState(null)
  const [visible, setVisible] = useState(25)
  const seesEveryone =
    hasPermission(user, 'managePeople') ||
    hasPermission(user, 'manageSettings') ||
    settings?.reports?.activityVisibility === 'everyone'
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setReport(
        await api.get(`/api/reports/activity/${period}?userId=${encodeURIComponent(seesEveryone ? scope : 'all')}`)
      )
      setVisible(25)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [period, scope, seesEveryone])
  useEffect(() => {
    load()
  }, [load])
  const rowColumns = [
    { key: 'date', label: 'Date' },
    { key: 'time', label: 'Time' },
    { key: 'person', label: 'Person' },
    { key: 'project', label: 'Project' },
    { key: 'taskId', label: 'Task ID' },
    { key: 'task', label: 'Task / Update' },
    { key: 'action', label: 'Action' },
    { key: 'status', label: 'Status' },
    { key: 'summary', label: 'Details' }
  ]
  const userColumns = [
    { key: 'person', label: 'Person' },
    { key: 'role', label: 'Job title' },
    { key: 'team', label: 'Team' },
    { key: 'tasksTouched', label: 'Tasks touched' },
    { key: 'completedTasks', label: 'Completed' },
    { key: 'projects', label: 'Projects' },
    { key: 'updates', label: 'Updates' },
    { key: 'blockers', label: 'Blockers' },
    { key: 'events', label: 'Events' }
  ]
  const projectColumns = [
    { key: 'project', label: 'Project' },
    { key: 'projectCode', label: 'Code' },
    { key: 'tasksTouched', label: 'Tasks touched' },
    { key: 'completedTasks', label: 'Completed' },
    { key: 'users', label: 'People' },
    { key: 'events', label: 'Events' }
  ]
  const totals = report?.totals || {}
  const rows = report?.rows || []
  const maxCompleted = Math.max(1, ...(report?.projects || []).map(p => p.completedTasks))
  return (
    <section className="page-content activity-report-lab">
      <div className="activity-report-hero">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-dot green" /> Activity log
          </span>
          <h2>Who did what, when, and inside which project.</h2>
          <p>
            Every row is something that was recorded: a task created, moved or completed, an update posted, a blocker
            raised. Atlas records what happened, not how long it took, so no time-spent figures are produced.
          </p>
        </div>
        <div className="report-builder-controls">
          <label>
            Timeframe
            <select value={period} onChange={e => setPeriod(e.target.value)}>
              <option value="daily">Day</option>
              <option value="weekly">Week</option>
              <option value="monthly">Month</option>
            </select>
          </label>
          {seesEveryone && (
            <label>
              Scope
              <select value={scope} onChange={e => setScope(e.target.value)}>
                <option value="all">Everyone (aggregate)</option>
                {people.map(person => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.jobTitle || person.role}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="secondary-button" onClick={load}>
            <Icon name="activity" size={15} /> Refresh
          </button>
        </div>
      </div>
      {!seesEveryone && (
        <PermissionNotice>
          You can see your own activity here. Workspace managers can see the whole team (an administrator can change
          this in Settings → Reports).
        </PermissionNotice>
      )}
      {error && (
        <div className="global-error" role="alert">
          <Icon name="warning" size={15} />
          {error}
          <button type="button" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {loading && (
        <div className="report-loading" role="status">
          Loading the activity log…
        </div>
      )}
      <div className="activity-report-totals">
        <div>
          <strong>{totals.tasksTouched || 0}</strong>
          <span>Tasks touched</span>
        </div>
        <div>
          <strong>{totals.completedTasks || 0}</strong>
          <span>Completed tasks</span>
        </div>
        <div>
          <strong>{totals.activeUsers || 0}</strong>
          <span>People active</span>
        </div>
        <div>
          <strong>{totals.projects || 0}</strong>
          <span>Projects</span>
        </div>
        <div>
          <strong>{totals.updates || 0}</strong>
          <span>Daily updates</span>
        </div>
        <div>
          <strong>{totals.blockers || 0}</strong>
          <span>Blockers raised</span>
        </div>
      </div>
      <div className="activity-report-grid">
        <section className="panel report-evidence-panel">
          <div className="section-head">
            <div>
              <h2>Activity events</h2>
              <p>
                {report?.scope || 'Everyone'} · {period} breakdown
              </p>
            </div>
            <ExportMenu
              dataset="activity-log"
              title={`${report?.scope || 'Everyone'} ${period} activity log`}
              scope={{ period, userId: seesEveryone ? scope : 'all' }}
              rowsHint={report?.rowsTotal}
            />
          </div>
          <div className="evidence-list">
            {rows.slice(0, visible).map(row => (
              <button
                type="button"
                className={`evidence-row ${selectedRow?.id === row.id ? 'selected' : ''}`}
                key={row.id}
                onClick={() => setSelectedRow(row)}
              >
                <div className="evidence-date">
                  <strong>{row.date}</strong>
                  <span>{row.time}</span>
                </div>
                <div className="evidence-main">
                  <div>
                    <Avatar name={row.person} small />
                    <strong>{row.person}</strong>
                    {row.role && <small className="muted-text">{row.role}</small>}
                  </div>
                  <p>
                    {row.taskId ? `${row.taskId} · ` : ''}
                    {row.task}
                  </p>
                  <small>
                    {row.project} · {row.action} · {row.status}
                  </small>
                </div>
                <span className="effort-chip">{row.derived ? 'from task record' : row.source}</span>
              </button>
            ))}
            {!rows.length && !loading && (
              <EmptyState title="No activity in this period" message="Try another timeframe or choose everyone." />
            )}
          </div>
          {rows.length > visible && (
            <button type="button" className="text-button show-more" onClick={() => setVisible(v => v + 25)}>
              {tr(settings, 'Show {count} more ({remaining} left)', { count: 25, remaining: rows.length - visible })}
            </button>
          )}
          {report?.rowsTruncated && (
            <p className="filter-hint">
              {tr(
                settings,
                'Showing the newest {shown} of {total} events. The summaries above count all of them; pick a person or a shorter timeframe to see the rest.',
                { shown: rows.length, total: report.rowsTotal }
              )}
            </p>
          )}
          {selectedRow && (
            <div className="report-drilldown">
              <div>
                <strong>{selectedRow.task}</strong>
                <span>
                  {selectedRow.summary || 'No additional details'} · {selectedRow.project}
                </span>
              </div>
              <button type="button" className="text-button" onClick={() => setSelectedRow(null)}>
                Clear
              </button>
            </div>
          )}
        </section>
        <aside className="panel report-score user-summary-panel">
          <div className="section-head">
            <div>
              <h2>People summary</h2>
              <p>Aggregated by selected timeframe</p>
            </div>
            <ExportMenu
              dataset="activity-summary"
              title={`${report?.scope || 'Everyone'} ${period} summary`}
              scope={{ period, userId: seesEveryone ? scope : 'all' }}
              primary={false}
              rowsHint={report?.users?.length}
            />
          </div>
          <div className="user-summary-list">
            {(report?.users || []).map(person => (
              <div className="user-summary-row" key={person.personId}>
                <div>
                  <Avatar name={person.person} small />
                  <strong>{person.person}</strong>
                </div>
                <span>
                  {person.completedTasks}/{person.tasksTouched} tasks
                </span>
                <span>{person.projects} projects</span>
                <span>{person.events} events</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
      <section className="panel project-table activity-project-panel">
        <div className="section-head">
          <div>
            <h2>Project contribution</h2>
            <p>Tasks completed per project, relative to the busiest project.</p>
          </div>
          <ExportMenu
            dataset="activity-projects"
            title={`${period} project contribution`}
            scope={{ period, userId: seesEveryone ? scope : 'all' }}
            primary={false}
            rowsHint={report?.projects?.length}
          />
        </div>
        <div className="project-contribution-grid">
          {(report?.projects || []).map(project => (
            <div key={project.project} className="project-contribution-card">
              <strong>{project.project}</strong>
              <span>{project.projectCode}</span>
              <ProgressBar value={(project.completedTasks / maxCompleted) * 100} color="purple" />
              <p>
                {tr(settings, '{completed} completed · {touched} touched · {people} people · {events} events', {
                  completed: project.completedTasks,
                  touched: project.tasksTouched,
                  people: project.users,
                  events: project.events
                })}
              </p>
            </div>
          ))}
        </div>
      </section>
    </section>
  )
}
