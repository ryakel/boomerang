import { useEffect, useRef, useCallback } from 'react'
import { saveTasks, saveRoutines, getLocalModified, setLocalModified } from '../store'

const DEBOUNCE_MS = 500

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
    fetch('/api/data')
      .then(res => {
        if (!res.ok) throw new Error('sync fetch failed')
        return res.json()
      })
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          const serverModified = data._lastModified || 0
          const localModified = getLocalModified()

          if (localModified > serverModified) {
            // Local data is newer (e.g. push hadn't finished before refresh)
            // Push local state to server instead of hydrating
            pushState(tasks, routines)
          } else {
            // Server data is same age or newer — hydrate from server
            skipNextPush.current = true
            onHydrate(data)
            if (data.tasks) saveTasks(data.tasks)
            if (data.routines) saveRoutines(data.routines)
            // Align local timestamp with server so next comparison works
            setLocalModified(serverModified)
          }
        } else {
          // Server empty — push current state up
          pushState(tasks, routines)
        }
      })
      .catch(() => {
        // Server unreachable — work offline
      })
      .finally(() => {
        hydrated.current = true
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Flush pending sync on page unload to prevent data loss
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
      }
      // sendBeacon only sends POST — server has a matching POST handler
      const payload = buildPayload(latestState.current.tasks, latestState.current.routines)
      if (payload) {
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
    if (!hydrated.current) return
    if (skipNextPush.current) {
      skipNextPush.current = false
      return
    }

    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(() => {
      pushState(tasks, routines)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [tasks, routines])

  // Manual flush for settings/labels changes (not tracked as React state)
  const flush = useCallback(() => {
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

  // Include local modification timestamp so the server stores it and
  // the next hydration can compare freshness
  data._lastModified = getLocalModified()

  return data
}

function pushState(tasks, routines) {
  const payload = buildPayload(tasks, routines)
  if (!payload) return

  fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {})
}
