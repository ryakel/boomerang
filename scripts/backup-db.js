#!/usr/bin/env node
// Daily DB snapshot. Copies $DB_PATH to ${DB_PATH}.YYYY-MM-DD.bak and prunes
// snapshots older than $BACKUP_RETENTION_DAYS (default 7).
//
// Importable: `await runBackup()` from server.js for the in-process daily loop.
// Runnable: `node scripts/backup-db.js` for ad-hoc / cron use.

import { copyFileSync, existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import path from 'path'

const DEFAULT_RETENTION_DAYS = 7

export async function runBackup() {
  const dbPath = process.env.DB_PATH || '/data/boomerang.db'
  const retentionDays = parseInt(process.env.BACKUP_RETENTION_DAYS || DEFAULT_RETENTION_DAYS, 10)

  if (!existsSync(dbPath)) {
    console.warn(`[Backup] DB not found at ${dbPath}, skipping`)
    return { skipped: true }
  }

  const stamp = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const dest = `${dbPath}.${stamp}.bak`

  if (existsSync(dest)) {
    // Already backed up today.
    pruneOldBackups(dbPath, retentionDays)
    return { alreadyExists: dest }
  }

  copyFileSync(dbPath, dest)
  console.log(`[Backup] Snapshotted ${dbPath} → ${dest}`)

  pruneOldBackups(dbPath, retentionDays)
  return { created: dest }
}

function pruneOldBackups(dbPath, retentionDays) {
  const dir = path.dirname(dbPath)
  const base = path.basename(dbPath)
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  let pruned = 0
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(base + '.') || !name.endsWith('.bak')) continue
    const full = path.join(dir, name)
    try {
      if (statSync(full).mtimeMs < cutoff) {
        unlinkSync(full)
        pruned++
      }
    } catch { /* ignore */ }
  }
  if (pruned > 0) console.log(`[Backup] Pruned ${pruned} backup(s) older than ${retentionDays}d`)
}

// Allow direct CLI execution.
if (import.meta.url === `file://${process.argv[1]}`) {
  await runBackup()
}
