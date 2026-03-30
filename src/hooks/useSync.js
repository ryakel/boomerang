import { useEffect, useRef, useCallback } from 'react'
import { saveTasks, saveRoutines, getLocalModified, setLocalModified } from '../store'

const DEBOUNCE_MS = 500
const TAG = '[SYNC]'

function log(...args) {
  console.log(TAG, ...args)
}

export function useSync(tasks, routines, onHydrate) {
  const debounceTimer = useRef(null)
  const hydrated = useRef(false)
  const skipNextPush = useRef(false)
  const latestState = useRef({ tasks, routines })

  // Keep latest state ref updated for beforeunload
  useEffect(() => {
    latestState.current = { tasks, routines }
  }, [tasks, routines])

  // On mount: pull data from server and reconcile with localStorage
  useEffect(() => {
    log('mount: fetching /api/data...')
    log('mount: localStorage has', tasks.length, 'tasks,', routines.length, 'routines, localModified=', getLocalModified())
    fetch('/api/data')
      .then(res => {
        if (!res.ok) throw new Error(`sync fetch failed: ${res.status}`)
        return res.json()
      })
      .then(data => {
        const serverKeys = Object.keys(data)
        const serverTaskCount = Array.isArray(data.tasks) ? data.tasks.length : 0
        const serverDoneCount = Array.isArray(data.tasks) ? data.tasks.filter(t => t.status === 'done').length : 0
        log('mount: server responded with collections=', serverKeys, 'tasks=', serverTaskCount, `(${serverDoneCount} done)`)

        if (data && serverKeys.length > 0) {
          const serverModified = data._lastModified || 0
          const localModified = getLocalModified()
          log('mount: comparing timestamps — local=', localModified, 'server=', serverModified)

          if (localModified > serverModified) {
            log('mount: LOCAL IS NEWER → pushing local to server')
            pushState(tasks, routines)
          } else {
            log('mount: SERVER IS NEWER OR EQUAL → hydrating from server')
            skipNextPush.current = true
            onHydrate(data)
            if (data.tasks) saveTasks(data.tasks)
            if (data.routines) saveRoutines(data.routines)
            setLocalModified(serverModified)
            log('mount: hydration complete, set localModified=', serverModified)
          }
        } else {
          log('mount: server is EMPTY → pushing local state up')
          pushState(tasks, routines)
        }
      })
      .catch(err => {
        log('mount: fetch FAILED:', err.message, '→ working offline')
      })
      .finally(() => {
        hydrated.current = true
        log('mount: hydrated flag set to true')
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending sync on page unload to prevent data loss
  useEffect(() => {
    const handleBeforeUnload = () => {
      log('beforeunload: flushing via sendBeacon')
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      const payload = buildPayload(latestState.current.tasks, latestState.current.routines)
      if (payload) {
        const taskCount = Array.isArray(payload.tasks) ? payload.tasks.length : 0
        log('beforeunload: sending', taskCount, 'tasks, _lastModified=', payload._lastModified)
        navigator.sendBeacon(
          '/api/data',
          new Blob([JSON.stringify(payload)], { type: 'application/json' })
        )
      } else {
        log('beforeunload: no payload to send')
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // Debounced push whenever tasks or routines change
  useEffect(() => {
    if (!hydrated.current) {
      log('effect: skipping push — not yet hydrated')
      return
    }
    if (skipNextPush.current) {
      log('effect: skipping push — skipNextPush flag set (hydration)')
      skipNextPush.current = false
      return
    }

    const doneCount = tasks.filter(t => t.status === 'done').length
    log('effect: tasks/routines changed — scheduling push in', DEBOUNCE_MS, 'ms (tasks=', tasks.length, `${doneCount} done,`, 'routines=', routines.length, ')')

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      log('debounce: pushing now')
      pushState(tasks, routines)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [tasks, routines])

  // Manual flush for settings/labels changes (not tracked as React state)
  const flush = useCallback(() => {
    log('flush: manual flush called (settings/labels)')
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
    log('pushState: no payload, skipping')
    return
  }

  const taskCount = Array.isArray(payload.tasks) ? payload.tasks.length : 0
  const doneCount = Array.isArray(payload.tasks) ? payload.tasks.filter(t => t.status === 'done').length : 0
  log('pushState: PUT /api/data — tasks=', taskCount, `(${doneCount} done)`, 'routines=', Array.isArray(payload.routines) ? payload.routines.length : 0, '_lastModified=', payload._lastModified)

  fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
    .then(res => {
      if (!res.ok) log('pushState: server responded with', res.status)
      else log('pushState: success')
    })
    .catch(err => {
      log('pushState: FAILED:', err.message)
    })
}
