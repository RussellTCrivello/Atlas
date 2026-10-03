// Fetch a list from the server and fetch it again whenever its address (or the workspace's change counter) changes. A slow,
// stale answer never overwrites a newer one, and the previous rows stay on screen while the next page loads (no flicker).
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../../../lib/api'

export interface ServerList<T> {
  data: T | null
  loading: boolean
  error: string
  reload: () => void
}

export function useServerList<T>(path: string | null, revision: number): ServerList<T> {
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
