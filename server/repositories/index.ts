// All repositories for one open database, created together. Services receive this and never see SQL.
import type { Database } from '../db/driver'
import { ActivityRepository } from './activities'
import { AlertRepository } from './alerts'
import { AuditRepository } from './audit'
import { ExportRepository } from './exports'
import { LedgerRepository } from './ledger'
import { MetaRepository } from './meta'
import { MilestoneRepository } from './milestones'
import { PersonRepository, TeamRepository } from './people'
import { ProjectRepository } from './projects'
import { ReportRepository } from './reports'
import { SearchRepository } from './search'
import { SessionRepository } from './sessions'
import { SettingsRepository } from './settings'
import { SnapshotRepository } from './snapshot'
import { SystemRepository } from './system'
import { TaskRepository } from './tasks'
import { UserRepository } from './users'

export function createRepositories(db: Database, defaults: { defaultTimezone: string }) {
  const settings = new SettingsRepository(db)
  return {
    meta: new MetaRepository(db),
    settings,
    snapshot: new SnapshotRepository(db, settings, defaults),
    users: new UserRepository(db),
    sessions: new SessionRepository(db),
    teams: new TeamRepository(db),
    people: new PersonRepository(db),
    projects: new ProjectRepository(db),
    tasks: new TaskRepository(db),
    milestones: new MilestoneRepository(db),
    activities: new ActivityRepository(db),
    alerts: new AlertRepository(db),
    ledger: new LedgerRepository(db),
    audit: new AuditRepository(db),
    reports: new ReportRepository(db),
    search: new SearchRepository(db),
    system: new SystemRepository(db),
    exports: new ExportRepository(db)
  }
}
export type Repositories = ReturnType<typeof createRepositories>
