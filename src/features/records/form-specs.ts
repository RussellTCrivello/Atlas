// What each record form asks for, as data: its fields, which are required, how they are limited, and what a new record starts
// with. The dialog renders from this, so every form gets the same required markers, field-level errors and keyboard behaviour,
// and a field is added in one place.
import { customFieldDefinitions, workflowStateLabels } from '../../lib/settings'
import { roleDefinitions } from '../../lib/roles'

export type FieldKind = 'text' | 'email' | 'password' | 'textarea' | 'select' | 'date' | 'number' | 'checkbox' | 'tags'
export type RecordType = 'task' | 'project' | 'person' | 'team' | 'milestone' | 'activity' | 'alert' | 'user'

export interface FieldOption {
  value: string | number
  label: string
}
export interface FieldSpec {
  name: string
  label: string
  kind: FieldKind
  required?: boolean
  maxLength?: number
  rows?: number
  min?: number
  max?: number
  pattern?: string
  /** What a value that does not match the pattern should look like. */
  patternHint?: string
  minLength?: number
  options?: FieldOption[]
  autoFocus?: boolean
  upper?: boolean
  hint?: string
  /** Fields that share a row (two columns). */
  row?: string
  autoComplete?: string
}

export interface FormContext {
  data: any
  user: any
  record: any
  isEdit: boolean
  settings: any
}

const ids = (list: any[], key: string, label = 'name'): FieldOption[] =>
  list.map(item => ({ value: item[key], label: item[label] }))

export function presetsFor(type: RecordType, { data, user, record }: FormContext): Record<string, any> {
  const firstProject = data.projects[0]?.numericId || ''
  const firstPerson = data.people[0]?.id || user?.personId || ''
  const firstTeam = data.teams[0]?.id || ''
  const statuses = workflowStateLabels(data.settings)
  const presets: Record<RecordType, Record<string, any>> = {
    task: {
      title: record?.title || '',
      projectId: record?.projectId || firstProject,
      // '' means "nobody"; a new task starts with the person creating it (the form can say otherwise)
      assigneeId: record?.assigneeId !== undefined ? record.assigneeId : user?.personId || firstPerson,
      priority: record?.priority || 'Medium',
      dueDate: record?.dueDate ?? data.today,
      status: record?.status || statuses[0] || 'To do',
      type: record?.type || 'Development',
      blocked: Boolean(record?.blocked),
      tags: (record?.tags || []).map((tag: any) => (typeof tag === 'string' ? tag : tag.name)),
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
  return presets[type] || {}
}

const COLORS = ['purple', 'blue', 'orange', 'green', 'pink', 'teal'].map(value => ({ value, label: value }))

export function specsFor(type: RecordType, ctx: FormContext, form: Record<string, any>): FieldSpec[] {
  const { data, record, settings } = ctx
  const people = ids(data.people, 'id')
  const projects = ids(data.projects, 'numericId')
  const teams = ids(data.teams, 'id')
  switch (type) {
    case 'task':
      return [
        { name: 'title', label: 'Task title', kind: 'text', required: true, maxLength: 300, autoFocus: true },
        { name: 'projectId', label: 'Project', kind: 'select', required: true, options: projects, row: 'a' },
        {
          name: 'assigneeId',
          label: 'Owner',
          kind: 'select',
          options: [{ value: '', label: 'Unassigned' }, ...people],
          row: 'a'
        },
        {
          name: 'priority',
          label: 'Priority',
          kind: 'select',
          options: ['High', 'Medium', 'Low'].map(value => ({ value, label: value })),
          row: 'b'
        },
        { name: 'dueDate', label: 'Due date', kind: 'date', row: 'b' },
        {
          name: 'status',
          label: 'Status',
          kind: 'select',
          options: workflowStateLabels(data.settings).map(value => ({ value, label: value })),
          row: 'c'
        },
        {
          name: 'type',
          label: 'Type',
          kind: 'select',
          options: ['Development', 'Design', 'Testing', 'Documentation'].map(value => ({ value, label: value })),
          row: 'c'
        },
        { name: 'tags', label: 'Tags', kind: 'tags', hint: 'Press Enter or comma to add a tag.' },
        { name: 'blocked', label: 'This task is blocked', kind: 'checkbox' }
      ]
    case 'project':
      return [
        {
          name: 'name',
          label: 'Project name',
          kind: 'text',
          required: true,
          maxLength: 120,
          autoFocus: true,
          row: 'a'
        },
        {
          name: 'code',
          label: 'Code',
          kind: 'text',
          required: true,
          upper: true,
          maxLength: 10,
          pattern: '[A-Za-z0-9][A-Za-z0-9_\\-]{1,9}',
          patternHint: '2–10 letters, digits, “-” or “_”',
          row: 'a'
        },
        { name: 'description', label: 'Objective', kind: 'textarea', rows: 3, maxLength: 2000 },
        { name: 'teamId', label: 'Team', kind: 'select', options: teams, row: 'b' },
        { name: 'ownerId', label: 'Owner', kind: 'select', options: people, row: 'b' },
        {
          name: 'status',
          label: 'Status',
          kind: 'select',
          options: ['On track', 'At risk', 'Completed'].map(value => ({ value, label: value })),
          row: 'c'
        },
        { name: 'deadline', label: 'Deadline', kind: 'date', row: 'c' }
      ]
    case 'person':
      return [
        { name: 'name', label: 'Full name', kind: 'text', required: true, maxLength: 120, autoFocus: true, row: 'a' },
        { name: 'email', label: 'Email', kind: 'email', required: true, maxLength: 254, row: 'a' },
        { name: 'jobTitle', label: 'Job title', kind: 'text', maxLength: 120, row: 'b' },
        { name: 'teamId', label: 'Team', kind: 'select', options: teams, row: 'b' },
        { name: 'focus', label: 'Current focus', kind: 'text', maxLength: 300 },
        { name: 'capacity', label: 'Planned capacity (%)', kind: 'number', min: 0, max: 100, row: 'c' },
        {
          name: 'status',
          label: 'Status',
          kind: 'select',
          options: ['On track', 'Needs attention', 'At risk'].map(value => ({ value, label: value })),
          row: 'c'
        }
      ]
    case 'team':
      return [
        { name: 'name', label: 'Team name', kind: 'text', required: true, maxLength: 120, autoFocus: true },
        { name: 'color', label: 'Color', kind: 'select', options: COLORS.slice(0, 5) }
      ]
    case 'milestone':
      return [
        { name: 'name', label: 'Milestone name', kind: 'text', required: true, maxLength: 200, autoFocus: true },
        { name: 'projectId', label: 'Project', kind: 'select', required: true, options: projects },
        { name: 'dueDate', label: 'Due date', kind: 'date', row: 'a' },
        {
          name: 'status',
          label: 'Status',
          kind: 'select',
          options: ['Upcoming', 'At risk', 'Complete'].map(value => ({ value, label: value })),
          row: 'a'
        }
      ]
    case 'activity':
      return [
        { name: 'personId', label: 'Person', kind: 'select', options: people },
        { name: 'yesterday', label: 'Yesterday', kind: 'textarea', rows: 2, maxLength: 5000, autoFocus: true },
        { name: 'today', label: 'Today', kind: 'textarea', rows: 2, maxLength: 5000 },
        { name: 'blocked', label: 'Blocked', kind: 'textarea', rows: 2, maxLength: 5000 },
        { name: 'upcoming', label: 'Upcoming', kind: 'textarea', rows: 2, maxLength: 5000 }
      ]
    case 'user': {
      const roles = Object.keys(roleDefinitions(data.settings)).map(value => ({ value, label: value }))
      const linkable = data.people.filter(
        (p: any) => p.id === record?.personId || !(data.users || []).some((u: any) => u.personId === p.id)
      )
      const edit = Boolean(record)
      return [
        { name: 'name', label: 'Full name', kind: 'text', required: true, maxLength: 120, autoFocus: true, row: 'a' },
        { name: 'email', label: 'Email', kind: 'email', required: true, maxLength: 254, row: 'a' },
        { name: 'role', label: 'Role', kind: 'select', options: roles, row: 'b' },
        {
          name: 'personId',
          label: 'Linked person',
          kind: 'select',
          options: [...(edit ? [] : [{ value: '', label: 'Create a new person profile' }]), ...ids(linkable, 'id')],
          row: 'b'
        },
        {
          name: 'password',
          label: edit ? 'New password (optional)' : 'Password',
          kind: 'password',
          required: !edit,
          minLength: edit ? undefined : Number(settings?.security?.passwordMinLength) || 8,
          autoComplete: 'new-password'
        },
        ...(form.password || !edit
          ? [{ name: 'mustChangePassword', label: 'Require a new password at next sign-in', kind: 'checkbox' as const }]
          : []),
        { name: 'avatarColor', label: 'Avatar color', kind: 'select', options: COLORS, row: 'c' },
        { name: 'active', label: 'Account active', kind: 'checkbox', row: 'c' }
      ]
    }
    default: // alert
      return [
        { name: 'title', label: 'Alert title', kind: 'text', required: true, maxLength: 200, autoFocus: true },
        { name: 'body', label: 'Details', kind: 'textarea', rows: 3, maxLength: 2000 },
        {
          name: 'type',
          label: 'Type',
          kind: 'select',
          options: [
            { value: 'info', label: 'Info' },
            { value: 'deadline', label: 'Deadline' },
            { value: 'blocker', label: 'Blocker' },
            { value: 'risk', label: 'Risk' }
          ],
          row: 'a'
        },
        {
          name: 'projectId',
          label: 'Project',
          kind: 'select',
          options: [{ value: '', label: 'Workspace' }, ...projects],
          row: 'a'
        }
      ]
  }
}

export const customFieldsOf = (settings: any, type: RecordType) => customFieldDefinitions(settings, type)

/** Carry these forward when the person chooses "Save and create another": the choices they repeat from one record to the next. */
export function carryOver(type: RecordType, saved: Record<string, any>): Record<string, any> {
  if (type === 'task')
    return {
      projectId: saved.projectId,
      assigneeId: saved.assigneeId,
      priority: saved.priority,
      type: saved.type,
      status: undefined,
      tags: saved.tags
    }
  if (type === 'milestone') return { projectId: saved.projectId }
  if (type === 'alert') return { projectId: saved.projectId, type: saved.type }
  if (type === 'person') return { teamId: saved.teamId, jobTitle: saved.jobTitle }
  return {}
}
