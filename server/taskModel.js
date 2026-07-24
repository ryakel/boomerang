// taskModel.js — the task-model-extensions layer (2026-07-18): derived state,
// pick-three commit ceiling, nightly rollover plan, and field validation.
//
// Pure module by design: no DB, no Node-specific deps, unit-tested in
// scripts/taskmodel.test.mjs. server.js applies the plans this module
// computes. There is deliberately NO `state` column in the schema — state is
// DERIVED here from the existing `status` machinery (the single source of
// truth every surface already keys off) plus the migration-046 fields, so
// the two can never drift.
//
// Language rule (hard, for this layer and everything downstream of it):
// punishment-framing vocabulary — the four words the spec bans — never
// appears in these states, field names, or messages. A committed task the
// day rolled past is "boomeranged" — it comes back around, forward-looking
// framing only.

export const COMMIT_CEILING = 3
export const DONE_ARCHIVE_DAYS = 7
export const FIRST_STEP_MAX = 140
export const DEFAULT_TIMEZONE = 'America/Chicago'

const ACTIVE_STATUSES = ['not_started', 'doing', 'waiting', 'in_progress']

// 'YYYY-MM-DD' for an ISO timestamp (or Date) in a given IANA timezone.
// en-CA locale renders exactly YYYY-MM-DD.
export function ymdInTz(isoOrDate, tz) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return null
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || DEFAULT_TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

export function isActiveStatus(status) {
  return ACTIVE_STATUSES.includes(status)
}

// Shelved = deliberately parked, excluded from the pool/digest/pick-three.
// Maps onto machinery the app already has: the Later space (backlog),
// projects, the "set aside" indefinite snooze, and a still-running snooze
// (the spec's shelve-with-snooze_until IS a snooze — it auto-returns when
// the clock passes, exactly like existing snoozed tasks do).
export function isShelved(task, nowMs = Date.now()) {
  if (task.status === 'backlog' || task.status === 'project') return true
  if (task.snooze_indefinite) return true
  if (task.snoozed_until && new Date(task.snoozed_until).getTime() > nowMs) return true
  return false
}

// The derived state exposed in API responses. Never stored.
//   open        in the pool, eligible for pick-three
//   committed   selected as one of today's three
//   boomeranged was committed, the day rolled over — transient; the rollover
//               returns it to open with boomerang_count incremented
//   shelved     deliberately parked (no timer, no guilt)
//   done        completed within the last DONE_ARCHIVE_DAYS
//   archived    soft-terminal: old done, or released ("let it go")
export function deriveTaskState(task, { todayYMD, nowMs = Date.now() } = {}) {
  if (task.status === 'done' || task.status === 'completed') {
    if (task.completed_at) {
      const age = nowMs - new Date(task.completed_at).getTime()
      if (age > DONE_ARCHIVE_DAYS * 24 * 60 * 60 * 1000) return 'archived'
    }
    return 'done'
  }
  if (task.status === 'cancelled') return 'archived'
  if (isShelved(task, nowMs)) return 'shelved'
  if (task.committed_on && todayYMD) {
    if (task.committed_on === todayYMD) return 'committed'
    if (task.committed_on < todayYMD) return 'boomeranged'
  }
  return 'open'
}

// Nightly rollover — computed as a pure plan of {id, updates} so it can be
// unit-tested (including the run-it-three-times chaos drill) and applied by
// the server through the normal write path. Idempotent by construction:
// every mutation's precondition is cleared by the mutation itself.
//   1. committed tasks the day rolled past → back to open (committed_on
//      cleared), boomerang_count incremented, last_boomeranged_at stamped.
//      They return to the pool immediately; the digest mentions them gently.
//   2. shelve-snoozes past their time already auto-surface via the existing
//      snoozed_until machinery — no mutation needed.
//   3. done → archived is derived (age-based) — no mutation needed.
export function rolloverPlan(tasks, { todayYMD, nowIso }) {
  const plan = []
  for (const t of tasks || []) {
    if (!isActiveStatus(t.status)) continue
    if (t.committed_on && t.committed_on < todayYMD) {
      plan.push({
        id: t.id,
        updates: {
          committed_on: null,
          boomerang_count: (t.boomerang_count || 0) + 1,
          last_boomeranged_at: nowIso,
        },
      })
    }
  }
  return plan
}

// The pick-three payload — shaped for a small screen: minimal, denormalized,
// one pass over the task list (sql.js is in-process, so this is a single
// round trip by construction). `timer` is a forward-shape placeholder for
// the watch client; no timer feature exists yet.
export function todayPayload(tasks, { todayYMD, nowMs = Date.now(), tz } = {}) {
  const committed = []
  let returnedCount = 0
  let openCount = 0
  for (const t of tasks || []) {
    const state = deriveTaskState(t, { todayYMD, nowMs })
    const doneToday = (t.status === 'done' || t.status === 'completed')
      && t.completed_at && ymdInTz(t.completed_at, tz) === todayYMD
    if (t.committed_on === todayYMD && (state === 'committed' || doneToday)) {
      committed.push({
        id: t.id,
        title: t.title,
        state: doneToday ? 'done' : state,
        first_step: t.first_step || null,
        intention_when: t.intention_when || null,
        intention_where: t.intention_where || null,
        due_date: t.due_date || null,
        size: t.size || null,
        energy: t.energy || null,
        energy_level: t.energyLevel ?? t.energy_level ?? null,
        impact: t.impact ?? null,
        boomerang_count: t.boomerang_count || 0,
        done: !!doneToday,
      })
      continue
    }
    if (state === 'open') {
      openCount++
      // Gently returned: came back around today and hasn't been re-committed.
      if (t.last_boomeranged_at && ymdInTz(t.last_boomeranged_at, tz) === todayYMD) {
        returnedCount++
      }
    }
  }
  return {
    date: todayYMD,
    committed,
    committed_count: committed.length,
    returned_count: returnedCount,
    open_count: openCount,
    timer: null,
  }
}

// ---- Field validation (422s at the API layer) ----

// first_step must actually be small.
export function validateFirstStep(value) {
  if (value == null || value === '') return { ok: true, value: null }
  const s = String(value).trim()
  if (s.length > FIRST_STEP_MAX) {
    return { ok: false, error: "that's a task, not a first step — shrink it further" }
  }
  return { ok: true, value: s }
}

// location: {lat, lng, radius_m?, label?, trigger?} — radius 50–1000m
// (default 150), trigger arrive|leave (default arrive).
export function validateLocation(value) {
  if (value == null) return { ok: true, value: null }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'location must be an object {lat, lng, radius_m, label, trigger}' }
  }
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, error: 'location.lat must be between -90 and 90' }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, error: 'location.lng must be between -180 and 180' }
  let radius = value.radius_m == null ? 150 : Number(value.radius_m)
  if (!Number.isFinite(radius)) return { ok: false, error: 'location.radius_m must be a number' }
  if (radius < 50 || radius > 1000) return { ok: false, error: 'location.radius_m must be between 50 and 1000' }
  const trigger = value.trigger == null ? 'arrive' : String(value.trigger)
  if (trigger !== 'arrive' && trigger !== 'leave') return { ok: false, error: 'location.trigger must be "arrive" or "leave"' }
  return {
    ok: true,
    value: {
      lat, lng,
      radius_m: radius,
      label: value.label ? String(value.label).slice(0, 120) : null,
      trigger,
    },
  }
}
