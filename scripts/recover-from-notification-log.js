#!/usr/bin/env node
// Recover task titles + IDs from notification_log after a data-loss event.
// Read-only — never mutates the DB. Run on prod against /data/boomerang.db.
//
// Usage:
//   node scripts/recover-from-notification-log.js                  # human-readable
//   node scripts/recover-from-notification-log.js --json > out.json # machine-readable
//
// Output: each unique task_id observed in notification_log, with its most-recent
// title, channels seen, notification count, and whether it currently exists in
// the tasks table. Tasks missing from the live table are recovery candidates.

import initSqlJs from 'sql.js'
import { readFileSync, existsSync } from 'fs'

const dbPath = process.env.DB_PATH || '/data/boomerang.db'
const asJson = process.argv.includes('--json')

if (!existsSync(dbPath)) {
  console.error(`DB not found at ${dbPath}. Set DB_PATH if it lives elsewhere.`)
  process.exit(1)
}

const SQL = await initSqlJs()
const buf = readFileSync(dbPath)
const db = new SQL.Database(buf)

const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='notification_log'")
if (!tables.length) {
  console.error('notification_log table does not exist in this DB.')
  process.exit(2)
}

// Most-recent (title, sent_at) per task_id, plus aggregate counts and channels.
const result = db.exec(`
  SELECT
    n.task_id,
    n.title,
    n.sent_at,
    (SELECT COUNT(*) FROM notification_log WHERE task_id = n.task_id) AS notif_count,
    (SELECT GROUP_CONCAT(DISTINCT channel) FROM notification_log WHERE task_id = n.task_id) AS channels
  FROM notification_log n
  WHERE n.task_id IS NOT NULL
    AND n.sent_at = (SELECT MAX(sent_at) FROM notification_log WHERE task_id = n.task_id)
  GROUP BY n.task_id
  ORDER BY n.sent_at DESC
`)

const rows = result[0]?.values || []
const cols = result[0]?.columns || []

// Cross-check against live tasks table so the user can focus on missing entries.
const liveIds = new Set()
const liveTables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
if (liveTables.length) {
  const live = db.exec('SELECT id FROM tasks')
  for (const v of live[0]?.values || []) liveIds.add(v[0])
}

const records = rows.map(r => {
  const o = {}
  cols.forEach((c, i) => { o[c] = r[i] })
  o.in_live_db = liveIds.has(o.task_id)
  return o
})

const missing = records.filter(r => !r.in_live_db)
const present = records.filter(r => r.in_live_db)

if (asJson) {
  process.stdout.write(JSON.stringify({
    db_path: dbPath,
    total_unique_task_ids: records.length,
    missing_from_live: missing.length,
    present_in_live: present.length,
    missing,
    present,
  }, null, 2))
  process.exit(0)
}

console.log(`DB: ${dbPath}`)
console.log(`Unique task IDs in notification_log: ${records.length}`)
console.log(`  Still present in tasks table:      ${present.length}`)
console.log(`  Missing from tasks table:          ${missing.length}  ← recovery candidates`)
console.log()
if (missing.length === 0) {
  console.log('Nothing to recover from notification_log.')
} else {
  console.log('--- MISSING TASKS (recovery candidates) ---')
  console.log(`${'last_seen'.padEnd(20)}  ${'task_id'.padEnd(10)}  count  channels                  title`)
  for (const r of missing) {
    const ts = (r.sent_at || '').slice(0, 19)
    const id = String(r.task_id).slice(0, 10).padEnd(10)
    const cnt = String(r.notif_count).padStart(5)
    const ch = String(r.channels || '').padEnd(24).slice(0, 24)
    console.log(`${ts}  ${id}  ${cnt}  ${ch}  ${r.title}`)
  }
}
