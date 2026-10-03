// An empty, unconfigured workspace: what a fresh install and `--init-production` start from.
import { compactSettingsForStorage, normalizeSettings } from '../../shared/settings'
import type { Snapshot } from '../domain/types'

export function emptySnapshot(config: { defaultTimezone: string }): Snapshot {
  const now = new Date().toISOString()
  return {
    meta: {
      createdAt: now,
      updatedAt: now,
      writeCount: 0,
      lastMigrationAt: now,
      designSystemVersion: '',
      schemaVersion: '',
      model: 'sqlite',
      atomicPersistence: true
    },
    configured: false,
    counters: { project: 1, task: 1 },
    settings: compactSettingsForStorage(normalizeSettings({}, { timezone: config.defaultTimezone })),
    users: [],
    teams: [],
    people: [],
    projects: [],
    tasks: [],
    milestones: [],
    activities: [],
    alerts: [],
    workLogs: [],
    auditLogs: []
  }
}
