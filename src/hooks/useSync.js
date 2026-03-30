import { useEffect, useRef, useCallback } from 'react'
import { saveTasks, saveRoutines, getLocalModified, setLocalModified } from '../store'

const DEBOUNCE_MS = 500

// Buffer log lines and send to server in batches so we don't spam requests
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
  const backlog = tasks.filter(t => t.status === 'backlog').length
  return `${tasks.length} total (${open} open, ${done} done, ${backlog} backlog)`
}

function labelSummary(labels) {
  if (!Array.isArray(labels)) return 'n/a'
  return `${labels.length} labels: [${labels.map(l => l.name).join(', ')}]`
}

export function useSync(tasks, routines, onHydrate) {
  const debounceTimer = useRef(null)
  const hydrated = useRef(false)
  const skipNextPush = useRef(false)
  const latestState = useRef({ tasks, routines })

  // Keep latest state ref updated for beforeunload and visibility sync
  useEffect(() => {
    latestState.current = { tasks, routines }
  }, [tasks, routines])

  // Shared reconciliation: fetch server data and merge based on timestamps
  const reconcile = useCallback((reason) => {
    const local = latestState.current
    remoteLog(`${reason}: fetching GET /api/data...`)
    return fetch('/api/data')
      .then(res => {
        if (!res.ok) throw new Error(`sync fetch failed: ${res.status}`)
        return res.json()
      })
      .then(data => {
        const serverKeys = Object.keys(data)
        remoteLog(`${reason}: server tasks=`, taskSummary(data.tasks), '_lastModified=', data._lastModified || 'none')

        if (data && serverKeys.length > 0) {
          const serverModified = data._lastModified || 0
          const localModified = getLocalModified()
          remoteLog(`${reason}: COMPARING — local=`, localModified, 'server=', serverModified)

          if (localModified > serverModified) {
            remoteLog(`${reason}: ✦ LOCAL IS NEWER → pushing local to server`)
            pushState(local.tasks, local.routines)
          } else if (serverModified > localModified) {
            remoteLog(`${reason}: ✦ SERVER IS NEWER → hydrating from server`)
            skipNextPush.current = true
            onHydrate(data)
            if (data.tasks) saveTasks(data.tasks)
            if (data.routines) saveRoutines(data.routines)
            setLocalModified(serverModified)
          } else {
            remoteLog(`${reason}: timestamps match, no action needed`)
          }
        } else {
          remoteLog(`${reason}: server is EMPTY → pushing local state`)
          pushState(local.tasks, local.routines)
        }
      })
      .catch(err => {
        remoteLog(`${reason}: fetch FAILED:`, err.message)
      })
  }, [onHydrate])

  // On mount: initial reconciliation
  useEffect(() => {
    remoteLog('--- PAGE LOAD ---')
    remoteLog('mount: localStorage has', taskSummary(tasks))
    remoteLog('mount: localModified=', getLocalModified())

    let lsLabels = null
    try { lsLabels = JSON.parse(localStorage.getItem('boom_labels_v1')) } catch { /* parse error */ }
    remoteLog('mount: localStorage labels=', labelSummary(lsLabels))

    reconcile('mount').finally(() => {
      hydrated.current = true
      remoteLog('mount: hydrated=true, ready for change tracking')
      flushLogs()
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-sync when the app becomes visible (switching between PWA and browser,
  // or returning to the tab after using another app)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && hydrated.current) {
        remoteLog('--- VISIBILITY: app became visible, re-syncing ---')
        reconcile('visibility')
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [reconcile])

  // Flush pending sync on page unload to prevent data loss
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      const payload = buildPayload(latestState.current.tasks, latestState.current.routines)
      if (payload) {
        const line = `beforeunload: sendBeacon tasks=${taskSummary(payload.tasks)} _lastModified=${payload._lastModified}`
        navigator.sendBeacon(
          '/api/log',
          new Blob([JSON.stringify({ lines: [`[SYNC] ${line}`] })], { type: 'application/json' })
        )
        navigator.sendBeacon(
          '/api/data',
          new Blob([JSON.stringify(payload)], { type: 'application/json' })
        )
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Debounced push whenever tasks or routines change
  useEffect(() => {
    if (!hydrated.current) {
      return
    }
    if (skipNextPush.current) {
      remoteLog('effect: skip push (hydration cycle)')
      skipNextPush.current = false
      return
    }

    remoteLog('effect: tasks/routines changed →', taskSummary(tasks), '| scheduling push in', DEBOUNCE_MS, 'ms')

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      remoteLog('debounce: timer fired, pushing now')
      pushState(tasks, routines)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [tasks, routines])

  // Manual flush for settings/labels changes (not tracked as React state)
  const flush = useCallback(() => {
    remoteLog('flush: manual flush (settings/labels changed)')
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    pushState(latestState.current.tasks, latestState.current.routines)
  }, [])

  return flush
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

  data._lastModified = getLocalModified()

  return data
}

function pushState(tasks, routines) {
  const payload = buildPayload(tasks, routines)
  if (!payload) {
    remoteLog('pushState: no payload, skipping')
    return
  }

  remoteLog('pushState: PUT /api/data — tasks=', taskSummary(payload.tasks), 'labels=', labelSummary(payload.labels), '_lastModified=', payload._lastModified)

  fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(res => {
      if (!res.ok) remoteLog('pushState: server responded', res.status)
      else remoteLog('pushState: ✓ success')
      flushLogs()
    })
    .catch(err => {
      remoteLog('pushState: ✗ FAILED:', err.message)
      flushLogs()
    })
}
