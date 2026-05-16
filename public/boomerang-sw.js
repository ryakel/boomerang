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
  } else if (payload.data && payload.data.habitAction && payload.data.routineId) {
    // Habit-mode behind-pace nudge: Log it / Not today
    actions = [
      { action: 'log_habit', title: 'Log it' },
      { action: 'not_today', title: 'Not today' }
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
  // Habit actions — log_habit creates+completes a task linked to the habit
  // routine; not_today bumps the push throttle so the same routine doesn't
  // re-nudge for 24h. Neither opens the app.
  var routineId = data.routineId
  if (event.action === 'log_habit' && routineId) {
    event.waitUntil(
      fetch('/api/notifications/action/log-habit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routineId: routineId })
      }).catch(function () {})
    )
    return
  }
  if (event.action === 'not_today' && routineId) {
    event.waitUntil(
      fetch('/api/notifications/action/not-today', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routineId: routineId })
      }).catch(function () {})
    )
    return
  }

  // Bare tap (no action) — open the app on the relevant task / surface.
  // North-Star path: the user wants to engage, give them context.
  var path = '/'
  if (taskId) path = '/?task=' + taskId
  else if (routineId) path = '/?routine=' + routineId
  else if (data.suggestionsView) path = '/?suggestions=1'
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
// Bump SHELL_CACHE when this SW changes so old caches get cleaned up on activate.
var SHELL_CACHE = 'boomerang-shell-v2'

self.addEventListener('install', function (event) {
  self.skipWaiting()
  // Pre-cache index.html so the offline fallback in `fetch` actually has
  // something to serve. Without this, the previous SW returned undefined
  // from caches.match() and Safari raised
  // "FetchEvent.respondWith received an error: Returned response is null."
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      return cache.add('/index.html').catch(function () { /* best effort */ })
    })
  )
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    Promise.all([
      // Clean up any older shell caches.
      caches.keys().then(function (keys) {
        return Promise.all(keys.map(function (k) {
          if (k.indexOf('boomerang-shell-') === 0 && k !== SHELL_CACHE) {
            return caches.delete(k)
          }
        }))
      }),
      self.clients.claim(),
    ])
  )
})

// --- Network-first caching for navigation ---
// On every navigation: try network, refresh the cached shell on success, fall
// back to the cached shell on failure. Critically: NEVER resolve respondWith
// with null/undefined — Safari errors out hard. If both network AND cache miss
// (first install offline, etc.), serve a synthetic offline page.
self.addEventListener('fetch', function (event) {
  if (event.request.url.indexOf('/api') !== -1) return
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    fetch(event.request).then(function (response) {
      // Refresh the shell cache opportunistically when we get a fresh page.
      if (response && response.ok) {
        var clone = response.clone()
        caches.open(SHELL_CACHE).then(function (cache) {
          cache.put('/index.html', clone).catch(function () {})
        }).catch(function () {})
      }
      return response
    }).catch(function () {
      return caches.match('/index.html').then(function (cached) {
        if (cached) return cached
        return new Response(
          '<!doctype html><html><head><meta charset="utf-8"><title>Boomerang offline</title>' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0B0B0F;color:#E8E8EC;' +
          'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;' +
          'margin:0;padding:24px;text-align:center}h1{margin:0 0 12px;font-size:24px}p{margin:0 0 24px;' +
          'color:#8A8A9A;line-height:1.5}a{color:#FF6240;text-decoration:none;padding:10px 20px;' +
          'border:1px solid #FF6240;border-radius:999px}</style></head>' +
          '<body><h1>Offline</h1><p>Boomerang couldn\'t reach the server.<br>It might be redeploying — try again in a moment.</p>' +
          '<a href="/">Retry</a></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      })
    })
  )
})
