// Domain types for the embedded document store. Everything here is plain JSON data.

export type CustomFields = Record<string, string | number | boolean | null>

export interface Team {
  id: string
  name: string
  color: string
  customFields?: CustomFields
  sample?: boolean
}

export interface Person {
  id: string
  name: string
  email: string
  jobTitle: string
  teamId: string
  focus: string
  capacity: number
  status: string
  color: string
  customFields?: CustomFields
  sample?: boolean
}

export interface Project {
  id: number
  name: string
  code: string
  description: string
  teamId: string
  ownerId: string
  color: string
  status: string
  deadline: string
  createdAt: string
  customFields?: CustomFields
  sample?: boolean
}

export interface Task {
  id: number
  /** Display key such as `ATL-0012`, frozen when the task is created so later project-code edits cannot rename it. */
  key?: string
  title: string
  projectId: number
  assigneeId: string
  priority: string
  dueDate: string
  status: string
  type: string
  blocked: boolean
  customFields?: CustomFields
  createdAt: string
  createdBy?: string
  completedAt?: string
  sample?: boolean
}

export interface Milestone {
  id: string
  name: string
  projectId: number
  dueDate: string
  status: string
  customFields?: CustomFields
  sample?: boolean
}

export interface Activity {
  id: string
  personId: string
  date: string
  time: string
  yesterday: string
  today: string
  blocked: string
  upcoming: string
  status: string
  customFields?: CustomFields
  sample?: boolean
}

export interface Alert {
  id: string
  title: string
  body: string
  type: string
  tone: string
  projectId: number | string
  taskId: number | string
  resolved: boolean
  createdAt: string
  customFields?: CustomFields
  sample?: boolean
}

export interface User {
  id: string
  name: string
  email: string
  passwordHash: string
  role: string
  personId: string
  avatarColor: string
  active: boolean
  createdAt: string
  lastLoginAt?: string
  passwordChangedAt?: string
  mustChangePassword?: boolean
  sample?: boolean
}

/** One immutable fact in the work ledger. Rows record what happened and who did it; they never carry invented effort. */
export interface WorkLog {
  id: string
  /** The person who performed the action (the actor), not necessarily the task's assignee. */
  personId: string
  actorUserId?: string
  assigneeId?: string
  taskId?: number
  projectId?: number
  taskKey?: string
  taskTitle?: string
  projectName?: string
  action: string
  statusFrom?: string
  statusTo?: string
  summary: string
  date: string
  time: string
  at?: string
  source: string
  derived?: boolean
  sample?: boolean
}

export interface AuditEntry {
  id: string
  action: string
  actorId: string
  detail: Record<string, unknown>
  createdAt: string
  ip?: string
  userAgent?: string
  prev?: string
  hash?: string
}

export interface StoreMeta {
  createdAt: string
  updatedAt: string
  writeCount: number
  lastMigrationAt: string
  designSystemVersion: string
  schemaVersion: string
  model: string
  atomicPersistence: boolean
  /** Hash of the last audit entry removed by retention; anchors the hash chain of the remaining entries. */
  auditAnchor?: string
}

export interface StoreState {
  meta: StoreMeta
  configured: boolean
  counters: { task: number; project: number }
  settings: any
  users: User[]
  teams: Team[]
  people: Person[]
  projects: Project[]
  tasks: Task[]
  milestones: Milestone[]
  activities: Activity[]
  alerts: Alert[]
  workLogs: WorkLog[]
  auditLogs: AuditEntry[]
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: string
  personId: string
  avatarColor: string
  active: boolean
  mustChangePassword?: boolean
  permissions: string[]
}
