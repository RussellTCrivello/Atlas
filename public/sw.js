const CACHE = 'atlas-local-v5-translation-runtime'
const STATIC_ASSETS = ['/manifest.webmanifest', '/atlas-icon.svg', '/fonts/AtlasSans-Regular.ttf', '/fonts/AtlasSans-Bold.ttf', '/fonts/AtlasDisplay-Bold.ttf']
const isVersionedAsset = url => url.pathname.startsWith('/assets/') || url.pathname.startsWith('/fonts/') || url.pathname === '/atlas-icon.svg' || url.pathname === '/manifest.webmanifest'
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.pathname.startsWith('/api/') || event.request.method !== 'GET') return
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request).then(cached => cached || caches.match('/'))))
    return
  }
  if (isVersionedAsset(url)) {
    event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok) {
        const clone = response.clone()
        caches.open(CACHE).then(cache => cache.put(event.request, clone)).catch(() => {})
      }
      return response
    })))
    return
  }
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})
