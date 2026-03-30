import { useEffect, useRef } from 'react'
import { saveTasks, saveRoutines, saveSettings, saveLabels } from '../store'

const DEBOUNCE_MS = 500

export function useSync(tasks, routines, onHydrate) {
  const debounceTimer = useRef(null)
  const hydrated = useRef(false)
  const skipNextPush = useRef(false)

  // On mount: pull data from server and hydrate localStorage + React state
  useEffect(() => {
    fetch('/api/data')
      .then(res => {
        if (!res.ok) throw new Error('sync fetch failed')
        return res.json()
      })
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          // Server has data — hydrate into React state + localStorage
          skipNextPush.current = true
          onHydrate(data)
          // Also persist to localStorage so store reads work
          if (data.tasks) saveTasks(data.tasks)
          if (data.routines) saveRoutines(data.routines)
          if (data.settings) saveSettings(data.settings)
          if (data.labels) saveLabels(data.labels)
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
}

function pushState(tasks, routines) {
  // Read settings and labels from localStorage (they don't change as often)
  let settings = null
  let labels = null
  try { settings = JSON.parse(localStorage.getItem('boom_settings_v1')) } catch { /* */ }
  try { labels = JSON.parse(localStorage.getItem('boom_labels_v1')) } catch { /* */ }

  const data = {}
  if (tasks?.length) data.tasks = tasks
  if (routines?.length) data.routines = routines
  if (settings) data.settings = settings
  if (labels) data.labels = labels

  if (Object.keys(data).length === 0) return

  fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).catch(() => {})
}
