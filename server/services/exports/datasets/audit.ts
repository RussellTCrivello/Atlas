// The audit trail, for administrators.
import { col, describeConditions, type DatasetDefinition } from '../kit'
import { applyAdvancedFilters } from '../../../../shared/filters'

export const auditDataset: DatasetDefinition = {
  id: 'audit',
  title: 'Audit trail',
  description: 'Who did what and when, newest first (the hash chain is verified on the System page).',
  permissions: ['manageSettings'],
  columns: ({ label }) => [
    col('createdAt', label('Time'), 'datetime', 'audit_log.created_at', { width: 18 }),
    col('action', label('Action'), 'text', 'audit_log.action', { width: 26 }),
    col('actor', label('User'), 'text', 'users.name', { width: 20 }),
    col('ip', label('Address'), 'text', 'audit_log.ip', { width: 16, defaultVisible: false }),
    col('detail', label('Details'), 'longtext', 'audit_log.detail', { width: 50 })
  ],
  run(dc) {
    const limit = Math.min(20000, Math.max(1, Number(dc.scope('limit')) || 5000))
    const rows = dc.ctx.repos.exports.audit(limit).map(r => ({
      createdAt: r.created_at,
      action: r.action,
      actor: r.actor_name,
      ip: r.ip ?? '',
      detail: String(r.detail) === '{}' ? '' : String(r.detail)
    }))
    const out = applyAdvancedFilters(rows, dc.request.filters ?? [])
    const columns = auditDataset.columns(dc)
    return {
      filters: [`${dc.label('Newest')} ${rows.length}`, ...describeConditions(dc.request.filters, columns, dc.label)],
      sections: [{ kind: 'table', id: 'audit', columns, rows: out, primary: true }]
    }
  }
}
