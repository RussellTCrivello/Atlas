// The overview page: headline numbers, daily pulse, project health, my tasks.
import { uiLanguage, tr } from '../../lib/i18n'
import { localDate, initials } from '../../lib/format'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { EmptyState, ProgressBar, StatCard, StatusPill } from '../../ui/primitives'
import { TaskRow } from './TaskRow'

export function Overview({ data, setPage }) {
  const { settings } = useApp()
  const language = uiLanguage(settings)
  const s = data.dashboard.stats || {}
  const pulse = data.dashboard.dailyPulse || {}
  const widgets = data.settings?.interface?.dashboardLayouts?.overview || [
    'stats',
    'dailyPulse',
    'projectHealth',
    'myFocus'
  ]
  const enabled = key => widgets.includes(key)
  return (
    <>
      <div className="welcome-row">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-dot" />{' '}
            {localDate(data.today, language, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          <h2>Today at a glance.</h2>
        </div>
        <button className="secondary-button" onClick={() => setPage('activity')}>
          <Icon name="activity" size={16} /> View activity
        </button>
      </div>
      {enabled('stats') && (
        <div className="stat-grid">
          <StatCard
            label="Active projects"
            value={s.activeProjects || 0}
            detail="not completed"
            icon="projects"
            color="purple"
            onClick={() => setPage('projects')}
          />
          <StatCard
            label="Open tasks"
            value={s.openTasks || 0}
            detail={tr(settings, '{count} assigned to you', { count: s.myOpenTasks || 0 })}
            icon="tasks"
            color="blue"
            onClick={() => setPage('tasks')}
          />
          <StatCard
            label="Needs attention"
            value={s.needsAttention || 0}
            detail="open alerts"
            icon="alerts"
            color="orange"
            onClick={() => setPage('alerts')}
          />
          <StatCard
            label="On track"
            value={`${s.onTrack || 0}%`}
            detail="healthy projects"
            icon="bolt"
            color="green"
            onClick={() => setPage('reports')}
          />
        </div>
      )}
      {enabled('dailyPulse') && (
        <>
          <div className="section-head dashboard-section-head">
            <div>
              <h2>Daily pulse</h2>
              <p>Updates, blockers, and next steps.</p>
            </div>
            <span className="date-select">
              <Icon name="calendar" size={15} /> Today
            </span>
          </div>
          <div className="daily-grid">
            <ActivityCard title="Yesterday" subtitle="From daily updates" tone="blue" items={pulse.yesterday || []} />
            <ActivityCard
              title="Today"
              subtitle={`${(pulse.today || []).length} focus items`}
              tone="purple"
              items={pulse.today || []}
            />
            <ActivityCard
              title="Blocked"
              subtitle={`${(pulse.blocked || []).length} blockers`}
              tone="orange"
              items={pulse.blocked || []}
            />
          </div>
        </>
      )}
      {(enabled('projectHealth') || enabled('myFocus')) && (
        <div className="split-section">
          {enabled('projectHealth') && (
            <section className="panel project-panel">
              <div className="section-head">
                <div>
                  <h2>Project health</h2>
                  <p>Current plan.</p>
                </div>
                <button className="text-button" onClick={() => setPage('projects')}>
                  View all <Icon name="arrow" size={13} />
                </button>
              </div>
              <div className="project-list">
                {data.projects.slice(0, 4).map(project => (
                  <ProjectHealthRow project={project} key={project.numericId} />
                ))}
              </div>
            </section>
          )}
          {enabled('myFocus') && (
            <section className="panel focus-panel">
              <div className="section-head">
                <div>
                  <h2>My focus</h2>
                  <p>Next actions.</p>
                </div>
                <Icon name="spark" size={17} className="muted-icon" />
              </div>
              <div className="focus-list">
                {data.dashboard.myTasks?.slice(0, 5).map(task => (
                  <TaskRow task={task} key={task.numericId} compact />
                ))}
                {!data.dashboard.myTasks?.length && (
                  <div className="empty-mini">Nothing is assigned to you right now.</div>
                )}
              </div>
              <button className="full-width-button" onClick={() => setPage('tasks')}>
                Open my work <Icon name="arrow" size={13} />
              </button>
            </section>
          )}
        </div>
      )}
      {!widgets.length && (
        <EmptyState title="Dashboard is empty" message="Enable widgets from Settings → Appearance." />
      )}
    </>
  )
}

export function ActivityCard({ title, subtitle, items, tone }) {
  return (
    <section className={`activity-card activity-${tone}`}>
      <div className="section-head compact">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="activity-items">
        {items.map((item, i) => (
          <div className="activity-item" key={i}>
            <span className="activity-marker">
              <Icon name={item.icon || 'check'} size={13} />
            </span>
            <div className="activity-copy">
              <strong>{item.title}</strong>
              <p>{item.detail}</p>
            </div>
            <span className="activity-time">{item.time}</span>
          </div>
        ))}
      </div>
      {!items.length && <div className="empty-mini">Nothing here yet.</div>}
    </section>
  )
}

export function ProjectHealthRow({ project }) {
  const { settings } = useApp()
  return (
    <div className="project-health-row">
      <div className={`project-symbol symbol-${project.color}`}>{initials(project.name)}</div>
      <div className="project-health-main">
        <div className="project-row-title">
          <strong>{project.name}</strong>
          <StatusPill tone={project.health === 'At risk' ? 'at-risk' : 'on-track'}>{project.health}</StatusPill>
        </div>
        <ProgressBar value={project.progress} color={project.color} />
      </div>
      <div className="project-percent">{project.progress}%</div>
      <div className="project-deadline">
        <span>Deadline</span>
        <strong>
          {project.deadlineDate ? localDate(project.deadlineDate, uiLanguage(settings)) : project.deadline}
        </strong>
      </div>
    </div>
  )
}
