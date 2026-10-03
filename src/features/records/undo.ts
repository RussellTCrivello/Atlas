// Undoing a delete. Deleted tasks are kept for 30 days (the server's trash); this is the browser's side of bringing them back:
// the toast that offers Undo right after a delete, and the call that restores everything one delete removed.
import { api, errorMessage } from '../../lib/api'
import { tr } from '../../lib/i18n'

export const TRASH_DAYS = 30

type Notify = (toast: Record<string, unknown>) => void

/** Bring back every task a delete removed. Resolves with how many came back and why any did not. */
export async function restoreTasks(
  batch: string
): Promise<{ requested: number; succeeded: number; failed: { label: string; reason: string }[] }> {
  return api.post('/api/tasks/restore', { batch })
}

/** The toast that follows a delete: it says how many, and offers Undo for as long as it is on screen. */
export function deletedToast(
  settings: any,
  count: number,
  name: string,
  batch: string,
  notify: Notify,
  onRestored: () => void
) {
  return {
    title: count === 1 ? tr(settings, 'Task deleted') : tr(settings, '{count} tasks deleted', { count }),
    body: count === 1 ? name : tr(settings, 'They stay recoverable for {days} days.', { days: TRASH_DAYS }),
    tone: 'success',
    action: {
      label: tr(settings, 'Undo'),
      onClick: async () => {
        try {
          const result = await restoreTasks(batch)
          const lost = result.failed.length
          notify({
            title: lost
              ? tr(settings, 'Restored {done} of {total} tasks', { done: result.succeeded, total: result.requested })
              : result.succeeded === 1
                ? tr(settings, 'Task restored')
                : tr(settings, '{count} tasks restored', { count: result.succeeded }),
            body: lost
              ? result.failed
                  .map(item => `${item.label}: ${item.reason}`)
                  .slice(0, 3)
                  .join(' · ')
              : undefined,
            tone: lost ? 'warning' : 'success'
          })
        } catch (error) {
          notify({ title: tr(settings, 'Could not undo the delete'), body: errorMessage(error), tone: 'warning' })
        } finally {
          onRestored()
        }
      }
    }
  }
}
