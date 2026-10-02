// Load a whole workspace document (a Snapshot) into the database, replacing what is there. Used to import a legacy JSON
// store or backup, to load demo data, and to start an empty workspace. It runs in one transaction: either every row is
// stored or nothing changes.
//
// Old documents were validated only loosely, so a few of them hold rows SQL will not accept (a task whose project was
// deleted, two projects with one code, an impossible date). Rather than refuse the whole import or drop data, each
// such row is repaired in the least destructive way and listed in the report that is returned and stored in the audit
// trail. Nothing is repaired silently.
import { compactSettingsForStorage, normalizeSettings } from '../../shared/settings'
import { taskKey } from '../domain/keys'
import { todayIn } from '../domain/time'
import type { Snapshot } from '../domain/types'
import { workflowStates } from '../domain/workflow'
import { isIsoDate } from '../util'
import type { Database } from './driver'

export interface SnapshotReport {
  counts: Record<string, number>
  repairs: string[]
}

const WIPE_ORDER = [
  'work_logs',
  'alerts',
  'activities',
  'milestones',
  'tasks',
  'projects',
  'sessions',
  'users',
  'people',
  'teams'
] as const

const json = (value: unknown) =>
  JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? value : {})
const text = (value: unknown, fallback = '') => (value === undefined || value === null ? fallback : String(value))
const flag = (value: unknown) => (value ? 1 : 0)
/** A reference stored as a number, or null: old documents sometimes held '' or a numeric string where a task or project id belongs. */
const intOrNull = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null
  const number = Number(value)
  return Number.isInteger(number) ? number : null
}

/** Replace every record in the database with the contents of `snapshot`. */
export function writeSnapshot(db: Database, snapshot: Snapshot, config: { defaultTimezone: string }): SnapshotReport {
  return db.transaction(() => {
    const repairs: string[] = []
    const repair = (message: string) => {
      if (repairs.length < 200) repairs.push(message)
      else if (repairs.length === 200) repairs.push('… further repairs are not listed')
    }
    const settings = compactSettingsForStorage(
      normalizeSettings(snapshot.settings || {}, { timezone: config.defaultTimezone })
    )
    const today = todayIn(settings)
    const date = (value: unknown, label: string): string | null => {
      if (value === undefined || value === null || value === '') return null
      if (typeof value === 'string' && isIsoDate(value)) return value
      repair(`${label}: "${String(value).slice(0, 30)}" is not a valid date; stored as no date`)
      return null
    }

    // ---- wipe -----------------------------------------------------------------------------------------------------
    for (const table of WIPE_ORDER) db.run(`DELETE FROM ${table}`)
    db.run('UPDATE audit_maintenance SET enabled = 1 WHERE id = 1')
    db.run('DELETE FROM audit_log')
    db.run('UPDATE audit_maintenance SET enabled = 0 WHERE id = 1')
    db.run("DELETE FROM sqlite_sequence WHERE name IN ('projects', 'tasks', 'audit_log')")

    // ---- reference data -------------------------------------------------------------------------------------------
    const teamIds = new Set<string>()
    for (const team of snapshot.teams || []) {
      if (!team?.id || teamIds.has(team.id)) {
        repair(`Team "${text(team?.name)}" had a missing or duplicate id and was skipped`)
        continue
      }
      teamIds.add(team.id)
      db.run('INSERT INTO teams(id, name, color, custom_fields, sample) VALUES (?, ?, ?, ?, ?)', [
        team.id,
        text(team.name, 'Team') || 'Team',
        text(team.color, 'purple'),
        json(team.customFields),
        flag(team.sample)
      ])
    }

    const personIds = new Set<string>()
    for (const person of snapshot.people || []) {
      if (!person?.id || personIds.has(person.id)) {
        repair(`Person "${text(person?.name)}" had a missing or duplicate id and was skipped`)
        continue
      }
      personIds.add(person.id)
      let teamId: string | null = person.teamId || null
      if (teamId && !teamIds.has(teamId)) {
        repair(`Person "${person.name}" pointed to a team that does not exist; the team was cleared`)
        teamId = null
      }
      const capacity = Math.min(100, Math.max(0, Math.round(Number(person.capacity ?? 70)) || 0))
      db.run(
        'INSERT INTO people(id, name, email, job_title, team_id, focus, capacity, status, color, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          person.id,
          text(person.name, 'Unnamed') || 'Unnamed',
          text(person.email),
          text(person.jobTitle),
          teamId,
          text(person.focus),
          capacity,
          text(person.status, 'On track'),
          text(person.color, 'purple'),
          json(person.customFields),
          flag(person.sample)
        ]
      )
    }

    const emails = new Set<string>()
    const linkedPeople = new Set<string>()
    for (const user of snapshot.users || []) {
      const email = text(user?.email).trim()
      if (!user?.id || !email || emails.has(email.toLowerCase())) {
        repair(`Account "${email || user?.id}" had a missing or duplicate email/id and was skipped`)
        continue
      }
      emails.add(email.toLowerCase())
      let personId: string | null = user.personId || null
      if (personId && (!personIds.has(personId) || linkedPeople.has(personId))) {
        repair(`Account ${email} shared or lacked a person profile; the link was cleared`)
        personId = null
      }
      if (personId) linkedPeople.add(personId)
      db.run(
        'INSERT INTO users(id, name, email, password_hash, role, person_id, avatar_color, active, created_at, last_login_at, password_changed_at, must_change_password, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          user.id,
          text(user.name, email) || email,
          email,
          text(user.passwordHash),
          text(user.role, 'Viewer'),
          personId,
          text(user.avatarColor, 'purple'),
          user.active === false ? 0 : 1,
          text(user.createdAt, new Date().toISOString()),
          user.lastLoginAt || null,
          user.passwordChangedAt || null,
          flag(user.mustChangePassword),
          flag(user.sample)
        ]
      )
    }

    // ---- projects & tasks -----------------------------------------------------------------------------------------
    const codes = new Set<string>()
    const projectIds = new Set<number>()
    const usedCodeFor = (wanted: string, label: string) => {
      let code = wanted || 'PRJ'
      for (let n = 2; codes.has(code.toUpperCase()); n++) code = `${wanted || 'PRJ'}-${n}`
      if (code !== wanted) repair(`Project "${label}" shared the code ${wanted}; it is now ${code}`)
      codes.add(code.toUpperCase())
      return code
    }
    const insertProject = (project: Snapshot['projects'][number], id: number | null) => {
      let teamId: string | null = project.teamId || null
      if (teamId && !teamIds.has(teamId)) {
        repair(`Project "${project.name}" pointed to a team that does not exist; the team was cleared`)
        teamId = null
      }
      let ownerId: string | null = project.ownerId || null
      if (ownerId && !personIds.has(ownerId)) {
        repair(`Project "${project.name}" had an owner who no longer exists; the owner was cleared`)
        ownerId = null
      }
      const code = usedCodeFor(text(project.code).trim().toUpperCase(), text(project.name))
      const result = db.run(
        'INSERT INTO projects(id, name, code, description, team_id, owner_id, color, status, deadline, created_at, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          text(project.name, 'Untitled project') || 'Untitled project',
          code,
          text(project.description),
          teamId,
          ownerId,
          text(project.color, 'purple'),
          text(project.status, 'On track'),
          date(project.deadline, `Project ${project.name} deadline`),
          date(project.createdAt, `Project ${project.name} created date`) || today,
          json(project.customFields),
          flag(project.sample)
        ]
      )
      return result.lastInsertRowid
    }
    for (const project of snapshot.projects || []) {
      const id = Number(project?.id)
      if (!Number.isInteger(id) || id < 1 || projectIds.has(id)) {
        repair(`Project "${text(project?.name)}" had a missing or duplicate id and was skipped`)
        continue
      }
      projectIds.add(id)
      insertProject(project, id)
    }
    let recoveredProject: number | null = null
    const recovered = () => {
      if (recoveredProject !== null) return recoveredProject
      recoveredProject = insertProject(
        {
          id: 0,
          name: 'Recovered items',
          code: 'RECOVERED',
          description: 'Items whose project no longer existed when the data was moved to the SQL database.',
          teamId: '',
          ownerId: '',
          color: 'orange',
          status: 'On track',
          deadline: '',
          createdAt: today,
          sample: false
        },
        null
      )
      projectIds.add(recoveredProject)
      return recoveredProject
    }

    const firstStatus = workflowStates(settings)[0] || 'To do'
    const projectRows = new Map(
      db.all<{ id: number; code: string }>('SELECT id, code FROM projects').map(row => [row.id, row])
    )
    const taskIds = new Set<number>()
    let maxTask = 0
    for (const task of snapshot.tasks || []) maxTask = Math.max(maxTask, Number(task?.id) || 0)
    let nextFreeTask = maxTask + 1
    for (const task of snapshot.tasks || []) {
      let id = Number(task?.id)
      if (!Number.isInteger(id) || id < 1 || taskIds.has(id)) {
        const replacement = nextFreeTask++
        repair(`Task "${text(task?.title)}" had a missing or duplicate id; it was renumbered ${replacement}`)
        id = replacement
      }
      taskIds.add(id)
      let projectId = Number(task.projectId)
      if (!projectIds.has(projectId)) {
        repair(`Task "${task.title}" belonged to a project that does not exist; moved to "Recovered items"`)
        projectId = recovered()
        projectRows.set(projectId, { id: projectId, code: 'RECOVERED' })
      }
      const assignee = task.assigneeId && personIds.has(task.assigneeId) ? task.assigneeId : null
      if (task.assigneeId && !assignee) repair(`Task "${task.title}" had an assignee who no longer exists; unassigned`)
      const creator = task.createdBy && personIds.has(task.createdBy) ? task.createdBy : null
      db.run(
        'INSERT INTO tasks(id, key, title, project_id, assignee_id, priority, due_date, status, type, blocked, custom_fields, created_at, created_by, completed_at, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          text(task.key) || taskKey(projectRows.get(projectId), id),
          text(task.title, '(untitled)') || '(untitled)',
          projectId,
          assignee,
          text(task.priority, 'Medium'),
          date(task.dueDate, `Task ${task.title} due date`),
          text(task.status) || firstStatus,
          text(task.type, 'Development'),
          flag(task.blocked),
          json(task.customFields),
          date(task.createdAt, `Task ${task.title} created date`) || today,
          creator,
          date(task.completedAt, `Task ${task.title} completed date`),
          flag(task.sample)
        ]
      )
    }

    const milestoneIds = new Set<string>()
    for (const milestone of snapshot.milestones || []) {
      if (!milestone?.id || milestoneIds.has(milestone.id)) {
        repair(`Milestone "${text(milestone?.name)}" had a missing or duplicate id and was skipped`)
        continue
      }
      milestoneIds.add(milestone.id)
      let projectId = Number(milestone.projectId)
      if (!projectIds.has(projectId)) {
        repair(`Milestone "${milestone.name}" belonged to a project that does not exist; moved to "Recovered items"`)
        projectId = recovered()
      }
      db.run(
        'INSERT INTO milestones(id, name, project_id, due_date, status, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          milestone.id,
          text(milestone.name, 'Milestone') || 'Milestone',
          projectId,
          date(milestone.dueDate, `Milestone ${milestone.name} due date`),
          text(milestone.status, 'Upcoming'),
          json(milestone.customFields),
          flag(milestone.sample)
        ]
      )
    }

    // ---- activity, alerts, history -------------------------------------------------------------------------------
    const activityIds = new Set<string>()
    for (const activity of snapshot.activities || []) {
      if (!activity?.id || activityIds.has(activity.id)) {
        repair('A daily update had a missing or duplicate id and was skipped')
        continue
      }
      activityIds.add(activity.id)
      db.run(
        'INSERT INTO activities(id, person_id, date, time, yesterday, today, blocked, upcoming, status, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          activity.id,
          activity.personId && personIds.has(activity.personId) ? activity.personId : null,
          date(activity.date, 'Daily update date') || today,
          text(activity.time),
          text(activity.yesterday),
          text(activity.today),
          text(activity.blocked),
          text(activity.upcoming),
          text(activity.status, 'Confirmed'),
          json(activity.customFields),
          flag(activity.sample)
        ]
      )
    }

    const alertIds = new Set<string>()
    for (const alert of snapshot.alerts || []) {
      if (!alert?.id || alertIds.has(alert.id)) {
        repair(`Alert "${text(alert?.title)}" had a missing or duplicate id and was skipped`)
        continue
      }
      alertIds.add(alert.id)
      const projectId = Number(alert.projectId)
      const taskId = Number(alert.taskId)
      db.run(
        'INSERT INTO alerts(id, title, body, type, tone, project_id, task_id, resolved, created_at, custom_fields, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          alert.id,
          text(alert.title, 'Alert') || 'Alert',
          text(alert.body),
          text(alert.type, 'info'),
          text(alert.tone, 'blue'),
          projectIds.has(projectId) ? projectId : null,
          taskIds.has(taskId) ? taskId : null,
          flag(alert.resolved),
          date(alert.createdAt, `Alert ${alert.title} date`) || today,
          json(alert.customFields),
          flag(alert.sample)
        ]
      )
    }

    const logIds = new Set<string>()
    for (const log of snapshot.workLogs || []) {
      if (!log?.id || logIds.has(log.id)) continue
      logIds.add(log.id)
      db.run(
        'INSERT INTO work_logs(id, person_id, actor_user_id, assignee_id, task_id, project_id, task_key, task_title, project_name, action, status_from, status_to, summary, date, time, at, source, derived, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          log.id,
          text(log.personId),
          log.actorUserId ?? null,
          log.assigneeId ?? null,
          intOrNull(log.taskId),
          intOrNull(log.projectId),
          log.taskKey ?? null,
          log.taskTitle ?? null,
          log.projectName ?? null,
          text(log.action, 'Event'),
          text(log.statusFrom),
          text(log.statusTo),
          text(log.summary),
          text(log.date, today),
          text(log.time),
          log.at ?? null,
          text(log.source, 'Task event'),
          flag(log.derived),
          flag(log.sample)
        ]
      )
    }

    db.run('UPDATE audit_maintenance SET enabled = 0 WHERE id = 1')
    const auditIds = new Set<string>()
    for (const entry of snapshot.auditLogs || []) {
      if (!entry?.id || auditIds.has(entry.id)) continue
      auditIds.add(entry.id)
      db.run(
        'INSERT INTO audit_log(id, action, actor_id, detail, created_at, ip, user_agent, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          entry.id,
          text(entry.action),
          text(entry.actorId),
          JSON.stringify(entry.detail ?? {}),
          text(entry.createdAt, new Date().toISOString()),
          entry.ip ?? null,
          entry.userAgent ?? null,
          text(entry.prev),
          entry.hash ?? null
        ]
      )
    }

    // ---- sequences, settings, flags ------------------------------------------------------------------------------
    // Identifiers are never reused: a legacy counter may be ahead of the largest id still present.
    const setSequence = (table: string, wanted: number) => {
      const current = Number(db.scalar(`SELECT COALESCE(MAX(id), 0) FROM ${table}`) ?? 0)
      const value = Math.max(current, wanted)
      if (db.get('SELECT 1 FROM sqlite_sequence WHERE name = ?', [table]))
        db.run('UPDATE sqlite_sequence SET seq = ? WHERE name = ?', [value, table])
      else if (value > 0) db.run('INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)', [table, value])
    }
    setSequence('projects', Number(snapshot.counters?.project || 1) - 1)
    setSequence('tasks', Number(snapshot.counters?.task || 1) - 1)

    db.run(
      'INSERT INTO settings(id, document, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at',
      [JSON.stringify(settings), new Date().toISOString()]
    )
    const setMeta = (key: string, value: string) =>
      db.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
        key,
        value
      ])
    setMeta('configured', snapshot.configured ? '1' : '0')
    setMeta('audit_anchor', text(snapshot.meta?.auditAnchor))

    const violations = db.all('PRAGMA foreign_key_check')
    if (violations.length) throw new Error(`Import left ${violations.length} dangling reference(s); nothing was stored`)

    const counts: Record<string, number> = {}
    for (const table of [
      'teams',
      'people',
      'users',
      'projects',
      'tasks',
      'milestones',
      'activities',
      'alerts',
      'work_logs',
      'audit_log'
    ])
      counts[table] = Number(db.scalar(`SELECT count(*) FROM ${table}`) ?? 0)
    return { counts, repairs }
  })
}
