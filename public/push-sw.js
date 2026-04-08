// Push notification handler — prepended to Workbox SW at build time
// Must be top-level (not inside importScripts/define) for push events to fire

self.addEventListener('push', function (event) {
  var payload = { title: 'Boomerang', body: 'New notification' }
  try {
    if (event.data) payload = event.data.json()
  } catch (e) {
    try { payload = { title: 'Boomerang', body: event.data.text() } } catch (e2) { /* default */ }
  }

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
