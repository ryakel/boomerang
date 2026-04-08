// Boomerang service worker — push notifications + basic offline caching

// --- Push handler (top-level, synchronous) ---
self.addEventListener('push', function (event) {
  var payload = { title: 'Boomerang', body: 'New notification' }
  try {
    if (event.data) payload = event.data.json()
  } catch (e) {
    try { payload = { title: 'Boomerang', body: event.data.text() } } catch (e2) { /* default */ }
  }

  // Log to server that push handler fired
  fetch('/api/push/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'push_received', title: payload.title })
  }).catch(function () {})

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Boomerang', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag || undefined,
      data: payload.data || {}
    })
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (var i = 0; i < windowClients.length; i++) {
        if (windowClients[i].url.indexOf(self.location.origin) !== -1) {
          return windowClients[i].focus()
        }
      }
      return self.clients.openWindow('/')
    })
  )
})

// --- Lifecycle ---
self.addEventListener('install', function () { self.skipWaiting() })
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim())
})

// --- Network-first caching for navigation ---
self.addEventListener('fetch', function (event) {
  if (event.request.url.indexOf('/api') !== -1) return
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    fetch(event.request).catch(function () {
      return caches.match('/index.html')
    })
  )
})
