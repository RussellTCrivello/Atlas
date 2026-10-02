export function createRateLimitMiddleware({ sendError, getClientAddress = defaultClientAddress }) {
  function rateLimit(map, key, limit, windowMs) {
    const now = Date.now()
    const current = map.get(key)
    if (!current || current.resetAt <= now) map.set(key, { count: 1, resetAt: now + windowMs })
    else {
      current.count += 1
      if (current.count > limit) return Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    }
    if (map.size > 10000) for (const [entryKey, entry] of map) if (entry.resetAt <= now) map.delete(entryKey)
    return 0
  }

  function rateLimitMiddleware(map, limit, windowMs, keySelector = getClientAddress) {
    return (req, res, next) => {
      const retryAfter = rateLimit(map, keySelector(req), limit, windowMs)
      if (retryAfter) {
        res.setHeader('Retry-After', String(retryAfter))
        return sendError(res, 429, 'Too many requests. Try again later.')
      }
      next()
    }
  }

  return { rateLimit, rateLimitMiddleware, clientAddress: getClientAddress }
}

export function defaultClientAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 100)
}
