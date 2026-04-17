import { useEffect, useState, useMemo } from 'react'
import { getWeather } from '../api'

const REFRESH_INTERVAL_MS = 30 * 60 * 1000 // 30 min

/**
 * Loads the cached weather forecast from the server.
 * Re-polls every 30 min so cards + What Now stay fresh.
 * Returns a quick lookup of { [isoDate]: day } for use in card badges.
 */
export function useWeather() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let cancelled = false
    const fetchOnce = async () => {
      try {
        const s = await getWeather()
        if (!cancelled) setStatus(s)
      } catch {
        // swallow — badge just won't render
      }
    }
    fetchOnce()
    const timer = setInterval(fetchOnce, REFRESH_INTERVAL_MS)
    // Also refresh when the page becomes visible again (likely stale)
    const vis = () => { if (document.visibilityState === 'visible') fetchOnce() }
    document.addEventListener('visibilitychange', vis)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', vis)
    }
  }, [])

  const byDate = useMemo(() => {
    const days = status?.cache?.forecast?.days || []
    const map = {}
    for (const d of days) map[d.date] = d
    return map
  }, [status])

  const enabled = !!status?.enabled && status?.cache?.forecast?.days?.length > 0

  return { enabled, byDate, status }
}
