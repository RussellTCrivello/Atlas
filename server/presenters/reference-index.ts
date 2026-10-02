// The small reference tables (settings, teams, people, projects) loaded once per request, so that turning ids into names
// is a map lookup. Tasks are deliberately not in here: they are the table that grows, and are always queried, never loaded whole.
import { workspaceTimezone, todayIn } from '../domain/time'
import type { Person, Project, Team } from '../domain/types'

export interface ReferenceIndex {
  settings: any
  today: string
  tz: string
  people: Map<string, Person>
  teams: Map<string, Team>
  projects: Map<string, Project>
  peopleByTeam: Map<string, number>
}

export function makeReferenceIndex(
  data: { settings: any; teams: Team[]; people: Person[]; projects: Project[] },
  now = new Date()
): ReferenceIndex {
  const peopleByTeam = new Map<string, number>()
  for (const person of data.people)
    if (person.teamId) peopleByTeam.set(person.teamId, (peopleByTeam.get(person.teamId) || 0) + 1)
  return {
    settings: data.settings,
    today: todayIn(data.settings, now),
    tz: workspaceTimezone(data.settings),
    people: new Map(data.people.map(person => [person.id, person])),
    teams: new Map(data.teams.map(team => [team.id, team])),
    projects: new Map(data.projects.map(project => [String(project.id), project])),
    peopleByTeam
  }
}
