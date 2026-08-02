// localReminders.js — keeps the DEVICE's local notification schedule in step
// with the app's tasks and loops. No-op outside the iOS native shell.
//
// The split, and why: `reminderSchedule.js` decides WHAT should be scheduled
// (pure, tested, 64-slot budget); `BoomerangLocalNotifs` schedules it (dumb
// pipe). This module is the thin thing in between that knows when to re-run.
//
// WHEN IT RE-RUNS: app launch, every resume, and after the task list changes.
// A local notification already handed to iOS keeps working with the app closed
// and the phone offline, so a refresh is only needed to reflect EDITS — the
// alarms themselves never depend on it. That's the property that makes this
// survive a fortnight abroad.

import { registerPlugin } from '@capacitor/core'
import { isNativeShell } from './apiConfig'
import { safeSetItem } from './store'
import { planLocalReminders } from './reminderSchedule'

const Notifs = registerPlugin('BoomerangLocalNotifs')

let refreshing = false
let lastPlanJson = null

export async function requestLocalReminderPermission() {
  if (!isNativeShell()) {
    return { ok: false, error: 'Local reminders only work in the iOS app.' }
  }
  try {
    const res = await Notifs.requestPermission()
    if (!res?.granted) {
      return {
        ok: false,
        error: res?.error
          || 'Notification permission denied. Enable it in iOS Settings → Boomerang → Notifications.',
      }
    }
    // Recorded per-DEVICE: this phone now rings for itself, so the Apple
    // Reminders mirror must stop attaching its own alarm or every reminder
    // fires twice. See localRemindersOwnAlarms().
    safeSetItem('boom_local_notifs_ok', '1')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err?.message || 'Could not ask for notification permission.' }
  }
}

/**
 * Re-plan and re-schedule. Safe to call often.
 *
 * `force` skips the no-change short-circuit — used by the Settings button, so
 * "Refresh" always does something observable rather than appearing broken when
 * the plan happens to be identical.
 */
export async function refreshLocalReminders(tasks = [], routines = [], { force = false } = {}) {
  if (!isNativeShell()) return { ok: false, skipped: 'not-native' }
  // Overlapping runs would both cancel-then-add against the same list; the
  // loser's adds can land after the winner's cancel and vanish.
  if (refreshing) return { ok: false, skipped: 'already-running' }

  const plan = planLocalReminders({ tasks, routines })
  const json = JSON.stringify(plan.schedule)
  if (!force && json === lastPlanJson) {
    return { ok: true, unchanged: true, ...counts(plan) }
  }

  refreshing = true
  try {
    const res = await Notifs.schedule({ items: plan.schedule })
    lastPlanJson = json
    if (res?.failures?.length) {
      console.warn('[localReminders] some alarms were refused:', res.failures)
    }
    return {
      ok: true,
      // `pending` is read back from iOS, not from what we asked for — the only
      // number that matches what will actually ring.
      pending: res?.pending ?? 0,
      failures: res?.failures || [],
      ...counts(plan),
    }
  } catch (err) {
    // Never swallowed: a schedule that silently stopped refreshing is
    // indistinguishable from one with nothing to do, and this one holds alarms.
    console.warn('[localReminders] refresh failed:', err?.message || err)
    lastPlanJson = null
    return { ok: false, error: err?.message || 'Could not schedule reminders.' }
  } finally {
    refreshing = false
  }
}

export async function pendingLocalReminders() {
  if (!isNativeShell()) return { count: 0, ids: [] }
  try { return await Notifs.pending() } catch { return { count: 0, ids: [] } }
}

export async function clearLocalReminders() {
  if (!isNativeShell()) return
  try { await Notifs.cancelAll(); lastPlanJson = null } catch { /* nothing pending */ }
}

function counts(plan) {
  return {
    repeating: plan.repeating,
    once: plan.once,
    // Surfaced so the UI can SAY what didn't fit. Silently dropping an alarm
    // past the 64-slot cap is the failure mode this whole design exists to
    // avoid — a reminder that never rings and never explains itself.
    dropped: plan.dropped.length,
  }
}

// Does THIS DEVICE ring for itself?
//
// When it does, the reminder written into Apple Reminders must carry no alarm,
// or the same moment fires twice — once from iOS's local notification and once
// from the EKAlarm. The mirror stays useful (visible in Apple's app, tickable,
// syncs completion back); it just stops being a second bell.
export function localRemindersOwnAlarms() {
  if (!isNativeShell()) return false
  try { return localStorage.getItem('boom_local_notifs_ok') === '1' } catch { return false }
}
