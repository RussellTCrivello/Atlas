// Doing one thing to a large selection: the ids go to the server in chunks (so no request is huge and the screen can show
// progress), the answers are added up, and the person can stop between chunks. Whatever happened is reported exactly: how many
// changed, which ones could not be and why, and how many were never attempted because the run was stopped or a request failed.
import { api, errorMessage } from './api'

export const CHUNK_SIZE = 200

export interface BulkFailure {
  id: string | number
  label: string
  reason: string
}
export interface BulkProgress {
  done: number
  total: number
  succeeded: number
  failed: number
}
export interface BulkResult {
  requested: number
  succeeded: number
  failed: BulkFailure[]
  /** Never sent: the person stopped the run, or a request failed before they were reached. */
  notAttempted: number
  cancelled: boolean
  /** Set when a request failed outright (network, permission); earlier chunks are still counted above. */
  error?: string
  /** One id that groups everything a delete removed, so a single Undo brings it all back. */
  batch?: string
}

export interface BulkRun {
  endpoint: string
  ids: (string | number)[]
  /** What to do: `{ action: 'status', status: 'Done' }`. The ids are added per chunk. */
  body: Record<string, unknown>
  signal?: { aborted: boolean }
  onProgress?: (progress: BulkProgress) => void
  chunkSize?: number
  /** Group the chunks of a delete under one undo (sent to the server as `batch`). */
  batch?: string
  post?: (path: string, body: unknown) => Promise<any>
}

export const newBatchId = () => `trash_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`

export async function runBulk(run: BulkRun): Promise<BulkResult> {
  const post = run.post || api.post
  const ids = [...new Set(run.ids)]
  const size = Math.max(1, run.chunkSize || CHUNK_SIZE)
  const result: BulkResult = {
    requested: ids.length,
    succeeded: 0,
    failed: [],
    notAttempted: 0,
    cancelled: false,
    batch: run.batch
  }
  let done = 0
  for (let start = 0; start < ids.length; start += size) {
    if (run.signal?.aborted) {
      result.cancelled = true
      result.notAttempted = ids.length - start
      break
    }
    const chunk = ids.slice(start, start + size)
    try {
      const answer = await post(run.endpoint, { ...run.body, ids: chunk, ...(run.batch ? { batch: run.batch } : {}) })
      result.succeeded += Number(answer.succeeded) || 0
      result.failed.push(...(Array.isArray(answer.failed) ? answer.failed : []))
    } catch (error) {
      // The request itself failed: what earlier chunks did stays reported, this one and the rest were not done.
      result.error = errorMessage(error)
      result.notAttempted = ids.length - start
      break
    }
    done += chunk.length
    run.onProgress?.({ done, total: ids.length, succeeded: result.succeeded, failed: result.failed.length })
  }
  return result
}

/** One sentence for the notification that follows a run. */
export function summarize(result: BulkResult, noun: string, verb: string): string {
  const parts = [`${verb} ${result.succeeded.toLocaleString('en')} of ${result.requested.toLocaleString('en')} ${noun}`]
  if (result.failed.length) parts.push(`${result.failed.length.toLocaleString('en')} could not be changed`)
  if (result.notAttempted) parts.push(`${result.notAttempted.toLocaleString('en')} not attempted`)
  return parts.join(' · ')
}
