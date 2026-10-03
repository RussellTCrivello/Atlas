// The read model for exports and printing: rows come from the v_* views (names already joined by SQL), so a report reads the
// database's own fields. Only reads; nothing here can change data.
import { type Database, type Row, marks } from './base'

export class ExportRepository {
  constructor(private db: Database) {}

  projects(): Row[] {
    return this.db.all('SELECT * FROM v_project_rows ORDER BY id')
  }
  milestones(projectId?: number): Row[] {
    return projectId === undefined
      ? this.db.all('SELECT * FROM v_milestone_rows ORDER BY (due_date IS NULL), due_date, project_id, id')
      : this.db.all('SELECT * FROM v_milestone_rows WHERE project_id = ? ORDER BY (due_date IS NULL), due_date, id', [
          projectId
        ])
  }
  people(): Row[] {
    return this.db.all('SELECT * FROM v_person_rows ORDER BY seq')
  }
  alerts(projectId?: number): Row[] {
    return projectId === undefined
      ? this.db.all('SELECT * FROM v_alert_rows ORDER BY resolved, created_at DESC, id')
      : this.db.all('SELECT * FROM v_alert_rows WHERE project_id = ? ORDER BY resolved, created_at DESC, id', [
          projectId
        ])
  }
  activities(): Row[] {
    return this.db.all('SELECT * FROM v_activity_rows ORDER BY date DESC, time DESC, id')
  }
  users(): Row[] {
    return this.db.all('SELECT * FROM v_user_rows ORDER BY seq')
  }
  /** Newest first, capped. */
  audit(limit: number): Row[] {
    return this.db.all('SELECT * FROM v_audit_rows ORDER BY seq DESC LIMIT ?', [limit])
  }
  /** Tasks that are not finished, per assignee (the people sheet's workload column). */
  openTasksByPerson(terminal: string[]): Map<string, number> {
    return new Map(
      this.db
        .all<{ assignee_id: string; n: number }>(
          `SELECT assignee_id, count(*) AS n FROM tasks WHERE assignee_id IS NOT NULL AND status NOT IN (${marks(terminal.length)}) GROUP BY assignee_id`,
          terminal
        )
        .map(row => [row.assignee_id, Number(row.n)])
    )
  }
}
