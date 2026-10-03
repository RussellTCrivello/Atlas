// Demo day-to-day activity: daily updates and alerts.
import { addDays } from '../../util'

export function demoActivities(today: string) {
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
  return activities
}

export function demoAlerts(today: string) {
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
  return alerts
}
