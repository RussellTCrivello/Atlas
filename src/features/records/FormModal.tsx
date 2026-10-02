// The dialog for creating and editing every kind of record.
import { useState, useRef, useEffect } from 'react'
import { tr } from '../../lib/i18n'
import { workflowStateLabels, customFieldDefinitions } from '../../lib/settings'
import { errorMessage } from '../../lib/api'
import { useApp } from '../../ui/app-context'
import { roleDefinitions } from '../../lib/roles'
import { Icon } from '../../ui/icons'
import { CustomFieldInputs } from '../../ui/custom-fields'

export function FormModal({ modal, data, user, onClose, onSave, onDelete }) {
  const type = modal?.type
  const record = modal?.record
  const { settings } = useApp()
  const [form, setForm] = useState<any>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const initialForm = useRef('')
  const dialogRef = useRef(null)
  const dirty = JSON.stringify(form) !== initialForm.current
  const requestClose = () => {
    if (dirty && !window.confirm(tr(settings, 'Discard your changes?'))) return
    onClose()
  }
  // Keyboard: Escape closes (asking first if there are unsaved edits), Tab stays inside the dialog.
  const onDialogKeyDown = event => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      requestClose()
    }
    if (event.key === 'Tab' && dialogRef.current) {
      const focusable = [
        ...dialogRef.current.querySelectorAll(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      ].filter(el => el.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }
  useEffect(() => {
    if (!type) return
    const opener = document.activeElement as HTMLElement | null
    return () => {
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) (opener as HTMLElement).focus()
    }
  }, [type])
  useEffect(() => {
    if (!type) return
    const firstProject = data.projects[0]?.numericId || ''
    const firstPerson = data.people[0]?.id || user?.personId || ''
    const firstTeam = data.teams[0]?.id || ''
    const taskStatuses = workflowStateLabels(data.settings)
    const presets = {
      task: {
        title: record?.title || '',
        projectId: record?.projectId || firstProject,
        assigneeId: record?.assigneeId || user?.personId || firstPerson,
        priority: record?.priority || 'Medium',
        dueDate: record?.dueDate || data.today,
        status: record?.status || taskStatuses[0] || 'To do',
        type: record?.type || 'Development',
        blocked: Boolean(record?.blocked),
        customFields: record?.customFields || {}
      },
      project: {
        name: record?.name || '',
        code: record?.code || '',
        description: record?.description || '',
        teamId: record?.teamId || firstTeam,
        ownerId: record?.ownerId || user?.personId || firstPerson,
        color: record?.color || 'purple',
        status: record?.status || 'On track',
        deadline: record?.deadlineDate || data.today,
        customFields: record?.customFields || {}
      },
      person: {
        name: record?.name || '',
        email: record?.email || '',
        jobTitle: record?.jobTitle || record?.role || 'Contributor',
        teamId: record?.teamId || firstTeam,
        focus: record?.focus || 'Workspace priorities',
        capacity: record?.capacity ?? record?.load ?? 70,
        status: record?.status || 'On track',
        color: record?.color || 'purple',
        customFields: record?.customFields || {}
      },
      team: { name: record?.name || '', color: record?.color || 'purple', customFields: record?.customFields || {} },
      milestone: {
        name: record?.name || '',
        projectId: record?.projectId || record?.project?.numericId || firstProject,
        dueDate: record?.dueDate || data.today,
        status: record?.status || 'Upcoming',
        customFields: record?.customFields || {}
      },
      activity: {
        personId: record?.personId || user?.personId || firstPerson,
        yesterday: '',
        today: '',
        blocked: '',
        upcoming: '',
        status: 'Confirmed',
        customFields: record?.customFields || {}
      },
      alert: {
        title: record?.title || '',
        body: record?.body || '',
        type: record?.type || 'info',
        tone: record?.tone || 'blue',
        projectId: record?.projectId || '',
        taskId: record?.taskId || '',
        customFields: record?.customFields || {}
      },
      user: {
        name: record?.name || '',
        email: record?.email || '',
        password: '',
        role: record?.role || 'Viewer',
        personId: record?.personId || '',
        avatarColor: record?.avatarColor || 'purple',
        active: record?.active !== false,
        mustChangePassword: true
      }
    }
    initialForm.current = JSON.stringify(presets[type] || {})
    setForm(presets[type] || {})
    setError('')
  }, [type, record?.numericId, record?.id])
  if (!type) return null
  const isEdit = Boolean(record?.numericId || record?.id)
  const taskStatuses = workflowStateLabels(data.settings)
  const roles = roleDefinitions(data.settings)
  const fieldDefs = customFieldDefinitions(data.settings, type)
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const submit = async e => {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      await onSave(type, record, form)
      initialForm.current = JSON.stringify(form)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const fields = () => {
    if (type === 'task')
      return (
        <>
          <label>
            Task title
            <input autoFocus value={form.title || ''} onChange={e => set('title', e.target.value)} required />
          </label>
          <div className="form-row">
            <label>
              Project
              <select value={form.projectId || ''} onChange={e => set('projectId', e.target.value)}>
                {data.projects.map(p => (
                  <option key={p.numericId} value={p.numericId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select value={form.assigneeId || ''} onChange={e => set('assigneeId', e.target.value)}>
                {data.people.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Priority
              <select value={form.priority || 'Medium'} onChange={e => set('priority', e.target.value)}>
                <option>High</option>
                <option>Medium</option>
                <option>Low</option>
              </select>
            </label>
            <label>
              Due date
              <input type="date" value={form.dueDate || ''} onChange={e => set('dueDate', e.target.value)} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Status
              <select value={form.status || 'To do'} onChange={e => set('status', e.target.value)}>
                {taskStatuses.map(s => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Type
              <select value={form.type || 'Development'} onChange={e => set('type', e.target.value)}>
                <option>Development</option>
                <option>Design</option>
                <option>Testing</option>
                <option>Documentation</option>
              </select>
            </label>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={Boolean(form.blocked)} onChange={e => set('blocked', e.target.checked)} />{' '}
            This task is blocked
          </label>
        </>
      )
    if (type === 'project')
      return (
        <>
          <div className="form-row">
            <label>
              Project name
              <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
            </label>
            <label>
              Code
              <input value={form.code || ''} onChange={e => set('code', e.target.value.toUpperCase())} required />
            </label>
          </div>
          <label>
            Objective
            <textarea value={form.description || ''} onChange={e => set('description', e.target.value)} rows={3} />
          </label>
          <div className="form-row">
            <label>
              Team
              <select value={form.teamId || ''} onChange={e => set('teamId', e.target.value)}>
                {data.teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Owner
              <select value={form.ownerId || ''} onChange={e => set('ownerId', e.target.value)}>
                {data.people.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-row">
            <label>
              Status
              <select value={form.status || 'On track'} onChange={e => set('status', e.target.value)}>
                <option>On track</option>
                <option>At risk</option>
                <option>Completed</option>
              </select>
            </label>
            <label>
              Deadline
              <input type="date" value={form.deadline || ''} onChange={e => set('deadline', e.target.value)} />
            </label>
          </div>
        </>
      )
    if (type === 'person')
      return (
        <>
          <div className="form-row">
            <label>
              Full name
              <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Job title
              <input value={form.jobTitle || ''} onChange={e => set('jobTitle', e.target.value)} />
            </label>
            <label>
              Team
              <select value={form.teamId || ''} onChange={e => set('teamId', e.target.value)}>
                {data.teams.map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Current focus
            <input value={form.focus || ''} onChange={e => set('focus', e.target.value)} />
          </label>
          <div className="form-row">
            <label>
              Planned capacity (%)
              <input
                type="number"
                min="0"
                max="100"
                value={form.capacity ?? 70}
                onChange={e => set('capacity', e.target.value)}
              />
            </label>
            <label>
              Status
              <select value={form.status || 'On track'} onChange={e => set('status', e.target.value)}>
                <option>On track</option>
                <option>Needs attention</option>
              </select>
            </label>
          </div>
        </>
      )
    if (type === 'team')
      return (
        <>
          <label>
            Team name
            <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
          </label>
          <label>
            Color
            <select value={form.color || 'purple'} onChange={e => set('color', e.target.value)}>
              <option>purple</option>
              <option>blue</option>
              <option>orange</option>
              <option>green</option>
              <option>teal</option>
            </select>
          </label>
        </>
      )
    if (type === 'milestone')
      return (
        <>
          <label>
            Milestone name
            <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
          </label>
          <label>
            Project
            <select value={form.projectId || ''} onChange={e => set('projectId', e.target.value)}>
              {data.projects.map(p => (
                <option key={p.numericId} value={p.numericId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Due date
              <input type="date" value={form.dueDate || ''} onChange={e => set('dueDate', e.target.value)} />
            </label>
            <label>
              Status
              <select value={form.status || 'Upcoming'} onChange={e => set('status', e.target.value)}>
                <option>Upcoming</option>
                <option>At risk</option>
                <option>Complete</option>
              </select>
            </label>
          </div>
        </>
      )
    if (type === 'activity')
      return (
        <>
          <label>
            Person
            <select value={form.personId || ''} onChange={e => set('personId', e.target.value)}>
              {data.people.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Yesterday
            <textarea
              autoFocus
              value={form.yesterday || ''}
              onChange={e => set('yesterday', e.target.value)}
              rows={2}
            />
          </label>
          <label>
            Today
            <textarea value={form.today || ''} onChange={e => set('today', e.target.value)} rows={2} />
          </label>
          <label>
            Blocked
            <textarea value={form.blocked || ''} onChange={e => set('blocked', e.target.value)} rows={2} />
          </label>
          <label>
            Upcoming
            <textarea value={form.upcoming || ''} onChange={e => set('upcoming', e.target.value)} rows={2} />
          </label>
        </>
      )
    if (type === 'user')
      return (
        <>
          <div className="form-row">
            <label>
              Full name
              <input autoFocus value={form.name || ''} onChange={e => set('name', e.target.value)} required />
            </label>
            <label>
              Email
              <input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} required />
            </label>
          </div>
          <div className="form-row">
            <label>
              Role
              <select value={form.role || 'Viewer'} onChange={e => set('role', e.target.value)}>
                {Object.keys(roles).map(role => (
                  <option key={role}>{role}</option>
                ))}
              </select>
            </label>
            <label>
              Linked person
              <select value={form.personId || ''} onChange={e => set('personId', e.target.value)}>
                {!record && <option value="">Create a new person profile</option>}
                {data.people
                  .filter(p => p.id === record?.personId || !(data.users || []).some(u => u.personId === p.id))
                  .map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            {record ? 'New password (optional)' : 'Password'}
            <input
              type="password"
              value={form.password || ''}
              onChange={e => set('password', e.target.value)}
              minLength={record ? undefined : Number(settings.security?.passwordMinLength) || 8}
              required={!record}
              autoComplete="new-password"
            />
          </label>
          {(form.password || !record) && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.mustChangePassword !== false}
                onChange={e => set('mustChangePassword', e.target.checked)}
              />{' '}
              Require a new password at next sign-in
            </label>
          )}
          <div className="form-row">
            <label>
              Avatar color
              <select value={form.avatarColor || 'purple'} onChange={e => set('avatarColor', e.target.value)}>
                <option>purple</option>
                <option>blue</option>
                <option>orange</option>
                <option>green</option>
                <option>pink</option>
                <option>teal</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.active !== false} onChange={e => set('active', e.target.checked)} />{' '}
              Account active
            </label>
          </div>
          <div className="settings-note">
            <Icon name="check" size={15} />
            <span>{roles[form.role || 'Viewer']?.summary || roles[form.role || 'Viewer']?.description}</span>
          </div>
        </>
      )
    return (
      <>
        <label>
          Alert title
          <input autoFocus value={form.title || ''} onChange={e => set('title', e.target.value)} required />
        </label>
        <label>
          Details
          <textarea value={form.body || ''} onChange={e => set('body', e.target.value)} rows={3} />
        </label>
        <div className="form-row">
          <label>
            Type
            <select value={form.type || 'info'} onChange={e => set('type', e.target.value)}>
              <option value="info">Info</option>
              <option value="deadline">Deadline</option>
              <option value="blocker">Blocker</option>
              <option value="risk">Risk</option>
            </select>
          </label>
          <label>
            Project
            <select value={form.projectId || ''} onChange={e => set('projectId', e.target.value)}>
              <option value="">Workspace</option>
              {data.projects.map(p => (
                <option key={p.numericId} value={p.numericId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </>
    )
  }
  const title = `${isEdit ? 'Edit' : type === 'activity' ? 'Log' : 'Create'} ${type}`
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && !dirty && onClose()}>
      <form
        className="modal"
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-dialog-title"
        onKeyDown={onDialogKeyDown}
      >
        <div className="modal-head">
          <div>
            <span className="eyebrow">
              <span className="eyebrow-dot" /> Atlas record
            </span>
            <h2 id="record-dialog-title">{title}</h2>
            <p>Changes are saved to this workspace's data store when you press Save.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close" onClick={requestClose}>
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="form-fields">
          {fields()}
          <CustomFieldInputs
            definitions={fieldDefs}
            values={form.customFields || {}}
            onChange={value => set('customFields', value)}
          />
          {error && (
            <div className="form-error">
              <Icon name="warning" size={15} />
              {error}
            </div>
          )}
        </div>
        <div className="modal-foot">
          {isEdit && onDelete && (
            <button type="button" className="secondary-button danger-button" onClick={() => onDelete(type, record)}>
              Delete
            </button>
          )}
          <span />
          <button type="button" className="secondary-button" onClick={requestClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Saving…' : 'Save'} <Icon name="arrow" size={14} />
          </button>
        </div>
      </form>
    </div>
  )
}
