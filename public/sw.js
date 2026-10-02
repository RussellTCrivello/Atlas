// Atlas service worker. Registered by the app as /sw.js?v=<build id>, so every build gets its own cache and the previous
// one is deleted on activation (no stale assets after an upgrade).
//
// What it does, honestly: it keeps the static, content-hashed assets (JS, CSS, fonts, icons) so repeat visits are fast,
// and it shows a clear offline page when the server cannot be reached. It does NOT make Atlas usable offline: all
// workspace data lives on the server and is never cached here.
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
const CACHE = `atlas-static-${VERSION}`
const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/atlas-icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
]

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key.startsWith('atlas-') && key !== CACHE).map(key => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  )
})

const immutable = url =>
  url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname.startsWith('/icons/')

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  // Never touch API traffic, other origins, or anything that is not a plain GET.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    // Pages always come from the server; only when it is unreachable do we show the offline page.
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')))
    return
  }

  if (immutable(url)) {
    // Content-hashed files never change: cache first.
    event.respondWith(
      caches.match(request).then(
        cached =>
          cached ||
          fetch(request).then(response => {
            if (response.ok) {
              const copy = response.clone()
              caches
                .open(CACHE)
                .then(cache => cache.put(request, copy))
                .catch(() => {})
            }
            return response
          })
      )
    )
  }
  // Everything else (manifest, icon) falls through to the network with the browser's normal HTTP caching.
})
