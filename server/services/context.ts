// What every service needs: configuration, the database connection and the repositories. Services never build SQL and
// never see HTTP; routes never see tables. This is the seam between them.
import type { AtlasConfig } from '../config'
import type { Database } from '../db/driver'
import type { Person, Project, Team, User } from '../domain/types'
import { type ReferenceIndex, makeReferenceIndex } from '../presenters/reference-index'
import type { Repositories } from '../repositories'
import { classifySqlError, isStorageFailure } from '../db/driver'
import { HttpError, badRequest, conflict, notFound } from '../util'

/** Who is acting and from where: attached to audit entries and ledger events. */
export interface RequestMeta {
  actorId?: string
  ip?: string
  userAgent?: string
}

export class ServiceContext {
  constructor(
    readonly config: AtlasConfig,
    readonly db: Database,
    readonly repos: Repositories
  ) {}

  /** The settings document (frozen: read it, never edit it; build a new one and save it). */
  get settings(): any {
    return this.repos.settings.get()
  }

  /** Run `fn` as one atomic unit: every change inside it is stored together or not at all. */
  transaction<T>(fn: () => T, options?: { revision?: boolean }): T {
    try {
      return this.db.transaction(fn, options)
    } catch (error) {
      throw translateDatabaseError(error)
    }
  }

  /** Teams, people and projects as lookup tables for one request (see presenters/reference-index.ts). */
  reference(now = new Date()): ReferenceIndex {
    return makeReferenceIndex(
      {
        settings: this.settings,
        teams: this.repos.teams.list(),
        people: this.repos.people.list(),
        projects: this.repos.projects.list()
      },
      now
    )
  }

  get revision(): number {
    return this.repos.meta.revision()
  }

  // ---- reference checks shared by several services --------------------------------------------------------------------
  requireProject(rawId: unknown): Project {
    const project = Number.isInteger(Number(rawId)) ? this.repos.projects.byId(Number(rawId)) : undefined
    if (!project) throw badRequest('The selected project does not exist')
    return project
  }
  requirePerson(personId: string, label = 'person'): Person {
    const person = this.repos.people.byId(personId)
    if (!person) throw badRequest(`The selected ${label} does not exist`)
    return person
  }
  requireTeam(teamId: string): Team {
    const team = this.repos.teams.byId(teamId)
    if (!team) throw badRequest('The selected team does not exist')
    return team
  }
}

/**
 * What a failed transaction means to the person who asked. A full or failing disk is a 503 ("nothing was changed"); a
 * value that must be unique and is not is a 409. Anything else is a bug and stays an internal error.
 */
export function translateDatabaseError(error: unknown): unknown {
  if (error instanceof HttpError) return error
  if (isStorageFailure(error)) {
    console.error(`Could not write to the database: ${(error as Error).message}`)
    return new HttpError(
      503,
      'Your change could not be saved to disk, so nothing was changed. Check free disk space and permissions, then try again.',
      'STORAGE_UNAVAILABLE'
    )
  }
  if (classifySqlError(error) === 'unique') return conflict('That value is already in use', 'DUPLICATE')
  return error
}

/** A numeric id taken from a URL: digits only, else NaN (which matches nothing). */
export const numericId = (value: unknown): number => (/^\d+$/.test(String(value)) ? Number(value) : Number.NaN)

export const actorOf = (user: User) => ({ id: user.id, personId: user.personId })

export { HttpError, badRequest, notFound }
