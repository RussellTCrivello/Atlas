// The composition root: the one place where the pieces are wired together. Everything else receives what it needs; nothing
// reaches for a global. Layers, from the bottom: db -> repositories -> services -> http. Each layer imports only from the
// ones below it (tests/server/architecture.test.ts enforces this).
import type { AtlasConfig } from '../config'
import type { Database } from '../db/driver'
import { type Repositories, createRepositories } from '../repositories'
import { LoginThrottle } from '../security/throttle'
import { AuditService } from '../services/audit'
import { AuthService } from '../services/auth'
import { BackupService } from '../services/backups'
import { BootstrapService } from '../services/bootstrap'
import { ServiceContext } from '../services/context'
import { ExportService } from '../services/exports'
import { LocalizationService } from '../services/localization'
import { MaintenanceService } from '../services/maintenance'
import { PeopleService } from '../services/people'
import { PlanningService } from '../services/planning'
import { ProjectService } from '../services/projects'
import { ReportService } from '../services/reports'
import { SearchService } from '../services/search'
import { SessionService } from '../services/sessions'
import { SettingsService } from '../services/settings'
import { SystemService } from '../services/system'
import { TagService } from '../services/tags'
import { TaskBulkService } from '../services/task-bulk'
import { TaskImportService } from '../services/task-import'
import { TaskService } from '../services/tasks'
import { UserService } from '../services/users'
import { ViewService } from '../services/views'

export function createContainer(config: AtlasConfig, db: Database) {
  const repos: Repositories = createRepositories(db, config)
  const ctx = new ServiceContext(config, db, repos)
  const audit = new AuditService(ctx)
  const sessions = new SessionService(ctx)
  const backups = new BackupService(ctx)
  const tasks = new TaskService(ctx, audit)
  const projects = new ProjectService(ctx, audit, backups, tasks)
  const people = new PeopleService(ctx, audit)
  const reports = new ReportService(ctx)
  const throttle = new LoginThrottle()

  // A snapshot after writes (or the daily one) is the backup policy; it runs after the commit, never inside a transaction.
  db.onAfterWrite(() => backups.afterWrite())

  return {
    config,
    db,
    repos,
    ctx,
    audit,
    sessions,
    backups,
    throttle,
    tasks,
    taskBulk: new TaskBulkService(ctx, audit, tasks),
    taskImport: new TaskImportService(ctx, audit, tasks),
    tags: new TagService(ctx, audit),
    views: new ViewService(ctx, audit),
    projects,
    people,
    reports,
    planning: new PlanningService(ctx, audit),
    users: new UserService(ctx, audit, sessions),
    auth: new AuthService(ctx, audit, sessions, throttle),
    settings: new SettingsService(ctx, audit, backups),
    localization: new LocalizationService(ctx, audit),
    bootstrap: new BootstrapService(ctx, projects, people, reports),
    system: new SystemService(ctx, audit, backups, sessions),
    maintenance: new MaintenanceService(ctx, audit, backups, sessions),
    search: new SearchService(ctx),
    exports: new ExportService(ctx, audit, reports, projects)
  }
}

export type Container = ReturnType<typeof createContainer>
