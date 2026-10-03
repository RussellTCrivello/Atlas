import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../Icon.jsx'
import { actionVisible } from '../../lib/advanced-filters.js'
import { workflowStateLabels } from '../../lib/workflows.js'
import { customFieldDefinitions, hasPermission, roleDefinitions } from '../../lib/workspace.js'

function fieldErrorFor(type, message) {
  const text = String(message || '').toLowerCase()
  const rules = {
    task: [['title', /title/], ['projectId', /project/], ['assigneeId', /owner|assignee|person/], ['status', /workflow|status/], ['priority', /priority/], ['dueDate', /due date|calendar date/], ['type', /task type|category/], ['blocked', /blocked/], ['tags', /tags/]],
    project: [['name', /project name|name/], ['code', /project code|code/], ['teamId', /team/], ['ownerId', /owner/], ['status', /project status|status/], ['deadline', /deadline/], ['description', /description/]],
    person: [['name', /name/], ['email', /email/], ['teamId', /team/], ['capacity', /capacity/], ['status', /person status|status/]],
    alert: [['title', /title/], ['taskId', /task/], ['projectId', /project/], ['type', /type/], ['body', /details|body/]],
    milestone: [['name', /name/], ['projectId', /project/], ['dueDate', /due date|calendar date/], ['status', /status/]],
    activity: [['personId', /person/], ['yesterday', /yesterday/], ['today', /today/], ['blocked', /blocked/], ['upcoming', /upcoming/]],
    team: [['name', /name/]],
    user: [['name', /name/], ['email', /email/], ['role', /role/], ['personId', /person/], ['password', /password/]]
  }
  const field = rules[type]?.find(([, pattern]) => pattern.test(text))?.[0]
  return field ? { [field]: message } : {}
}

function CustomFieldInputs({ definitions = [], values = {}, onChange }) {
  if (!definitions.length) return null
  const setField = (key, value) => onChange({ ...(values || {}), [key]: value })
  return <section className="custom-field-runtime"><strong>Configured fields</strong>{definitions.filter(field => field.visible !== false).map(field => <label key={field.key || field.name}>{field.label || field.key}<input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : field.type === 'datetime' ? 'datetime-local' : field.type === 'checkbox' ? 'checkbox' : 'text'} checked={field.type === 'checkbox' ? Boolean(values?.[field.key]) : undefined} value={field.type === 'checkbox' ? undefined : (values?.[field.key] ?? '')} onChange={e => setField(field.key, field.type === 'checkbox' ? e.target.checked : e.target.value)} required={Boolean(field.required)}/></label>)}</section>
}

export function EntityFormModal({ modal, data, user, onClose, onSave, onDelete, onCreateAnother }) {
  const type = modal?.type
  const record = modal?.record
  const [form, setForm] = useState({})
  const [baseline, setBaseline] = useState({})
  const [savedRecord, setSavedRecord] = useState(null)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deleteTriggerRef = useRef(null)
  const activeRecord = savedRecord || record
  // Reset only when a new form instance is opened; background data refreshes must not erase an active draft.
  useEffect(() => {
    if (!type) return
    const firstProject = data.projects[0]?.numericId || ''
    const firstPerson = data.people[0]?.id || user?.personId || ''
    const firstTeam = data.teams[0]?.id || ''
    const taskStatuses = workflowStateLabels(data.settings)
    const presets = {
      task: { title: record?.title || '', projectId: record?.projectId || firstProject, assigneeId: record?.assigneeId || user?.personId || firstPerson, priority: record?.priority || 'Medium', dueDate: record?.dueDate || data.today, status: record?.status || taskStatuses[0] || 'To do', type: record?.type || 'Development', blocked: Boolean(record?.blocked), tagsText: Array.isArray(record?.tags) ? record.tags.join(', ') : '', customFields: record?.customFields || {} },
      project: { name: record?.name || '', code: record?.code || '', description: record?.description || '', teamId: record?.teamId || firstTeam, ownerId: record?.ownerId || user?.personId || firstPerson, color: record?.color || 'purple', status: record?.status || 'On track', deadline: record?.deadlineDate || data.today, customFields: record?.customFields || {} },
      person: { name: record?.name || '', email: record?.email || '', jobTitle: record?.jobTitle || record?.role || 'Contributor', teamId: record?.teamId || firstTeam, focus: record?.focus || 'Workspace priorities', capacity: record?.capacity ?? record?.load ?? 70, status: record?.status || 'On track', color: record?.color || 'purple', customFields: record?.customFields || {} },
      team: { name: record?.name || '', color: record?.color || 'purple', customFields: record?.customFields || {} },
      milestone: { name: record?.name || '', projectId: record?.projectId || record?.project?.numericId || firstProject, dueDate: record?.dueDate || data.today, status: record?.status || 'Upcoming', customFields: record?.customFields || {} },
      activity: { personId: record?.personId || user?.personId || firstPerson, yesterday: record?.yesterday || '', today: record?.today || '', blocked: record?.blocked || '', upcoming: record?.upcoming || '', customFields: record?.customFields || {} },
      alert: { title: record?.title || '', body: record?.body || '', type: record?.type || 'info', tone: record?.tone || 'blue', projectId: record?.projectId || '', taskId: record?.taskId || '', customFields: record?.customFields || {} },
      user: { name: record?.name || '', email: record?.email || '', password: '', role: record?.role || 'Viewer', personId: record?.personId || firstPerson, avatarColor: record?.avatarColor || 'purple', active: record?.active !== false }
    }
    const initialForm = presets[type] || {}
    setForm(initialForm)
    setBaseline(initialForm)
    setSavedRecord(null)
    setError('')
    setFieldErrors({})
    setDeleteConfirm(false)
    setDeleting(false)
  }, [modal, type, user?.personId])
  useEffect(() => {
    if (!deleteConfirm && !deleting && deleteTriggerRef.current?.isConnected) deleteTriggerRef.current.focus()
  }, [deleteConfirm, deleting])
  useEffect(() => {
    if (!type) return undefined
    const root = document.querySelector('.modal-backdrop .modal')
    for (const [field, message] of Object.entries(fieldErrors)) {
      if (!message) continue
      const selectorField = String(field).replace(/[^a-zA-Z0-9_-]/g, '')
      const wrapper = root?.querySelector(`[data-form-fields*="${selectorField}"]`)
      const control = wrapper?.querySelector('input,select,textarea')
      control?.setAttribute('aria-invalid', 'true')
      control?.setAttribute('aria-describedby', `form-field-error-${selectorField}`)
    }
    return () => root?.querySelectorAll('[aria-invalid="true"]').forEach(control => { control.removeAttribute('aria-invalid'); control.removeAttribute('aria-describedby') })
  }, [fieldErrors, type])
  if (!type) return null
  const isEdit = Boolean(activeRecord?.numericId || activeRecord?.id)
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline)
  const savePermission = { task: 'manageTasks', project: 'manageProjects', person: 'managePeople', team: 'managePeople', milestone: 'manageProjects', activity: 'logActivity', alert: 'manageAlerts', user: 'manageUsers' }[type]
  const deletePermission = { task: 'manageTasks', project: 'manageProjects', person: 'managePeople', team: 'managePeople', milestone: 'manageProjects', activity: 'manageTasks', alert: 'manageAlerts', user: 'manageUsers' }[type]
  const canSaveRecord = actionVisible(data.settings, isEdit ? 'edit' : 'create') && hasPermission(user, savePermission)
  const canCreateAnother = actionVisible(data.settings, 'create') && hasPermission(user, savePermission)
  const canDeleteRecord = isEdit && actionVisible(data.settings, 'delete') && hasPermission(user, deletePermission)
  const taskStatuses = workflowStateLabels(data.settings)
  const roles = roleDefinitions(data.settings)
  const fieldDefs = customFieldDefinitions(data.settings, type)
  const set = (key, value) => { setForm(current => ({ ...current, [key]: value })); setFieldErrors(current => { const next = { ...current }; delete next[key]; return next }) }
  const requestClose = () => { if (dirty && !window.confirm('Discard unsaved changes?')) return; onClose() }
  const resetForm = () => { if (dirty && !window.confirm('Reset all unsaved changes to the last saved values?')) return; setForm(baseline); setError(''); setFieldErrors({}) }
  const deletionImpact = () => {
    if (!activeRecord) return ''
    if (type === 'project') {
      const tasks = data.tasks.filter(task => String(task.projectId) === String(activeRecord.numericId)).length
      const milestones = activeRecord.milestoneRows?.length || 0
      const taskIds = new Set(data.tasks.filter(task => String(task.projectId) === String(activeRecord.numericId)).map(task => String(task.numericId)))
      const alerts = data.alerts.filter(alert => String(alert.projectId || '') === String(activeRecord.numericId) || taskIds.has(String(alert.taskId || ''))).length
      return `This also permanently removes ${tasks} linked task${tasks === 1 ? '' : 's'}, ${milestones} milestone${milestones === 1 ? '' : 's'}, and ${alerts} related alert${alerts === 1 ? '' : 's'}.`
    }
    if (type === 'task') {
      const alerts = data.alerts.filter(alert => String(alert.taskId || '') === String(activeRecord.numericId)).length
      return alerts ? `${alerts} linked alert${alerts === 1 ? '' : 's'} will also be removed.` : ''
    }
    if (type === 'person') {
      const tasks = data.tasks.filter(task => String(task.assigneeId || '') === String(activeRecord.id)).length
      const projects = data.projects.filter(project => String(project.ownerId || '') === String(activeRecord.id)).length
      const activity = data.activity.filter(row => String(row.personId || '') === String(activeRecord.id)).length
      return `The profile is linked to ${tasks} task${tasks === 1 ? '' : 's'}, ${projects} project${projects === 1 ? '' : 's'}, and ${activity} visible activity record${activity === 1 ? '' : 's'}. Additional user-account or retained work-ledger references may block deletion; reassign or remove dependencies first.`
    }
    if (type === 'team') {
      const people = data.people.filter(person => String(person.teamId) === String(activeRecord.id)).length
      const projects = data.projects.filter(project => String(project.teamId) === String(activeRecord.id)).length
      return `This team is linked to ${people} people and ${projects} projects. Reassign linked records before deleting the team.`
    }
    if (type === 'activity') {
      const alerts = data.alerts.filter(alert => String(alert.activityId || '') === String(activeRecord.id)).length
      return alerts ? `${alerts} linked alert${alerts === 1 ? '' : 's'} will remain as historical records.` : ''
    }
    return ''
  }
  const removeRecord = async () => {
    if (!onDelete || !activeRecord || deleting) return
    setDeleting(true)
    setError('')
    try {
      const result = await onDelete(type, activeRecord, { confirmed: true })
      if (result === false) { setDeleteConfirm(false); return }
      setDeleteConfirm(false)
      onClose()
    } catch (deleteError) {
      setError(deleteError?.message || 'This record could not be deleted.')
      setDeleteConfirm(false)
    } finally { setDeleting(false) }
  }
  const focusField = field => {
    const selectorField = String(field).replace(/[^a-zA-Z0-9_-]/g, '')
    document.querySelector(`.modal-backdrop .modal [data-form-fields*="${selectorField}"]`)?.querySelector('input,select,textarea')?.focus()
  }
  const submit = async (event, mode = 'save') => {
    event.preventDefault()
    setError(''); setFieldErrors({})
    if (!canSaveRecord) { setError('Your role or workspace action settings do not allow this change.'); return }
    const payload = type === 'task' ? { ...form, tags: String(form.tagsText || '').split(',').map(tag => tag.trim()).filter(Boolean) } : form
    setSaving(true)
    try {
      const result = await onSave(type, activeRecord, payload)
      if (mode === 'continue') {
        const queuedRecord = result?.offlineQueued && result.localId
          ? { ...activeRecord, ...form, id: result.localId, ...(['task', 'project'].includes(type) ? { numericId: result.localId } : {}) }
          : result || activeRecord
        setSavedRecord(queuedRecord)
        setBaseline(structuredClone(form))
        setError(''); setFieldErrors({})
      } else if (mode === 'another' && canCreateAnother && onCreateAnother) onCreateAnother(type)
      else onClose()
    } catch (saveError) {
      const message = saveError?.message || 'The record could not be saved.'
      setError(message)
      setFieldErrors(fieldErrorFor(type, message))
    } finally { setSaving(false) }
  }
  const fields = () => {
    if (type === 'task') return <><label data-form-fields="title">Task title<input autoFocus value={form.title || ''} onChange={e => set('title', e.target.value)} required/></label><div className="form-row" data-form-fields="projectId,assigneeId"><label>Project<select value={form.projectId || ''} onChange={e => set('projectId', e.target.value)} required>{data.projects.map(p => <option key={p.numericId} value={p.numericId}>{p.name}</option>)}</select></label><label>Owner<select value={form.assigneeId || ''} onChange={e => set('assigneeId', e.target.value)} required>{data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><div className="form-row" data-form-fields="priority,dueDate"><label>Priority<select value={form.priority || 'Medium'} onChange={e => set('priority', e.target.value)}><option>High</option><option>Medium</option><option>Low</option></select></label><label>Due date<input type="date" value={form.dueDate || ''} onChange={e => set('dueDate', e.target.value)}/></label></div><div className="form-row" data-form-fields="status,type"><label>Status<select value={form.status || 'To do'} onChange={e => set('status', e.target.value)}>{taskStatuses.map(s => <option key={s}>{s}</option>)}</select></label><label>Type<select value={form.type || 'Development'} onChange={e => set('type', e.target.value)}><option>Development</option><option>Design</option><option>Testing</option><option>Documentation</option></select></label></div><label className="checkbox-label" data-form-fields="blocked"><input type="checkbox" checked={Boolean(form.blocked)} onChange={e => set('blocked', e.target.checked)}/> This task is blocked</label><label data-form-fields="tags">Tags / categories<input value={form.tagsText || ''} onChange={e => set('tagsText', e.target.value)} placeholder="Comma-separated tags"/></label></>
    if (type === 'project') return <><div className="form-row" data-form-fields="name,code"><label>Project name<input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required/></label><label>Code<input value={form.code || ''} onChange={e => set('code', e.target.value.toUpperCase())} required/></label></div><label data-form-fields="description">Objective<textarea value={form.description || ''} onChange={e => set('description', e.target.value)} rows="3"/></label><div className="form-row" data-form-fields="teamId,ownerId"><label>Team<select value={form.teamId || ''} onChange={e => set('teamId', e.target.value)} required>{data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label>Owner<select value={form.ownerId || ''} onChange={e => set('ownerId', e.target.value)} required>{data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><div className="form-row" data-form-fields="status,deadline"><label>Status<select value={form.status || 'On track'} onChange={e => set('status', e.target.value)}><option>On track</option><option>At risk</option><option>Completed</option></select></label><label>Deadline<input type="date" value={form.deadline || ''} onChange={e => set('deadline', e.target.value)}/></label></div></>
    if (type === 'person') return <><div className="form-row" data-form-fields="name,email"><label>Full name<input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required/></label><label>Email<input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} required/></label></div><div className="form-row" data-form-fields="jobTitle,teamId"><label>Job title<input value={form.jobTitle || ''} onChange={e => set('jobTitle', e.target.value)}/></label><label>Team<select value={form.teamId || ''} onChange={e => set('teamId', e.target.value)}>{data.teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div><label data-form-fields="focus">Current focus<input value={form.focus || ''} onChange={e => set('focus', e.target.value)}/></label><div className="form-row" data-form-fields="capacity,status"><label>Capacity<input type="number" min="0" max="100" value={form.capacity ?? 70} onChange={e => set('capacity', e.target.value)}/></label><label>Status<select value={form.status || 'On track'} onChange={e => set('status', e.target.value)}><option>On track</option><option>Needs attention</option></select></label></div></>
    if (type === 'team') return <><label data-form-fields="name">Team name<input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required/></label><label data-form-fields="color">Color<select value={form.color || 'purple'} onChange={e => set('color', e.target.value)}><option>purple</option><option>blue</option><option>orange</option><option>green</option><option>teal</option></select></label></>
    if (type === 'milestone') return <><label data-form-fields="name">Milestone name<input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required/></label><label data-form-fields="projectId">Project<select value={form.projectId || ''} onChange={e => set('projectId', e.target.value)}>{data.projects.map(p => <option key={p.numericId} value={p.numericId}>{p.name}</option>)}</select></label><div className="form-row" data-form-fields="dueDate,status"><label>Due date<input type="date" value={form.dueDate || ''} onChange={e => set('dueDate', e.target.value)}/></label><label>Status<select value={form.status || 'Upcoming'} onChange={e => set('status', e.target.value)}><option>Upcoming</option><option>At risk</option><option>Complete</option></select></label></div></>
    if (type === 'activity') return <><label data-form-fields="personId">Person<select value={form.personId || ''} onChange={e => set('personId', e.target.value)} required>{data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label data-form-fields="yesterday">Yesterday<textarea autoFocus value={form.yesterday || ''} onChange={e => set('yesterday', e.target.value)} rows="2"/></label><label data-form-fields="today">Today<textarea value={form.today || ''} onChange={e => set('today', e.target.value)} rows="2"/></label><label data-form-fields="blocked">Blocked<textarea value={form.blocked || ''} onChange={e => set('blocked', e.target.value)} rows="2"/></label><label data-form-fields="upcoming">Upcoming<textarea value={form.upcoming || ''} onChange={e => set('upcoming', e.target.value)} rows="2"/></label></>
    if (type === 'user') return <><div className="form-row" data-form-fields="name,email"><label>Full name<input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required/></label><label>Email<input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} required/></label></div><div className="form-row" data-form-fields="role,personId"><label>Role<select value={form.role || 'Viewer'} onChange={e => set('role', e.target.value)}>{Object.keys(roles).map(role => <option key={role}>{role}</option>)}</select></label><label>Linked person<select value={form.personId || ''} onChange={e => set('personId', e.target.value)}>{data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div><label data-form-fields="password">{record ? 'New password (optional)' : 'Password'}<input type="password" value={form.password || ''} onChange={e => set('password', e.target.value)} minLength={record ? undefined : 8} required={!record}/></label><div className="form-row" data-form-fields="avatarColor,active"><label>Avatar color<select value={form.avatarColor || 'purple'} onChange={e => set('avatarColor', e.target.value)}><option>purple</option><option>blue</option><option>orange</option><option>green</option><option>pink</option><option>teal</option></select></label><label className="checkbox-label"><input type="checkbox" checked={form.active !== false} onChange={e => set('active', e.target.checked)}/> Account active</label></div><div className="settings-note" data-form-fields="role"><Icon name="check" size={15}/><span>{roles[form.role || 'Viewer']?.summary || roles[form.role || 'Viewer']?.description}</span></div></>
    return <><label data-form-fields="title">Alert title<input autoFocus value={form.title || ''} onChange={e => set('title', e.target.value)} required/></label><label data-form-fields="body">Details<textarea value={form.body || ''} onChange={e => set('body', e.target.value)} rows="3"/></label><div className="form-row" data-form-fields="type,projectId"><label>Type<select value={form.type || 'info'} onChange={e => set('type', e.target.value)}><option value="info">Info</option><option value="deadline">Deadline</option><option value="blocker">Blocker</option><option value="risk">Risk</option></select></label><label>Project<select value={form.projectId || ''} onChange={e => set('projectId', e.target.value)}><option value="">Workspace</option>{data.projects.map(p => <option key={p.numericId} value={p.numericId}>{p.name}</option>)}</select></label></div></>
  }
  const formSurface = { task: 'tasks', project: 'projects', person: 'people', user: 'users', activity: 'activity', alert: 'alerts', team: 'teams', milestone: 'milestones' }[type]
  const orderedFields = () => {
    const rendered = fields()
    const children = React.Children.toArray(React.isValidElement(rendered) && rendered.type === React.Fragment ? rendered.props.children : rendered)
    const configured = data.settings?.interface?.formLayouts?.[formSurface]
    if (!Array.isArray(configured) || !configured.length) return children
    const order = new Map(configured.map((key, index) => [String(key), index]))
    return children.map((child, index) => {
      const fieldKeys = String(child.props?.['data-form-fields'] || '').split(',').filter(Boolean)
      const ranks = fieldKeys.map(key => order.get(key)).filter(rank => rank !== undefined)
      return { child, index, rank: ranks.length ? Math.min(...ranks) : configured.length + index }
    }).sort((a, b) => a.rank - b.rank || a.index - b.index).map(item => item.child)
  }
  const title = `${isEdit ? 'Edit' : type === 'activity' ? 'Log' : 'Create'} ${type}`
  const fieldLabels = { title: 'Title', name: 'Name', code: 'Code', email: 'Email', projectId: 'Project', assigneeId: 'Owner', ownerId: 'Owner', teamId: 'Team', status: 'Status', priority: 'Priority', dueDate: 'Due date', deadline: 'Deadline', type: 'Type', tags: 'Tags', capacity: 'Capacity', personId: 'Person', password: 'Password' }
  const entries = Object.entries(fieldErrors).filter(([, message]) => message)
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && requestClose()}>
    <form className="modal" aria-hidden={deleteConfirm || undefined} inert={deleteConfirm || undefined} onSubmit={event => submit(event, event.nativeEvent.submitter?.dataset?.saveMode || 'save')} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); requestClose() } }}>
      <div className="modal-head"><div><span className="eyebrow"><span className="eyebrow-dot"/> Atlas record</span><h2>{title}</h2><p>Changes save to the local workspace; offline edits stay queued on this device.</p></div><button type="button" className="icon-button" onClick={requestClose} aria-label="Close record form"><Icon name="close" size={17}/></button></div>
      <div className="form-fields">
        {orderedFields()}<CustomFieldInputs definitions={fieldDefs} values={form.customFields || {}} onChange={value => set('customFields', value)}/>
        {entries.length > 0 && <div className="field-error-summary" role="alert"><strong>Review these fields</strong>{entries.map(([field, message]) => <button type="button" id={`form-field-error-${field}`} key={field} onClick={() => focusField(field)}><span>{fieldLabels[field] || field}</span>{message}</button>)}</div>}
        {error && entries.length === 0 && <div className="form-error" role="alert"><Icon name="warning" size={15}/>{error}</div>}
      </div>
      <div className="modal-foot">
        {canDeleteRecord && onDelete && <button ref={deleteTriggerRef} type="button" className="secondary-button danger-button" disabled={saving || deleting} onClick={() => setDeleteConfirm(true)}>Delete</button>}
        <span className={`form-dirty-state ${dirty ? 'is-dirty' : ''}`} role="status" aria-live="polite">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <button type="button" className="secondary-button" onClick={resetForm} disabled={!dirty || saving}>Reset</button>
        <button type="button" className="secondary-button" onClick={requestClose} disabled={saving}>Cancel</button>
        <button type="submit" data-save-mode="continue" className="secondary-button" disabled={!canSaveRecord || !dirty || saving}>{saving ? 'Saving…' : 'Save & continue'}</button>
        {canCreateAnother && <button type="submit" data-save-mode="another" className="secondary-button" disabled={!canSaveRecord || !dirty || saving}>Save & create another</button>}
        <button type="submit" data-save-mode="save" className="primary-button" disabled={!canSaveRecord || !dirty || saving}>{saving ? 'Saving…' : 'Save'} <Icon name="arrow" size={14}/></button>
      </div>
    </form>
    {deleteConfirm && <div className="record-modal-backdrop" role="presentation"><section className="record-confirm-modal danger" role="alertdialog" aria-modal="true" aria-busy={deleting} aria-labelledby="form-delete-title" aria-describedby="form-delete-description" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!deleting) setDeleteConfirm(false); return }
      if (event.key === 'Tab') {
        const focusable = [...event.currentTarget.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])')]
        const first = focusable[0], last = focusable[focusable.length - 1]
        if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
      }
    }}><header><h3 id="form-delete-title">Delete 1 {type} record?</h3><button type="button" className="icon-button" onClick={() => setDeleteConfirm(false)} disabled={deleting} aria-label="Cancel deletion"><Icon name="close" size={16}/></button></header><p id="form-delete-description">This action is permanent and cannot be restored from Atlas. {deletionImpact()}{dirty ? ' Unsaved form changes will also be discarded.' : ''}</p><div className="record-confirm-actions"><button type="button" data-dialog-initial autoFocus className="secondary-button" onClick={() => setDeleteConfirm(false)} disabled={deleting}>Cancel</button><button type="button" className="primary-button danger-confirm" onClick={removeRecord} aria-disabled={deleting}>{deleting ? <span role="status" aria-live="polite">Deleting…</span> : 'Delete 1 record'}</button></div></section></div>}
  </div>
}
