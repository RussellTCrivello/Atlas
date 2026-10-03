// Reporting windows: how a date falls into a day / week / month / quarter / year bucket, and what the report figures mean.
// Two sources of truth feed the reports (see services/reports.ts), each used for one thing:
//   * the immutable work ledger (work_logs) answers "what happened, when, by whom" (created, completed, activity);
//   * task records answer "what is the state now" (open, blocked, overdue) and "was it delivered by its due date".
// History therefore does not change retroactively when a task is later re-opened, edited or deleted.
import { formatDate } from './time'
import type { WorkLog } from './types'
import { addDays, isIsoDate, weekday } from '../util'

export type Period = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
const START_DAY: Record<string, number> = { sunday: 0, monday: 1, saturday: 6 }

export function bucketFor(period: string, dateValue: string, settings: any): string {
  if (!isIsoDate(dateValue)) return ''
  if (period === 'daily') return dateValue
  if (period === 'weekly') {
    const start = START_DAY[settings?.workspace?.weekStartsOn] ?? 1
    const offset = (weekday(dateValue) - start + 7) % 7
    return addDays(dateValue, -offset)
  }
  const [year, month] = dateValue.split('-').map(Number)
  if (period === 'monthly') return `${year}-${String(month).padStart(2, '0')}`
  if (period === 'quarterly') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
  return String(year)
}

export interface Bucket {
  key: string
  label: string
}
export function makeBuckets(period: string, today: string, settings: any): Bucket[] {
  const [ty, tm] = today.split('-').map(Number)
  const count =
    period === 'daily' ? 10 : period === 'weekly' ? 10 : period === 'monthly' ? 12 : period === 'quarterly' ? 8 : 5
  const buckets: Bucket[] = []
  for (let i = count - 1; i >= 0; i--) {
    let iso = today
    if (period === 'daily') iso = addDays(today, -i)
    else if (period === 'weekly') iso = addDays(today, -i * 7)
    else if (period === 'monthly') iso = new Date(Date.UTC(ty, tm - 1 - i, 1)).toISOString().slice(0, 10)
    else if (period === 'quarterly') iso = new Date(Date.UTC(ty, tm - 1 - i * 3, 1)).toISOString().slice(0, 10)
    else if (period === 'yearly') iso = new Date(Date.UTC(ty - i, 0, 1)).toISOString().slice(0, 10)
    const key = bucketFor(period, iso, settings)
    let label = formatDate(settings, iso, { month: 'short', day: 'numeric' })
    if (period === 'weekly') label = `Wk ${formatDate(settings, key, { month: 'short', day: 'numeric' })}`
    if (period === 'monthly') label = formatDate(settings, iso, { month: 'short' })
    if (period === 'quarterly') label = key.split('-')[1]
    if (period === 'yearly') label = iso.slice(0, 4)
    buckets.push({ key, label })
  }
  return buckets
}

export function bucketLabel(period: string, dateValue: string, settings: any): string {
  if (period === 'daily') return formatDate(settings, dateValue, { weekday: 'short', month: 'short', day: 'numeric' })
  if (period === 'weekly')
    return `Week of ${formatDate(settings, bucketFor('weekly', dateValue, settings), { month: 'short', day: 'numeric' })}`
  if (period === 'monthly')
    return formatDate(settings, `${dateValue.slice(0, 7)}-01`, { month: 'long', year: 'numeric' })
  return formatDate(settings, dateValue)
}

/** A ledger row that records a task being completed (including older rows that only carry the status change). */
export function isCompletionRow(row: Pick<WorkLog, 'action' | 'statusFrom' | 'statusTo'>, terminal: string[]): boolean {
  if (row.action === 'Completed task') return true
  return Boolean(row.statusTo) && terminal.includes(row.statusTo!) && !terminal.includes(row.statusFrom || '')
}
export const REPORT_DEFINITIONS = {
  created: 'Tasks created in the period (from the work ledger).',
  completed:
    'Distinct tasks completed in the period (from the work ledger). Re-opening a task later does not change past periods.',
  planned: 'Tasks whose due date fell in the period and has already passed (due date as currently recorded).',
  delivered: 'Of the planned tasks, those completed on or before their due date.',
  deliveryRate:
    'Delivered ÷ planned. Both counts describe the same set of tasks, so the rate is always between 0% and 100%. Empty when nothing came due.'
}

export const isBlockerRow = (row: Pick<WorkLog, 'action'>) =>
  row.action === 'Raised blocker' || row.action === 'Blocked task'

/** First calendar day covered by a series of buckets (the date to filter ledger rows and due dates from). */
export function windowStart(period: string, today: string, settings: any): string {
  const first = makeBuckets(period, today, settings)[0]
  if (period === 'daily') return first.key
  if (period === 'weekly') return first.key
  if (period === 'monthly') return `${first.key}-01`
  if (period === 'quarterly') {
    const [year, quarter] = first.key.split('-Q').map(Number)
    return `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`
  }
  return `${first.key}-01-01`
}
