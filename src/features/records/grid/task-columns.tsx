// The columns of the task grid: what each one shows, how it sorts and filters on the server, and how it is edited in place.
// Whether a cell can be edited follows the person's rights, the same rules the server enforces (anyone who writes tasks can move
// them through the workflow; re-planning a task needs task management or ownership of it).
import { projectHash } from '../../../app/routes'
import { slug } from '../../../lib/format'
import { tr } from '../../../lib/i18n'
import { dueText } from '../../../lib/labels'
import type { ColumnDef } from '../../../lib/grid-model'
import { Avatar, StatusPill } from '../../../ui/primitives'
import type { GridColumn } from './GridTable'

export const TASK_DEFS: ColumnDef[] = [
  { key: 'key', label: 'Task ID', width: 104, fixed: true },
  { key: 'title', label: 'Task', width: 320, minWidth: 140 },
  { key: 'project', label: 'Project', width: 160 },
  { key: 'status', label: 'Status', width: 148 },
  { key: 'priority', label: 'Priority', width: 118 },
  { key: 'assignee', label: 'Owner', width: 176 },
  { key: 'due', label: 'Due date', width: 150 },
  { key: 'tags', label: 'Tags', width: 170 },
  { key: 'type', label: 'Type', width: 130, defaultHidden: true },
  { key: 'blocked', label: 'Blocked', width: 100, defaultHidden: true },
  { key: 'created', label: 'Created', width: 124, defaultHidden: true },
  { key: 'completed', label: 'Completed', width: 124, defaultHidden: true }
]

/** The fields the advanced filter offers: the ones the server's condition engine knows. */
export const TASK_FILTER_FIELDS = [
  { key: 'id', label: 'Task ID' },
  { key: 'title', label: 'Task' },
  { key: 'project', label: 'Project' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'type', label: 'Type' },
  { key: 'assignee', label: 'Owner' },
  { key: 'dueDate', label: 'Due date', type: 'date' },
  { key: 'createdAt', label: 'Created', type: 'date' },
  { key: 'completedAt', label: 'Completed', type: 'date' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'tags', label: 'Tags' },
  { key: 'team', label: 'Team' }
]

export interface TaskColumnContext {
  settings: any
  language: string
  user: any
  people: { id: string; name: string }[]
  statuses: string[]
  canWrite: boolean
  canManage: boolean
  /** Change one field of a task (re-planning). Throws with the server's message when refused. */
  update: (task: any, patch: Record<string, unknown>, what: string) => Promise<void>
  moveTo: (task: any, status: string) => Promise<void>
}

const PRIORITIES = ['High', 'Medium', 'Low']
const TYPES = ['Development', 'Design', 'Testing', 'Documentation']

export function taskColumns(ctx: TaskColumnContext): GridColumn<any>[] {
  const { settings, language, user, canWrite } = ctx
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const replan = (task: any) =>
    canWrite &&
    (ctx.canManage || (user?.personId && (task.assigneeId === user.personId || task.createdBy === user.personId)))
  const pick = (values: string[]) => values.map(value => ({ value, label: value }))
  const byKey = (key: string) => TASK_DEFS.find(def => def.key === key)!
  const base = (key: string) => ({ ...byKey(key), sortable: true })
  return [
    { ...base('key'), render: task => <span className="task-id">{task.id}</span> },
    {
      ...base('title'),
      className: 'task-title-cell',
      filter: 'text',
      render: task => (
        <>
          <strong>{task.title}</strong>
          {task.blocked && <span className="blocked-chip">{t('Blocked')}</span>}
        </>
      )
    },
    {
      ...base('project'),
      filter: 'text',
      render: task => (
        <a href={projectHash(task.projectId)} data-no-open>
          {task.project}
        </a>
      )
    },
    {
      ...base('status'),
      filter: 'select',
      options: pick(ctx.statuses),
      render: task => <StatusPill tone={slug(task.status)}>{task.status}</StatusPill>
    },
    {
      ...base('priority'),
      filter: 'select',
      options: pick(PRIORITIES),
      render: task => (
        <span className={`priority priority-${String(task.priority).toLowerCase()}`}>{task.priority}</span>
      )
    },
    {
      ...base('assignee'),
      filter: 'select',
      single: true,
      options: [
        { value: 'me', label: t('Assigned to me') },
        { value: 'none', label: t('Unassigned') },
        ...ctx.people.map(person => ({ value: person.id, label: person.name }))
      ],
      className: 'owner-cell',
      render: task => (
        <>
          <Avatar name={task.assignee} color={task.assigneeColor} small /> <span>{task.assignee}</span>
        </>
      )
    },
    {
      ...base('due'),
      filter: 'dateRange',
      render: task => (
        <span className={`task-due due-${task.dueTone}`}>{dueText(task, language, settings) || t('No date')}</span>
      )
    },
    {
      ...base('tags'),
      filter: 'text',
      render: task =>
        task.tags?.length ? (
          <span className="tag-list">
            {task.tags.map((tag: any) => (
              <span className="tag-chip" key={tag.id}>
                {tag.name}
              </span>
            ))}
          </span>
        ) : (
          <span className="muted">—</span>
        )
    },
    { ...base('type'), filter: 'select', options: pick(TYPES), render: task => task.type },
    {
      ...base('blocked'),
      filter: 'boolean',
      render: task =>
        task.blocked ? <span className="blocked-chip">{t('Blocked')}</span> : <span className="muted">—</span>
    },
    { ...base('created'), filter: 'dateRange', render: task => task.createdAt || '—' },
    { ...base('completed'), filter: 'dateRange', render: task => task.completedAt || '—' }
  ].map(column => withEditing(column as GridColumn<any>, ctx, t, replan, pick)) as GridColumn<any>[]
}

/** Attach in-place editing to the columns that have it, for the people who may use it. */
function withEditing(
  column: GridColumn<any>,
  ctx: TaskColumnContext,
  t: (phrase: string, values?: Record<string, unknown>) => string,
  replan: (task: any) => boolean | string | undefined,
  pick: (values: string[]) => { value: string; label: string }[]
): GridColumn<any> {
  const label = (what: string) => (task: any) => `${t(what)}: ${task.id}`
  if (!ctx.canWrite) return column
  switch (column.key) {
    case 'status':
      return {
        ...column,
        edit: {
          kind: 'select',
          always: true,
          className: 'status-select',
          label: task => `${t('Status')}: ${task.title}`,
          options: task => pick([...new Set([...ctx.statuses, task.status])]),
          get: task => task.status,
          save: (task, value) => ctx.moveTo(task, value)
        }
      }
    case 'title':
      return {
        ...column,
        edit: {
          kind: 'text',
          required: true,
          maxLength: 300,
          label: label('Task'),
          enabled: task => Boolean(replan(task)),
          get: task => task.title,
          save: (task, value) => ctx.update(task, { title: value.trim() }, 'Title')
        }
      }
    case 'priority':
      return {
        ...column,
        edit: {
          kind: 'select',
          always: true,
          label: label('Priority'),
          options: () => pick(PRIORITIES),
          enabled: task => Boolean(replan(task)),
          get: task => task.priority,
          save: (task, value) => ctx.update(task, { priority: value }, 'Priority')
        }
      }
    case 'assignee':
      return {
        ...column,
        edit: {
          kind: 'select',
          label: label('Owner'),
          enabled: task => Boolean(replan(task)),
          options: () => [
            { value: '', label: t('Unassigned') },
            ...ctx.people.map(person => ({ value: person.id, label: person.name }))
          ],
          get: task => task.assigneeId || '',
          save: (task, value) => ctx.update(task, { assigneeId: value }, 'Owner')
        }
      }
    case 'due':
      return {
        ...column,
        edit: {
          kind: 'date',
          label: label('Due date'),
          enabled: task => Boolean(replan(task)),
          get: task => task.dueDate || '',
          save: (task, value) => ctx.update(task, { dueDate: value }, 'Due date')
        }
      }
    case 'type':
      return {
        ...column,
        edit: {
          kind: 'select',
          label: label('Type'),
          options: () => pick(TYPES),
          enabled: task => Boolean(replan(task)),
          get: task => task.type,
          save: (task, value) => ctx.update(task, { type: value }, 'Type')
        }
      }
    default:
      return column
  }
}
