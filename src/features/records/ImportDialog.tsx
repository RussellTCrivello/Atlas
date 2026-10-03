// Importing tasks from a CSV file, in steps: choose a file (or paste its text), check it (nothing is created), look at how the
// columns were understood and change them if they were not, see which rows have problems, then import. The check and the import
// use the same rules on the server, so what the check promises is what the import does.
import { useEffect, useId, useRef, useState } from 'react'
import { ApiError, api, errorMessage } from '../../lib/api'
import { tr } from '../../lib/i18n'
import { useApp } from '../../ui/app-context'
import { Icon } from '../../ui/icons'
import { useDialogKeys } from '../../ui/use-dialog'

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  project: 'Project',
  assignee: 'Owner',
  priority: 'Priority',
  status: 'Status',
  type: 'Type',
  dueDate: 'Due date',
  blocked: 'Blocked',
  tags: 'Tags'
}
const MAX_FILE_BYTES = 5_000_000

interface Props {
  projects: { numericId: number; name: string }[]
  defaultProjectId?: number | null
  onClose: () => void
  onImported: (created: number) => void
}

export function ImportDialog({ projects, defaultProjectId, onClose, onImported }: Props) {
  const { settings, notify } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const id = useId()
  const dialog = useRef<HTMLDivElement>(null)
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [projectId, setProjectId] = useState<string>(defaultProjectId ? String(defaultProjectId) : '')
  const [duplicates, setDuplicates] = useState<'skip' | 'create'>('skip')
  const [skipInvalid, setSkipInvalid] = useState(false)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [report, setReport] = useState<any>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<'' | 'check' | 'import'>('')
  const [created, setCreated] = useState<number | null>(null)
  const onKeyDown = useDialogKeys(dialog, true, () => !busy && onClose())

  const request = (dryRun: boolean) => ({
    csv: text,
    dryRun,
    skipInvalid,
    duplicates,
    ...(projectId ? { projectId: Number(projectId) } : {}),
    ...(Object.keys(mapping).length ? { mapping } : {})
  })
  const check = async () => {
    if (!text.trim() || busy) return
    setBusy('check')
    setError('')
    try {
      setReport(await api.post('/api/tasks/import', request(true)))
    } catch (failure) {
      setReport(null)
      setError(errorMessage(failure))
    } finally {
      setBusy('')
    }
  }
  // Once a file has been checked, changing how it is read checks it again, so the numbers on screen are always current.
  // (Editing the text, or choosing another file, discards the check instead: the person presses "Check" for the new file.)
  const hasReport = useRef(false)
  hasReport.current = Boolean(report)
  useEffect(() => {
    if (!hasReport.current) return
    const timer = setTimeout(check, 200)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, projectId, duplicates])

  const run = async () => {
    if (busy) return
    setBusy('import')
    setError('')
    try {
      const done = await api.post('/api/tasks/import', request(false))
      setCreated(done.totals.created)
      setReport(done)
      onImported(done.totals.created)
      notify({
        title: t('{count} tasks imported', { count: done.totals.created.toLocaleString('en') }),
        tone: 'success'
      })
    } catch (failure) {
      if (failure instanceof ApiError && failure.details?.totals) setReport(failure.details)
      setError(errorMessage(failure))
    } finally {
      setBusy('')
    }
  }
  const readFile = async (file: File | undefined) => {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError(t('That file is larger than 5 MB.'))
      return
    }
    setError('')
    setFileName(file.name)
    setReport(null)
    setMapping({})
    setText(await file.text())
  }

  const totals = report?.totals
  const importable = totals ? totals.valid : 0
  const blocked = totals ? totals.invalid > 0 && !skipInvalid : false
  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onMouseDown={event => event.target === event.currentTarget && !busy && onClose()}
    >
      <div
        ref={dialog}
        className="modal import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        onKeyDown={onKeyDown}
      >
        <div className="modal-head">
          <div>
            <h2 id={`${id}-title`}>{t('Import tasks from CSV')}</h2>
            <p>{t('Check the file first: nothing is created until you press Import.')}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t('Close')}
            onClick={onClose}
            disabled={Boolean(busy)}
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="import-body">
          {created !== null ? (
            <div className="bulk-report" role="status">
              <p className="report-ok">
                <Icon name="check" size={15} />{' '}
                <strong>{t('{count} tasks imported', { count: created.toLocaleString('en') })}</strong>
              </p>
              {totals && (totals.invalid > 0 || totals.duplicates > 0) && (
                <p>
                  {t('{invalid} rows with problems and {duplicates} rows that already existed were skipped.', {
                    invalid: totals.invalid,
                    duplicates: totals.duplicates
                  })}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="import-source">
                <label className="file-pick">
                  <span>{t('Choose a CSV file')}</span>
                  <input
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    onChange={event => readFile(event.target.files?.[0])}
                  />
                </label>
                {fileName && <span className="menu-note">{fileName}</span>}
              </div>
              <div className="field">
                <label htmlFor={`${id}-text`}>{t('…or paste the file here')}</label>
                <textarea
                  id={`${id}-text`}
                  rows={5}
                  value={text}
                  placeholder={'Title,Project,Owner,Priority,Due date\nWrite the spec,PAY,Dana,High,2030-01-31'}
                  onChange={event => {
                    setText(event.target.value)
                    setReport(null)
                    setFileName('')
                  }}
                />
              </div>
              <div className="form-row">
                <div className="field">
                  <label htmlFor={`${id}-project`}>{t('Project for rows without one')}</label>
                  <select id={`${id}-project`} value={projectId} onChange={event => setProjectId(event.target.value)}>
                    <option value="">{t('None (the file must name the project)')}</option>
                    {projects.map(project => (
                      <option key={project.numericId} value={project.numericId}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`${id}-dup`}>{t('A task that already exists')}</label>
                  <select
                    id={`${id}-dup`}
                    value={duplicates}
                    onChange={event => setDuplicates(event.target.value as 'skip' | 'create')}
                  >
                    <option value="skip">{t('Skip it (same title in the same project)')}</option>
                    <option value="create">{t('Create it anyway')}</option>
                  </select>
                </div>
              </div>
              <label className="checkbox-label">
                <input type="checkbox" checked={skipInvalid} onChange={event => setSkipInvalid(event.target.checked)} />{' '}
                {t('Import the valid rows and skip the ones with problems')}
              </label>
              {error && (
                <div className="form-error" role="alert">
                  <Icon name="warning" size={15} /> {error}
                </div>
              )}
              {report && (
                <div className="import-report" aria-live="polite">
                  <p className="import-totals">
                    <strong>{t('{rows} rows', { rows: totals.rows.toLocaleString('en') })}</strong> ·{' '}
                    {t('{count} ready to import', { count: totals.valid.toLocaleString('en') })}
                    {totals.invalid > 0 && (
                      <span className="report-warn">
                        {' '}
                        · {t('{count} with problems', { count: totals.invalid.toLocaleString('en') })}
                      </span>
                    )}
                    {totals.duplicates > 0 && (
                      <span> · {t('{count} already exist', { count: totals.duplicates.toLocaleString('en') })}</span>
                    )}
                  </p>
                  <h3>{t('How the columns were read')}</h3>
                  <div className="table-scroll">
                    <table className="mapping-table">
                      <thead>
                        <tr>
                          <th scope="col">{t('Column in your file')}</th>
                          <th scope="col">{t('First value')}</th>
                          <th scope="col">{t('Goes into')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.columns.map((column: any) => (
                          <tr key={column.header + column.index}>
                            <td>{column.header || <em>{t('(no name)')}</em>}</td>
                            <td className="sample">{column.sample}</td>
                            <td>
                              <select
                                aria-label={t('Where “{column}” goes', { column: column.header })}
                                value={mapping[column.header] ?? column.field ?? 'ignore'}
                                onChange={event =>
                                  setMapping(current => ({ ...current, [column.header]: event.target.value }))
                                }
                              >
                                <option value="ignore">{t('Ignore this column')}</option>
                                {report.fields.map((field: string) => (
                                  <option key={field} value={field}>
                                    {t(FIELD_LABELS[field] || field)}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {report.problems.length > 0 && (
                    <>
                      <h3>{t('Problems')}</h3>
                      <ul className="problem-list">
                        {report.problems.slice(0, 30).map((problem: any, index: number) => (
                          <li key={index}>
                            <strong>{t('Row {row}', { row: problem.row })}</strong>
                            {problem.title ? ` (${problem.title})` : ''}: {problem.message}
                          </li>
                        ))}
                      </ul>
                      {(report.problemsTruncated || report.problems.length > 30) && (
                        <p className="menu-note">{t('Only the first problems are listed.')}</p>
                      )}
                    </>
                  )}
                  <h3>{t('Preview')}</h3>
                  <div className="table-scroll">
                    <table className="preview-table">
                      <thead>
                        <tr>
                          <th scope="col">{t('Row')}</th>
                          <th scope="col">{t('Title')}</th>
                          <th scope="col">{t('Status')}</th>
                          <th scope="col">{t('Priority')}</th>
                          <th scope="col">{t('Due date')}</th>
                          <th scope="col">{t('Result')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.preview.map((row: any) => (
                          <tr key={row.row} className={row.outcome !== 'ok' ? `row-${row.outcome}` : ''}>
                            <td>{row.row}</td>
                            <td>{row.title}</td>
                            <td>{row.status}</td>
                            <td>{row.priority}</td>
                            <td>{row.dueDate}</td>
                            <td>
                              {row.outcome === 'ok'
                                ? t('Will be created')
                                : row.outcome === 'duplicate'
                                  ? t('Already exists')
                                  : row.problems.map((p: any) => p.message).join('; ')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          {created !== null ? (
            <button type="button" className="primary-button" autoFocus onClick={onClose}>
              {t('Close')}
            </button>
          ) : (
            <>
              <button type="button" className="secondary-button" onClick={onClose} disabled={Boolean(busy)}>
                {t('Cancel')}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={check}
                disabled={!text.trim() || Boolean(busy)}
              >
                {busy === 'check' ? t('Checking…') : report ? t('Check again') : t('Check the file')}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={run}
                disabled={!report || importable === 0 || blocked || Boolean(busy)}
                title={blocked ? t('Some rows have problems: fix the file or choose to skip them.') : undefined}
              >
                {busy === 'import'
                  ? t('Importing…')
                  : t('Import {count} tasks', { count: importable.toLocaleString('en') })}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
