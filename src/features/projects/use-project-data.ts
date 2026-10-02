// Data for the project page: the project's numbers and its tasks, both read from the database through the API. The task list is
// filtered, sorted and paged by the server, so a project with ten thousand tasks costs the same to open as one with ten.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'

export interface TaskFilters {
  q: string
  status: string[]
  priority: string[]
  assignee: string
  /** '' (everything), 'open', 'done' or 'overdue'. */
  scope: '' | 'open' | 'done' | 'overdue'
  blocked: boolean
}
export const NO_FILTERS: TaskFilters = { q: '', status: [], priority: [], assignee: '', scope: '', blocked: false }
export const hasFilters = (filters: TaskFilters) =>
  Boolean(
    filters.q ||
    filters.status.length ||
    filters.priority.length ||
    filters.assignee ||
    filters.scope ||
    filters.blocked
  )

export interface TaskSortState {
  key: string
  dir: 'asc' | 'desc'
}

export function taskQuery(filters: TaskFilters, sort: TaskSortState, page: number, pageSize: number): string {
  const params = new URLSearchParams()
  if (filters.q.trim()) params.set('q', filters.q.trim())
  if (filters.status.length) params.set('status', filters.status.join(','))
  if (filters.priority.length) params.set('priority', filters.priority.join(','))
  if (filters.assignee) params.set('assignee', filters.assignee)
  if (filters.scope) params.set('scope', filters.scope)
  if (filters.blocked) params.set('blocked', 'true')
  params.set('sort', sort.key)
  params.set('dir', sort.dir)
  params.set('page', String(page))
  params.set('pageSize', String(pageSize))
  return params.toString()
}

export interface Loaded<T> {
  data: T | null
  loading: boolean
  error: string
  reload: () => void
}

/** Fetch `path`, again whenever it (or `revision`, the workspace's change counter) changes. A slow, stale answer never overwrites a newer one. */
function useFetched<T>(path: string | null, revision: number): Loaded<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string }>({
    data: null,
    loading: Boolean(path),
    error: ''
  })
  const ticket = useRef(0)
  const load = useCallback(() => {
    if (!path) return
    const mine = ++ticket.current
    setState(current => ({ ...current, loading: true }))
    api
      .get(path)
      .then(data => mine === ticket.current && setState({ data, loading: false, error: '' }))
      .catch(
        error =>
          mine === ticket.current && setState(current => ({ ...current, loading: false, error: errorMessage(error) }))
      )
  }, [path])
  useEffect(load, [load, revision])
  return { ...state, reload: load }
}

export interface ProjectDetail {
  project: any
  totals: { total: number; open: number; done: number; blocked: number; overdue: number }
  byStatus: { status: string; count: number; done: boolean }[]
  byPriority: { priority: string; count: number }[]
  people: { personId: string; name: string; color: string; open: number; done: number }[]
  alerts: any[]
  recent: any[]
  today: string
}
export interface TaskPage {
  projectId: number
  rows: any[]
  total: number
  page: number
  pageSize: number
  pages: number
  byStatus: Record<string, number>
  byPriority: Record<string, number>
}

export const useProjectDetail = (projectId: number, revision: number) =>
  useFetched<ProjectDetail>(`/api/projects/${projectId}`, revision)

export const useProjectTasks = (
  projectId: number,
  filters: TaskFilters,
  sort: TaskSortState,
  page: number,
  pageSize: number,
  revision: number
) => useFetched<TaskPage>(`/api/projects/${projectId}/tasks?${taskQuery(filters, sort, page, pageSize)}`, revision)
