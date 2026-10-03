// What projects, people and alerts look like as tables, and what can be done with one or many of them. Each kind says which columns
// it has (and how they sort and filter), and builds the buttons for the selection bar from what is selected and what the person's
// role allows. The work itself is done by the server's bulk and duplicate endpoints; deleting one record keeps the application's
// own confirmation (which spells out what goes with it).
import { projectHash } from '../../app/routes'
import { api, errorMessage } from '../../lib/api'
import type { BulkResult } from '../../lib/bulk'
import { slug } from '../../lib/format'
import type { ColumnDef } from '../../lib/grid-model'
import { uiLanguage } from '../../lib/i18n'
import { deadlineText } from '../../lib/labels'
import { askAction } from '../../ui/confirm'
import { Avatar, ProgressBar, StatusPill } from '../../ui/primitives'
import type { BulkSpec } from './BulkDialog'
import type { EntityActions, EntityKind } from './EntityGrid'
import type { BarAction } from './grid/SelectionBar'
import { printRecords } from '../export/print'

type T = (phrase: string, values?: Record<string, unknown>) => string
const pick = (values: string[]) => values.map(value => ({ value, label: value }))

export interface EntityContext {
  data: any
  settings: any
  t: T
  notify: (toast: Record<string, unknown>) => void
  openModal: (type: string, record?: any) => void
  /** Delete one record with the application's own confirmation. */
  deleteOne: (type: string, record: any) => void
  refresh: () => void
  can: Record<string, boolean>
}

// ---- projects -------------------------------------------------------------------------------------------------------------
const PROJECT_DEFS: ColumnDef[] = [
  { key: 'name', label: 'Project', width: 270, minWidth: 140, fixed: true },
  { key: 'code', label: 'Code', width: 96 },
  { key: 'team', label: 'Team', width: 150 },
  { key: 'owner', label: 'Owner', width: 170 },
  { key: 'health', label: 'Health', width: 120 },
  { key: 'status', label: 'Status', width: 120, defaultHidden: true },
  { key: 'progress', label: 'Progress', width: 160 },
  { key: 'deadline', label: 'Deadline', width: 140 },
  { key: 'members', label: 'People', width: 160, defaultHidden: true }
]

export function projectKind(ctx: EntityContext): EntityKind<any> {
  const { data, settings, t } = ctx
  const language = uiLanguage(settings)
  return {
    scope: 'projects-table',
    noun: t('projects'),
    defs: PROJECT_DEFS,
    rowId: row => row.numericId,
    rowLabel: row => `${row.code}: ${row.name}`,
    defaultSort: [{ key: 'name', dir: 'asc' }],
    dataset: 'projects',
    exportTitle: 'Atlas projects',
    searchLabel: t('Search projects'),
    filterFields: [
      { key: 'name', label: 'Project' },
      { key: 'code', label: 'Code' },
      { key: 'team', label: 'Team' },
      { key: 'owner', label: 'Owner' },
      { key: 'status', label: 'Status' },
      { key: 'health', label: 'Health' },
      { key: 'progress', label: 'Progress', type: 'number' },
      { key: 'deadlineDate', label: 'Deadline', type: 'date' }
    ],
    columns: tt =>
      [
        {
          ...PROJECT_DEFS[0],
          sortable: true,
          filter: 'text',
          value: row => row.name,
          render: row => (
            <a href={projectHash(row.numericId)} data-no-open>
              <strong>{row.name}</strong>
            </a>
          )
        },
        { ...PROJECT_DEFS[1], sortable: true, filter: 'text', value: row => row.code, render: row => row.code },
        {
          ...PROJECT_DEFS[2],
          sortable: true,
          filter: 'select',
          options: pick(data.teams.map((team: any) => team.name)),
          value: row => row.team,
          render: row => row.team
        },
        {
          ...PROJECT_DEFS[3],
          sortable: true,
          filter: 'select',
          options: pick(data.people.map((person: any) => person.name)),
          value: row => row.owner,
          render: row => row.owner
        },
        {
          ...PROJECT_DEFS[4],
          sortable: true,
          filter: 'select',
          options: pick(['On track', 'At risk', 'Completed']),
          value: row => row.health,
          render: row => (
            <StatusPill tone={row.health === 'At risk' ? 'at-risk' : row.health === 'Completed' ? 'done' : 'on-track'}>
              {row.health}
            </StatusPill>
          )
        },
        {
          ...PROJECT_DEFS[5],
          sortable: true,
          filter: 'select',
          options: pick(['On track', 'At risk', 'Completed']),
          value: row => row.status,
          render: row => row.status
        },
        {
          ...PROJECT_DEFS[6],
          sortable: true,
          filter: 'number',
          value: row => row.progress,
          render: row => (
            <span className="progress-cell">
              <ProgressBar value={row.progress} color={row.color} /> <span>{row.progress}%</span>
            </span>
          )
        },
        {
          ...PROJECT_DEFS[7],
          sortable: true,
          filter: 'dateRange',
          value: row => row.deadlineDate,
          render: row => deadlineText(row, language, settings)
        },
        {
          ...PROJECT_DEFS[8],
          sortable: false,
          filter: 'text',
          value: row => (row.members || []).join(', '),
          render: row => (row.members || []).join(', ') || '—'
        }
      ] as any
  }
}

export function projectActions(ctx: EntityContext, afterBulk: (result: BulkResult) => void): EntityActions<any> {
  const { data, t, notify, can } = ctx
  const duplicate = async (row: any) => {
    const tasks = (await api.get(`/api/projects/${row.numericId}`).catch(() => null))?.totals?.total ?? 0
    const answer = await askAction({
      title: t('Duplicate “{name}”?', { name: row.name }),
      message: t('The copy keeps the plan: team, owner, deadline and milestones (as upcoming).'),
      checkbox: tasks
        ? { label: t('Also copy its {count} tasks (they start again at the first status)', { count: tasks }) }
        : undefined,
      confirmLabel: t('Duplicate')
    })
    if (!answer.confirmed) return
    try {
      const copy = await api.post(`/api/projects/${row.numericId}/duplicate`, { withTasks: answer.checked })
      notify({ title: t('Project duplicated'), body: copy.name, tone: 'success' })
    } catch (error) {
      notify({ title: t('Could not duplicate the project'), body: errorMessage(error), tone: 'warning' })
    } finally {
      ctx.refresh()
    }
  }
  const choose = (
    title: string,
    field: string,
    label: string,
    options: { value: string; label: string }[],
    body: (value: string) => Record<string, unknown>,
    action: string,
    ids: any[],
    tools: any,
    confirm: (n: number) => string
  ): BulkSpec => ({
    title,
    noun: t('projects'),
    endpoint: '/api/projects/bulk',
    ids,
    action: { action },
    fields: [
      { name: field, label, kind: 'select', required: true, options: [{ value: '', label: t('Choose…') }, ...options] }
    ],
    build: values => ({ body: body(values[field]) }),
    confirmLabel: confirm,
    verb: t('Changed'),
    onDone: () => undefined
  })
  return {
    afterBulk,
    onOpen: row => (window.location.hash = projectHash(row.numericId)),
    onEdit: can.manageProjects ? row => ctx.openModal('project', row) : undefined,
    onAdd: can.manageProjects ? () => ctx.openModal('project') : undefined,
    addLabel: t('New project'),
    onDelete: can.manageProjects
      ? rows => (rows.length === 1 ? ctx.deleteOne('project', rows[0]) : undefined)
      : undefined,
    rowActions: row =>
      can.manageProjects ? (
        <button
          type="button"
          className="icon-button row-more"
          aria-label={`${t('Edit')} ${row.name}`}
          onClick={() => ctx.openModal('project', row)}
        >
          <span aria-hidden="true">✎</span>
        </button>
      ) : null,
    bar: (selected, tools) => {
      const ids = selected.map(row => row.numericId)
      const one = selected[0]
      const manage = !can.manageProjects
      return [
        {
          id: 'add',
          label: t('New project'),
          icon: 'plus',
          always: true,
          hidden: manage,
          onRun: () => ctx.openModal('project')
        },
        {
          id: 'open',
          label: t('Open'),
          icon: 'eye',
          max: 1,
          onRun: () => (window.location.hash = projectHash(one.numericId))
        },
        {
          id: 'edit',
          label: t('Edit'),
          icon: 'edit',
          max: 1,
          hidden: manage,
          onRun: () => ctx.openModal('project', one)
        },
        { id: 'duplicate', label: t('Duplicate'), icon: 'copy', max: 1, hidden: manage, onRun: () => duplicate(one) },
        {
          id: 'status',
          label: t('Status'),
          icon: 'check',
          hidden: manage,
          onRun: () =>
            tools.bulk(
              choose(
                t('Change status'),
                'status',
                t('New status'),
                pick(['On track', 'At risk', 'Completed']),
                value => ({ status: value }),
                'status',
                ids,
                tools,
                n => t('Change status of {count} projects', { count: n })
              )
            )
        },
        {
          id: 'owner',
          label: t('Owner'),
          icon: 'team',
          hidden: manage,
          onRun: () =>
            tools.bulk(
              choose(
                t('Change owner'),
                'ownerId',
                t('New owner'),
                data.people.map((p: any) => ({ value: p.id, label: p.name })),
                value => ({ ownerId: value }),
                'owner',
                ids,
                tools,
                n => t('Change the owner of {count} projects', { count: n })
              )
            )
        },
        {
          id: 'team',
          label: t('Team'),
          icon: 'team',
          hidden: manage,
          onRun: () =>
            tools.bulk(
              choose(
                t('Move to a team'),
                'teamId',
                t('Team'),
                data.teams.map((x: any) => ({ value: x.id, label: x.name })),
                value => ({ teamId: value }),
                'team',
                ids,
                tools,
                n => t('Move {count} projects', { count: n })
              )
            )
        },
        {
          id: 'print',
          label: t('Print'),
          icon: 'print',
          onRun: () =>
            printRecords(uiLanguage(ctx.settings), 'projects', ids, 'Atlas projects').catch(error =>
              notify({ title: t('Could not print'), body: errorMessage(error), tone: 'warning' })
            )
        },
        {
          id: 'delete',
          label: t('Delete'),
          icon: 'trash',
          tone: 'danger',
          hidden: manage,
          onRun: () => {
            if (selected.length === 1) return ctx.deleteOne('project', one)
            tools.bulk({
              title: t('Delete {count} projects', { count: ids.length }),
              noun: t('projects'),
              endpoint: '/api/projects/bulk',
              ids,
              action: { action: 'delete' },
              intro: (
                <p className="field-hint">
                  {t(
                    'A project that still has tasks or milestones is refused unless you tick the box below. A backup is taken first.'
                  )}
                </p>
              ),
              fields: [
                {
                  name: 'cascade',
                  label: t('Also delete the tasks, milestones and alerts of these projects'),
                  kind: 'checkbox'
                }
              ],
              build: values => ({ body: { cascade: Boolean(values.cascade) } }),
              confirmLabel: n => t('Delete {count} projects', { count: n }),
              verb: t('Deleted'),
              danger: true,
              irreversible: true,
              onDone: () => undefined
            })
          }
        }
      ] as BarAction[]
    }
  }
}

// ---- people ---------------------------------------------------------------------------------------------------------------
const PERSON_DEFS: ColumnDef[] = [
  { key: 'name', label: 'Name', width: 240, minWidth: 140, fixed: true },
  { key: 'email', label: 'Email', width: 230 },
  { key: 'role', label: 'Role', width: 170 },
  { key: 'team', label: 'Team', width: 150 },
  { key: 'status', label: 'Status', width: 140 },
  { key: 'load', label: 'Planned capacity', width: 150 },
  { key: 'focus', label: 'Focus', width: 240, defaultHidden: true }
]

export function personKind(ctx: EntityContext): EntityKind<any> {
  const { data, t } = ctx
  return {
    scope: 'people-table',
    noun: t('people'),
    defs: PERSON_DEFS,
    rowId: row => row.id,
    rowLabel: row => row.name,
    defaultSort: [{ key: 'name', dir: 'asc' }],
    dataset: 'people',
    exportTitle: 'Atlas people',
    searchLabel: t('Search people'),
    filterFields: [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'role', label: 'Role' },
      { key: 'team', label: 'Team' },
      { key: 'status', label: 'Status' },
      { key: 'load', label: 'Planned capacity', type: 'number' }
    ],
    columns: () =>
      [
        {
          ...PERSON_DEFS[0],
          sortable: true,
          filter: 'text',
          value: (row: any) => row.name,
          render: (row: any) => (
            <span className="owner-cell">
              <Avatar name={row.name} color={row.color} small /> <strong>{row.name}</strong>
            </span>
          )
        },
        {
          ...PERSON_DEFS[1],
          sortable: true,
          filter: 'text',
          value: (row: any) => row.email,
          render: (row: any) => row.email || '—'
        },
        {
          ...PERSON_DEFS[2],
          sortable: true,
          filter: 'text',
          value: (row: any) => row.role,
          render: (row: any) => row.role
        },
        {
          ...PERSON_DEFS[3],
          sortable: true,
          filter: 'select',
          options: pick(data.teams.map((team: any) => team.name)),
          value: (row: any) => row.team,
          render: (row: any) => row.team
        },
        {
          ...PERSON_DEFS[4],
          sortable: true,
          filter: 'select',
          options: pick(['On track', 'Needs attention', 'At risk']),
          value: (row: any) => row.status,
          render: (row: any) => <StatusPill tone={slug(row.status)}>{row.status}</StatusPill>
        },
        {
          ...PERSON_DEFS[5],
          sortable: true,
          filter: 'number',
          value: (row: any) => row.load,
          render: (row: any) => `${row.load}%`
        },
        {
          ...PERSON_DEFS[6],
          sortable: true,
          filter: 'text',
          value: (row: any) => row.focus,
          render: (row: any) => row.focus
        }
      ] as any
  }
}

export function personActions(ctx: EntityContext, afterBulk: (result: BulkResult) => void): EntityActions<any> {
  const { data, t, notify, can } = ctx
  const duplicate = async (row: any) => {
    try {
      const copy = await api.post(`/api/people/${row.id}/duplicate`, {})
      notify({ title: t('Person duplicated'), body: copy.name, tone: 'success' })
    } catch (error) {
      notify({ title: t('Could not duplicate'), body: errorMessage(error), tone: 'warning' })
    } finally {
      ctx.refresh()
    }
  }
  return {
    afterBulk,
    onOpen: can.managePeople ? row => ctx.openModal('person', row) : undefined,
    onEdit: can.managePeople ? row => ctx.openModal('person', row) : undefined,
    onAdd: can.managePeople ? () => ctx.openModal('person') : undefined,
    addLabel: t('Add person'),
    onDelete: can.managePeople ? rows => (rows.length === 1 ? ctx.deleteOne('person', rows[0]) : undefined) : undefined,
    bar: (selected, tools) => {
      const ids = selected.map(row => row.id)
      const one = selected[0]
      const manage = !can.managePeople
      return [
        {
          id: 'add',
          label: t('Add person'),
          icon: 'plus',
          always: true,
          hidden: manage,
          onRun: () => ctx.openModal('person')
        },
        {
          id: 'edit',
          label: t('Edit'),
          icon: 'edit',
          max: 1,
          hidden: manage,
          onRun: () => ctx.openModal('person', one)
        },
        { id: 'duplicate', label: t('Duplicate'), icon: 'copy', max: 1, hidden: manage, onRun: () => duplicate(one) },
        {
          id: 'team',
          label: t('Team'),
          icon: 'team',
          hidden: manage,
          onRun: () =>
            tools.bulk({
              title: t('Move to a team'),
              noun: t('people'),
              endpoint: '/api/people/bulk',
              ids,
              action: { action: 'team' },
              fields: [
                {
                  name: 'teamId',
                  label: t('Team'),
                  kind: 'select',
                  required: true,
                  options: [
                    { value: '', label: t('Choose…') },
                    ...data.teams.map((x: any) => ({ value: x.id, label: x.name }))
                  ]
                }
              ],
              build: values => ({ body: { teamId: values.teamId } }),
              confirmLabel: n => t('Move {count} people', { count: n }),
              verb: t('Moved'),
              onDone: () => undefined
            })
        },
        {
          id: 'print',
          label: t('Print'),
          icon: 'print',
          onRun: () =>
            printRecords(uiLanguage(ctx.settings), 'people', ids, 'Atlas people').catch(error =>
              notify({ title: t('Could not print'), body: errorMessage(error), tone: 'warning' })
            )
        },
        {
          id: 'delete',
          label: t('Delete'),
          icon: 'trash',
          tone: 'danger',
          hidden: manage,
          onRun: () => {
            if (selected.length === 1) return ctx.deleteOne('person', one)
            tools.bulk({
              title: t('Delete {count} people', { count: ids.length }),
              noun: t('people'),
              endpoint: '/api/people/bulk',
              ids,
              action: { action: 'delete' },
              intro: (
                <p className="field-hint">
                  {t(
                    'Their tasks become unassigned. A person who has a sign-in account is refused: delete or re-link the account first.'
                  )}
                </p>
              ),
              fields: [],
              confirmLabel: n => t('Delete {count} people', { count: n }),
              verb: t('Deleted'),
              danger: true,
              irreversible: true,
              onDone: () => undefined
            })
          }
        }
      ] as BarAction[]
    }
  }
}

// ---- alerts ---------------------------------------------------------------------------------------------------------------
const ALERT_DEFS: ColumnDef[] = [
  { key: 'title', label: 'Alert', width: 300, minWidth: 140, fixed: true },
  { key: 'type', label: 'Type', width: 110 },
  { key: 'project', label: 'Project', width: 180 },
  { key: 'state', label: 'State', width: 120 },
  { key: 'time', label: 'Created', width: 130 },
  { key: 'body', label: 'Details', width: 300, defaultHidden: true }
]

export function alertKind(ctx: EntityContext): EntityKind<any> {
  const { data, t } = ctx
  return {
    scope: 'alerts-table',
    noun: t('alerts'),
    defs: ALERT_DEFS,
    rowId: row => row.id,
    rowLabel: row => row.title,
    defaultSort: [{ key: 'time', dir: 'desc' }],
    dataset: 'alerts',
    exportTitle: 'Atlas alerts',
    searchLabel: t('Search alerts'),
    filterFields: [
      { key: 'title', label: 'Alert' },
      { key: 'type', label: 'Type' },
      { key: 'project', label: 'Project' },
      { key: 'resolved', label: 'Resolved' },
      { key: 'createdAt', label: 'Created', type: 'date' }
    ],
    columns: () =>
      [
        {
          ...ALERT_DEFS[0],
          sortable: true,
          filter: 'text',
          value: (row: any) => row.title,
          render: (row: any) => <strong>{row.title}</strong>
        },
        {
          ...ALERT_DEFS[1],
          sortable: true,
          filter: 'select',
          options: pick(['info', 'deadline', 'blocker', 'risk', 'overdue']),
          value: (row: any) => row.type,
          render: (row: any) => row.type
        },
        {
          ...ALERT_DEFS[2],
          sortable: true,
          filter: 'select',
          options: pick(['Workspace', ...data.projects.map((p: any) => p.name)]),
          value: (row: any) => row.project,
          render: (row: any) => row.project
        },
        {
          ...ALERT_DEFS[3],
          sortable: true,
          filter: 'select',
          options: pick(['Open', 'Resolved']),
          value: (row: any) => (row.resolved ? 'Resolved' : 'Open'),
          render: (row: any) =>
            row.resolved ? (
              <StatusPill tone="resolved">{t('Resolved')}</StatusPill>
            ) : (
              <StatusPill tone="at-risk">{t('Open')}</StatusPill>
            )
        },
        {
          ...ALERT_DEFS[4],
          sortable: true,
          filter: 'dateRange',
          value: (row: any) => row.createdAt,
          render: (row: any) => row.time
        },
        {
          ...ALERT_DEFS[5],
          sortable: true,
          filter: 'text',
          value: (row: any) => row.body,
          render: (row: any) => row.body || '—'
        }
      ] as any
  }
}

export function alertActions(ctx: EntityContext, afterBulk: (result: BulkResult) => void): EntityActions<any> {
  const { t, notify, can } = ctx
  const duplicate = async (row: any) => {
    try {
      const copy = await api.post(`/api/alerts/${row.id}/duplicate`, {})
      notify({ title: t('Alert duplicated'), body: copy.title, tone: 'success' })
    } catch (error) {
      notify({ title: t('Could not duplicate'), body: errorMessage(error), tone: 'warning' })
    } finally {
      ctx.refresh()
    }
  }
  const simple = (
    action: 'resolve' | 'reopen' | 'delete',
    title: string,
    ids: any[],
    verb: string,
    confirm: (n: number) => string,
    extra: Partial<BulkSpec> = {}
  ): BulkSpec => ({
    title,
    noun: t('alerts'),
    endpoint: '/api/alerts/bulk',
    ids,
    action: { action },
    fields: [],
    confirmLabel: confirm,
    verb,
    onDone: () => undefined,
    ...extra
  })
  return {
    afterBulk,
    onEdit: can.manageAlerts ? row => ctx.openModal('alert', row) : undefined,
    onOpen: can.manageAlerts ? row => ctx.openModal('alert', row) : undefined,
    onAdd: can.manageAlerts ? () => ctx.openModal('alert') : undefined,
    addLabel: t('New alert'),
    onDelete: can.manageAlerts ? rows => (rows.length === 1 ? ctx.deleteOne('alert', rows[0]) : undefined) : undefined,
    bar: (selected, tools) => {
      const ids = selected.map(row => row.id)
      const one = selected[0]
      return [
        {
          id: 'add',
          label: t('New alert'),
          icon: 'plus',
          always: true,
          hidden: !can.manageAlerts,
          onRun: () => ctx.openModal('alert')
        },
        {
          id: 'edit',
          label: t('Edit'),
          icon: 'edit',
          max: 1,
          hidden: !can.manageAlerts,
          onRun: () => ctx.openModal('alert', one)
        },
        {
          id: 'duplicate',
          label: t('Duplicate'),
          icon: 'copy',
          max: 1,
          hidden: !can.manageAlerts,
          onRun: () => duplicate(one)
        },
        {
          id: 'resolve',
          label: t('Mark resolved'),
          icon: 'check',
          hidden: !can.resolveAlerts,
          onRun: () =>
            tools.bulk(
              simple('resolve', t('Mark resolved'), ids, t('Resolved'), n => t('Resolve {count} alerts', { count: n }))
            )
        },
        {
          id: 'reopen',
          label: t('Re-open'),
          icon: 'undo',
          hidden: !can.resolveAlerts,
          onRun: () =>
            tools.bulk(
              simple('reopen', t('Re-open'), ids, t('Re-opened'), n => t('Re-open {count} alerts', { count: n }))
            )
        },
        {
          id: 'print',
          label: t('Print'),
          icon: 'print',
          onRun: () =>
            printRecords(uiLanguage(ctx.settings), 'alerts', ids, 'Atlas alerts').catch(error =>
              notify({ title: t('Could not print'), body: errorMessage(error), tone: 'warning' })
            )
        },
        {
          id: 'delete',
          label: t('Delete'),
          icon: 'trash',
          tone: 'danger',
          hidden: !can.manageAlerts,
          onRun: () => {
            if (selected.length === 1) return ctx.deleteOne('alert', one)
            tools.bulk(
              simple(
                'delete',
                t('Delete {count} alerts', { count: ids.length }),
                ids,
                t('Deleted'),
                n => t('Delete {count} alerts', { count: n }),
                { danger: true, irreversible: true }
              )
            )
          }
        }
      ] as BarAction[]
    }
  }
}
