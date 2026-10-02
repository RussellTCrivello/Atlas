// UI test harness: the real client bundle runs in jsdom against a real Atlas server (no mocked API).
// jsdom is not a browser: layout, CSS and real input devices are not covered. These tests check behaviour and DOM content.
import path from 'node:path'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

let bundle: Promise<string> | null = null
export function clientBundle(): Promise<string> {
  bundle ??= build({
    entryPoints: [path.join(import.meta.dirname, '..', '..', 'src', 'main.tsx')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: { __ATLAS_BUILD__: '"test"', __ATLAS_DEV__: 'false', 'process.env.NODE_ENV': '"development"' },
    logLevel: 'silent'
  }).then(result => result.outputFiles[0].text)
  return bundle
}

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
export const textOf = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim()

export interface BootedUI {
  w: any
  doc: Document
  dom: JSDOM
  cookie: () => string
  fetchLog: string[]
  requests: { method: string; url: string; body?: string }[]
  errors: string[]
  downloads: { blob: Blob; name: string }[]
  confirms: string[]
  close(): void
  waitFor<T>(fn: () => T | null | undefined | false, timeout?: number): Promise<T>
  click(selector: string, text?: string): Element
  type(selector: string, value: string, index?: number): void
  settle(ms?: number): Promise<void>
  goto(hash: string): Promise<void>
}

export interface BootOptions {
  base: string
  cookie?: string
  hash?: string
  confirm?: boolean | ((message: string) => boolean)
  beforeEval?(window: any): void
  language?: string
  /** Rewrite requests before they are sent, to simulate failures (return a Response to short-circuit). */
  intercept?(url: string, init: RequestInit): Response | Promise<Response> | undefined
}

export async function bootUI(options: BootOptions): Promise<BootedUI> {
  const jar = { cookie: options.cookie || '' }
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: `${options.base}/${options.hash ? `#${options.hash}` : ''}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  })
  const w: any = dom.window
  w.matchMedia ||= (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {}
  })
  w.structuredClone ||= structuredClone
  w.Blob = Blob
  w.scrollTo = () => {}
  const confirms: string[] = []
  w.confirm = (message: string) => {
    confirms.push(message)
    return typeof options.confirm === 'function' ? options.confirm(message) : options.confirm !== false
  }
  const downloads: { blob: Blob; name: string }[] = []
  let lastName = ''
  w.URL.createObjectURL = (blob: Blob) => {
    downloads.push({ blob, name: lastName })
    return 'blob:mock'
  }
  w.URL.revokeObjectURL = () => {}
  w.HTMLAnchorElement.prototype.click = function () {
    lastName = this.download
    const entry = downloads.at(-1)
    if (entry && !entry.name) entry.name = this.download
  }
  const errors: string[] = []
  w.addEventListener('error', (e: any) => errors.push(String(e.error?.stack || e.message)))
  w.addEventListener('unhandledrejection', (e: any) =>
    errors.push(`unhandledrejection: ${String(e.reason?.message || e.reason)}`)
  )
  const fetchLog: string[] = []
  const requests: BootedUI['requests'] = []
  w.fetch = async (input: any, init: RequestInit = {}) => {
    const raw = typeof input === 'string' ? input : input.url
    const url = raw.startsWith('http') ? raw : options.base + raw
    const method = init.method || 'GET'
    requests.push({
      method,
      url: url.replace(options.base, ''),
      body: typeof init.body === 'string' ? init.body : undefined
    })
    const forced = await options.intercept?.(url.replace(options.base, ''), init)
    if (forced) {
      fetchLog.push(`${method} ${url.replace(options.base, '')} -> ${forced.status}`)
      return forced
    }
    const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) }
    if (jar.cookie) headers.Cookie = jar.cookie
    const res = await fetch(url, { ...init, headers })
    for (const header of res.headers.getSetCookie?.() || []) {
      const pair = header.split(';')[0]
      if (/Expires=Thu, 01 Jan 1970/i.test(header) || /^atlas_sid=$/.test(pair)) jar.cookie = ''
      else if (pair.startsWith('atlas_sid=')) jar.cookie = pair
    }
    fetchLog.push(`${method} ${url.replace(options.base, '')} -> ${res.status}`)
    return res
  }
  const originalConsoleError = w.console.error
  w.console.error = (...args: unknown[]) => {
    const text = args.map(String).join(' ')
    if (!/not wrapped in act|Each child in a list/i.test(text)) errors.push(`console.error: ${text.slice(0, 400)}`)
  }
  void originalConsoleError
  options.beforeEval?.(w)
  w.eval(await clientBundle())

  const doc = w.document as Document
  const ui: BootedUI = {
    w,
    doc,
    dom,
    cookie: () => jar.cookie,
    fetchLog,
    requests,
    errors,
    downloads,
    confirms,
    close: () => dom.window.close(),
    async waitFor(fn, timeout = 8000) {
      const started = Date.now()
      let last: unknown
      while (Date.now() - started < timeout) {
        try {
          const value = fn()
          if (value) return value as any
        } catch (error) {
          last = error
        }
        await sleep(40)
      }
      throw new Error(
        `waitFor timed out${last ? `: ${String((last as Error).message)}` : ''}\nDOM:\n${textOf(doc.body).slice(0, 600)}\nerrors: ${errors.slice(0, 3).join(' | ')}`
      )
    },
    click(selector, text) {
      const matches = [...doc.querySelectorAll(selector)]
      const el = text === undefined ? matches[0] : matches.find(e => textOf(e) === text || textOf(e).startsWith(text))
      if (!el) throw new Error(`no element for ${selector}${text ? ` ~ "${text}"` : ''}`)
      el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }))
      return el
    },
    type(selector, value, index = 0) {
      const el = doc.querySelectorAll(selector)[index] as
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined
      if (!el) throw new Error(`no element for ${selector}[${index}]`)
      const proto =
        el instanceof w.HTMLSelectElement
          ? w.HTMLSelectElement.prototype
          : el instanceof w.HTMLTextAreaElement
            ? w.HTMLTextAreaElement.prototype
            : w.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new w.Event(el instanceof w.HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    },
    settle: async (ms = 250) => {
      await sleep(ms)
    },
    async goto(hash) {
      w.location.hash = hash
      await sleep(150)
    }
  }
  return ui
}

/** Sign in through the real UI. */
export async function signIn(ui: BootedUI, email: string, password: string) {
  await ui.waitFor(() => ui.doc.querySelector('input[type="email"]'))
  ui.type('input[type="email"]', email)
  ui.type('input[type="password"]', password)
  ui.click('.login-submit')
}
