// Development demo data. Only ever loaded by `npm run reset:data` (or the setup wizard) with ATLAS_ALLOW_DEMO_DATA=true,
// never in production. Every row is flagged `sample: true`, so it can be removed from Settings without touching live data.
import { compactSettingsForStorage, normalizeSettings } from '../../../shared/settings'
import type { AtlasConfig } from '../../config'
import { normalizeState } from '../../db/legacy-store'
import { deriveLedger } from '../../domain/ledger'
import { todayIn } from '../../domain/time'
import type { Snapshot } from '../../domain/types'
import { demoPeople, demoTeams } from './directory'
import { demoActivities, demoAlerts } from './pulse'
import { demoMilestones, demoProjects, demoTasks } from './work'
import { hashPasswordSync } from '../../security/passwords'

/** Public, well-known development credentials. They exist only in demo stores and are never served in production. */
export const DEMO_ACCOUNTS = [
  { email: 'maya@atlas.local', password: 'atlas-demo', role: 'Administrator', name: 'Maya Chen' },
  { email: 'manager@atlas.local', password: 'manager-demo', role: 'Manager', name: 'Noah Reed' },
  { email: 'developer@atlas.local', password: 'developer-demo', role: 'Developer', name: 'Lina Patel' },
  { email: 'viewer@atlas.local', password: 'viewer-demo', role: 'Viewer', name: 'Omar Haddad' }
]

export function demoSnapshot(config: Pick<AtlasConfig, 'defaultTimezone'>): Snapshot {
  const today = todayIn({ workspace: { defaultTimezone: config.defaultTimezone } })
  const teams = demoTeams()
  const people = demoPeople()
  const projects = demoProjects(today)
  const milestones = demoMilestones(today)
  const activities = demoActivities(today)
  const alerts = demoAlerts(today)
  const allTasks: any[] = demoTasks(today, people)
  const settings = compactSettingsForStorage(
    normalizeSettings({ workspace: { name: 'Northstar', unit: 'Engineering' } }, { timezone: config.defaultTimezone })
  )
  const state = normalizeState(
    {
      meta: {},
      configured: true,
      counters: { project: 5, task: 55 },
      settings,
      users: [
        {
          id: 'u1',
          name: 'Maya Chen',
          email: 'maya@atlas.local',
          passwordHash: hashPasswordSync('atlas-demo'),
          role: 'Administrator',
          personId: 'p1',
          avatarColor: 'purple',
          active: true,
          sample: true
        },
        {
          id: 'u2',
          name: 'Noah Reed',
          email: 'manager@atlas.local',
          passwordHash: hashPasswordSync('manager-demo'),
          role: 'Manager',
          personId: 'p2',
          avatarColor: 'blue',
          active: true,
          sample: true
        },
        {
          id: 'u3',
          name: 'Lina Patel',
          email: 'developer@atlas.local',
          passwordHash: hashPasswordSync('developer-demo'),
          role: 'Developer',
          personId: 'p3',
          avatarColor: 'pink',
          active: true,
          sample: true
        },
        {
          id: 'u4',
          name: 'Omar Haddad',
          email: 'viewer@atlas.local',
          passwordHash: hashPasswordSync('viewer-demo'),
          role: 'Viewer',
          personId: 'p4',
          avatarColor: 'orange',
          active: true,
          sample: true
        }
      ],
      teams,
      people,
      projects,
      tasks: allTasks,
      milestones,
      activities,
      alerts,
      workLogs: [],
      auditLogs: []
    },
    config
  )
  state.workLogs = deriveLedger(state)
  return state
}
