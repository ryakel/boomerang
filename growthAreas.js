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
//   growth_area_today  — the cached once-daily rotation pick + AI rendering,
//                        `{ date, area_id, area_title, text }`

import { getData, setData } from './db.js'

const AREAS_COLLECTION = 'growth_areas'
const TODAY_COLLECTION = 'growth_area_today'
const AI_TIMEOUT_MS = 6000
const VALID_MODES = new Set(['morning', 'persistent', 'both'])
const ENERGY_TYPES = ['desk', 'people', 'errand', 'confrontation', 'creative', 'physical']

function getAnthropicKey() {
  return getData('settings')?.anthropic_api_key || process.env.ANTHROPIC_API_KEY || null
}

function loadAreas() {
  const arr = getData(AREAS_COLLECTION)
  return Array.isArray(arr) ? arr : []
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

function dayOfYear(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  const start = Date.UTC(y, 0, 0)
  const cur = Date.UTC(y, m - 1, d)
  return Math.floor((cur - start) / 86400000)
}

async function callClaude({ system, user, maxTokens }) {
  const key = getAnthropicKey()
  if (!key) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data?.content?.[0]?.text || '').trim()
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

export async function createGrowthArea({ title, mode }) {
  const t = String(title || '').trim()
  if (!t) throw new Error('title is required')
  const m = VALID_MODES.has(mode) ? mode : 'both'
  const energy_affinity = await inferEnergyAffinity(t)
  const area = {
    id: `ga-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: t,
    mode: m,
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
  if (updates.mode !== undefined && VALID_MODES.has(updates.mode)) next.mode = updates.mode
  if (updates.active !== undefined) next.active = !!updates.active
  if (updates.energy_affinity !== undefined) {
    next.energy_affinity = ENERGY_TYPES.includes(updates.energy_affinity) ? updates.energy_affinity : null
  }
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

// --- Morning rotation ---

function rotationPool() {
  return loadAreas().filter(a => a.active && (a.mode === 'morning' || a.mode === 'both'))
}

function pickRotationArea(pool, ymd) {
  if (pool.length === 0) return null
  const idx = dayOfYear(ymd) % pool.length
  return pool[idx]
}

async function rephraseArea(area) {
  const text = await callClaude({
    system: `You write short, warm, concrete morning nudges for an ADHD-friendly personal coaching app. Given a standing "growth area" the user wants to work on about themselves, write ONE fresh, specific, encouraging sentence (under 16 words) that makes today's version of it concrete and actionable — not a generic restatement. Vary the phrasing every time; never just repeat the input. Reply with just the sentence — no quotes, no preamble.`,
    user: area.title,
    maxTokens: 60,
  })
  if (!text) return area.title
  return text.replace(/^["']|["']$/g, '').trim() || area.title
}

// Computes (if not already cached for today) and returns the daily pick.
// Safe to call frequently — no-ops once today's pick is cached.
//
// A cached EMPTY pick (area_id: null — no eligible areas at the time) is
// deliberately NOT sticky: it's the common first-run shape (user adds their
// first morning/both area mid-day, after the background loop's startup tick
// already cached "nothing to show"). Re-checking the pool costs nothing when
// it's still empty, and only ever upgrades null → a real pick, so it can't
// cause the digest/banner disagreement the caching exists to prevent — that
// risk only applies once a REAL pick (with its AI-rephrased text) has been
// made and potentially already delivered.
export async function ensureTodayGrowthArea() {
  const today = todayLocalYMD()
  const cached = getData(TODAY_COLLECTION)
  if (cached?.date === today && cached.area_id) return cached

  const pool = rotationPool()
  const area = pickRotationArea(pool, today)
  if (!area) {
    const empty = { date: today, area_id: null, area_title: null, text: null }
    setData(TODAY_COLLECTION, empty)
    return empty
  }
  const text = await rephraseArea(area)
  const result = { date: today, area_id: area.id, area_title: area.title, text }
  setData(TODAY_COLLECTION, result)
  return result
}

// Sync read-only accessor — returns null if today's pick hasn't been
// computed yet (caller should trigger ensureTodayGrowthArea() separately;
// digestBuilder.js is synchronous and must never block on a live AI call).
export function getTodayGrowthAreaCached() {
  const cached = getData(TODAY_COLLECTION)
  return cached?.date === todayLocalYMD() ? cached : null
}

// Active areas eligible for contextual injection (What Now / Quokka).
export function contextualGrowthAreas() {
  return loadAreas().filter(a => a.active && (a.mode === 'persistent' || a.mode === 'both'))
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
