// The pages and how the address bar maps to them.
//   #/overview   #/projects   #/projects/12   #/projects/12?task=45   #/tasks   #/people   #/activity   #/reports   #/alerts   #/settings
export const PAGE_IDS = ['overview', 'projects', 'tasks', 'people', 'activity', 'reports', 'alerts', 'settings']

const segments = () => window.location.hash.replace(/^#\/?/, '').split(/[/?]/)

export const pageFromHash = () => {
  const id = segments()[0]
  return PAGE_IDS.includes(id) ? id : ''
}

/** The project whose page is open (`#/projects/12`), or null on every other address. */
export const projectIdFromHash = (): number | null => {
  const [page, id] = segments()
  return page === 'projects' && /^\d+$/.test(id || '') ? Number(id) : null
}

/** The task to highlight on a project page (`#/projects/12?task=45`). */
export const taskFromHash = (): number | null => {
  const query = window.location.hash.split('?')[1] || ''
  const task = new URLSearchParams(query).get('task')
  return task && /^\d+$/.test(task) ? Number(task) : null
}

export const projectHash = (id: number, task?: number) => `#/projects/${id}${task ? `?task=${task}` : ''}`
