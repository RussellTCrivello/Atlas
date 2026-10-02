// Server-side sessions. The cookie carries a 256-bit random token; only its SHA-256 is stored, so a copy of the database
// cannot be replayed as a session. Rows are written immediately (create, revoke); `last_seen_at` is refreshed at most
// once a minute so that reading data never causes a write per request.
import { type Database } from './base'

export interface SessionRow {
  hash: string
  userId: string
  createdAt: number
  lastSeenAt: number
}

export class SessionRepository {
  constructor(private db: Database) {}

  insert(hash: string, userId: string, now: number) {
    this.db.run('INSERT INTO sessions(token_hash, user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?)', [
      hash,
      userId,
      now,
      now
    ])
  }

  find(hash: string): SessionRow | undefined {
    const row = this.db.get('SELECT token_hash, user_id, created_at, last_seen_at FROM sessions WHERE token_hash = ?', [
      hash
    ])
    return (
      row && {
        hash: row.token_hash,
        userId: row.user_id,
        createdAt: Number(row.created_at),
        lastSeenAt: Number(row.last_seen_at)
      }
    )
  }

  touch(hash: string, now: number) {
    this.db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', [now, hash])
  }

  delete(hash: string): boolean {
    return this.db.run('DELETE FROM sessions WHERE token_hash = ?', [hash]).changes > 0
  }

  /** Sign a user out everywhere, optionally keeping one session (the one making the request). */
  deleteForUser(userId: string, exceptHash?: string): number {
    return this.db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash IS NOT ?', [userId, exceptHash ?? null])
      .changes
  }

  /** Keep only the newest `keep` sessions of a user. */
  trimUser(userId: string, keep: number) {
    this.db.run(
      'DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)',
      [userId, userId, keep]
    )
  }

  deleteOlderThan(createdBefore: number): number {
    return this.db.run('DELETE FROM sessions WHERE created_at < ?', [createdBefore]).changes
  }

  count(): number {
    return Number(this.db.scalar('SELECT count(*) FROM sessions'))
  }
}
