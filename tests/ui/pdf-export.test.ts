// MIN-03: the PDF export registers both font weights, loads the (1.4 MB) fonts once, and says so when it has to fall back.
// This runs the real jsPDF and jspdf-autotable in Node with the real font files; jsPDF writes the file to the working
// directory in Node, so each test works in a throw-away directory.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import { exportPdf } from '../../src/lib/export'

const fonts = path.join(import.meta.dirname, '..', '..', 'public', 'fonts')
const columns = [
  { key: 'title', label: 'Title' },
  { key: 'owner', label: 'Owner' }
]
const rows = [
  { title: 'Write the report', owner: 'Dana' },
  { title: 'تقرير المشاريع', owner: 'ليلى' }
]

let work: string
let originalCwd: string
const originalFetch = globalThis.fetch
let fetched: string[] = []
let complaints: string[] = []
const originalConsole = { warn: console.warn, error: console.error }

before(() => {
  originalCwd = process.cwd()
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pdf-'))
  process.chdir(work)
})
after(() => {
  process.chdir(originalCwd)
  fs.rmSync(work, { recursive: true, force: true })
})
afterEach(() => {
  globalThis.fetch = originalFetch
  console.warn = originalConsole.warn
  console.error = originalConsole.error
})

function serveFonts(available: boolean) {
  fetched = []
  complaints = []
  globalThis.fetch = (async (url: string) => {
    fetched.push(String(url))
    const file = path.join(fonts, path.basename(String(url)))
    if (!available || !fs.existsSync(file)) return new Response('missing', { status: 404 })
    return new Response(new Uint8Array(fs.readFileSync(file)))
  }) as typeof fetch
  console.warn = (...args: unknown[]) => void complaints.push(args.join(' '))
  console.error = (...args: unknown[]) => void complaints.push(args.join(' '))
}

describe('PDF export (MIN-03)', () => {
  test('with the fonts available: a real PDF, both weights registered (no jsPDF font warning), fonts fetched once', async () => {
    serveFonts(true)
    const first = await exportPdf(rows, columns, 'Weekly report', 'landscape', {})
    assert.equal(first.unicodeFont, true)
    const bytes = fs.readFileSync(path.join(work, 'Weekly-report.pdf'))
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    assert.ok(bytes.length > 20_000, 'the embedded Unicode font makes the file substantial')
    assert.deepEqual(
      complaints.filter(line => /font/i.test(line)),
      [],
      'jsPDF did not complain about a missing bold face'
    )
    assert.deepEqual(fetched.sort(), ['/fonts/AtlasSans-Bold.ttf', '/fonts/AtlasSans-Regular.ttf'])
    await exportPdf(rows, columns, 'Second export', 'portrait', {})
    assert.equal(fetched.length, 2, 'the second export reuses the fonts already loaded')
  })

  test('without the fonts: the PDF is still produced, the caller is told, and the next export retries', async () => {
    // A fresh module instance has an empty font cache, so this test does not depend on the previous one.
    const fresh = (await import(`../../src/lib/export?fallback=${Date.now()}`)) as typeof import('../../src/lib/export')
    serveFonts(false)
    const result = await fresh.exportPdf(rows, columns, 'Fallback report', 'landscape', {})
    assert.equal(result.unicodeFont, false)
    assert.equal(fs.readFileSync(path.join(work, 'Fallback-report.pdf')).subarray(0, 5).toString(), '%PDF-')
    const afterFailure = fetched.length
    assert.ok(afterFailure >= 1)
    serveFonts(true)
    const retried = await fresh.exportPdf(rows, columns, 'Retried report', 'landscape', {})
    assert.equal(retried.unicodeFont, true, 'a failed load is not cached')
  })
})
