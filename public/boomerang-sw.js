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

  // Inline actions for low-stakes pings — let the user resolve without
  // opening the app. NOT enabled for Stage 3 high-priority alarms (those
  // should require the user to actually engage with the task in the app).
  var actions = []
  if (payload.data && payload.data.taskId && !payload.data.no_actions) {
    actions = [
      { action: 'snooze1h', title: 'Snooze 1h' },
      { action: 'done', title: 'Done' }
    ]
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Boomerang', {
      body: payload.body || '',
      data: payload.data || {},
      actions: actions
    }).then(function () {
      fetch('/api/push/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'notification_shown' })
      }).catch(function () {})
    }).catch(function (err) {
      fetch('/api/push/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'notification_error', error: err.message || String(err) })
      }).catch(function () {})
    })
  )
})

self.addEventListener('notificationclick', function (event) {
  event.preventDefault()
  event.notification.close()
  var data = event.notification.data || {}
  var taskId = data.taskId

  // Inline action handler — Snooze 1h and Done resolve without opening
  // the app. Re-engagement is "act on tasks I care about"; closing the
  // loop on a low-stakes ping doesn't need a full app round-trip.
  if (event.action === 'snooze1h' && taskId) {
    event.waitUntil(
      fetch('/api/notifications/action/snooze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: taskId, hours: 1 })
      }).catch(function () {})
    )
    return
  }
  if (event.action === 'done' && taskId) {
    event.waitUntil(
      fetch('/api/notifications/action/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: taskId })
      }).catch(function () {})
    )
    return
  }

  // Bare tap (no action) — open the app on the relevant task. This is the
  // North-Star path: user wants to engage, give them context.
  var path = taskId ? '/?task=' + taskId : '/'
  var url = self.location.origin + path

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      if (windowClients.length > 0) {
        // App is open/suspended — navigate then focus
        windowClients[0].navigate(url)
        return windowClients[0].focus()
      }
      // App was killed — open fresh
      return self.clients.openWindow(url)
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
