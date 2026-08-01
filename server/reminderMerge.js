// reminderMerge.js — the 3-way merge between Boomerang tasks and Apple
// Reminders. Deliberately dependency-free: no database, no network, no
// EventKit. Every rule about whose edit survives is exercised by
// scripts/reminderMerge.test.mjs without any of that being present.
//
// WHY THE MERGE LIVES HERE AND NOT ON THE PHONE: EventKit is device-local, so
// the reading and writing has to happen inside the app — but the DECIDING does
// not. The native side is a dumb pipe (list what's there, write back what it's
// told), exactly like the watch. That keeps the rules testable, keeps them the
// same across every device, and means a second device can never merge
// differently from the first.
//
// WHY 3-WAY: both sides are edited independently and neither reports a
// reliable per-field modification time. A two-way diff between "what Boomerang
// has" and "what the phone has" cannot distinguish "I renamed this in
// Boomerang" from "I renamed it in Reminders", so it collapses into
// last-writer-wins and eats one of them every time both are touched between
// syncs. The shadow is what the two sides last AGREED on; comparing each
// against that baseline separately is what makes the difference legible.
//
// DIRECTION OF AUTHORITY: unlike the Trello list sync, both sides here belong
// to the same person, so there is no "this is someone else's data" rule. The
// user's instruction is that Boomerang is the system of record, so a genuine
// two-sided conflict resolves to Boomerang — with one deliberate exception
// below.

// A sync that has lost more than this fraction of previously-linked reminders
// is treated as a bad read rather than a real mass deletion. Reminders can
// vanish from a fetch for reasons that have nothing to do with intent: a
// revoked or downgraded permission, a list the user hid, an iCloud account
// still populating after a restore.
const MAX_MISSING_FRACTION = 0.5
// ...but only once there are enough links for the fraction to mean anything.
// Deleting 2 of 3 reminders is an ordinary afternoon; losing 20 of 30 is not.
const MISSING_FRACTION_FLOOR = 6

const str = (v) => (v == null ? '' : String(v))
const bool = (v) => !!v && v !== '0'

// Two times are the same instant even when the strings differ — the phone
// round-trips through NSDate and hands back a normalized ISO form, so a raw
// string compare reports a change on every single sync and starts a write
// ping-pong between the two sides.
function sameTime(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return str(a) === str(b)
  // Reminders stores to the minute; seconds precision is noise.
  return Math.abs(ta - tb) < 60_000
}

function changedFrom(shadowValue, value, isTime = false) {
  return isTime ? !sameTime(shadowValue, value) : str(shadowValue) !== str(value)
}

/**
 * planReminderSync(localTasks, remoteReminders, shadows, opts)
 *
 * localTasks:      [{ id, title, notes, remind_at, reminders_id, status, completed_at }]
 * remoteReminders: [{ id, title, notes, remindAt, completed }]
 * shadows:         [{ task_id, reminders_id, title, notes, remind_at, completed }]
 *
 * Returns a PLAN — nothing here mutates anything:
 *   {
 *     toRemote:  [{ remindersId?, taskId, title, notes, remindAt, completed }]
 *     toLocal:   [{ taskId, fields: {...} }]
 *     toCreateLocal: [{ remindersId, title, notes, remindAt, completed }]
 *     toUnlink:  [taskId]          // remote is gone AND we can prove it
 *     shadows:   [{ task_id, reminders_id, title, notes, remind_at, completed }]
 *     held:      [{ reason, detail }]   // never silent — see below
 *   }
 *
 * `held` exists because a sync that silently declines to do something is
 * indistinguishable from a broken one. Anything skipped says why.
 */
export function planReminderSync(localTasks = [], remoteReminders = [], shadows = [], opts = {}) {
  const {
    isDoneStatus = (s) => s === 'done' || s === 'completed',
    nowISO = null,
  } = opts

  const plan = {
    toRemote: [], toLocal: [], toCreateLocal: [], toUnlink: [], shadows: [], held: [],
  }

  const remoteById = new Map(remoteReminders.filter(r => r?.id).map(r => [String(r.id), r]))
  const shadowByTask = new Map(shadows.filter(s => s?.task_id).map(s => [String(s.task_id), s]))
  const linked = localTasks.filter(t => t?.reminders_id)

  // --- Mass-disappearance guard -------------------------------------------
  // Applied BEFORE anything is unlinked. A bad read must not be mistaken for
  // the user clearing their list.
  const missing = linked.filter(t => !remoteById.has(String(t.reminders_id)))
  const massDisappearance =
    linked.length >= MISSING_FRACTION_FLOOR &&
    missing.length / linked.length > MAX_MISSING_FRACTION
  if (massDisappearance) {
    plan.held.push({
      reason: 'suspicious_disappearance',
      detail: `${missing.length} of ${linked.length} linked reminders missing from this read — treating as a bad response, not a mass delete. Nothing unlinked.`,
    })
  }

  const claimedRemoteIds = new Set()

  for (const task of localTasks) {
    if (!task?.id) continue
    const rid = task.reminders_id ? String(task.reminders_id) : null
    const localDone = isDoneStatus(task.status)

    // --- Not linked yet ---------------------------------------------------
    if (!rid) {
      // Only a task that actually wants an alarm goes out. Pushing every task
      // in the system into Reminders would turn a focused list into a mirror
      // of the whole backlog, which is not what an alarm surface is for.
      if (task.remind_at && !localDone) {
        plan.toRemote.push({
          remindersId: null,
          taskId: task.id,
          title: str(task.title),
          notes: str(task.notes),
          remindAt: task.remind_at,
          completed: false,
        })
      }
      continue
    }

    claimedRemoteIds.add(rid)
    const remote = remoteById.get(rid)
    const shadow = shadowByTask.get(String(task.id)) || null

    // --- Linked, but the remote is gone ------------------------------------
    if (!remote) {
      if (massDisappearance) continue // held above; leave the link alone
      // A reminder deleted in Apple's app is a real signal, but deleting the
      // Boomerang task in response would let a swipe in Reminders destroy work
      // that lives here. Drop the LINK, keep the task — the task simply stops
      // having an alarm, which is recoverable; the reverse is not.
      plan.toUnlink.push(task.id)
      plan.held.push({
        reason: 'remote_deleted',
        detail: `"${str(task.title)}" was removed from Reminders — its alarm link was dropped, the task was kept.`,
      })
      continue
    }

    // --- Linked and present: the actual 3-way compare ----------------------
    const remoteDone = bool(remote.completed)

    // Completion is the ONE field where Boomerang does not automatically win.
    // Finishing something is deliberate on whichever side it happened, and
    // losing that is the worst outcome this sync can produce — it re-raises an
    // alarm for work already done, which is precisely how a reminder system
    // trains you to ignore it. So a completion propagates from either side.
    // Un-completion is not symmetric: it only travels if the shadow says the
    // side that changed is the one that moved.
    const localCompletionIsNew = localDone && !bool(shadow?.completed)
    const remoteCompletionIsNew = remoteDone && !bool(shadow?.completed)

    const fields = {}
    const remoteWrite = {}

    if (localCompletionIsNew && !remoteDone) {
      remoteWrite.completed = true
    } else if (remoteCompletionIsNew && !localDone) {
      fields.status = 'done'
      if (nowISO) fields.completed_at = nowISO
    }

    // Title / notes / time: shadow decides who moved.
    for (const [localKey, remoteKey, isTime] of [
      ['title', 'title', false],
      ['notes', 'notes', false],
      ['remind_at', 'remindAt', true],
    ]) {
      const localVal = task[localKey]
      const remoteVal = remote[remoteKey]
      if (isTime ? sameTime(localVal, remoteVal) : str(localVal) === str(remoteVal)) continue

      const shadowVal = shadow ? shadow[localKey] : undefined
      const localMoved = shadow ? changedFrom(shadowVal, localVal, isTime) : true
      const remoteMoved = shadow ? changedFrom(shadowVal, remoteVal, isTime) : true

      if (localMoved && !remoteMoved) {
        remoteWrite[remoteKey] = localVal
      } else if (remoteMoved && !localMoved) {
        fields[localKey] = remoteVal
      } else {
        // Both moved, or no shadow to prove otherwise. Boomerang is the system
        // of record, so it wins — and says so, because a discarded edit the
        // user made in Apple's app must not vanish without a trace.
        remoteWrite[remoteKey] = localVal
        plan.held.push({
          reason: 'conflict_local_wins',
          detail: `"${str(task.title)}" — ${localKey} changed on both sides${shadow ? '' : ' (no baseline)'}; Boomerang's value kept.`,
        })
      }
    }

    if (Object.keys(fields).length) plan.toLocal.push({ taskId: task.id, fields })
    if (Object.keys(remoteWrite).length) {
      plan.toRemote.push({
        remindersId: rid,
        taskId: task.id,
        title: 'title' in remoteWrite ? remoteWrite.title : str(task.title),
        notes: 'notes' in remoteWrite ? remoteWrite.notes : str(task.notes),
        remindAt: 'remindAt' in remoteWrite ? remoteWrite.remindAt : task.remind_at,
        completed: 'completed' in remoteWrite ? remoteWrite.completed : remoteDone,
      })
    }

    // The agreed state after this sync resolves.
    plan.shadows.push({
      task_id: task.id,
      reminders_id: rid,
      title: 'title' in fields ? fields.title : ('title' in remoteWrite ? remoteWrite.title : str(task.title)),
      notes: 'notes' in fields ? fields.notes : ('notes' in remoteWrite ? remoteWrite.notes : str(task.notes)),
      remind_at: 'remind_at' in fields ? fields.remind_at : ('remindAt' in remoteWrite ? remoteWrite.remindAt : task.remind_at),
      completed: (fields.status ? true : localDone) || !!remoteWrite.completed || (remoteDone && !localCompletionIsNew),
    })
  }

  // --- Reminders with no Boomerang task: the voice-capture inbox -----------
  // This is the half that makes "Hey Siri, remind me to…" land in Boomerang
  // without any App Intents involvement.
  for (const remote of remoteReminders) {
    if (!remote?.id) continue
    const rid = String(remote.id)
    if (claimedRemoteIds.has(rid)) continue
    if (bool(remote.completed)) {
      // Something completed before Boomerang ever saw it. Importing it would
      // create a task whose only life is being already done.
      plan.held.push({
        reason: 'remote_new_but_done',
        detail: `"${str(remote.title)}" was already completed in Reminders — not imported.`,
      })
      continue
    }
    if (!str(remote.title).trim()) {
      plan.held.push({ reason: 'remote_untitled', detail: 'A reminder with no title was skipped.' })
      continue
    }
    plan.toCreateLocal.push({
      remindersId: rid,
      title: str(remote.title).trim(),
      notes: str(remote.notes),
      remindAt: remote.remindAt || null,
      completed: false,
    })
  }

  return plan
}

export const __testing = { MAX_MISSING_FRACTION, MISSING_FRACTION_FLOOR, sameTime }
