// The shape of the data before the first load: empty lists and the default settings, so screens can render at once.
import { defaultSettings } from '../lib/settings'

export const emptyData: any = {
  today: '',
  revision: 0,
  settings: defaultSettings,
  teams: [],
  people: [],
  users: [],
  projects: [],
  tasks: [],
  taskStats: { total: 0, loaded: 0, truncated: false },
  activity: [],
  alerts: [],
  dashboard: { stats: {}, dailyPulse: {}, myTasks: [] },
  reports: { series: [] }
}
