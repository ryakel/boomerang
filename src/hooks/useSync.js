import { useEffect, useRef, useCallback } from 'react'

const DEBOUNCE_MS = 500

export function useSync(tasks, routines, onHydrate) {
  const debounceTimer = useRef(null)
  const hasFetched = useRef(false)

  // On mount: pull data from server and hydrate localStorage
  useEffect(() => {
    if (hasFetched.current) return
    hasFetched.current = true

    fetch('/api/data')
      .then(res => {
        if (!res.ok) throw new Error('sync fetch failed')
        return res.json()
      })
      .then(data => {
        if (data && Object.keys(data).length > 0) {
          onHydrate(data)
        } else {
          // Server has no data — push current localStorage up
          pushAll()
        }
      })
      .catch(() => {
        // Server unreachable (local dev without server, etc.) — no-op
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Push current state to server
  const pushAll = useCallback(() => {
    const data = {}
    for (const key of ['boom_tasks_v1', 'boom_routines_v1', 'boom_settings_v1', 'boom_labels_v1']) {
      try {
        const raw = localStorage.getItem(key)
        if (raw) data[key.replace('boom_', '').replace('_v1', '')] = JSON.parse(raw)
      } catch { /* skip */ }
    }
    fetch('/api/data', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).catch(() => {})
  }, [])

  // Debounced push whenever tasks or routines change
  useEffect(() => {
    if (!hasFetched.current) return
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    debounceTimer.current = setTimeout(pushAll, DEBOUNCE_MS)
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [tasks, routines, pushAll])
}
