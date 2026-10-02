// Test helpers that look at the database directly, to check what was really stored rather than what an API said.
import fs from 'node:fs'
import path from 'node:path'
import { Database, type Row } from '../../server/db/driver'
import { listBackupsIn } from '../../server/db/backup'
import type { TestServer } from './server'

export const dbFile = (server: { dataDir: string }) => path.join(server.dataDir, 'atlas.db')
export const listBackups = (server: { dataDir: string }) => listBackupsIn(server.dataDir)
export const settingsOf = (server: TestServer): any => server.container.ctx.settings

/** Ledger rows for one task, oldest first. */
export const ledgerFor = (server: TestServer, taskId: number) =>
  server.db.all('SELECT * FROM work_logs WHERE task_id = ? ORDER BY rowid', [taskId])

/** Audit rows (optionally for one action), oldest first, with `detail` parsed. */
export const auditRows = (server: TestServer, action?: string) =>
  server.db
    .all(
      action ? 'SELECT * FROM audit_log WHERE action = ? ORDER BY seq' : 'SELECT * FROM audit_log ORDER BY seq',
      action ? [action] : []
    )
    .map(row => ({ ...row, detail: JSON.parse(row.detail) }) as Row & { detail: Record<string, any> })

/** Insert daily-update rows straight into the table (fixtures that the API would stamp with today's date). */
export function insertActivities(server: TestServer, rows: { personId: string; date: string; text: string }[]) {
  server.db.transaction(() => {
    rows.forEach((row, index) =>
      server.db.run(
        "INSERT INTO activities(id, person_id, date, time, today, status) VALUES (?, ?, ?, '09:00', ?, 'On track')",
        [`activity_fixture_${Date.now().toString(36)}_${index}`, row.personId, row.date, row.text]
      )
    )
  })
}

/** Open the data directory's database on a separate connection (the server must not be using it for writes). */
export function openDirect(dataDir: string, readOnly = false) {
  return new Database(path.join(dataDir, 'atlas.db'), { readOnly })
}

export const fileSize = (file: string) => (fs.existsSync(file) ? fs.statSync(file).size : 0)
