// creditYesterday.js — "I did this last night, I'm only ticking it now."
//
// A tap stamps the moment you tap. When the work happened yesterday evening
// and the tick lands this morning, three things trust that stamp and all three
// come out wrong:
//   - completed_at lands on today, so yesterday can read as a streak gap;
//   - a loop gets TODAY in completed_history: yesterday's cycle reads missed
//     (the rally breaks) and today's reads caught, so tonight's instance never
//     spawns and the loop slides a day;
//   - a committed (pick-three) task was already rolled over at midnight, its
//     boomerang_count bumped for a day it was actually finished on.
//
// This module is the ONE repair, and it is PURE: no state, no network, clock
// injected. The toast's "Did it yesterday" and the Last night list on Today
// both call it, so the rules live in exactly one place and
// scripts/creditYesterday.test.mjs pins them.
//
// It never decides on its own. The default stays "today"; this only runs when
// the user says so, and only inside the window where the question makes sense.

import { localYMD } from './dates.js'
import { stampLoopDay, unstampLoopDay } from './kept/cycles.js'

// Ticks after this local hour are not offered the question. By lunch, "I did
// it last night" is the rare case and a button for it is noise. It gates when
// the TICK happened, not when the answer comes, so a 9am tick can still be put
// right at 2pm.
export const CREDIT_YESTERDAY_CUTOFF_HOUR = 12

// The local hour a credited completion is placed at. Only the DAY matters to
// every consumer (streak, loop windows, today counts); evening reads true.
const CREDIT_HOUR = 20

function startOfLocalDay(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

function yesterdayStart(now) {
  const d = startOfLocalDay(now)
  d.setDate(d.getDate() - 1)
  return d
}

// May this completed task be offered "Did it yesterday"?
//   - it is done, and was ticked TODAY before the cutoff;
//   - it already existed before today began (a task created this morning
//     cannot have been done last night).
// Idempotent by construction: once credited, completed_at is yesterday, so
// the first rule fails and the offer cannot appear twice.
export function canCreditYesterday(task, now = new Date()) {
  if (!task || task.status !== 'done' || !task.completed_at) return false
  const done = new Date(task.completed_at)
  const created = new Date(task.created_at)
  if (Number.isNaN(done.getTime()) || Number.isNaN(created.getTime())) return false
  const nowD = new Date(now)
  if (localYMD(done) !== localYMD(nowD)) return false
  if (done.getHours() >= CREDIT_YESTERDAY_CUTOFF_HOUR) return false
  return created.getTime() < startOfLocalDay(nowD).getTime()
}

// Yesterday at CREDIT_HOUR local — but never before the task existed. A task
// created at 21:30 last night gets 21:31, not 20:00, so created→completed
// never runs backwards (points read that span).
export function creditedCompletionIso(task, now = new Date()) {
  const y = yesterdayStart(now)
  const target = new Date(y); target.setHours(CREDIT_HOUR, 0, 0, 0)
  const lastMs = new Date(y); lastMs.setHours(23, 59, 59, 999)
  let t = target.getTime()
  const created = new Date(task?.created_at).getTime()
  if (Number.isFinite(created) && created >= t) t = Math.min(created + 60_000, lastMs.getTime())
  return new Date(t).toISOString()
}

// The repair. Returns { taskUpdates, routine }:
//   taskUpdates — the partial to apply to the task, or null when not eligible.
//   routine     — the routine to save; the SAME reference when nothing about
//                 it changes (a fresh reference re-runs the spawn pass).
//
// `siblings` is only read for a stack: the other tasks of this cycle (same
// routine_id + due_date). A stack stamps its history when the LAST member
// clears, so the stamp only moves back once every member is credited to
// yesterday or earlier — until then the cycle really did finish today.
export function creditYesterday({ task, routine = null, siblings = [], now = new Date() } = {}) {
  if (!canCreditYesterday(task, now)) return { taskUpdates: null, routine }

  const todayKey = localYMD(new Date(now))
  const yesterdayKey = localYMD(yesterdayStart(now))
  const completedAt = creditedCompletionIso(task, now)
  const taskUpdates = { completed_at: completedAt }

  Object.assign(taskUpdates, rolloverReversal(task, todayKey, yesterdayKey))

  return { taskUpdates, routine: moveLoopStamp({ task, routine, siblings, todayKey, yesterdayKey, completedAt }) }
}

// Undo last night's rollover. It ran because the task was still open at
// midnight; it wasn't really. A rollover that ran this morning means the task
// was committed for a day before today, and the rollover runs every night, so
// that day was yesterday.
function rolloverReversal(task, todayKey, yesterdayKey) {
  if (!task.last_boomeranged_at || localYMD(new Date(task.last_boomeranged_at)) !== todayKey) return {}
  const out = {
    boomerang_count: Math.max(0, (task.boomerang_count || 0) - 1),
    last_boomeranged_at: null,
  }
  if (!task.committed_on) out.committed_on = yesterdayKey
  return out
}

// A stack's history is stamped when the LAST member of a cycle clears, so the
// cycle counts for yesterday only when every OTHER member was done by then.
function stackClearedBy(task, siblings, yesterdayKey) {
  return (siblings || []).filter(s => s && s.id !== task.id
    && s.routine_id === task.routine_id && s.due_date === task.due_date)
    .every(s => s.status === 'done' && s.completed_at
      && localYMD(new Date(s.completed_at)) <= yesterdayKey)
}

function isStackRoutine(routine) {
  return Array.isArray(routine?.members) && routine.members.length > 0
}

function moveLoopStamp({ task, routine, siblings, todayKey, yesterdayKey, completedAt }) {
  if (!routine || !task.routine_id || routine.id !== task.routine_id) return routine
  if (isStackRoutine(routine) && !stackClearedBy(task, siblings, yesterdayKey)) return routine
  // The task is done and the user says it was last night, so yesterday gets
  // the stamp. Today's comes off only if there is one to take: a tick in the
  // app writes it, but a tick from the WATCH (or any server-side complete)
  // writes none, and that loop would otherwise stay unrecorded entirely.
  const hist = Array.isArray(routine.completed_history) ? routine.completed_history : []
  const hadToday = hist.some(ts => localYMD(new Date(ts)) === todayKey)
  return stampLoopDay(hadToday ? unstampLoopDay(routine, todayKey) : routine, yesterdayKey, completedAt)
}

// ---------------------------------------------------------------------------
// The Last night list (Today, top). Two kinds of row, one question each:
//   ticked — done this morning; was it really last night?  (creditYesterday)
//   open   — still open; did you do it last night and never tick it?
//            (completeAsYesterday)
// "Keep today" / "Still open" stamps `reconciled_on` with today's date, a
// per-task column so the answer holds on every device and the list never asks
// the same thing twice. Crediting needs no marker: completed_at moves to
// yesterday and the task stops qualifying on its own.

const OPEN_STATUSES = new Set(['not_started', 'doing', 'waiting', 'in_progress'])

// Was this task on yesterday's plate? Narrow on purpose — the list asks about
// last night, not about everything overdue, and a row that appears every day
// for a week-old task is noise.
//   - it existed before today began, and
//   - a loop instance due yesterday, or rolled forward to today (auto-roll
//     moves an unticked instance's due date each morning);
//   - otherwise: due yesterday, committed for yesterday, or rolled over by
//     last night's rollover.
export function wasOnYesterdaysPlate(task, now = new Date()) {
  if (!task) return false
  const nowD = new Date(now)
  const created = new Date(task.created_at).getTime()
  if (!Number.isFinite(created) || created >= startOfLocalDay(nowD).getTime()) return false
  const todayKey = localYMD(nowD)
  const yesterdayKey = localYMD(yesterdayStart(nowD))
  const due = task.due_date ? String(task.due_date).slice(0, 10) : null
  if (task.routine_id) return due === yesterdayKey || due === todayKey
  if (due === yesterdayKey) return true
  if (task.committed_on === yesterdayKey) return true
  return !!task.last_boomeranged_at && localYMD(new Date(task.last_boomeranged_at)) === todayKey
}

// May this still-open task be completed as of last night?
export function canCompleteAsYesterday(task, now = new Date()) {
  if (!task || !OPEN_STATUSES.has(task.status)) return false
  const created = new Date(task.created_at).getTime()
  return Number.isFinite(created) && created < startOfLocalDay(new Date(now)).getTime()
}

// The rows for the Last night list: ticked ones first (they are the ones whose
// numbers are wrong right now), then open ones.
export function reconcileCandidates(tasks, now = new Date()) {
  const todayKey = localYMD(new Date(now))
  const nowMs = new Date(now).getTime()
  const ticked = []
  const open = []
  for (const t of tasks || []) {
    if (!t || t.reconciled_on === todayKey || t.gmail_pending) continue
    if (!wasOnYesterdaysPlate(t, now)) continue
    if (t.status === 'done') {
      if (canCreditYesterday(t, now)) ticked.push({ task: t, kind: 'ticked' })
    } else if (canCompleteAsYesterday(t, now)) {
      if (t.snooze_indefinite) continue
      // A deliberate snooze is a decision, not a forgotten tick. A loop's
      // snooze is the app parking it until tonight's trigger, so it stays.
      if (!t.routine_id && t.snoozed_until && new Date(t.snoozed_until).getTime() > nowMs) continue
      open.push({ task: t, kind: 'open' })
    }
  }
  return [...ticked, ...open]
}

// Complete a still-open task as if it had been ticked last night. Same shape
// as creditYesterday: { taskUpdates, routine } with the routine's reference
// unchanged when nothing about it moves.
export function completeAsYesterday({ task, routine = null, siblings = [], now = new Date() } = {}) {
  if (!canCompleteAsYesterday(task, now)) return { taskUpdates: null, routine }
  const todayKey = localYMD(new Date(now))
  const yesterdayKey = localYMD(yesterdayStart(now))
  const completedAt = creditedCompletionIso(task, now)
  const taskUpdates = {
    status: 'done',
    completed_at: completedAt,
    ...rolloverReversal(task, todayKey, yesterdayKey),
  }
  let nextRoutine = routine
  if (routine && task.routine_id && routine.id === task.routine_id
      && (!isStackRoutine(routine) || stackClearedBy(task, siblings, yesterdayKey))) {
    nextRoutine = stampLoopDay(routine, yesterdayKey, completedAt)
    // Doing the thing retires a push-it-out floor, as completing always does.
    if (nextRoutine.resume_at) nextRoutine = { ...nextRoutine, resume_at: null }
  }
  return { taskUpdates, routine: nextRoutine }
}
