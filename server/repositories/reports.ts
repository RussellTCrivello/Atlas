// Report figures computed by SQL. Bucketing (day / week / month / quarter / year) is done in the query, so a report
// over 100,000 tasks and a million ledger rows is a handful of GROUP BY scans, not a loop over every record.
import { type Database, marks } from './base'
import type { SqlValue } from '../db/driver'

const WEEK_START: Record<string, number> = { sunday: 0, monday: 1, saturday: 6 }

/** SQL for "which bucket does this date column fall in", matching domain/report-windows.ts `bucketFor`. */
export function bucketSql(period: string, column: string, weekStartsOn: string): string {
  const start = WEEK_START[weekStartsOn] ?? 1
  switch (period) {
    case 'daily':
      return column
    case 'weekly':
      return `date(${column}, '-' || ((CAST(strftime('%w', ${column}) AS INTEGER) - ${start} + 7) % 7) || ' days')`
    case 'monthly':
      return `substr(${column}, 1, 7)`
    case 'quarterly':
      return `(substr(${column}, 1, 4) || '-Q' || ((CAST(substr(${column}, 6, 2) AS INTEGER) - 1) / 3 + 1))`
    default:
      return `substr(${column}, 1, 4)`
  }
}

export interface SeriesCounts {
  created: Map<string, number>
  completed: Map<string, number>
  activities: Map<string, number>
  planned: Map<string, number>
  delivered: Map<string, number>
}

export class ReportRepository {
  constructor(private db: Database) {}

  /**
   * Counts per bucket from the ledger (created, completed, daily updates) and from task due dates (planned, delivered).
   * `from` is the first day of the first bucket; rows outside the requested buckets are ignored by the caller.
   */
  series(period: string, weekStartsOn: string, from: string, today: string, terminal: string[]): SeriesCounts {
    const logBucket = bucketSql(period, 'date', weekStartsOn)
    const dueBucket = bucketSql(period, 'due_date', weekStartsOn)
    const grouped = (sql: string, params: SqlValue[]) =>
      new Map(this.db.all<{ b: string; n: number }>(sql, params).map(row => [String(row.b), Number(row.n)]))
    const inList = marks(terminal.length)
    return {
      created: grouped(
        `SELECT ${logBucket} AS b, count(DISTINCT task_id) AS n FROM work_logs
         WHERE task_id IS NOT NULL AND date >= ? AND action = 'Created task' GROUP BY b`,
        [from]
      ),
      completed: grouped(
        `SELECT ${logBucket} AS b, count(DISTINCT task_id) AS n FROM work_logs
         WHERE task_id IS NOT NULL AND date >= ? AND action != 'Created task'
           AND (action = 'Completed task' OR (status_to != '' AND status_to IN (${inList}) AND status_from NOT IN (${inList})))
         GROUP BY b`,
        [from, ...terminal, ...terminal]
      ),
      activities: grouped(
        `SELECT ${logBucket} AS b, count(*) AS n FROM work_logs WHERE date >= ? AND source = 'Activity log' GROUP BY b`,
        [from]
      ),
      planned: grouped(
        `SELECT ${dueBucket} AS b, count(*) AS n FROM tasks
         WHERE due_date IS NOT NULL AND due_date >= ? AND due_date <= ? GROUP BY b`,
        [from, today]
      ),
      delivered: grouped(
        `SELECT ${dueBucket} AS b, count(*) AS n FROM tasks
         WHERE due_date IS NOT NULL AND due_date >= ? AND due_date <= ?
           AND status IN (${inList}) AND completed_at IS NOT NULL AND completed_at <= due_date GROUP BY b`,
        [from, today, ...terminal]
      )
    }
  }

  projectTotals(): { active: number; completed: number } {
    const row = this.db.get(
      "SELECT coalesce(sum(CASE WHEN status != 'Completed' THEN 1 ELSE 0 END), 0) AS active, coalesce(sum(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) AS completed FROM projects"
    )!
    return { active: Number(row.active), completed: Number(row.completed) }
  }
}
