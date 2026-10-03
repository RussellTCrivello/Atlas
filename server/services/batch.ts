// Doing one thing to many records without letting one bad record spoil the rest. Each record is processed in its own savepoint:
// a record that cannot be changed (not allowed, not found, would break a rule) is reported with the reason and everything else
// still happens. A failure of the storage itself is different: it stops the whole batch, because nothing can be trusted to be saved.
import { HttpError } from '../util'
import type { ServiceContext } from './context'

export interface BatchFailure {
  id: string | number
  /** What the person knows the record as (a task key and title, a project name…). */
  label: string
  reason: string
}
export interface BatchResult {
  requested: number
  succeeded: number
  failed: BatchFailure[]
}

export function runBatch<Id extends string | number>(
  ctx: ServiceContext,
  ids: Id[],
  label: (id: Id) => string,
  work: (id: Id) => void,
  finish?: (result: BatchResult) => void
): BatchResult {
  const unique = [...new Set(ids)]
  return ctx.transaction(() => {
    const result: BatchResult = { requested: unique.length, succeeded: 0, failed: [] }
    for (const id of unique) {
      try {
        ctx.transaction(() => work(id))
        result.succeeded++
      } catch (error) {
        if (error instanceof HttpError && error.status < 500)
          result.failed.push({ id, label: label(id), reason: error.message })
        else throw error
      }
    }
    finish?.(result)
    return result
  })
}
