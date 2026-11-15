import { useEffect, useState } from 'react'
import { gcalListEvents, gcalStatus } from '../api'
import { loadSettings } from '../store'

// Shared by Kept 2.0 Today (TodayKept2.jsx) and the Tasks list (TasksViewKept.jsx),
// which both show "Worth doing next". The pick (todayModel's buildTodayModel)
// reads calendar events and the shared Not now state, so both screens must feed
// it the same inputs or they would recommend different tasks.

export const NOT_NOW_KEY = 'boom_today_notnow'
export const LASTNIGHT_KEY = 'boom_lastnight_hidden_on'   // shared with the classic screen
const EVENTS_TTL_MS = 10 * 60 * 1000

export function readJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}

export const clock = (msOrIso) => {
  const d = new Date(msOrIso)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`
}

export const minutesLabel = (min) => {
  if (min == null) return null
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r ? `${h} hr ${r} min` : `${h} hr`
}

// Calendar events for today and tomorrow, from the existing read-only
// GET /api/gcal/events. Not connected, offline or slow: no events, no error.
export function useCalendarEvents(todayKey) {
  const [raw, setRaw] = useState(null)
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      // Ask once whether Google Calendar is connected before asking for events.
      const status = await gcalStatus().catch(() => null)
      if (cancelled) return
      if (!status?.connected) { setRaw(null); return }
      const s = loadSettings()
      const start = new Date(); start.setHours(0, 0, 0, 0)
      const end = new Date(start); end.setDate(end.getDate() + 2)
      const calendars = [...new Set(['primary', s.gcal_calendar_id].filter(Boolean))]
      const results = await Promise.allSettled(calendars.map(c => gcalListEvents(start.toISOString(), end.toISOString(), c)))
      if (cancelled) return
      const ok = results.filter(r => r.status === 'fulfilled')
      if (ok.length === 0) { setRaw(null); return }
      const seen = new Set()
      const merged = []
      for (const r of ok) for (const e of r.value || []) { if (!seen.has(e.id)) { seen.add(e.id); merged.push(e) } }
      setRaw(merged)
    }
    load()
    const timer = setInterval(load, EVENTS_TTL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [todayKey])
  return raw
}

// The current minute, so time-based sections move without a reload.
export function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60 * 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') setNow(new Date()) }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible) }
  }, [])
  return now
}

