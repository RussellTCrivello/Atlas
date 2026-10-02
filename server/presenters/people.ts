import type { Person, Team } from '../domain/types'
import type { ReferenceIndex } from './reference-index'

export function personPublic(ref: ReferenceIndex, person: Person) {
  const team = ref.teams.get(person.teamId)
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    jobTitle: person.jobTitle,
    role: person.jobTitle,
    teamId: person.teamId,
    team: team?.name || 'Workspace',
    focus: person.focus,
    capacity: person.capacity,
    load: person.capacity,
    status: person.status,
    color: person.color || team?.color || 'purple',
    customFields: person.customFields || {}
  }
}

export const teamPublic = (ref: Pick<ReferenceIndex, 'peopleByTeam'>, team: Team) => ({
  ...team,
  peopleCount: ref.peopleByTeam.get(team.id) || 0
})
