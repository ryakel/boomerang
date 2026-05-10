import { useState, useEffect, useRef, useCallback } from 'react'
import { saveTasks, saveRoutines, saveSettings, saveLabels, loadSettings, uuid } from '../store'
import { serverCreateTask, serverUpdateTask, serverDeleteTask,
  serverCreateRoutine, serverUpdateRoutine, serverDeleteRoutine } from '../api'

const DEBOUNCE_MS = 300
const MUTATION_QUEUE_KEY = 'boom_mutation_queue'

// --- Mutation queue helpers ---
function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(MUTATION_QUEUE_KEY) || '[]')
  } catch { return [] }
}

function saveQueue(queue) {
  localStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(queue))
}

function enqueueMutations(ops) {
  const queue = loadQueue()
  queue.push(...ops)
  // Cap at 200 entries to avoid unbounded growth
  if (queue.length > 200) queue.splice(0, queue.length - 200)
  saveQueue(queue)
}

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
  const clientId = useRef(uuid()).current
  const debounceTimer = useRef(null)
  const hydrated = useRef(false)
  const skipNextPush = useRef(false)
  const latestState = useRef({ tasks, routines })
  const serverVersion = useRef(0)
  const [syncStatus, setSyncStatus] = useState(null) // null | 'saving' | 'saved' | 'offline'
  const savedTimer = useRef(null)
  const versionMismatchFired = useRef(false)

  // Track previous state for diffing
  const prevTasks = useRef(null)
  const prevRoutines = useRef(null)

  // If we just reloaded for a version update, skip all version checks this page load
  if (!versionMismatchFired.current && sessionStorage.getItem('boom_reloading_for_update')) {
    sessionStorage.removeItem('boom_reloading_for_update')
    versionMismatchFired.current = true
  }

  const onVersionMismatchRef = useRef(onVersionMismatch)
  onVersionMismatchRef.current = onVersionMismatch

  const fireVersionMismatch = useCallback((newVersion) => {
    if (versionMismatchFired.current) return
    versionMismatchFired.current = true
    if (onVersionMismatchRef.current) onVersionMismatchRef.current(newVersion)
  }, [])

  // Keep latest state ref updated
  useEffect(() => {
    latestState.current = { tasks, routines }
  }, [tasks, routines])

  // Bulk push helper — settings/labels only. Tasks and routines never travel
  // through this path (per-record APIs handle them).
  const pushBulkState = useCallback(function pushBulkState() {
    const payload = buildPayload()
    if (!payload) {
      remoteLog('push: no payload, skipping')
      return
    }
    payload._clientId = clientId
    payload._appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

    remoteLog('push: PUT /api/data (settings/labels) keys=' + Object.keys(payload).filter(k => !k.startsWith('_')).join(','))
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
          prevTasks.current = latestState.current.tasks
          prevRoutines.current = latestState.current.routines
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
  }, [clientId])

  // Per-record change detection and push
  const pushChanges = useCallback(function pushChanges(currentTasks, currentRoutines) {
    const prev = prevTasks.current
    const prevR = prevRoutines.current

    // No prior snapshot means hydrate hasn't completed (or failed). Refuse to
    // push — local state isn't authoritative until we've successfully read the
    // server's view at least once. Settings/labels changes will still flush
    // via the manual `flush()` path; tasks/routines will sync once a hydrate
    // lands and prev gets set.
    if (!prev || !prevR) {
      remoteLog('push: skipped — not yet hydrated, refusing to push unverified state')
      return
    }

    const ops = []

    // Diff tasks
    const prevMap = new Map(prev.map(t => [t.id, t]))
    const currMap = new Map((currentTasks || []).map(t => [t.id, t]))

    // New or updated tasks
    for (const [id, task] of currMap) {
      const old = prevMap.get(id)
      if (!old) {
        ops.push(() => serverCreateTask(task, clientId))
      } else if (JSON.stringify(old) !== JSON.stringify(task)) {
        ops.push(() => serverUpdateTask(id, task, clientId))
      }
    }
    // Deleted tasks
    for (const id of prevMap.keys()) {
      if (!currMap.has(id)) {
        ops.push(() => serverDeleteTask(id))
      }
    }

    // Diff routines
    const prevRMap = new Map(prevR.map(r => [r.id, r]))
    const currRMap = new Map((currentRoutines || []).map(r => [r.id, r]))

    for (const [id, routine] of currRMap) {
      const old = prevRMap.get(id)
      if (!old) {
        ops.push(() => serverCreateRoutine(routine, clientId))
      } else if (JSON.stringify(old) !== JSON.stringify(routine)) {
        ops.push(() => serverUpdateRoutine(id, routine, clientId))
      }
    }
    for (const id of prevRMap.keys()) {
      if (!currRMap.has(id)) {
        ops.push(() => serverDeleteRoutine(id))
      }
    }

    if (ops.length === 0) {
      remoteLog('push: no changes detected')
      prevTasks.current = currentTasks
      prevRoutines.current = currentRoutines
      return
    }

    remoteLog(`push: ${ops.length} per-record operation(s)`)
    setSyncStatus('saving')

    // Build serializable descriptions for queue fallback
    const opDescriptions = []
    for (const [id, task] of currMap) {
      const old = prevMap.get(id)
      if (!old) opDescriptions.push({ type: 'createTask', data: task })
      else if (JSON.stringify(old) !== JSON.stringify(task)) opDescriptions.push({ type: 'updateTask', id, data: task })
    }
    for (const id of prevMap.keys()) {
      if (!currMap.has(id)) opDescriptions.push({ type: 'deleteTask', id })
    }
    for (const [id, routine] of currRMap) {
      const old = prevRMap.get(id)
      if (!old) opDescriptions.push({ type: 'createRoutine', data: routine })
      else if (JSON.stringify(old) !== JSON.stringify(routine)) opDescriptions.push({ type: 'updateRoutine', id, data: routine })
    }
    for (const id of prevRMap.keys()) {
      if (!currRMap.has(id)) opDescriptions.push({ type: 'deleteRoutine', id })
    }

    Promise.all(ops.map(op => op()))
      .then(results => {
        for (const r of results) {
          if (r?.version) serverVersion.current = r.version
        }
        prevTasks.current = currentTasks
        prevRoutines.current = currentRoutines
        remoteLog(`push: success, ${ops.length} ops, v${serverVersion.current}`)
        setSyncStatus('saved')
        if (savedTimer.current) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSyncStatus(null), 2000)
        flushLogs()
      })
      .catch(err => {
        remoteLog('push: per-record FAILED:', err.message, '— queueing mutations')
        enqueueMutations(opDescriptions)
        setSyncStatus('offline')
        // Still update prev so we don't re-diff the same changes
        prevTasks.current = currentTasks
        prevRoutines.current = currentRoutines
        flushLogs()
      })
  }, [clientId, pushBulkState])

  // Replay queued mutations
  const replayQueue = useCallback(() => {
    const queue = loadQueue()
    if (queue.length === 0) return Promise.resolve()

    remoteLog(`replay: ${queue.length} queued mutation(s)`)
    setSyncStatus('saving')

    const executors = {
      createTask: (op) => serverCreateTask(op.data, clientId),
      updateTask: (op) => serverUpdateTask(op.id, op.data, clientId),
      deleteTask: (op) => serverDeleteTask(op.id),
      createRoutine: (op) => serverCreateRoutine(op.data, clientId),
      updateRoutine: (op) => serverUpdateRoutine(op.id, op.data, clientId),
      deleteRoutine: (op) => serverDeleteRoutine(op.id),
    }

    // Execute sequentially to preserve order
    let chain = Promise.resolve()
    for (const op of queue) {
      const exec = executors[op.type]
      if (exec) {
        chain = chain.then(() => exec(op)).then(r => {
          if (r?.version) serverVersion.current = r.version
        })
      }
    }

    return chain
      .then(() => {
        saveQueue([])
        remoteLog(`replay: success, ${queue.length} ops replayed`)
        setSyncStatus('saved')
        if (savedTimer.current) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSyncStatus(null), 2000)
        flushLogs()
      })
      .catch(err => {
        remoteLog(`replay: FAILED: ${err.message} — keeping queue`)
        setSyncStatus('offline')
        flushLogs()
      })
  }, [clientId])

  // Fetch server data and hydrate local state
  const fetchAndHydrate = useCallback((reason) => {
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
          if (data.tasks) saveTasks(data.tasks)
          if (data.routines) saveRoutines(data.routines)
          if (data.settings) {
            // Preserve local theme. Theme is device-local (laptop vs phone vs
            // tablet have different ergonomics; user might prefer terminal on
            // one device and light on another). Without this guard, a
            // hydration that lands within ~300ms of a theme pick can overwrite
            // the just-saved local theme with stale server data and the
            // preference appears to revert on refresh.
            const localTheme = (loadSettings() || {}).theme
            const merged = { ...data.settings }
            if (localTheme) merged.theme = localTheme
            saveSettings(merged)
          }
          if (data.labels) saveLabels(data.labels)
          prevTasks.current = data.tasks || []
          prevRoutines.current = data.routines || []
        } else {
          remoteLog(`${reason}: server empty, pushing local settings/labels`)
          pushBulkState()
        }
      })
      .catch(err => {
        remoteLog(`${reason}: fetch failed: ${err.message}`)
      })
  }, [onHydrate, pushBulkState])

  // SSE connection
  useEffect(() => {
    remoteLog(`SSE: connecting (clientId=${clientId.slice(0, 8)})`)
    let es = null
    let reconnectTimer = null

    function connect() {
      es = new EventSource('/api/events')

      es.onmessage = (event) => {
        if (event.data.startsWith(':')) return
        let msg
        try { msg = JSON.parse(event.data) } catch { return }

        if (msg.type === 'connected') {
          serverVersion.current = msg.version
          remoteLog(`SSE: connected, server v${msg.version}, appVersion=${msg.appVersion}`)

          const clientVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
          if (msg.appVersion && clientVersion !== 'dev' && msg.appVersion !== clientVersion) {
            remoteLog(`SSE: VERSION MISMATCH — client=${clientVersion} server=${msg.appVersion}`)
            flushLogs()
            fireVersionMismatch(msg.appVersion)
            return
          }

          fetchAndHydrate('initial').then(() => {
            return replayQueue()
          }).finally(() => {
            hydrated.current = true
            remoteLog('SSE: hydrated, ready for sync')
            flushLogs()
          })
        } else if (msg.type === 'update') {
          if (msg.sourceClientId === clientId) {
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
  }, [clientId, fetchAndHydrate, fireVersionMismatch, replayQueue])

  // Re-sync when app becomes visible
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

  // Detect online/offline and replay queue on reconnect
  useEffect(() => {
    const handleOnline = () => {
      remoteLog('network: back online, replaying queue')
      setSyncStatus(null)
      replayQueue()
    }
    const handleOffline = () => {
      remoteLog('network: went offline')
      setSyncStatus('offline')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    // Set initial offline status if already offline
    if (!navigator.onLine) setSyncStatus('offline')
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [replayQueue])

  // Debounced per-record push whenever tasks or routines change
  useEffect(() => {
    if (!hydrated.current) return
    if (skipNextPush.current) {
      skipNextPush.current = false
      return
    }

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      pushChanges(latestState.current.tasks, latestState.current.routines)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [tasks, routines, pushChanges])

  // Flush pending sync on page unload — uses bulk endpoint (sendBeacon limitation)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      const payload = buildPayload()
      if (payload) {
        payload._clientId = clientId
        payload._appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
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

  // Manual flush for settings/labels changes (still bulk since those live in app_data)
  const flush = useCallback(() => {
    remoteLog('flush: manual (settings/labels changed)')
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    pushBulkState()
  }, [pushBulkState])

  // Check app version against server on demand
  const checkVersion = useCallback(() => {
    if (versionMismatchFired.current) return
    fetch('/api/health')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.appVersion) return
        const clientVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
        if (clientVersion !== 'dev' && data.appVersion !== clientVersion) {
          remoteLog(`version check: mismatch client=${clientVersion} server=${data.appVersion}`)
          fireVersionMismatch(data.appVersion)
        }
      })
      .catch(() => {})
  }, [fireVersionMismatch])

  const queueLength = loadQueue().length

  return { flush, checkVersion, syncStatus, queueLength }
}

// Bulk PUT carries settings + labels only. Tasks and routines have their own
// per-record /api/tasks and /api/routines APIs; including them here was the
// wipe vector that destroyed 153 tasks on 2026-05-07 (a client whose initial
// GET failed sent tasks: [] via manual flush). Server has a 409 guard now,
// but the cleanest fix is to never give the server a chance to misinterpret
// an empty client state as a delete-all command.
function buildPayload() {
  let settings = null
  let labels = null
  try { settings = JSON.parse(localStorage.getItem('boom_settings_v1')) } catch { /* */ }
  try { labels = JSON.parse(localStorage.getItem('boom_labels_v1')) } catch { /* */ }

  const data = {}
  if (settings) data.settings = settings
  if (labels) data.labels = labels

  if (Object.keys(data).length === 0) return null
  return data
}
