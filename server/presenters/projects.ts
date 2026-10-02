// Project as the browser sees it. Progress, health and members come from per-project task counts that SQL computes in one
// pass (ProjectStats), not from scanning tasks here.
import { formatDate } from '../domain/time'
import type { Milestone, Person, Project } from '../domain/types'
import type { ProjectStats } from '../repositories/projects'
import { daysBetween, isIsoDate } from '../util'
import type { ReferenceIndex } from './reference-index'

const EMPTY_STATS: ProjectStats = { total: 0, done: 0, open: 0, overdue: 0, blocked: 0 }

export const projectProgress = (stats: ProjectStats = EMPTY_STATS): number =>
  stats.total ? Math.round((stats.done / stats.total) * 100) : 0

export function projectHealth(project: Pick<Project, 'status'>, stats: ProjectStats = EMPTY_STATS): string {
  if (project.status === 'Completed') return 'Completed'
  if (project.status === 'At risk') return 'At risk'
  return stats.overdue > 0 ? 'At risk' : 'On track'
}

export function projectPublic(
  ref: ReferenceIndex,
  project: Project,
  milestones: Milestone[],
  stats: ProjectStats = EMPTY_STATS,
  assigneeIds: string[] = []
) {
  const team = ref.teams.get(project.teamId)
  const owner = ref.people.get(project.ownerId)
  const memberIds = [...new Set(assigneeIds.concat(project.ownerId).filter(Boolean))]
  const members = memberIds.map(personId => ref.people.get(personId)).filter((p): p is Person => Boolean(p))
  const diff = project.deadline && isIsoDate(project.deadline) ? daysBetween(ref.today, project.deadline) : null
  return {
    id: `project-${project.id}`,
    numericId: project.id,
    name: project.name,
    code: project.code,
    description: project.description,
    teamId: project.teamId,
    team: team?.name || 'Workspace',
    ownerId: project.ownerId,
    owner: owner?.name || 'Unassigned',
    color: project.color || team?.color || 'purple',
    status: project.status,
    health: projectHealth(project, stats),
    progress: projectProgress(stats),
    deadlineDate: project.deadline,
    deadline: formatDate(ref.settings, project.deadline),
    deadlineDays: diff,
    days: diff == null ? 'No date' : diff < 0 ? `${Math.abs(diff)} days late` : `${diff} days`,
    members: members.map(person => person.name),
    memberColors: Object.fromEntries(members.map(person => [person.name, person.color])),
    milestoneRows: milestones.map(milestone => ({ ...milestone, projectId: project.id })),
    customFields: project.customFields || {}
  }
}
export type ProjectPublic = ReturnType<typeof projectPublic>
