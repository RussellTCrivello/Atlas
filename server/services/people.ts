// People and teams: the directory of who works here and which team they belong to.
import type { AuditContext } from '../domain/audit-chain'
import { id } from '../util'
import type { Person, Team } from '../domain/types'
import { personPublic, teamPublic } from '../presenters/people'
import type { PersonCreateInput, PersonUpdateInput, TeamCreateInput, TeamUpdateInput } from '../validation/schemas'
import { badRequest, notFound } from '../util'
import type { AuditService } from './audit'
import type { ServiceContext } from './context'

export class PeopleService {
  constructor(
    private ctx: ServiceContext,
    private audit: AuditService
  ) {}

  private findPerson(rawId: string): Person {
    const person = this.ctx.repos.people.byId(rawId)
    if (!person) throw notFound('Person not found')
    return person
  }
  private findTeam(rawId: string): Team {
    const team = this.ctx.repos.teams.byId(rawId)
    if (!team) throw notFound('Team not found')
    return team
  }

  // ---- people ------------------------------------------------------------------------------------------------------
  createPerson(body: PersonCreateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const teamId = body.teamId || repos.teams.list()[0]?.id || ''
      if (teamId) this.ctx.requireTeam(teamId)
      const person: Person = {
        id: id('person'),
        name: body.name,
        email: body.email || '',
        jobTitle: body.jobTitle || 'Contributor',
        teamId,
        focus: body.focus || 'Workspace priorities',
        capacity: body.capacity ?? 70,
        status: body.status || 'On track',
        color: body.color || 'purple',
        customFields: body.customFields || {},
        sample: false
      }
      repos.people.insert(person)
      this.audit.record('person.created', who, { personId: person.id })
      return personPublic(this.ctx.reference(), person)
    })
  }

  updatePerson(rawId: string, body: PersonUpdateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const current = this.findPerson(rawId)
      if (body.teamId) this.ctx.requireTeam(body.teamId)
      repos.people.update(current.id, body)
      this.audit.record('person.updated', who, { personId: current.id })
      return personPublic(this.ctx.reference(), repos.people.byId(current.id)!)
    })
  }

  deletePerson(rawId: string, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const person = this.findPerson(rawId)
      if (repos.users.hasAccountForPerson(person.id))
        throw badRequest('Cannot delete a person who has a sign-in account. Delete or re-link the account first.')
      // Their tasks become unassigned and their projects ownerless through the foreign keys; the counts go in the audit trail.
      const impact = repos.people.deletionImpact(person.id)
      repos.people.delete(person.id)
      this.audit.record('person.deleted', who, {
        personId: person.id,
        unassignedTasks: impact.tasks,
        projectsWithoutOwner: impact.projects
      })
      return { ok: true, unassignedTasks: impact.tasks, projectsWithoutOwner: impact.projects }
    })
  }

  // ---- teams -------------------------------------------------------------------------------------------------------
  createTeam(body: TeamCreateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const team: Team = {
        id: id('team'),
        name: body.name,
        color: body.color || 'purple',
        customFields: body.customFields || {},
        sample: false
      }
      this.ctx.repos.teams.insert(team)
      this.audit.record('team.created', who, { teamId: team.id })
      return team
    })
  }

  updateTeam(rawId: string, body: TeamUpdateInput, who: AuditContext) {
    return this.ctx.transaction(() => {
      const { repos } = this.ctx
      const team = this.findTeam(rawId)
      repos.teams.update(team.id, body)
      this.audit.record('team.updated', who, { teamId: team.id })
      return repos.teams.byId(team.id)!
    })
  }

  deleteTeam(rawId: string, who: AuditContext) {
    this.ctx.transaction(() => {
      const { repos } = this.ctx
      const team = this.findTeam(rawId)
      if (repos.teams.hasPeople(team.id)) throw badRequest('Move people before deleting this team')
      if (repos.teams.hasProjects(team.id)) throw badRequest('Move projects to another team before deleting this team')
      repos.teams.delete(team.id)
      this.audit.record('team.deleted', who, { teamId: team.id })
    })
  }

  /** Teams with their head counts, for the browser's directory. */
  teamsPublic(ref = this.ctx.reference()) {
    return this.ctx.repos.teams.list().map(team => teamPublic(ref, team))
  }
}
