import { useCallback, useEffect, useRef, useState } from 'react'
import { gcalListEvents, gcalStatus, notNowGet, notNowPost } from '../api'
import { loadSettings, safeSetItem } from '../store'
import { recordNotNow } from '../todayModel'
import { mergeNotNow, sameNotNow } from '../../server/notNowMerge.js'

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

// "Not now" on Worth doing next, shared by Today and Tasks and synced across
// devices (BOOM-43). The local copy renders immediately and works offline; the
// server copy is merged in on open and on every return to the app, and every
// dismissal is sent up. Merge rule: server/notNowMerge.js (same day → union,
// different days → the later day). A same-device window event keeps Today and
// Tasks in step when both are mounted.
const NOT_NOW_EVENT = 'boom-notnow'
export function useNotNow(todayKey) {
  const [state, setState] = useState(() => readJSON(NOT_NOW_KEY))
  const stateRef = useRef(state)
  const apply = useCallback((next) => {
    if (!next || sameNotNow(stateRef.current, next)) return
    stateRef.current = next
    setState(next)
    safeSetItem(NOT_NOW_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(NOT_NOW_EVENT, { detail: next }))
  }, [])
  useEffect(() => {
    let cancelled = false
    const sync = async () => {
      const server = await notNowGet()
      if (cancelled || !server) return
      const merged = mergeNotNow(readJSON(NOT_NOW_KEY), server)
      apply(merged)
      // Dismissals made here while offline go up too.
      if (merged && !sameNotNow(merged, server)) notNowPost(merged).then(s => { if (!cancelled && s) apply(mergeNotNow(stateRef.current, s)) })
    }
    sync()
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    const onLocal = (e) => apply(mergeNotNow(stateRef.current, e.detail))
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(NOT_NOW_EVENT, onLocal)
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onVisible); window.removeEventListener(NOT_NOW_EVENT, onLocal) }
  }, [todayKey, apply])
  const dismiss = useCallback((taskId, reasonKey) => {
    const next = recordNotNow(stateRef.current, todayKey, taskId, reasonKey)
    apply(next)
    notNowPost(next).then(s => { if (s) apply(mergeNotNow(stateRef.current, s)) })
  }, [todayKey, apply])
  return [state, dismiss]
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

