// Demo work: four projects, their tasks (twelve hand-written, forty-two generated "historical" ones) and milestones.
import { addDays } from '../../util'

export function demoProjects(today: string) {
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
  return projects
}

export function demoTasks(today: string, people: { id: string }[]) {
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
  return [...tasks, ...oldTasks]
}

export function demoMilestones(today: string) {
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
  return milestones
}
