#!/usr/bin/env node
/**
 * One-time cleanup script: remove duplicate web push subscriptions.
 *
 * Run with the same DB_PATH the server uses. Prints how many duplicate
 * groups it found and how many rows were removed. Safe to run multiple
 * times — second run reports zero.
 *
 * Usage:
 *   DB_PATH=/data/boomerang.db node scripts/dedupe-push-subscriptions.js
 *
 * Or inside the running container:
 *   docker exec boomerang node scripts/dedupe-push-subscriptions.js
 */

import { initDb, dedupePushSubscriptions, flushNow } from '../db.js'

const dbPath = process.env.DB_PATH || './boomerang.db'

async function main() {
  console.log(`[Dedup] Opening ${dbPath}...`)
  await initDb(dbPath)
  const { duplicateGroups, removed } = dedupePushSubscriptions()
  console.log(`[Dedup] Found ${duplicateGroups} duplicate keypair group(s); removed ${removed} stale row(s).`)
  flushNow()
  process.exit(0)
}

main().catch(err => {
  console.error('[Dedup] Failed:', err)
  process.exit(1)
})
