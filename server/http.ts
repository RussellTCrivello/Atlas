// HTTP hardening and error handling shared by every route.
import crypto from 'node:crypto'
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import { type AtlasConfig, isLoopbackHost } from './config'
import { HttpError } from './util'

export const SESSION_COOKIE = 'atlas_sid'

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const id = crypto.randomBytes(4).toString('hex')
    ;(req as any).id = id
    res.setHeader('X-Request-Id', id)
    next()
  }
}

/** Headers for every response. The CSP is strict in production; in development Vite needs inline scripts and websockets. */
export function securityHeaders(config: AtlasConfig): RequestHandler {
  const csp = [
    "default-src 'self'",
    "script-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'"
  ].join('; ')
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
    )
    if (config.isProduction) {
      res.setHeader('Content-Security-Policy', csp)
      if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000')
    }
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store')
    next()
  }
}

function hostnameOf(hostHeader: string | undefined): string {
  const value = String(hostHeader || '')
    .toLowerCase()
    .trim()
  if (value.startsWith('[')) return value.slice(0, value.indexOf(']') + 1) // [::1]:5173
  return value.replace(/:\d+$/, '')
}

/**
 * Reject requests whose Host header is not one we expect. This is what stops DNS-rebinding: a malicious web page can
 * point its own domain at 127.0.0.1, but the browser still sends that attacker-controlled name as Host.
 *  - ATLAS_ALLOWED_HOSTS set  -> only those names (`name` or `name:port`)
 *  - bound to a loopback address -> localhost, 127.0.0.1, [::1] and the bind address
 *  - bound to a network address  -> any name (operators reach the server by LAN name or IP we cannot know)
 */
export function hostGuard(config: AtlasConfig): RequestHandler {
  const explicit = new Set(config.allowedHosts)
  const loopbackOnly = isLoopbackHost(config.host)
  const loopbackNames = new Set(['localhost', '127.0.0.1', '[::1]', config.host.toLowerCase()])
  return (req, res, next) => {
    const hostHeader = String(req.headers.host || '').toLowerCase()
    const name = hostnameOf(hostHeader)
    const allowed = explicit.size
      ? explicit.has(hostHeader) || explicit.has(name)
      : loopbackOnly
        ? loopbackNames.has(name)
        : true
    if (allowed) return next()
    res.status(403).json({
      error: `Unrecognised Host header "${name.slice(0, 80)}". If this is a legitimate address, add it to ATLAS_ALLOWED_HOSTS.`,
      code: 'HOST_NOT_ALLOWED'
    })
  }
}

/** CSRF defence in depth (SameSite=Lax cookies are the first layer): browsers always send Origin on cross-site writes. */
export function originGuard(): RequestHandler {
  const unsafe = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
  return (req, res, next) => {
    if (!unsafe.has(req.method)) return next()
    const origin = req.headers.origin
    if (!origin) return next() // non-browser clients (scripts, curl, tests) do not send Origin
    let originHost = ''
    try {
      originHost = new URL(origin).host.toLowerCase()
    } catch {
      /* "null" or malformed */
    }
    if (originHost && originHost === String(req.headers.host || '').toLowerCase()) return next()
    res.status(403).json({ error: 'Cross-origin request blocked.', code: 'CROSS_ORIGIN' })
  }
}

export function apiNotFound(): RequestHandler {
  return (req, res) =>
    res.status(404).json({ error: `No such API endpoint: ${req.method} ${req.path.slice(0, 100)}`, code: 'NOT_FOUND' })
}

export function errorHandler(): ErrorRequestHandler {
  return (err: any, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err)
    if (err instanceof HttpError) {
      if (err.status === 429 && (err.details as any)?.retryAfterSeconds)
        res.setHeader('Retry-After', String((err.details as any).retryAfterSeconds))
      return void res.status(err.status).json({ error: err.message, code: err.code, details: err.details })
    }
    // body-parser errors carry a status and a type
    if (err?.type === 'entity.too.large')
      return void res.status(413).json({ error: 'The request body is too large.', code: 'PAYLOAD_TOO_LARGE' })
    if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError)
      return void res.status(400).json({ error: 'The request body is not valid JSON.', code: 'BAD_JSON' })
    if (err?.status && err.status >= 400 && err.status < 500)
      return void res.status(err.status).json({ error: String(err.message || 'Bad request'), code: 'BAD_REQUEST' })
    const id = (req as any).id || 'n/a'
    console.error(`[${id}] ${req.method} ${req.path} failed:`, err)
    res.status(500).json({
      error: `Something went wrong on the server (reference ${id}). The error was logged.`,
      code: 'INTERNAL',
      requestId: id
    })
  }
}
