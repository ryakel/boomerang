// growthAreas.js — personal "growth areas" (coaching reminders), see
// wiki/Growth-Areas.md for the full spec.
//
// Deliberately its own app_data collection (`growth_areas`), NOT part of the
// bulk `/api/data` sync blob — the client never folds it into that object,
// so it can't be clobbered by the whole-blob last-writer-wins path (same
// carve-out reasoning as tasks/routines/packages, see CLAUDE.md's Derived-
// Stat Durability Rules). All access goes through dedicated endpoints.
//
// Two collections:
//   growth_areas       — the user's list of areas (CRUD)
//   growth_area_today  — the cached once-daily rotation picks + AI renderings,
//                        `{ date, morning: pick|null, evening: pick|null }`
//                        where pick = `{ area_id, area_title, text }`

import { getData, setData } from './db.js'
import { aiComplete } from './aiGateway.js'

const AREAS_COLLECTION = 'growth_areas'
const TODAY_COLLECTION = 'growth_area_today'
const AI_TIMEOUT_MS = 6000
const ENERGY_TYPES = ['desk', 'people', 'errand', 'confrontation', 'creative', 'physical']
const VALID_DAY_SCOPES = new Set(['any', 'weekdays', 'weekends'])
const ROTATION_PERIODS = ['morning', 'evening']

// Legacy areas (shipped 2026-07-04) stored a single `mode: 'morning'|
// 'persistent'|'both'` field. Normalized on every read so old records keep
// working without a migration (this collection is a JSON blob, not a SQL
// table) — translated once into the current morning/evening/persistent +
// day_scope shape. The raw stored record keeps its stale `mode` key until
// next saved; harmless, nothing reads it after normalization.
function normalizeArea(a) {
  if (!a) return a
  if (a.morning !== undefined || a.evening !== undefined || a.persistent !== undefined) {
    return { day_scope: 'any', evening: false, ...a }
  }
  const mode = a.mode || 'both'
  return {
    ...a,
    morning: mode === 'morning' || mode === 'both',
    evening: false,
    persistent: mode === 'persistent' || mode === 'both',
    day_scope: 'any',
  }
}

function loadAreas() {
  const arr = getData(AREAS_COLLECTION)
  return Array.isArray(arr) ? arr.map(normalizeArea) : []
}
function saveAreas(arr) {
  setData(AREAS_COLLECTION, arr)
}

// Buckets "today" in the user's timezone (falls back to server-local),
// mirroring the pattern in tagSuggestions.js / db.js.
function todayLocalYMD() {
  const tz = getData('settings')?.user_timezone
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  }
}

// Day-of-week in the user's timezone, mirroring tagSuggestions.js's
// userLocalParts() pattern. 0 = Sunday ... 6 = Saturday.
function localDayOfWeek() {
  const tz = getData('settings')?.user_timezone
  try {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, weekday: 'short' }).format(new Date())
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    return map[wd] ?? new Date().getDay()
  } catch {
    return new Date().getDay()
  }
}

// "Leave work at work" — a work-scoped area shouldn't even be ELIGIBLE on a
// day it doesn't apply to, rather than trying to auto-detect "this is a
// work reminder, deprioritize on weekends" (which would mean guessing life
// domains via AI — more speculative machinery than this feature's "dead
// simple, no tracking" design calls for). day_scope is the deterministic,
// user-declared alternative: applies to both the daily rotation pool AND
// contextual injection, so a weekday-only area is fully invisible on a
// Saturday, not just deprioritized.
function dayScopeMatches(dayScope) {
  if (!dayScope || dayScope === 'any') return true
  const dow = localDayOfWeek()
  const isWeekend = dow === 0 || dow === 6
  return dayScope === 'weekends' ? isWeekend : !isWeekend
}

function dayOfYear(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  const start = Date.UTC(y, 0, 0)
  const cur = Date.UTC(y, m - 1, d)
  return Math.floor((cur - start) / 86400000)
}

async function callClaude({ system, user, maxTokens }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  try {
    const { text } = await aiComplete({
      tier: 'workhorse', system, user, maxTokens,
      feature: 'growth_areas', signal: controller.signal,
    })
    return text || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function inferEnergyAffinity(title) {
  const text = await callClaude({
    system: `Given a personal "growth area" someone wants to work on about themselves, pick the SINGLE best-matching energy type from this list, or "none" if nothing clearly fits: desk (focused computer/paperwork), people (social interaction), errand (going somewhere), confrontation (emotionally difficult interaction), creative (open-ended thinking/making), physical (bodily effort). Reply with just the one word — no punctuation, no explanation.`,
    user: title,
    maxTokens: 10,
  })
  if (!text) return null
  const word = text.toLowerCase().replace(/[^a-z]/g, '')
  return ENERGY_TYPES.includes(word) ? word : null
}

export function listGrowthAreas() {
  return loadAreas()
}

export function getGrowthArea(id) {
  return loadAreas().find(a => a.id === id) || null
}

// `morning`/`evening`/`persistent` default to the old "both" shape (morning
// + persistent, no evening) when none are explicitly specified — e.g. a
// bare Quokka create_growth_area({title}) call. Once ANY of the three is
// specified, the other two default to false rather than silently keeping
// the old default, so an explicit "evening only" request isn't quietly
// widened.
export async function createGrowthArea({ title, morning, evening, persistent, day_scope }) {
  const t = String(title || '').trim()
  if (!t) throw new Error('title is required')
  const anySpecified = morning !== undefined || evening !== undefined || persistent !== undefined
  const energy_affinity = await inferEnergyAffinity(t)
  const area = {
    id: `ga-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: t,
    morning: anySpecified ? !!morning : true,
    evening: anySpecified ? !!evening : false,
    persistent: anySpecified ? !!persistent : true,
    day_scope: VALID_DAY_SCOPES.has(day_scope) ? day_scope : 'any',
    energy_affinity,
    active: true,
    created_at: new Date().toISOString(),
  }
  const arr = loadAreas()
  arr.push(area)
  saveAreas(arr)
  return area
}

export function updateGrowthArea(id, updates = {}) {
  const arr = loadAreas()
  const idx = arr.findIndex(a => a.id === id)
  if (idx === -1) return null
  const next = { ...arr[idx] }
  if (updates.title !== undefined) next.title = String(updates.title).trim()
  if (updates.morning !== undefined) next.morning = !!updates.morning
  if (updates.evening !== undefined) next.evening = !!updates.evening
  if (updates.persistent !== undefined) next.persistent = !!updates.persistent
  if (updates.day_scope !== undefined && VALID_DAY_SCOPES.has(updates.day_scope)) next.day_scope = updates.day_scope
  if (updates.active !== undefined) next.active = !!updates.active
  if (updates.energy_affinity !== undefined) {
    next.energy_affinity = ENERGY_TYPES.includes(updates.energy_affinity) ? updates.energy_affinity : null
  }
  delete next.mode // fully migrated off the legacy field once explicitly edited
  arr[idx] = next
  saveAreas(arr)
  return next
}

export function deleteGrowthArea(id) {
  const arr = loadAreas()
  const next = arr.filter(a => a.id !== id)
  if (next.length === arr.length) return false
  saveAreas(next)
  return true
}

// --- Rotation (morning + evening, independently scoped) ---

function rotationPool(period) {
  return loadAreas().filter(a => a.active && a[period] && dayScopeMatches(a.day_scope))
}

function pickRotationArea(pool, ymd) {
  if (pool.length === 0) return null
  const idx = dayOfYear(ymd) % pool.length
  return pool[idx]
}

async function rephraseArea(area, period) {
  const framing = period === 'evening'
    ? 'This is an EVENING nudge — write it as a wind-down/closing-out cue (e.g. "closing your laptop", "before you head home"), not a morning energize-for-the-day tone.'
    : 'This is a MORNING nudge — write it as a start-the-day cue.'
  const text = await callClaude({
    system: `You write short, warm, concrete nudges for an ADHD-friendly personal coaching app. Given a standing "growth area" the user wants to work on about themselves, write ONE fresh, specific, encouraging sentence (under 16 words) that makes today's version of it concrete and actionable — not a generic restatement. ${framing} Vary the phrasing every time; never just repeat the input. Reply with just the sentence — no quotes, no preamble.`,
    user: area.title,
    maxTokens: 60,
  })
  if (!text) return area.title
  return text.replace(/^["']|["']$/g, '').trim() || area.title
}

// Computes (if not already cached for today) and returns the daily picks
// for both periods. Safe to call frequently — no-ops once cached.
//
// A cached EMPTY pick (area_id: null — no eligible areas that period/day)
// is deliberately NOT sticky: it's the common first-run shape (user adds
// their first area mid-day, or a work-scoped area's day_scope just isn't
// "today"), and re-checking the pool costs nothing when still empty. Only
// ever upgrades null → a real pick, so it can't cause the digest/banner
// disagreement the caching exists to prevent — that risk only applies once
// a REAL pick (with its AI-rephrased text) has been made and potentially
// already delivered.
export async function ensureTodayGrowthArea() {
  const today = todayLocalYMD()
  const cached = getData(TODAY_COLLECTION)
  const result = cached?.date === today ? { ...cached } : { date: today }
  let changed = cached?.date !== today

  for (const period of ROTATION_PERIODS) {
    if (result[period]?.area_id) continue // already resolved a real pick for this period today
    const pool = rotationPool(period)
    const area = pickRotationArea(pool, today)
    if (!area) {
      result[period] = { area_id: null, area_title: null, text: null }
      changed = true
      continue
    }
    const text = await rephraseArea(area, period)
    result[period] = { area_id: area.id, area_title: area.title, text }
    changed = true
  }
  if (changed) setData(TODAY_COLLECTION, result)
  return result
}

// Sync read-only accessor — returns null if today's picks haven't been
// computed yet (caller should trigger ensureTodayGrowthArea() separately;
// digestBuilder.js is synchronous and must never block on a live AI call).
// Returns `{ date, morning, evening }`; either period may be null/absent
// if not yet computed this cycle.
export function getTodayGrowthAreaCached() {
  const cached = getData(TODAY_COLLECTION)
  return cached?.date === todayLocalYMD() ? cached : null
}

// Active areas eligible for contextual injection (What Now / Quokka),
// filtered by day_scope the same way the rotation pool is — a weekday-only
// area doesn't get mentioned in a Saturday What Now pick either.
export function contextualGrowthAreas() {
  return loadAreas().filter(a => a.active && a.persistent && dayScopeMatches(a.day_scope))
}

// --- Background sync loop, mirrors weatherSync.js's cadence pattern ---

const REFRESH_INTERVAL_MS = 15 * 60 * 1000 // 15 min
let loopTimer = null

export function startGrowthAreaSync() {
  const tick = () => {
    ensureTodayGrowthArea().catch(err => console.error('[GrowthAreas] refresh failed:', err.message))
  }
  tick()
  loopTimer = setInterval(tick, REFRESH_INTERVAL_MS)
  console.log('[GrowthAreas] Daily rotation sync loop running')
}

export function stopGrowthAreaSync() {
  if (loopTimer) clearInterval(loopTimer)
  loopTimer = null
}
