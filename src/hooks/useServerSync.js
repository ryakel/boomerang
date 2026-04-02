import { useState, useEffect, useRef, useCallback } from 'react'
import { saveTasks, saveRoutines, saveSettings, saveLabels } from '../store'

const DEBOUNCE_MS = 300

// Buffer log lines and send to server in batches
const _logBuffer = []
let _logTimer = null
function remoteLog(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  console.log('[SYNC]', line)
  _logBuffer.push(`[SYNC] ${line}`)
  if (!_logTimer) {
    _logTimer = setTimeout(flushLogs, 200)
  }
}
function flushLogs() {
  _logTimer = null
  if (_logBuffer.length === 0) return
  const lines = _logBuffer.splice(0)
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines }),
  }).catch(() => {})
}

function taskSummary(tasks) {
  if (!Array.isArray(tasks)) return 'n/a'
  const done = tasks.filter(t => t.status === 'done').length
  const open = tasks.filter(t => t.status === 'open').length
  return `${tasks.length} total (${open} open, ${done} done)`
}

export function useServerSync(tasks, routines, onHydrate, onVersionMismatch) {
  const clientId = useRef(crypto.randomUUID()).current
  const debounceTimer = useRef(null)
  const hydrated = useRef(false)
  const skipNextPush = useRef(false)
  const latestState = useRef({ tasks, routines })
  const serverVersion = useRef(0)
  const [syncStatus, setSyncStatus] = useState(null) // null | 'saving' | 'saved' | 'offline'
  const savedTimer = useRef(null)

  // Keep latest state ref updated
  useEffect(() => {
    latestState.current = { tasks, routines }
  }, [tasks, routines])

  // Fetch server data and hydrate local state
  const fetchAndHydrate = useCallback((reason) => {
    // Cancel any pending push — we're about to get fresh server state,
    // so pushing stale local state would cause a race condition
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current)
      debounceTimer.current = null
      remoteLog(`${reason}: cancelled pending push`)
    }
    remoteLog(`${reason}: fetching /api/data`)
    return fetch('/api/data')
      .then(res => {
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`)
        return res.json()
      })
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          serverVersion.current = data._version || 0
          remoteLog(`${reason}: got v${serverVersion.current}, tasks=${taskSummary(data.tasks)}`)
          skipNextPush.current = true
          onHydrate(data)
          // Cache in localStorage for offline/fast initial render
          if (data.tasks) saveTasks(data.tasks)
          if (data.routines) saveRoutines(data.routines)
          if (data.settings) saveSettings(data.settings)
          if (data.labels) saveLabels(data.labels)
        } else {
          remoteLog(`${reason}: server empty, pushing local state`)
          pushState(latestState.current.tasks, latestState.current.routines)
        }
      })
      .catch(err => {
        remoteLog(`${reason}: fetch failed: ${err.message}`)
      })
  }, [onHydrate])

  // SSE connection
  useEffect(() => {
    remoteLog(`SSE: connecting (clientId=${clientId.slice(0, 8)})`)
    let es = null
    let reconnectTimer = null

    function connect() {
      es = new EventSource('/api/events')

      es.onmessage = (event) => {
        if (event.data.startsWith(':')) return // ping
        let msg
        try { msg = JSON.parse(event.data) } catch { return }

        if (msg.type === 'connected') {
          serverVersion.current = msg.version
          remoteLog(`SSE: connected, server v${msg.version}, appVersion=${msg.appVersion}`)

          // Show update modal if client is running a different version than the server
          const clientVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
          if (msg.appVersion && clientVersion !== 'dev' && msg.appVersion !== clientVersion) {
            remoteLog(`SSE: VERSION MISMATCH — client=${clientVersion} server=${msg.appVersion}`)
            flushLogs()
            if (onVersionMismatch) onVersionMismatch(msg.appVersion)
            return
          }

          fetchAndHydrate('initial').finally(() => {
            hydrated.current = true
            remoteLog('SSE: hydrated, ready for sync')
            flushLogs()
          })
        } else if (msg.type === 'update') {
          if (msg.sourceClientId === clientId) {
            // Our own write echoed back, just update version
            serverVersion.current = msg.version
            remoteLog(`SSE: own write confirmed v${msg.version}`)
            return
          }
          remoteLog(`SSE: update from another client v${msg.version}`)
          serverVersion.current = msg.version
          fetchAndHydrate('sse-update')
        }
      }

      es.onerror = () => {
        remoteLog('SSE: connection error, will auto-reconnect')
        // EventSource auto-reconnects, but if it closes permanently we retry
        if (es.readyState === EventSource.CLOSED) {
          remoteLog('SSE: closed, manual reconnect in 3s')
          reconnectTimer = setTimeout(connect, 3000)
        }
      }
    }

    connect()

    return () => {
      if (es) es.close()
      if (reconnectTimer) clearTimeout(reconnectTimer)
    }
  }, [clientId, fetchAndHydrate])

  // Re-sync when app becomes visible (covers iOS killing SSE in background,
  // mobile browser tab switches, and PWA resume)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && hydrated.current) {
        remoteLog('visibility: app became visible, checking for updates')
        fetchAndHydrate('visibility')
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [fetchAndHydrate])

  // Debounced push whenever tasks or routines change
  useEffect(() => {
    if (!hydrated.current) return
    if (skipNextPush.current) {
      skipNextPush.current = false
      return
    }

    remoteLog('change: scheduling push in', DEBOUNCE_MS, 'ms')

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      pushState(latestState.current.tasks, latestState.current.routines)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [tasks, routines])

  // Flush pending sync on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      const payload = buildPayload(latestState.current.tasks, latestState.current.routines)
      if (payload) {
        payload._clientId = clientId
        navigator.sendBeacon(
          '/api/data',
          new Blob([JSON.stringify(payload)], { type: 'application/json' })
        )
        remoteLog('beforeunload: sendBeacon')
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [clientId])

  // Manual flush for settings/labels changes
  const flush = useCallback(() => {
    remoteLog('flush: manual (settings/labels changed)')
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    pushState(latestState.current.tasks, latestState.current.routines)
  }, [])

  // Push helper - uses clientId from closure
  function pushState(tasks, routines) {
    const payload = buildPayload(tasks, routines)
    if (!payload) {
      remoteLog('push: no payload, skipping')
      return
    }
    payload._clientId = clientId

    remoteLog('push: PUT /api/data — tasks=', taskSummary(payload.tasks))
    setSyncStatus('saving')

    fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(res => {
        if (!res.ok) {
          remoteLog('push: server responded', res.status)
          setSyncStatus('offline')
        } else return res.json().then(r => {
          serverVersion.current = r.version
          remoteLog('push: success v' + r.version)
          setSyncStatus('saved')
          if (savedTimer.current) clearTimeout(savedTimer.current)
          savedTimer.current = setTimeout(() => setSyncStatus(null), 2000)
        })
        flushLogs()
      })
      .catch(err => {
        remoteLog('push: FAILED:', err.message)
        setSyncStatus('offline')
        flushLogs()
      })
  }

  // Check app version against server on demand (e.g. on view navigation)
  const checkVersion = useCallback(() => {
    fetch('/api/health')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.appVersion) return
        const clientVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
        if (clientVersion !== 'dev' && data.appVersion !== clientVersion) {
          remoteLog(`version check: mismatch client=${clientVersion} server=${data.appVersion}`)
          if (onVersionMismatch) onVersionMismatch(data.appVersion)
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { flush, checkVersion, syncStatus }
}

function buildPayload(tasks, routines) {
  let settings = null
  let labels = null
  try { settings = JSON.parse(localStorage.getItem('boom_settings_v1')) } catch { /* */ }
  try { labels = JSON.parse(localStorage.getItem('boom_labels_v1')) } catch { /* */ }

  const data = {}
  if (Array.isArray(tasks)) data.tasks = tasks
  if (Array.isArray(routines)) data.routines = routines
  if (settings) data.settings = settings
  if (labels) data.labels = labels

  if (Object.keys(data).length === 0) return null
  return data
}
