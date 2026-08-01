// remindersSync.js — drives the two-way Apple Reminders sync from the WebView.
// No-op everywhere except the iOS native shell.
//
// The round trip, and why it has three legs rather than two:
//   1. read   — ask EventKit what's in the Boomerang list
//   2. merge  — POST it; the SERVER decides (server/reminderMerge.js, pure and
//               tested) and answers with what to write back
//   3. write  — apply that to EventKit, then report the ids EventKit minted
//               for newly-created reminders so the server can link them
//
// Leg 3's report-back is not optional. A reminder created without its id
// getting home is orphaned, and the next sync sees a task with no link and
// creates a second one — the classic duplicate-every-poll bug.

import { registerPlugin } from '@capacitor/core'
import { isNativeShell, readJson } from './apiConfig'

const Reminders = registerPlugin('BoomerangReminders')

let syncing = false

export async function remindersAvailable() {
  return isNativeShell()
}

export async function requestRemindersAccess() {
  if (!isNativeShell()) {
    return { ok: false, error: 'Reminders sync only works in the iOS app.' }
  }
  try {
    const res = await Reminders.requestAccess()
    if (!res?.granted) {
      return {
        ok: false,
        error: res?.error
          || 'Reminders access denied. Enable it in iOS Settings → Boomerang → Reminders (Full Access).',
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not ask for Reminders access.' }
  }
}

/**
 * One full sync. Safe to call often — overlapping runs are refused rather than
 * queued, because two syncs interleaving their read/merge/write legs is how a
 * merge based on a stale read overwrites a fresh one.
 */
export async function syncReminders({ silent = true } = {}) {
  if (!isNativeShell()) return { ok: false, skipped: 'not-native' }
  if (syncing) return { ok: false, skipped: 'already-running' }
  syncing = true
  try {
    // 1. read — a REJECTION here must abort the whole sync. Treating a failed
    // read as an empty list would tell the server every reminder was deleted.
    const listed = await Reminders.list()
    const items = Array.isArray(listed?.items) ? listed.items : []

    // 2. merge
    const res = await fetch('/api/reminders/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    const plan = await readJson(res, 'The server')

    // 3. write, then report the new ids home
    let linked = 0
    if (plan.toWrite?.length) {
      const written = await Reminders.write({ items: plan.toWrite })
      if (written?.links?.length) {
        const linkRes = await fetch('/api/reminders/link', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ links: written.links }),
        })
        linked = (await readJson(linkRes, 'The server'))?.linked || 0
      }
      if (written?.failures?.length) {
        console.warn('[reminders] some writes failed:', written.failures)
      }
    }

    if (!silent && plan.held?.length) {
      console.log('[reminders] held:', plan.held)
    }
    return {
      ok: true,
      imported: plan.imported || 0,
      applied: plan.applied || 0,
      unlinked: plan.unlinked || 0,
      linked,
      held: plan.held || [],
    }
  } catch (err) {
    // Surfaced, never swallowed: a sync that silently stops is indistinguishable
    // from one that has nothing to do, and this one holds alarms.
    console.warn('[reminders] sync failed:', err?.message || err)
    return { ok: false, error: err?.message || 'Reminders sync failed.' }
  } finally {
    syncing = false
  }
}
