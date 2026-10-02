// Roles and permissions. Pure functions over the settings document: no I/O.
import { ROLE_PERMISSIONS } from '../../shared/settings'
import type { User } from './types'

const own = (object: any, key: string) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, key)

export function permissionsFor(settings: any, role: string = 'Viewer'): string[] {
  const registry = settings?.permissions?.roles
  if (own(registry, role) && Array.isArray(registry[role]?.permissions)) return registry[role].permissions
  // A role that no longer exists in the registry degrades to read-only rather than to nothing.
  return ROLE_PERMISSIONS.Viewer
}

export const can = (settings: any, user: Pick<User, 'role'> | null | undefined, permission: string): boolean =>
  Boolean(user) && permissionsFor(settings, user!.role).includes(permission)

/**
 * Per-person activity analytics (who logged what, rankings) are visible to people managers and administrators, or to
 * everyone when the workspace opted in under Settings > Reports. Everybody can always see their own activity (GOV-02).
 */
export const canSeePeopleAnalytics = (settings: any, user: Pick<User, 'role'> | null | undefined): boolean =>
  can(settings, user, 'managePeople') ||
  can(settings, user, 'manageSettings') ||
  settings?.reports?.activityVisibility === 'everyone'

export function roleRank(settings: any, role: string): number {
  const registry = settings?.permissions?.roles
  if (own(registry, role) && registry[role]?.rank) return Number(registry[role].rank)
  return ({ Viewer: 1, Developer: 2, Manager: 3, Administrator: 4 } as Record<string, number>)[role] || 1
}

export const roleExists = (settings: any, role: unknown): role is string =>
  typeof role === 'string' && own(settings?.permissions?.roles, role)

/** A user who can still administer the workspace: active, with both user and settings management. */
export function isAdministrator(settings: any, user: Pick<User, 'role' | 'active'>): boolean {
  if (user.active === false) return false
  const permissions = permissionsFor(settings, user.role)
  return permissions.includes('manageUsers') && permissions.includes('manageSettings')
}
