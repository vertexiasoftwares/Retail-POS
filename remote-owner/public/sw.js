const SHELL_CACHE = 'vertexia-remote-shell-v1'
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/retail-pos-icon.png', '/retail-pos-logo-transparent.png']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS).catch(() => undefined)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key !== SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // NEVER cache Cloud Gateway API responses or authenticated data
  if (url.pathname.startsWith('/api/cloud/') || url.origin !== self.location.origin) {
    return
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then(cache => cache.put('/index.html', copy)).catch(() => undefined)
          }
          return res
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const networkFetch = fetch(req)
        .then(res => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone()
            caches.open(SHELL_CACHE).then(cache => cache.put(req, copy)).catch(() => undefined)
          }
          return res
        })
        .catch(() => cached)
      return cached || networkFetch
    }),
  )
})
