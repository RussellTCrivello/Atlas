// The overview page's figures, assembled from numbers SQL already computed. This module only decides how they read.
import { formatDate } from '../domain/time'
import type { Activity, Milestone } from '../domain/types'
import type { TaskCounts } from '../repositories/tasks'
import type { ProjectPublic } from './projects'
import type { ReferenceIndex } from './reference-index'
import type { TaskPublic } from './tasks'

export interface DashboardInput {
  ref: ReferenceIndex
  counts: TaskCounts
  mine: { count: number; first: TaskPublic[] }
  blockedOpen: TaskPublic[]
  projects: ProjectPublic[]
  openAlerts: number
  todayEntries: Activity[]
  yesterdayEntries: Activity[]
  upcomingMilestones: Milestone[]
  /** `null` hides the ranking from people who may only see their own activity (GOV-02). */
  mostActive: { personId: string; updates: number }[] | null
}

const pulse = (title: string, detail: string, time: string, icon: string) => ({
  title,
  detail: detail || 'No update',
  time: time || '',
  icon
})

export function buildDashboard(input: DashboardInput) {
  const { ref, counts, projects } = input
  const person = (personId: string) => ref.people.get(personId)?.name || 'Unknown'
  const activeProjects = projects.filter(project => project.health !== 'Completed').length
  const atRisk = projects.filter(project => project.health === 'At risk').length

  // "Yesterday": what people report having done. Prefer each person's entry logged today (its "yesterday" field); for
  // people who have not posted today, use the "today" plan from the entry they logged yesterday.
  const doneYesterday = new Map<string, ReturnType<typeof pulse>>()
  for (const entry of input.todayEntries)
    if (entry.yesterday)
      doneYesterday.set(entry.personId, pulse(person(entry.personId), entry.yesterday, entry.time, 'check'))
  for (const entry of input.yesterdayEntries)
    if (entry.today && !doneYesterday.has(entry.personId))
      doneYesterday.set(entry.personId, pulse(person(entry.personId), entry.today, entry.time, 'check'))

  const upcoming = input.upcomingMilestones.map(milestone =>
    pulse(
      milestone.name,
      ref.projects.get(String(milestone.projectId))?.name || 'Project',
      formatDate(ref.settings, milestone.dueDate),
      'calendar'
    )
  )

  const mostActive = input.mostActive
    ? input.mostActive
        .map(({ personId, updates }) => {
          const found = ref.people.get(personId)
          return { personId, name: found?.name || 'Unknown', color: found?.color || 'blue', updates }
        })
        .sort((a, b) => b.updates - a.updates || a.name.localeCompare(b.name))
        .slice(0, 4)
    : null

  return {
    stats: {
      activeProjects,
      openTasks: counts.open,
      myOpenTasks: input.mine.count,
      needsAttention: input.openAlerts,
      onTrack: activeProjects ? Math.round(((activeProjects - atRisk) / activeProjects) * 100) : 100,
      completedTasks: counts.done
    },
    dailyPulse: {
      yesterday: [...doneYesterday.values()].slice(0, 4),
      today: input.todayEntries
        .slice(0, 4)
        .map(entry => pulse(person(entry.personId), entry.today, entry.time, 'bolt')),
      blocked: input.todayEntries
        .filter(entry => entry.blocked)
        .map(entry => pulse(person(entry.personId), entry.blocked, entry.time, 'warning'))
        .concat(
          input.blockedOpen
            .slice(0, 3)
            .map(task => pulse(task.title, `${task.project} · ${task.assignee}`, task.due, 'warning'))
        ),
      upcoming
    },
    mostActive,
    myTasks: input.mine.first
  }
}
