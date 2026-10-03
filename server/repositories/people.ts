// Teams and people (the directory). Accounts that can sign in live in users.ts and link to a person profile.
import type { Person, Team } from '../domain/types'
import { type Database, type Row, isOne, nullable, orEmpty, parseFields, stringifyFields, updatePlan } from './base'

const toTeam = (row: Row): Team => ({
  id: row.id,
  name: row.name,
  color: row.color,
  customFields: parseFields(row.custom_fields),
  sample: isOne(row.sample)
})

const toPerson = (row: Row): Person => ({
  id: row.id,
  name: row.name,
  email: row.email,
  jobTitle: row.job_title,
  teamId: orEmpty(row.team_id),
  focus: row.focus,
  capacity: Number(row.capacity),
  status: row.status,
  color: row.color,
  customFields: parseFields(row.custom_fields),
  sample: isOne(row.sample)
})

const PERSON_COLUMNS = {
  name: 'name',
  email: 'email',
  jobTitle: 'job_title',
  teamId: 'team_id',
  focus: 'focus',
  capacity: 'capacity',
  status: 'status',
  color: 'color',
  customFields: 'custom_fields'
}
const TEAM_COLUMNS = { name: 'name', color: 'color', customFields: 'custom_fields' }

export class TeamRepository {
  constructor(private db: Database) {}
  list(): Team[] {
    return this.db.all('SELECT * FROM teams ORDER BY rowid').map(toTeam)
  }
  byId(id: string): Team | undefined {
    const row = this.db.get('SELECT * FROM teams WHERE id = ?', [id])
    return row && toTeam(row)
  }
  insert(team: Team) {
    this.db.run('INSERT INTO teams(id, name, color, custom_fields, sample) VALUES (?, ?, ?, ?, ?)', [
      team.id,
      team.name,
      team.color,
      stringifyFields(team.customFields),
      Boolean(team.sample)
    ])
  }
  update(id: string, patch: Partial<Team>) {
    const plan = updatePlan('teams', 'id', id, TEAM_COLUMNS, patch as Record<string, unknown>, {
      customFields: stringifyFields
    })
    if (plan) this.db.run(plan.sql, plan.params)
  }
  delete(id: string) {
    this.db.run('DELETE FROM teams WHERE id = ?', [id])
  }
  /** Delete demo teams that nobody real belongs to any more. */
  deleteUnusedSamples() {
    this.db.run(
      'DELETE FROM teams WHERE sample = 1 AND id NOT IN (SELECT team_id FROM people WHERE team_id IS NOT NULL)'
    )
  }
  peopleCounts(): Map<string, number> {
    return new Map(
      this.db
        .all<{ team_id: string; n: number }>(
          'SELECT team_id, count(*) AS n FROM people WHERE team_id IS NOT NULL GROUP BY team_id'
        )
        .map(row => [row.team_id, Number(row.n)])
    )
  }
  hasPeople(id: string): boolean {
    return Boolean(this.db.get('SELECT 1 FROM people WHERE team_id = ?', [id]))
  }
  hasProjects(id: string): boolean {
    return Boolean(this.db.get('SELECT 1 FROM projects WHERE team_id = ?', [id]))
  }
}

export class PersonRepository {
  constructor(private db: Database) {}
  list(): Person[] {
    return this.db.all('SELECT * FROM people ORDER BY rowid').map(toPerson)
  }
  byId(id: string): Person | undefined {
    const row = this.db.get('SELECT * FROM people WHERE id = ?', [id])
    return row && toPerson(row)
  }
  exists(id: string): boolean {
    return Boolean(this.db.get('SELECT 1 FROM people WHERE id = ?', [id]))
  }
  insert(person: Person) {
    this.db.run(
      'INSERT INTO people(id, name, email, job_title, team_id, focus, capacity, status, color, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        person.id,
        person.name,
        person.email,
        person.jobTitle,
        nullable(person.teamId),
        person.focus,
        person.capacity,
        person.status,
        person.color,
        stringifyFields(person.customFields),
        Boolean(person.sample)
      ]
    )
  }
  update(id: string, patch: Partial<Person>) {
    const plan = updatePlan('people', 'id', id, PERSON_COLUMNS, patch as Record<string, unknown>, {
      teamId: nullable,
      customFields: stringifyFields
    })
    if (plan) this.db.run(plan.sql, plan.params)
  }
  /** Deleting a person un-assigns their tasks and clears project ownership through the foreign keys; the counts are for the audit record. */
  deletionImpact(id: string): { tasks: number; projects: number } {
    return {
      tasks: Number(this.db.scalar('SELECT count(*) FROM tasks WHERE assignee_id = ?', [id])),
      projects: Number(this.db.scalar('SELECT count(*) FROM projects WHERE owner_id = ?', [id]))
    }
  }
  delete(id: string) {
    this.db.run('DELETE FROM people WHERE id = ?', [id])
  }
  /** Delete demo people who have no real account. */
  deleteSamplesWithoutAccount() {
    this.db.run(
      'DELETE FROM people WHERE sample = 1 AND id NOT IN (SELECT person_id FROM users WHERE person_id IS NOT NULL)'
    )
  }
}
