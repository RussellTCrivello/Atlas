// Data for the project page: the project's numbers (totals, breakdowns, people, milestones, alerts, recent activity), read from the
// database through the API. Its tasks are the task grid's business (features/records/TaskGrid.tsx), which asks the server itself.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'

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
export const useProjectDetail = (projectId: number, revision: number) =>
  useFetched<ProjectDetail>(`/api/projects/${projectId}`, revision)
