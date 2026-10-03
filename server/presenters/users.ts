import { permissionsFor } from '../domain/permissions'
import type { SessionUser, User } from '../domain/types'
import type { ReferenceIndex } from './reference-index'

export function publicUser(settings: any, user: User): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    personId: user.personId,
    avatarColor: user.avatarColor,
    active: user.active !== false,
    mustChangePassword: Boolean(user.mustChangePassword),
    permissions: permissionsFor(settings, user.role)
  }
}

/** The account directory entry an administrator sees: roles and sign-in times, never the password hash. */
export function publicAccessUser(ref: ReferenceIndex, user: User) {
  const person = ref.people.get(user.personId)
  return {
    ...publicUser(ref.settings, user),
    personName: person?.name || user.name,
    team: (person && ref.teams.get(person.teamId)?.name) || 'Workspace',
    lastLoginAt: user.lastLoginAt || '',
    createdAt: user.createdAt || '',
    sample: Boolean(user.sample)
  }
}
