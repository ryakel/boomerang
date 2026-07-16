/**
 * Dev seed system — populates the DB with realistic ADHD-messy test data.
 *
 * Startup (SEED_DB=1): loads static scripts/seed-data.json for instant boot.
 * On demand: POST /api/dev/seed to re-seed without restarting.
 */

import { readFileSync, existsSync } from 'fs'
import { clearAllData, setData, upsertTask, upsertRoutine, bumpVersion, flushNow } from './db.js'

function loadSeedData() {
  const p = new URL('../scripts/seed-data.json', import.meta.url).pathname
  if (!existsSync(p)) {
    throw new Error(`[Seed] Static seed data not found at ${p}`)
  }
  return JSON.parse(readFileSync(p, 'utf-8'))
}

const ONE_DAY = 86400000
const isDateOnly = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v))
const shiftIso = (v, ms) => {
  if (!v) return v
  const t = new Date(v).getTime()
  if (Number.isNaN(t)) return v
  const d = new Date(t + ms)
  return isDateOnly(v) ? d.toISOString().slice(0, 10) : d.toISOString()
}

// The static seed is frozen at whatever date it was generated. To keep dev data
// always current ("cover all timelines"), at seed time we:
//   1. Rebase every TASK date so the most-recent completion lands today (so
//      overdue stays overdue, upcoming stays upcoming, done is recent).
//   2. Synthesize a rich, cadence-based completion history for each active
//      routine spanning ~250 days up to today — so habit heatmaps, the Home
//      "Today's Pulse", and Analytics (7d/30d/90d/year) all have real data.
function makeSeedCurrent(data) {
  const now = Date.now()

  // ── 1. Rebase task dates on the latest task completion ──────────────────
  let maxCompleted = 0
  for (const t of data.tasks || []) {
    const c = t.completed_at ? new Date(t.completed_at).getTime() : 0
    if (c > maxCompleted) maxCompleted = c
    for (const h of t.completed_history || []) {
      const hh = new Date(h).getTime(); if (hh > maxCompleted) maxCompleted = hh
    }
  }
  if (maxCompleted) {
    const shift = now - maxCompleted
    const taskDateFields = ['completed_at', 'created_at', 'last_touched', 'snoozed_until', 'waiting_at', 'last_session_at', 'due_date']
    for (const t of data.tasks || []) {
      for (const f of taskDateFields) if (t[f]) t[f] = shiftIso(t[f], shift)
      if (Array.isArray(t.completed_history)) t.completed_history = t.completed_history.map(h => shiftIso(h, shift))
      if (Array.isArray(t.comments)) t.comments = t.comments.map(c => ({ ...c, timestamp: shiftIso(c.timestamp, shift) }))
    }
  }

  // ── 2. Synthesize rich routine history up to today ──────────────────────
  const STEP = { daily: 1, weekly: 7, monthly: 30, quarterly: 91, annually: 365 }
  for (const r of data.routines || []) {
    const step = STEP[r.cadence] || 1
    if (r.paused) {
      // Keep paused routines light but recent: a handful in the last ~60 days.
      const hist = []
      for (let n = 0; n < 3; n++) {
        const d = new Date(now - (10 + n * 18) * ONE_DAY); d.setHours(9, 0, 0, 0)
        hist.push(d.toISOString())
      }
      r.completed_history = hist
      r.created_at = shiftIso(r.created_at, now - new Date(r.created_at || now).getTime())
      continue
    }
    const days = step === 1 ? 250 : step * 30   // ~250d daily, ~30 cycles otherwise
    const adherence = 0.8
    const hist = []
    for (let d = days; d >= 0; d -= step) {
      // Always log the last couple of cadence slots for a live streak.
      if (d <= step || Math.random() < adherence) {
        const ts = new Date(now - d * ONE_DAY); ts.setHours(8 + Math.floor(Math.random() * 10), 0, 0, 0)
        hist.push(ts.toISOString())
      }
    }
    r.completed_history = hist
    r.created_at = new Date(now - (days + step) * ONE_DAY).toISOString()
  }

  return data
}

/**
 * Seed the database from static JSON.
 * Called from server.js after initDb() when SEED_DB=1,
 * or via POST /api/dev/seed.
 *
 * Writes tasks and routines via per-record upsert (not bulk PUT) — the bulk
 * setAllData(tasks/routines) path was retired after the 2026-05-07 wipe.
 */
export async function seedDatabase() {
  console.log('[Seed] Seeding database...')

  const data = loadSeedData()

  if (!data.tasks || !data.routines || !data.labels || !data.settings) {
    throw new Error('[Seed] Invalid seed data — missing tasks, routines, labels, or settings')
  }

  makeSeedCurrent(data)

  clearAllData()
  for (const task of data.tasks) upsertTask(task)
  for (const routine of data.routines) upsertRoutine(routine)
  setData('settings', data.settings)
  setData('labels', data.labels)
  bumpVersion()
  flushNow()

  const statusCounts = {}
  for (const t of data.tasks) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1

  console.log(`[Seed] Done! ${data.tasks.length} tasks, ${data.routines.length} routines, ${data.labels.length} labels`)
  console.log(`[Seed] Status distribution:`, statusCounts)
}
