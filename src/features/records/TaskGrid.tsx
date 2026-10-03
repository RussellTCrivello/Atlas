// The task grid: every capability for working with many tasks, on top of rows the database finds, sorts and pages. Selecting
// (one, the page, everything that matches, ranges), the actions that fit the selection, sorting by several columns, per-column
// and advanced filters, saved views, editing in place, bulk changes with progress and a precise report, deleting with undo,
// import, and exporting or printing exactly what is selected, filtered or everything. It is used by the project page and by the
// list view of "My work"; the page decides the scope, the grid does the rest.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, errorMessage } from '../../lib/api'
import { type BulkResult } from '../../lib/bulk'
import { type ColumnFilters, type FilterValue, visibleColumns } from '../../lib/grid-model'
import { tr, uiLanguage } from '../../lib/i18n'
import * as selection from '../../lib/selection'
import { workflowStateLabels } from '../../lib/settings'
import { useApp } from '../../ui/app-context'
import { confirmAction } from '../../ui/confirm'
import { ExportMenu } from '../export/ExportMenu'
import { printRecords } from '../export/print'
import { BulkDialog, type BulkSpec } from './BulkDialog'
import { GridEmpty, GridError } from './grid/GridStates'
import { GridTable } from './grid/GridTable'
import { GridToolbar } from './grid/GridToolbar'
import { Pager } from './grid/Pager'
import { type BarAction, SelectionBar } from './grid/SelectionBar'
import { TASK_DEFS, TASK_FILTER_FIELDS, taskColumns } from './grid/task-columns'
import { useGridState } from './grid/use-grid-state'
import { useServerList } from './grid/use-server-list'
import { ImportDialog } from './ImportDialog'
import { RecordDrawer } from './RecordDrawer'
import { type TaskGridQuery, taskParams } from './task-query'
import { deletedToast } from './undo'
import { Icon } from '../../ui/icons'

/** The most records "select all matching" will select; the server refuses more (GET /api/tasks/ids). */
export const SELECTION_LIMIT = 10_000

interface TaskPage {
  rows: any[]
  total: number
  page: number
  pages: number
  pageSize: number
}
export interface TaskGridHandle {
  setFilter: (key: string, value: FilterValue) => void
  clearFilters: () => void
}
export interface SummaryApi {
  filters: ColumnFilters
  hasFilters: boolean
  total: number
  setFilter: (key: string, value: FilterValue) => void
  clearFilters: () => void
}
interface Props {
  /** The screen (and the key its saved views belong to): `project-tasks` or `my-work`. */
  scope: string
  /** Parameters that fix what the list is about: `{ project: '12' }`, `{ assignee: 'me' }`. */
  fixed: Record<string, string>
  /** What "Entire dataset" exports: `{ projectId: 12 }` or nothing. */
  fullScope: Record<string, string | number | boolean>
  data: any
  canWrite: boolean
  canManage: boolean
  openModal: (type: string, record?: any) => void
  refresh: () => void
  highlight?: number | null
  /** Columns hidden until the person switches them on (the project page hides "Project"). */
  hiddenColumns?: string[]
  searchLabel?: string
  tableClass?: string
  exportTitle: string
  /** A record to start from when adding (the project the page is about). */
  addPreset?: Record<string, unknown>
  /** The project that imports go to when the file does not say. */
  importProjectId?: number | null
  /** Rendered above the toolbar: the project page's numbers and status bar. */
  summary?: (api: SummaryApi) => ReactNode
  onFiltersChange?: (filters: ColumnFilters, hasFilters: boolean) => void
  /** Shown when the list is empty and nothing is filtered. */
  emptyNoun?: string
}

export const TaskGrid = forwardRef<TaskGridHandle, Props>(function TaskGrid(props, ref) {
  const { scope, fixed, fullScope, data, canWrite, canManage, openModal, refresh } = props
  const { user, settings, notify } = useApp()
  const t = useCallback((phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values), [settings])
  const language = uiLanguage(settings)
  const statuses = workflowStateLabels(settings)

  const defs = useMemo(
    () => TASK_DEFS.map(def => (props.hiddenColumns?.includes(def.key) ? { ...def, defaultHidden: true } : def)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [(props.hiddenColumns || []).join('|')]
  )
  const grid = useGridState({
    scope,
    userId: user?.id || '',
    defs,
    defaultSort: [{ key: 'due', dir: 'asc' }],
    defaultPageSize: Number(settings.pageSize) || 50,
    virtualFilters: ['state']
  })
  const query: TaskGridQuery = {
    q: grid.config.q,
    sort: grid.config.sort,
    columnFilters: grid.config.columnFilters,
    conditions: grid.config.conditions,
    page: grid.page,
    pageSize: grid.config.pageSize,
    fixed
  }
  const path = `/api/tasks?${taskParams(query)}`
  const gridQuery = taskParams(query, { paged: false }).toString()
  const list = useServerList<TaskPage>(path, data.revision)
  const rows = list.data?.rows ?? []
  const total = list.data?.total ?? 0
  const afterChange = useCallback(() => {
    list.reload()
    refresh()
  }, [list, refresh])

  // ---- selection ------------------------------------------------------------------------------------------------------
  const [picked, setPicked] = useState(selection.EMPTY_SELECTION)
  const [matchingKey, setMatchingKey] = useState<string | null>(null)
  const [selectingAll, setSelectingAll] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const announce = (message: string) => setAnnouncement(message)
  // What is selected belongs to what was found: changing the search or the filters starts a new selection (paging and sorting do not).
  const findKey = JSON.stringify([grid.config.q, grid.config.columnFilters, grid.config.conditions, fixed])
  useEffect(() => {
    setPicked(selection.EMPTY_SELECTION)
    setMatchingKey(null)
  }, [findKey])
  // A page that no longer exists (a delete emptied the last one) falls back to the last page that does.
  useEffect(() => {
    if (list.data && grid.page > list.data.pages) grid.setPage(list.data.pages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.data?.pages])
  useEffect(
    () => props.onFiltersChange?.(grid.config.columnFilters, grid.hasFilters),
    [grid.config.columnFilters, grid.hasFilters]
  ) // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({ setFilter: grid.setColumnFilter, clearFilters: grid.clearFilters }))

  const rowId = useCallback((task: any) => task.numericId as number, [])
  const visibleIds = useMemo(() => rows.map(rowId), [rows, rowId])
  const selectedIds = useMemo(() => selection.toArray(picked) as number[], [picked])
  const count = selectedIds.length
  const allMatching = matchingKey === findKey && count === total && total > 0
  const tooMany = total > SELECTION_LIMIT

  const selectAllMatching = async () => {
    if (selectingAll) return
    setSelectingAll(true)
    try {
      const found = await api.get(`/api/tasks/ids?${gridQuery}`)
      if (found.truncated) {
        notify({
          title: t('Too many to select'),
          body: t('{total} tasks match; at most {limit} can be selected at once. Narrow the filter first.', {
            total: found.total,
            limit: SELECTION_LIMIT
          }),
          tone: 'warning'
        })
        return
      }
      setPicked(current => selection.selectAll(current, found.ids))
      setMatchingKey(findKey)
      announce(t('All {count} matching tasks are selected', { count: found.ids.length }))
    } catch (error) {
      notify({ title: t('Could not select every matching task'), body: errorMessage(error), tone: 'warning' })
    } finally {
      setSelectingAll(false)
    }
  }

  // ---- one record -------------------------------------------------------------------------------------------------------
  const [drawerId, setDrawerId] = useState<number | null>(null)
  const [importing, setImporting] = useState(false)
  const [bulk, setBulk] = useState<BulkSpec | null>(null)
  const taskFor = async (id: number) =>
    rows.find(row => row.numericId === id) ?? (await api.get(`/api/tasks/${id}`)).task

  const update = useCallback(
    async (task: any, patch: Record<string, unknown>, what: string) => {
      try {
        await api.put(`/api/tasks/${task.numericId}`, patch)
        announce(t('{what} updated for {id}', { what: t(what), id: task.id }))
      } finally {
        afterChange()
      }
    },
    [afterChange, t]
  )
  const moveTo = useCallback(
    async (task: any, status: string) => {
      if (status === task.status) return
      try {
        await api.patch(`/api/tasks/${task.numericId}/status`, { status })
        notify({ title: t('Moved to {status}', { status }), body: task.title, tone: 'success' })
      } finally {
        afterChange()
      }
    },
    [afterChange, notify, t]
  )
  const advance = async (task: any) => {
    try {
      await api.patch(`/api/tasks/${task.numericId}/status`, { advance: true })
      notify({ title: t('Task advanced'), body: task.title, tone: 'success' })
    } catch (error) {
      notify({ title: t('Could not update the task'), body: errorMessage(error), tone: 'warning' })
    } finally {
      afterChange()
    }
  }
  const duplicate = async (task: any) => {
    try {
      const copy = await api.post(`/api/tasks/${task.numericId}/duplicate`, {})
      notify({ title: t('Task duplicated'), body: copy.title, tone: 'success' })
      setPicked(selection.toggle(selection.EMPTY_SELECTION, copy.numericId))
    } catch (error) {
      notify({ title: t('Could not duplicate the task'), body: errorMessage(error), tone: 'warning' })
    } finally {
      afterChange()
    }
  }
  const print = async (ids: number[], title: string) => {
    try {
      await printRecords(language, 'tasks', ids, title)
    } catch (error) {
      notify({ title: t('Could not print'), body: errorMessage(error), tone: 'warning' })
    }
  }

  // ---- bulk actions -----------------------------------------------------------------------------------------------------
  const done = (spec: BulkSpec, result: BulkResult, deleting: boolean) => {
    afterChange()
    const requested = [...new Set(spec.ids)]
    const attempted = requested.slice(0, requested.length - result.notAttempted)
    const failed = new Set(result.failed.map(item => item.id))
    // What could not be done stays selected so the cause can be fixed and the action tried again; what worked is released after a delete.
    const leftOver = [...requested.filter(id => failed.has(id) || !attempted.includes(id))]
    setPicked(current => {
      if (deleting) return selection.selectAll(selection.EMPTY_SELECTION, leftOver)
      return leftOver.length ? selection.selectAll(selection.EMPTY_SELECTION, leftOver) : current
    })
    setMatchingKey(null)
    if (deleting && result.succeeded > 0 && result.batch)
      notify(deletedToast(settings, result.succeeded, '', result.batch, notify, afterChange))
    announce(`${result.succeeded} of ${result.requested}`)
  }
  const personOptions = [
    { value: '', label: t('Unassigned') },
    ...data.people.map((person: any) => ({ value: person.id, label: person.name }))
  ]
  const suggestions = useServerTags()
  const openBulk = (kind: 'status' | 'assign' | 'edit' | 'tags') => {
    const base = {
      noun: t('tasks'),
      endpoint: '/api/tasks/bulk',
      ids: selectedIds,
      verb: t('Changed'),
      suggestions,
      onDone: (result: BulkResult, spec: BulkSpec) => done(spec, result, false)
    }
    if (kind === 'status')
      setBulk({
        ...base,
        title: t('Change status'),
        action: { action: 'status' },
        fields: [
          {
            name: 'status',
            label: t('New status'),
            kind: 'select',
            required: true,
            options: [{ value: '', label: t('Choose a status…') }, ...statuses.map(value => ({ value, label: value }))]
          }
        ],
        build: values => ({ body: { status: values.status } }),
        confirmLabel: n => t('Change status of {count} tasks', { count: n })
      })
    if (kind === 'assign')
      setBulk({
        ...base,
        title: t('Assign to'),
        action: { action: 'assign' },
        fields: [
          {
            name: 'assigneeId',
            label: t('Owner'),
            kind: 'select',
            options: [{ value: '__none', label: t('Choose a person…') }, ...personOptions]
          }
        ],
        build: values =>
          values.assigneeId === undefined || values.assigneeId === '__none'
            ? { errors: { assigneeId: t('Choose a person, or Unassigned') } }
            : { body: { assigneeId: values.assigneeId } },
        confirmLabel: n => t('Assign {count} tasks', { count: n })
      })
    if (kind === 'edit')
      setBulk({
        ...base,
        title: t('Edit fields'),
        action: { action: 'edit' },
        intro: (
          <p className="field-hint">{t('Only the fields you fill in are changed. Leave the others as they are.')}</p>
        ),
        fields: [
          {
            name: 'priority',
            label: t('Priority'),
            kind: 'select',
            options: [
              { value: '', label: t('— leave as is —') },
              ...['High', 'Medium', 'Low'].map(value => ({ value, label: value }))
            ]
          },
          {
            name: 'type',
            label: t('Type'),
            kind: 'select',
            options: [
              { value: '', label: t('— leave as is —') },
              ...['Development', 'Design', 'Testing', 'Documentation'].map(value => ({ value, label: value }))
            ]
          },
          { name: 'dueDate', label: t('Due date'), kind: 'date' },
          { name: 'clearDue', label: t('Remove the due date'), kind: 'checkbox' },
          {
            name: 'blocked',
            label: t('Blocked'),
            kind: 'select',
            options: [
              { value: '', label: t('— leave as is —') },
              { value: 'yes', label: t('Blocked') },
              { value: 'no', label: t('Not blocked') }
            ]
          },
          {
            name: 'projectId',
            label: t('Move to project'),
            kind: 'select',
            options: [
              { value: '', label: t('— leave as is —') },
              ...data.projects.map((project: any) => ({ value: String(project.numericId), label: project.name }))
            ]
          }
        ],
        build: values => {
          const body: Record<string, unknown> = {}
          if (values.priority) body.priority = values.priority
          if (values.type) body.type = values.type
          if (values.clearDue) body.dueDate = ''
          else if (values.dueDate) body.dueDate = values.dueDate
          if (values.blocked) body.blocked = values.blocked === 'yes'
          if (values.projectId) body.projectId = Number(values.projectId)
          return Object.keys(body).length ? { body } : { errors: { '': t('Choose at least one field to change.') } }
        },
        confirmLabel: n => t('Edit {count} tasks', { count: n })
      })
    if (kind === 'tags')
      setBulk({
        ...base,
        title: t('Tags'),
        action: { action: 'tag' },
        fields: [
          {
            name: 'mode',
            label: t('What to do'),
            kind: 'select',
            options: [
              { value: 'add', label: t('Add these tags') },
              { value: 'remove', label: t('Remove these tags') }
            ]
          },
          {
            name: 'tags',
            label: t('Tags'),
            kind: 'tags',
            required: true,
            hint: t('Press Enter or comma to add a tag.')
          }
        ],
        build: values =>
          values.tags?.length
            ? { body: { action: values.mode === 'remove' ? 'untag' : 'tag', tags: values.tags } }
            : { errors: { tags: t('Add at least one tag') } },
        confirmLabel: n => t('Update tags on {count} tasks', { count: n })
      })
  }

  const removeTasks = async (ids: number[]) => {
    if (!ids.length) return
    if (ids.length === 1) {
      const task = await taskFor(ids[0])
      const proceed = await confirmAction({
        title: t('Delete task {id}?', { id: task.id }),
        message: `“${task.title}”`,
        tone: 'danger',
        confirmLabel: t('Delete task'),
        undoHint: t('You can undo this for {days} days.', { days: 30 })
      })
      if (!proceed) return
      try {
        const result = await api.delete(`/api/tasks/${task.numericId}`)
        notify(deletedToast(settings, 1, task.title, result.batch, notify, afterChange))
        setPicked(current => selection.deselect(current, [task.numericId]))
        setDrawerId(null)
      } catch (error) {
        notify({ title: t('Could not delete'), body: errorMessage(error), tone: 'warning' })
      } finally {
        afterChange()
      }
      return
    }
    setBulk({
      title: t('Delete {count} tasks', { count: ids.length.toLocaleString('en') }),
      noun: t('tasks'),
      endpoint: '/api/tasks/bulk',
      ids,
      action: { action: 'delete' },
      fields: [],
      confirmLabel: n => t('Delete {count} tasks', { count: n.toLocaleString('en') }),
      verb: t('Deleted'),
      danger: true,
      groupAsOneUndo: true,
      undoHint: t('You can undo this for {days} days, from the message that follows.', { days: 30 }),
      onDone: (result, spec) => done(spec, result, true)
    })
  }
  const deleteFromKeyboard = (focused: any | null) => {
    if (!canManage) {
      notify({
        title: t('Not allowed'),
        body: t('Deleting tasks needs the “manageTasks” permission.'),
        tone: 'warning'
      })
      return
    }
    if (count > 0) void removeTasks(selectedIds)
    else if (focused) void removeTasks([focused.numericId])
  }

  // ---- what the bar offers for this many selected ----------------------------------------------------------------------
  const single = async (run: (task: any) => void) => {
    try {
      run(await taskFor(selectedIds[0]))
    } catch (error) {
      notify({ title: t('Could not open the task'), body: errorMessage(error), tone: 'warning' })
    }
  }
  const actions: BarAction[] = [
    {
      id: 'import',
      label: t('Import CSV'),
      icon: 'upload',
      always: true,
      hidden: !canWrite,
      onRun: () => setImporting(true)
    },
    { id: 'open', label: t('Open'), icon: 'eye', max: 1, onRun: () => setDrawerId(selectedIds[0]) },
    {
      id: 'edit',
      label: t('Edit'),
      icon: 'edit',
      max: 1,
      hidden: !canWrite,
      onRun: () => single(task => openModal('task', task))
    },
    { id: 'duplicate', label: t('Duplicate'), icon: 'copy', max: 1, hidden: !canWrite, onRun: () => single(duplicate) },
    { id: 'status', label: t('Status'), icon: 'check', hidden: !canWrite, onRun: () => openBulk('status') },
    { id: 'assign', label: t('Assign'), icon: 'team', hidden: !canWrite, onRun: () => openBulk('assign') },
    { id: 'fields', label: t('Edit fields'), icon: 'edit', hidden: !canWrite, onRun: () => openBulk('edit') },
    { id: 'tags', label: t('Tags'), icon: 'tag', hidden: !canWrite, onRun: () => openBulk('tags') },
    { id: 'print', label: t('Print'), icon: 'print', onRun: () => print(selectedIds, props.exportTitle) },
    {
      id: 'delete',
      label: t('Delete'),
      icon: 'trash',
      tone: 'danger',
      hidden: !canManage,
      onRun: () => removeTasks(selectedIds)
    }
  ]

  const columns = useMemo(
    () => taskColumns({ settings, language, user, people: data.people, statuses, canWrite, canManage, update, moveTo }),
    [settings, language, user, data.people, statuses.join('|'), canWrite, canManage, update, moveTo] // eslint-disable-line react-hooks/exhaustive-deps
  )
  const shown = visibleColumns(columns, grid.config.columns)
  const position = drawerId === null ? -1 : visibleIds.indexOf(drawerId)

  return (
    <div className="task-grid" data-scope={scope}>
      {props.summary?.({
        filters: grid.config.columnFilters,
        hasFilters: grid.hasFilters,
        total,
        setFilter: grid.setColumnFilter,
        clearFilters: grid.clearFilters
      })}
      <GridToolbar
        grid={grid}
        scope={scope}
        defs={defs}
        filterFields={TASK_FILTER_FIELDS.map(field => ({ ...field, label: t(field.label) }))}
        searchLabel={props.searchLabel || t('Search tasks')}
      >
        <ExportMenu
          dataset="tasks"
          title={props.exportTitle}
          selection={selectedIds}
          fullScope={fullScope}
          grid={gridQuery}
          rowsHint={total}
          primary
        />
      </GridToolbar>
      <SelectionBar
        noun={t('tasks')}
        count={count}
        onPage={selectedIds.filter(id => visibleIds.includes(id)).length}
        pageRows={rows.length}
        pageState={selection.pageState(picked, visibleIds)}
        total={total}
        allMatching={allMatching}
        selectingAll={selectingAll}
        tooMany={tooMany}
        limit={SELECTION_LIMIT}
        onSelectAllMatching={selectAllMatching}
        onClear={() => {
          setPicked(selection.EMPTY_SELECTION)
          setMatchingKey(null)
        }}
        actions={actions}
      />
      {list.error && <GridError message={list.error} onRetry={list.reload} />}
      <div className={props.tableClass || 'task-grid-table'} aria-busy={list.loading}>
        <GridTable
          caption={t('Tasks')}
          rows={rows}
          rowId={rowId}
          rowLabel={task => `${task.id}: ${task.title}`}
          columns={shown}
          widths={grid.config.columns.widths}
          sort={grid.config.sort}
          onSort={grid.sortBy}
          filters={grid.config.columnFilters}
          onFilter={grid.setColumnFilter}
          showFilters={grid.showFilters}
          selection={picked}
          onSelect={next => {
            setPicked(next)
            if (next.ids.size !== total) setMatchingKey(null)
          }}
          onOpen={task => setDrawerId(task.numericId)}
          onEdit={canWrite ? task => openModal('task', task) : undefined}
          onDelete={canManage ? deleteFromKeyboard : undefined}
          onSelectAllMatching={tooMany ? undefined : selectAllMatching}
          onResize={grid.resize}
          onResetWidth={grid.resetWidths}
          highlight={props.highlight}
          loading={list.loading}
          rowActions={task => (
            <>
              {canWrite && !task.done && (
                <button
                  type="button"
                  className="icon-button subtle task-check"
                  aria-label={t('Advance {title} to the next status', { title: task.title })}
                  title={t('Advance to the next status')}
                  onClick={() => advance(task)}
                >
                  <Icon name="arrow" size={14} />
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  className="icon-button row-more"
                  aria-label={`${t('Edit')} ${task.title}`}
                  onClick={() => openModal('task', task)}
                >
                  <Icon name="edit" size={15} />
                </button>
              )}
            </>
          )}
        />
        {!rows.length && !list.loading && !list.error && (
          <GridEmpty
            noun={props.emptyNoun || t('tasks')}
            filtered={grid.hasFilters}
            onClear={() => {
              grid.clearFilters()
              props.onFiltersChange?.({}, false)
            }}
            onAdd={canWrite ? () => openModal('task', props.addPreset) : undefined}
            addLabel={t('Add task')}
            onImport={canWrite ? () => setImporting(true) : undefined}
          />
        )}
      </div>
      <Pager
        page={list.data?.page ?? grid.page}
        pages={list.data?.pages ?? 1}
        pageSize={grid.config.pageSize}
        total={total}
        noun={t('tasks')}
        onPage={grid.setPage}
        onPageSize={grid.setPageSize}
      />
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      {bulk && <BulkDialog spec={bulk} onClose={() => setBulk(null)} />}
      {importing && (
        <ImportDialog
          projects={data.projects}
          defaultProjectId={props.importProjectId}
          onClose={() => setImporting(false)}
          onImported={() => afterChange()}
        />
      )}
      {drawerId !== null && (
        <RecordDrawer
          taskId={drawerId}
          revision={data.revision}
          canWrite={canWrite}
          canManage={canManage}
          onClose={() => setDrawerId(null)}
          onEdit={task => {
            setDrawerId(null)
            openModal('task', task)
          }}
          onDuplicate={duplicate}
          onPrint={task => print([task.numericId], `${task.id}: ${task.title}`)}
          onDelete={task => removeTasks([task.numericId])}
          previous={position > 0 ? visibleIds[position - 1] : undefined}
          next={position >= 0 && position < visibleIds.length - 1 ? visibleIds[position + 1] : undefined}
          onNavigate={setDrawerId}
        />
      )}
    </div>
  )
})

/** Names of the tags that exist, offered while typing a tag. */
function useServerTags(): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    api
      .get('/api/tags')
      .then(result => alive && setNames((result.tags || []).map((tag: any) => tag.name)))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])
  return names
}
