// Development demo data. Only ever loaded by `npm run reset:data` (or the setup wizard) with ATLAS_ALLOW_DEMO_DATA=true,
// never in production. Every row is flagged `sample: true`, so it can be removed from Settings without touching live data.
import { compactSettingsForStorage, normalizeSettings } from '../../shared/settings'
import type { AtlasConfig } from '../config'
import { normalizeState } from '../db/legacy-store'
import { deriveLedger } from '../domain/ledger'
import { todayIn } from '../domain/time'
import type { Snapshot } from '../domain/types'
import { hashPasswordSync } from '../security/passwords'
import { addDays } from '../util'

/** Public, well-known development credentials. They exist only in demo stores and are never served in production. */
export const DEMO_ACCOUNTS = [
  { email: 'maya@atlas.local', password: 'atlas-demo', role: 'Administrator', name: 'Maya Chen' },
  { email: 'manager@atlas.local', password: 'manager-demo', role: 'Manager', name: 'Noah Reed' },
  { email: 'developer@atlas.local', password: 'developer-demo', role: 'Developer', name: 'Lina Patel' },
  { email: 'viewer@atlas.local', password: 'viewer-demo', role: 'Viewer', name: 'Omar Haddad' }
]

export function demoSnapshot(config: Pick<AtlasConfig, 'defaultTimezone'>): Snapshot {
  const today = todayIn({ workspace: { defaultTimezone: config.defaultTimezone } })
  const teams = [
    { id: 'team-platform', name: 'Platform', color: 'purple', sample: true },
    { id: 'team-product', name: 'Product Experience', color: 'blue', sample: true },
    { id: 'team-growth', name: 'Growth', color: 'orange', sample: true },
    { id: 'team-data', name: 'Data', color: 'green', sample: true }
  ]
  const people = [
    {
      id: 'p1',
      name: 'Maya Chen',
      email: 'maya@atlas.local',
      jobTitle: 'Engineering Manager',
      teamId: 'team-platform',
      focus: 'Release readiness and cross-team alignment',
      capacity: 78,
      status: 'On track',
      color: 'purple',
      sample: true
    },
    {
      id: 'p2',
      name: 'Noah Reed',
      email: 'noah@atlas.local',
      jobTitle: 'Senior Developer',
      teamId: 'team-platform',
      focus: 'API reliability and observability',
      capacity: 82,
      status: 'On track',
      color: 'blue',
      sample: true
    },
    {
      id: 'p3',
      name: 'Lina Patel',
      email: 'lina@atlas.local',
      jobTitle: 'Product Designer',
      teamId: 'team-product',
      focus: 'Onboarding interaction polish',
      capacity: 64,
      status: 'On track',
      color: 'pink',
      sample: true
    },
    {
      id: 'p4',
      name: 'Omar Haddad',
      email: 'omar@atlas.local',
      jobTitle: 'QA Lead',
      teamId: 'team-product',
      focus: 'Regression gates and risk checks',
      capacity: 91,
      status: 'Needs attention',
      color: 'orange',
      sample: true
    },
    {
      id: 'p5',
      name: 'Ella Brooks',
      email: 'ella@atlas.local',
      jobTitle: 'Data Engineer',
      teamId: 'team-data',
      focus: 'Delivery metrics warehouse',
      capacity: 70,
      status: 'On track',
      color: 'green',
      sample: true
    },
    {
      id: 'p6',
      name: 'Samir Khan',
      email: 'samir@atlas.local',
      jobTitle: 'Growth Engineer',
      teamId: 'team-growth',
      focus: 'Activation experiments',
      capacity: 58,
      status: 'On track',
      color: 'teal',
      sample: true
    }
  ]
  const projects = [
    {
      id: 1,
      name: 'Atlas Command Center',
      code: 'ATL',
      description: 'Make daily operations visible with decision-ready workspace intelligence.',
      teamId: 'team-platform',
      ownerId: 'p1',
      color: 'purple',
      status: 'On track',
      deadline: addDays(today, 19),
      createdAt: addDays(today, -70),
      sample: true
    },
    {
      id: 2,
      name: 'Customer Onboarding',
      code: 'ONB',
      description: 'Design a fast, guided path from invited user to productive team member.',
      teamId: 'team-product',
      ownerId: 'p3',
      color: 'blue',
      status: 'At risk',
      deadline: addDays(today, 9),
      createdAt: addDays(today, -50),
      sample: true
    },
    {
      id: 3,
      name: 'Data Reliability',
      code: 'DR',
      description: 'Harden reporting pipelines and close the trust gap in operational data.',
      teamId: 'team-data',
      ownerId: 'p5',
      color: 'green',
      status: 'On track',
      deadline: addDays(today, 37),
      createdAt: addDays(today, -44),
      sample: true
    },
    {
      id: 4,
      name: 'Growth Experiments',
      code: 'GRW',
      description: 'Run activation experiments with clear tracking and learning loops.',
      teamId: 'team-growth',
      ownerId: 'p6',
      color: 'orange',
      status: 'On track',
      deadline: addDays(today, 31),
      createdAt: addDays(today, -30),
      sample: true
    }
  ]
  const tasks = [
    {
      id: 1,
      title: 'Finalize advanced reporting export templates',
      projectId: 1,
      assigneeId: 'p1',
      priority: 'High',
      dueDate: today,
      status: 'In progress',
      type: 'Documentation',
      blocked: false,
      createdAt: addDays(today, -7),
      sample: true
    },
    {
      id: 2,
      title: 'Wire native drag-and-drop board updates',
      projectId: 1,
      assigneeId: 'p2',
      priority: 'High',
      dueDate: addDays(today, 1),
      status: 'Review',
      type: 'Development',
      blocked: false,
      createdAt: addDays(today, -9),
      sample: true
    },
    {
      id: 3,
      title: 'QA keyboard shortcut coverage',
      projectId: 1,
      assigneeId: 'p4',
      priority: 'Medium',
      dueDate: addDays(today, 4),
      status: 'Testing',
      type: 'Testing',
      blocked: false,
      createdAt: addDays(today, -11),
      sample: true
    },
    {
      id: 4,
      title: 'Design setup wizard empty states',
      projectId: 2,
      assigneeId: 'p3',
      priority: 'Medium',
      dueDate: addDays(today, 2),
      status: 'Done',
      type: 'Design',
      blocked: false,
      createdAt: addDays(today, -18),
      completedAt: addDays(today, -1),
      sample: true
    },
    {
      id: 5,
      title: 'Resolve SSO callback mismatch',
      projectId: 2,
      assigneeId: 'p2',
      priority: 'High',
      dueDate: addDays(today, -1),
      status: 'In progress',
      type: 'Development',
      blocked: true,
      createdAt: addDays(today, -13),
      sample: true
    },
    {
      id: 6,
      title: 'Refresh welcome checklist microcopy',
      projectId: 2,
      assigneeId: 'p3',
      priority: 'Low',
      dueDate: addDays(today, 6),
      status: 'To do',
      type: 'Design',
      blocked: false,
      createdAt: addDays(today, -6),
      sample: true
    },
    {
      id: 7,
      title: 'Backfill delivery metrics for quarterly trend',
      projectId: 3,
      assigneeId: 'p5',
      priority: 'Medium',
      dueDate: addDays(today, 3),
      status: 'In progress',
      type: 'Development',
      blocked: false,
      createdAt: addDays(today, -16),
      sample: true
    },
    {
      id: 8,
      title: 'Add pipeline freshness alert',
      projectId: 3,
      assigneeId: 'p5',
      priority: 'High',
      dueDate: addDays(today, 8),
      status: 'To do',
      type: 'Development',
      blocked: false,
      createdAt: addDays(today, -4),
      sample: true
    },
    {
      id: 9,
      title: 'Prototype activation cohort dashboard',
      projectId: 4,
      assigneeId: 'p6',
      priority: 'Medium',
      dueDate: addDays(today, 10),
      status: 'Review',
      type: 'Development',
      blocked: false,
      createdAt: addDays(today, -8),
      sample: true
    },
    {
      id: 10,
      title: 'Document experiment naming rules',
      projectId: 4,
      assigneeId: 'p6',
      priority: 'Low',
      dueDate: addDays(today, 15),
      status: 'Done',
      type: 'Documentation',
      blocked: false,
      createdAt: addDays(today, -25),
      completedAt: addDays(today, -10),
      sample: true
    },
    {
      id: 11,
      title: 'Create annual executive delivery pack',
      projectId: 1,
      assigneeId: 'p1',
      priority: 'High',
      dueDate: addDays(today, 12),
      status: 'To do',
      type: 'Documentation',
      blocked: false,
      createdAt: addDays(today, -2),
      sample: true
    },
    {
      id: 12,
      title: 'Polish local font loading and offline shell',
      projectId: 1,
      assigneeId: 'p2',
      priority: 'Medium',
      dueDate: addDays(today, 5),
      status: 'Done',
      type: 'Development',
      blocked: false,
      createdAt: addDays(today, -14),
      completedAt: today,
      sample: true
    }
  ]
  const oldTasks: any[] = []
  for (let i = 13; i <= 54; i++) {
    const projectId = ((i - 1) % 4) + 1
    const createdAt = addDays(today, -((i * 5) % 360) - 7)
    const done = i % 3 !== 0
    oldTasks.push({
      id: i,
      title: `Historical delivery item ${i - 12}`,
      projectId,
      assigneeId: people[(i - 1) % people.length].id,
      priority: ['Low', 'Medium', 'High'][i % 3],
      dueDate: addDays(createdAt, 8 + (i % 14)),
      status: done ? 'Done' : ['To do', 'In progress', 'Review', 'Testing'][i % 4],
      type: ['Development', 'Design', 'Testing', 'Documentation'][i % 4],
      blocked: !done && i % 7 === 0,
      createdAt,
      completedAt: done ? addDays(createdAt, 5 + (i % 12)) : undefined,
      sample: true
    })
  }
  const milestones = [
    {
      id: 'm1',
      projectId: 1,
      name: 'Executive report builder',
      dueDate: addDays(today, 12),
      status: 'Upcoming',
      sample: true
    },
    {
      id: 'm2',
      projectId: 2,
      name: 'Pilot onboarding release',
      dueDate: addDays(today, 9),
      status: 'At risk',
      sample: true
    },
    {
      id: 'm3',
      projectId: 3,
      name: 'Pipeline SLA review',
      dueDate: addDays(today, 18),
      status: 'Upcoming',
      sample: true
    },
    {
      id: 'm4',
      projectId: 4,
      name: 'Experiment readout',
      dueDate: addDays(today, 22),
      status: 'Upcoming',
      sample: true
    }
  ]
  const activities = [
    {
      id: 'a1',
      personId: 'p1',
      date: today,
      time: '09:10',
      yesterday: 'Validated report requirements with leadership.',
      today: 'Finalize export templates and print presets.',
      blocked: '',
      upcoming: 'Annual report review.',
      status: 'Confirmed',
      sample: true
    },
    {
      id: 'a2',
      personId: 'p2',
      date: today,
      time: '09:20',
      yesterday: 'Completed local asset audit.',
      today: 'Review drag-and-drop persistence and API update paths.',
      blocked: 'SSO callback mismatch needs environment confirmation.',
      upcoming: 'Ship board interaction polish.',
      status: 'Confirmed',
      sample: true
    },
    {
      id: 'a3',
      personId: 'p3',
      date: today,
      time: '09:31',
      yesterday: 'Finished setup wizard states.',
      today: 'Improve onboarding checklist affordances.',
      blocked: '',
      upcoming: 'Design review.',
      status: 'Confirmed',
      sample: true
    },
    {
      id: 'a4',
      personId: 'p4',
      date: addDays(today, -1),
      time: '16:40',
      yesterday: 'Ran regression smoke test.',
      today: 'Validate keyboard shortcuts and print layouts.',
      blocked: '',
      upcoming: 'Testing sign-off.',
      status: 'Confirmed',
      sample: true
    },
    {
      id: 'a5',
      personId: 'p5',
      date: addDays(today, -1),
      time: '15:25',
      yesterday: 'Backfilled weekly delivery metrics.',
      today: 'Compare monthly and quarterly rollups.',
      blocked: '',
      upcoming: 'Freshness alert.',
      status: 'Confirmed',
      sample: true
    },
    {
      id: 'a6',
      personId: 'p6',
      date: addDays(today, -2),
      time: '14:05',
      yesterday: 'Mapped activation cohorts.',
      today: 'Prototype readout dashboard.',
      blocked: '',
      upcoming: 'Experiment kickoff.',
      status: 'Confirmed',
      sample: true
    }
  ]
  const alerts = [
    {
      id: 'al1',
      title: 'Onboarding release is at risk',
      body: 'SSO callback mismatch blocks the pilot release path.',
      type: 'risk',
      tone: 'orange',
      projectId: 2,
      taskId: 5,
      resolved: false,
      createdAt: today,
      sample: true
    },
    {
      id: 'al2',
      title: 'Overdue task detected',
      body: 'Resolve SSO callback mismatch is past its due date.',
      type: 'overdue',
      tone: 'red',
      projectId: 2,
      taskId: 5,
      resolved: false,
      createdAt: today,
      sample: true
    },
    {
      id: 'al3',
      title: 'Local assets confirmed',
      body: 'Fonts, icons, manifest, and service worker are local to the project.',
      type: 'info',
      tone: 'blue',
      projectId: 1,
      resolved: true,
      createdAt: addDays(today, -1),
      sample: true
    }
  ]
  const allTasks: any[] = [...tasks, ...oldTasks]
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
