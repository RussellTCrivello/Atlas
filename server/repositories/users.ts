import type { User } from '../domain/types'
import { type Database, type Row, isOne, nullable, orEmpty, updatePlan } from './base'

const COLUMNS: Record<string, string> = {
  name: 'name',
  email: 'email',
  passwordHash: 'password_hash',
  role: 'role',
  personId: 'person_id',
  avatarColor: 'avatar_color',
  active: 'active',
  lastLoginAt: 'last_login_at',
  passwordChangedAt: 'password_changed_at',
  mustChangePassword: 'must_change_password'
}

const toUser = (row: Row): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  passwordHash: row.password_hash,
  role: row.role,
  personId: orEmpty(row.person_id),
  avatarColor: row.avatar_color,
  active: isOne(row.active),
  createdAt: row.created_at,
  lastLoginAt: row.last_login_at ?? undefined,
  passwordChangedAt: row.password_changed_at ?? undefined,
  mustChangePassword: isOne(row.must_change_password),
  sample: isOne(row.sample)
})

export class UserRepository {
  constructor(private db: Database) {}

  list(): User[] {
    return this.db.all('SELECT * FROM users ORDER BY rowid').map(toUser)
  }
  count(): number {
    return Number(this.db.scalar('SELECT count(*) FROM users'))
  }
  byId(id: string): User | undefined {
    const row = this.db.get('SELECT * FROM users WHERE id = ?', [id])
    return row && toUser(row)
  }
  byEmail(email: string): User | undefined {
    const row = this.db.get('SELECT * FROM users WHERE lower(trim(email)) = lower(trim(?))', [email])
    return row && toUser(row)
  }
  /** Is this email used by an account other than `exceptId`? */
  emailTaken(email: string, exceptId?: string): boolean {
    return Boolean(
      this.db.get('SELECT 1 FROM users WHERE lower(trim(email)) = lower(trim(?)) AND id IS NOT ?', [
        email,
        exceptId ?? null
      ])
    )
  }
  /** Is this person profile linked to an account other than `exceptId`? */
  personLinked(personId: string, exceptId?: string): boolean {
    return Boolean(this.db.get('SELECT 1 FROM users WHERE person_id = ? AND id IS NOT ?', [personId, exceptId ?? null]))
  }
  hasAccountForPerson(personId: string): boolean {
    return Boolean(this.db.get('SELECT 1 FROM users WHERE person_id = ?', [personId]))
  }

  insert(user: User) {
    this.db.run(
      'INSERT INTO users(id, name, email, password_hash, role, person_id, avatar_color, active, created_at, last_login_at, password_changed_at, must_change_password, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        user.id,
        user.name,
        user.email,
        user.passwordHash,
        user.role,
        nullable(user.personId),
        user.avatarColor,
        user.active !== false,
        user.createdAt,
        user.lastLoginAt ?? null,
        user.passwordChangedAt ?? null,
        Boolean(user.mustChangePassword),
        Boolean(user.sample)
      ]
    )
  }

  update(id: string, patch: Partial<User>) {
    const plan = updatePlan('users', 'id', id, COLUMNS, patch as Record<string, unknown>, {
      personId: nullable,
      active: Boolean,
      mustChangePassword: Boolean
    })
    if (plan) this.db.run(plan.sql, plan.params)
  }

  delete(id: string) {
    this.db.run('DELETE FROM users WHERE id = ?', [id])
  }

  /** Sample (demo) accounts, removed together with the demo data. */
  deleteSamples(): string[] {
    const ids = this.db.all<{ id: string }>('SELECT id FROM users WHERE sample = 1').map(row => row.id)
    this.db.run('DELETE FROM users WHERE sample = 1')
    return ids
  }
}
