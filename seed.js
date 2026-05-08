/**
 * Dev seed system — populates the DB with realistic ADHD-messy test data.
 *
 * Startup (SEED_DB=1): loads static scripts/seed-data.json for instant boot.
 * On demand: POST /api/dev/seed to re-seed without restarting.
 */

import { readFileSync, existsSync } from 'fs'
import { clearAllData, setData, upsertTask, upsertRoutine, bumpVersion, flushNow } from './db.js'

function loadSeedData() {
  const p = new URL('./scripts/seed-data.json', import.meta.url).pathname
  if (!existsSync(p)) {
    throw new Error(`[Seed] Static seed data not found at ${p}`)
  }
  return JSON.parse(readFileSync(p, 'utf-8'))
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
