// Paging: where you are, how many rows a page holds, and ways to move (first, previous, a page number, next, last). The range
// ("Showing 51–100 of 1,234 tasks") is announced politely when it changes, so a screen reader hears that the page turned.
import { useEffect, useState } from 'react'
import { PAGE_SIZES } from '../../../lib/grid-model'
import { tr } from '../../../lib/i18n'
import { useApp } from '../../../ui/app-context'

interface Props {
  page: number
  pages: number
  pageSize: number
  total: number
  noun: string
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  sizes?: number[]
}

export function Pager({ page, pages, pageSize, total, noun, onPage, onPageSize, sizes = PAGE_SIZES }: Props) {
  const { settings } = useApp()
  const t = (phrase: string, values?: Record<string, unknown>) => tr(settings, phrase, values)
  const [typed, setTyped] = useState(String(page))
  useEffect(() => setTyped(String(page)), [page])
  const first = total ? (page - 1) * pageSize + 1 : 0
  const last = Math.min(total, page * pageSize)
  const go = (value: string) => {
    const n = Math.round(Number(value))
    if (Number.isFinite(n) && n >= 1) onPage(Math.min(n, pages))
    else setTyped(String(page))
  }
  return (
    <div className="table-pager grid-pager" role="navigation" aria-label={t('Pages')}>
      <span className="results-meta" role="status" aria-live="polite">
        {total
          ? t('Showing {first}–{last} of {total} {noun}', {
              first: first.toLocaleString('en'),
              last: last.toLocaleString('en'),
              total: total.toLocaleString('en'),
              noun
            })
          : t('Nothing to show')}
      </span>
      <label className="page-size">
        {t('Rows per page')}
        <select value={pageSize} onChange={event => onPageSize(Number(event.target.value))}>
          {[...new Set([...sizes, pageSize])]
            .sort((a, b) => a - b)
            .map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        className="secondary-button"
        disabled={page <= 1}
        onClick={() => onPage(1)}
        aria-label={t('First page')}
      >
        «
      </button>
      <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('Previous')}
      </button>
      <label className="page-jump">
        <span className="sr-only">{t('Page number')}</span>
        <input
          inputMode="numeric"
          value={typed}
          aria-label={t('Page number')}
          onChange={event => setTyped(event.target.value.replace(/[^\d]/g, ''))}
          onBlur={() => go(typed)}
          onKeyDown={event => event.key === 'Enter' && go(typed)}
        />
        <span aria-live="polite">{t('of {pages}', { pages: pages.toLocaleString('en') })}</span>
      </label>
      <button type="button" className="secondary-button" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t('Next')}
      </button>
      <button
        type="button"
        className="secondary-button"
        disabled={page >= pages}
        onClick={() => onPage(pages)}
        aria-label={t('Last page')}
      >
        »
      </button>
    </div>
  )
}
