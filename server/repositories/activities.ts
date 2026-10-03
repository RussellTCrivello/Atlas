// Daily updates ("yesterday / today / blocked / upcoming" posted by a person).
import type { Activity } from '../domain/types'
import { type Database, type Row, isOne, nullable, orEmpty, parseFields, stringifyFields } from './base'

const toActivity = (row: Row): Activity => ({
  id: row.id,
  personId: orEmpty(row.person_id),
  date: row.date,
  time: row.time,
  yesterday: row.yesterday,
  today: row.today,
  blocked: row.blocked,
  upcoming: row.upcoming,
  status: row.status,
  customFields: parseFields(row.custom_fields),
  sample: isOne(row.sample)
})

export class ActivityRepository {
  constructor(private db: Database) {}
  /** Newest first, capped (the activity page pages through older ones). */
  recent(limit: number, offset = 0): Activity[] {
    return this.db
      .all('SELECT * FROM activities ORDER BY date DESC, time DESC, rowid DESC LIMIT ? OFFSET ?', [limit, offset])
      .map(toActivity)
  }
  count(): number {
    return Number(this.db.scalar('SELECT count(*) FROM activities'))
  }
  onDate(date: string): Activity[] {
    return this.db.all('SELECT * FROM activities WHERE date = ? ORDER BY rowid', [date]).map(toActivity)
  }
  /** Updates posted per person from `from` (inclusive) up to `until` (exclusive). */
  countsByPersonBetween(from: string, until: string): { personId: string; updates: number }[] {
    return this.db
      .all<{ person_id: string; n: number }>(
        'SELECT person_id, count(*) AS n FROM activities WHERE date >= ? AND date < ? AND person_id IS NOT NULL GROUP BY person_id',
        [from, until]
      )
      .map(row => ({ personId: row.person_id, updates: Number(row.n) }))
  }
  byId(id: string): Activity | undefined {
    const row = this.db.get('SELECT * FROM activities WHERE id = ?', [id])
    return row && toActivity(row)
  }
  insert(activity: Activity) {
    this.db.run(
      'INSERT INTO activities(id, person_id, date, time, yesterday, today, blocked, upcoming, status, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        activity.id,
        nullable(activity.personId),
        activity.date,
        activity.time,
        activity.yesterday,
        activity.today,
        activity.blocked,
        activity.upcoming,
        activity.status,
        stringifyFields(activity.customFields),
        Boolean(activity.sample)
      ]
    )
  }
  delete(id: string) {
    this.db.run('DELETE FROM activities WHERE id = ?', [id])
  }
  deleteSamples() {
    this.db.run('DELETE FROM activities WHERE sample = 1')
  }
}
