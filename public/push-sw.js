// Push notification service worker — loaded alongside Workbox SW
// This file lives in /public so it's served at the root scope

self.addEventListener('push', (event) => {
  let payload
  try {
    payload = event.data?.json()
  } catch {
    try {
      payload = { title: 'Boomerang', body: event.data?.text() || '' }
    } catch {
      payload = { title: 'Boomerang', body: 'New notification' }
    }
  }

  const { title, body, tag, data } = payload || {}

  event.waitUntil(
    self.registration.showNotification(title || 'Boomerang', {
      body: body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: tag || undefined,
      renotify: !!tag,
      data: data || {},
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus()
        }
      }
      return clients.openWindow('/')
    })
  )
})
