import { useState, useCallback, useEffect } from 'react'
import { loadRoutines, saveRoutines, createRoutine, isRoutineDue, getNextDueDate, pushOutOneCycle, deferOneCycle, createTask, localYMD } from '../store'
import { suggestRoutineDueDate } from '../api'
import { stampLoopDay, unstampLoopDay } from '../kept/cycles'
import { sameJson } from '../utils/sameJson'
import { TERMINAL_STATUSES, acceptsDeferral } from '../loopSpawnStatus'

// Compute an ISO snooze instant for a due-day ('YYYY-MM-DD') + trigger time
// ('HH:MM', browser-local). Returns null when no trigger time is set or the
// time is already past — so "don't show before 8pm" surfaces immediately once
// 8pm has passed. Because every notification engine + the task-list filter
// honor snoozed_until, this also suppresses nagging before the trigger time.
function triggerSnooze(dueDateYMD, triggerTime) {
  if (!triggerTime) return null
  const [hh, mm] = String(triggerTime).split(':').map(Number)
  const dt = new Date(`${dueDateYMD}T00:00:00`)
  dt.setHours(hh || 0, mm || 0, 0, 0)
  return dt.getTime() > Date.now() ? dt.toISOString() : null
}

// The alarm a spawned task inherits from its loop. Same clock time as the
// snooze, different job: the snooze decides when it SURFACES in the app, this
// decides when the phone makes a noise. Opt-in per routine (`remind`), because
// trigger_time predates this and silently converting every existing one into
// an alarm is the ambient flood the 2026-07-24 reshape deleted.
//
// Unlike triggerSnooze this does NOT drop a past time: a 7:30pm reminder
// spawned at 7:45pm should still be pushed to Apple, where a past-dated alarm
// simply shows as overdue rather than vanishing.
function triggerRemindAt(dueDateYMD, triggerTime, remind) {
  if (!remind || !triggerTime) return null
  const [hh, mm] = String(triggerTime).split(':').map(Number)
  const dt = new Date(`${dueDateYMD}T00:00:00`)
  if (Number.isNaN(dt.getTime())) return null
  dt.setHours(hh || 0, mm || 0, 0, 0)
  return dt.toISOString()
}

// Spawn one independent task per stack member for a single cycle (due day).
// All members of a cycle share its due_date — that (routine_id, due_date) pair
// IS the cycle key used for grouped display, the same-day re-spawn guard, and
// bonus scoping on completion. Energy / notes / tags fall back to the routine's
// when a member leaves them unset. size_inferred stays false so the background
// auto-sizer points each card; clearing every member of the cycle pays a 20%
// bonus (awarded in AppV2.handleComplete). Distinct from follow_ups (a
// dependent chain) — members are independent and spawn together.
function spawnStackMembers(routine, dueYMD) {
  const snooze = triggerSnooze(dueYMD, routine.trigger_time)
  return routine.members.map(m => {
    const tags = Array.isArray(m.tags) && m.tags.length ? m.tags : routine.tags
    const task = createTask(m.title || routine.title, tags, dueYMD, m.notes || routine.notes)
    task.routine_id = routine.id
    task.notion_page_id = routine.notion_page_id
    task.notion_url = routine.notion_url
    if (routine.high_priority) task.high_priority = true
    const energy = m.energy_type || routine.energy
    const energyLevel = m.energy_level ?? routine.energyLevel
    if (energy) task.energy = energy
    if (energyLevel) task.energyLevel = energyLevel
    if (routine.assignee) task.assignee = routine.assignee
    if (routine.impact) task.impact = routine.impact
    task.snoozed_until = snooze
    return task
  })
}

export function useRoutines() {
  const [routines, setRoutines] = useState(loadRoutines)

  useEffect(() => {
    saveRoutines(routines)
  }, [routines])

  const addRoutine = useCallback((title, cadence, customDays, tags, notes, highPriority = false, endDate = null, scheduleDayOfWeek = null, followUps = [], autoRoll = false, spawnMode = 'auto', targetCount = null, targetPeriod = null, customUnit = 'days', triggerTime = null, scheduleDayOfMonth = null, scheduleWeekOfMonth = null, members = [], assignee = null, remind = false) => {
    const routine = createRoutine(title, cadence, customDays, tags, notes, customUnit)
    if (highPriority) routine.high_priority = true
    if (remind) routine.remind = true
    if (endDate) routine.end_date = endDate
    if (scheduleDayOfWeek != null) routine.schedule_day_of_week = scheduleDayOfWeek
    if (scheduleDayOfMonth != null) routine.schedule_day_of_month = scheduleDayOfMonth
    if (scheduleWeekOfMonth != null) routine.schedule_week_of_month = scheduleWeekOfMonth
    if (triggerTime) routine.trigger_time = triggerTime
    if (Array.isArray(followUps) && followUps.length > 0) routine.follow_ups = followUps
    if (Array.isArray(members) && members.length > 0) routine.members = members
    if (autoRoll) routine.auto_roll = true
    if (assignee) routine.assignee = assignee
    if (spawnMode === 'habit') {
      routine.spawn_mode = 'habit'
      routine.target_count = targetCount
      routine.target_period = targetPeriod
    }
    setRoutines(prev => [routine, ...prev])
    return routine
  }, [])

  const deleteRoutine = useCallback((id) => {
    setRoutines(prev => prev.filter(r => r.id !== id))
  }, [])

  const togglePause = useCallback((id) => {
    setRoutines(prev => prev.map(r =>
      r.id === id ? { ...r, paused: !r.paused } : r
    ))
  }, [])

  const completeRoutine = useCallback((id) => {
    setRoutines(prev => prev.map(r =>
      r.id === id ? {
        ...r,
        completed_history: [...r.completed_history, new Date().toISOString()],
        // Doing the thing retires any "push it out" floor. Leaving it would
        // hold the loop back long after the reason for pushing it had passed.
        resume_at: null,
      } : r
    ))
  }, [])

  // Backdate-completion follow-through. When the user edits a routine-spawned
  // task's `completed_at` (e.g. "I actually did this yesterday"), the matching
  // entry in the routine's completed_history needs to move too so cadence
  // calculations stay aligned. Replaces the entry at exact-ISO match; falls
  // back to the most recent entry as a heuristic when the timestamps don't
  // match exactly (covers the small drift between completeRoutine's stamp
  // and the task's completed_at). Sorts the history after the swap so
  // getNextDueDate's "last entry = newest" assumption holds.
  const adjustRoutineHistory = useCallback((id, fromIso, toIso) => {
    if (!toIso) return
    setRoutines(prev => prev.map(r => {
      if (r.id !== id) return r
      const history = Array.isArray(r.completed_history) ? r.completed_history : []
      if (history.length === 0) return r
      let idx = fromIso ? history.indexOf(fromIso) : -1
      if (idx === -1) idx = history.length - 1
      const next = [...history]
      next[idx] = toIso
      next.sort()
      return { ...r, completed_history: next }
    }))
  }, [])

  const updateRoutine = useCallback((id, updates) => {
    setRoutines(prev => prev.map(r =>
      r.id === id ? { ...r, ...updates } : r
    ))
  }, [])

  const updateRoutineNotion = useCallback((id, notionPageId, notionUrl) => {
    setRoutines(prev => prev.map(r =>
      r.id === id ? { ...r, notion_page_id: notionPageId, notion_url: notionUrl } : r
    ))
  }, [])

  // Advance a routine past its current cycle without spawning a task.
  //
  // This used to append `new Date()` to completed_history. That DID roll the
  // schedule forward — getNextDueDate reads the last stamp — but a completion
  // stamp is evidence of work: it credited the cycle, extended the rally, added
  // to the "Nx completed" total and filled in the trail. Every "not this time"
  // quietly became "I did it", and the button's own label said "advance the
  // schedule WITHOUT spawning a task". Nothing expressed a moved schedule until
  // `resume_at` (migration 054), so this faked one.
  //
  // Now it sets the floor and touches no history. Repeated skips compound.
  const skipCycle = useCallback((routineId) => {
    setRoutines(prev => prev.map(r =>
      r.id === routineId ? { ...r, resume_at: pushOutOneCycle(r) } : r
    ))
  }, [])

  // The same floor, moved by a TASK-side deferral: the user sent this cycle's
  // spawned task to backlog/cancelled/project. That is "not this time", which
  // is exactly what `resume_at` exists to say — never a completed_history
  // stamp, which would credit the cycle, extend the rally and fill in the
  // trail for work that wasn't done.
  //
  // Without this, releasing the spawn guard for those statuses (see
  // TERMINAL_STATUSES) would respawn the same cycle on the next pass, because
  // the cadence grid only advances past a slot a COMPLETION satisfied. With
  // it, the loop comes back next cycle instead of immediately.
  //
  // Deliberately NOT stamping `skipped_days`: the cycle stays honestly
  // uncaught, so the loop's gap list can still offer Mark done / Skip for it.
  const deferLoopCycle = useCallback((routineId) => {
    if (!routineId) return
    setRoutines(prev => prev.map(r => {
      if (r.id !== routineId) return r
      if (!acceptsDeferral(r)) return r
      const floor = deferOneCycle(r)
      // Same reference when nothing moved — a fresh one re-runs the spawn pass.
      return floor && floor !== r.resume_at ? { ...r, resume_at: floor } : r
    }))
  }, [])

  // Habit-mode "+ Log it": spawn a task and immediately mark it done. The
  // returned task lands on the list with status='done' and counts toward the
  // current period total. Use case: "I just did a workout, log it." The
  // routine itself has no cadence so there's no schedule to update.
  //
  // It ALSO stamps completed_history once per log — that array is the single
  // source the Wallaby habit grids/streaks read, so a habit-mode log that
  // skipped it left the grids empty (the only thing populating them was the
  // Home checkbox's raw write — see onToggleHabit). Born-done tasks never route
  // through handleComplete, so this stamp here is the lone writer for this path
  // (no double).
  const logHabit = useCallback((routineId) => {
    const routine = routines.find(r => r.id === routineId)
    if (!routine || routine.spawn_mode !== 'habit') return null
    const today = localYMD()
    const now = new Date().toISOString()
    const task = createTask(routine.title, routine.tags, today, routine.notes)
    task.routine_id = routine.id
    task.notion_page_id = routine.notion_page_id
    task.notion_url = routine.notion_url
    task.status = 'done'
    task.completed_at = now
    task.last_touched = now
    if (routine.energy) task.energy = routine.energy
    if (routine.energyLevel) task.energyLevel = routine.energyLevel
    if (routine.assignee) task.assignee = routine.assignee
    if (routine.impact) task.impact = routine.impact
    setRoutines(prev => prev.map(r => r.id === routineId
      ? { ...r, completed_history: [...(r.completed_history || []), now] }
      : r))
    return task
  }, [routines])

  // Remove a single completed_history entry that buckets to a given local day.
  // The reopen counterpart to completeRoutine/logHabit: when a routine-spawned
  // task is un-completed, its history stamp has to come back off or the Wallaby
  // grids keep showing the day as done (phantom). Removes the most-recent match
  // only, so multiple same-day completions (habit-mode "2 workouts today") drop
  // one at a time.
  const uncompleteRoutine = useCallback((id, ymd) => {
    if (!ymd) return
    setRoutines(prev => prev.map(r => (r.id === id ? unstampLoopDay(r, ymd) : r)))
  }, [])

  // Spawn a one-off task from a routine right now, bypassing the schedule.
  // Useful when the user wants to do the routine ad-hoc outside of its
  // scheduled cadence. Due date is today. Does NOT update completed_history
  // until the task is completed (same as normal scheduled spawn), so the
  // routine's cadence clock is unaffected unless the spawned task is done.
  // Returns an array of spawned tasks (one element for an ordinary routine, one
  // per member for a stack). Callers pass the result straight to addSpawnedTasks.
  const spawnNow = useCallback((routineId) => {
    const routine = routines.find(r => r.id === routineId)
    if (!routine) return []
    const today = localYMD()
    if (Array.isArray(routine.members) && routine.members.length > 0) {
      return spawnStackMembers(routine, today)
    }
    const task = createTask(routine.title, routine.tags, today, routine.notes)
    task.routine_id = routine.id
    task.notion_page_id = routine.notion_page_id
    task.notion_url = routine.notion_url
    if (routine.high_priority) task.high_priority = true
    if (routine.energy) task.energy = routine.energy
    if (routine.energyLevel) task.energyLevel = routine.energyLevel
    if (routine.assignee) task.assignee = routine.assignee
    if (routine.impact) task.impact = routine.impact
    if (Array.isArray(routine.follow_ups) && routine.follow_ups.length > 0) {
      task.follow_ups = routine.follow_ups
    }
    task.snoozed_until = triggerSnooze(today, routine.trigger_time)
    return [task]
  }, [routines])

  // Spawn tasks for due routines. Returns { spawned, rolled }:
  //  - spawned: newly-created task objects (caller writes them via addSpawnedTasks)
  //  - rolled:  [{ taskId, updates }] — for auto_roll routines that already have
  //             an active instance, the existing task's due_date is bumped to
  //             today (and any past snoozed_until is cleared) instead of
  //             spawning a duplicate. Caller applies via updateTask.
  // Use case for rolled: medication. You can't double up, so yesterday's stale
  // pill task should roll forward, not coexist with today's. Full spec in
  // wiki/Activity-Prompts.md.
  const spawnDueTasks = useCallback((existingTasks) => {
    const spawned = []
    const rolled = []
    const today = localYMD()

    routines.forEach(routine => {
      if (!isRoutineDue(routine)) return

      const isStack = Array.isArray(routine.members) && routine.members.length > 0

      if (routine.auto_roll && !isStack) {
        // Auto-roll path: find a truly-active instance and bump it forward.
        // If none, fall through to a normal spawn. (Stacks don't auto-roll —
        // they spawn a fresh set each cycle, see the stack guard below.)
        const activeInstance = existingTasks.find(
          t => t.routine_id === routine.id && !TERMINAL_STATUSES.has(t.status),
        )
        if (activeInstance) {
          // Re-anchor the snooze to TODAY's trigger time: today@trigger if it's
          // still in the future, else null (triggerSnooze handles the no-trigger
          // and already-past cases). The roll path previously only *cleared* a
          // stale snooze and never re-applied the trigger, so a trigger-time
          // routine rolled forward surfaced immediately instead of waiting for
          // its clock time — e.g. a 13:00 "IFR Studying – PM" showing at 07:40.
          const desiredSnooze = triggerSnooze(today, routine.trigger_time)
          const needsDateBump = activeInstance.due_date !== today
          const hasStaleSnooze = activeInstance.snoozed_until &&
            new Date(activeInstance.snoozed_until) <= new Date()
          // Instance should be parked at today's trigger but isn't (rolled with
          // a cleared snooze, or never snoozed). null !== a future ISO → fixes
          // the already-surfaced task on the next spawn pass, idempotently.
          const needsSnoozeFix = !!desiredSnooze && activeInstance.snoozed_until !== desiredSnooze
          if (!needsDateBump && !hasStaleSnooze && !needsSnoozeFix) return

          rolled.push({
            taskId: activeInstance.id,
            updates: {
              due_date: today,
              last_touched: new Date().toISOString(),
              snoozed_until: desiredSnooze,
              // Re-anchor the alarm too. A rolled instance keeping yesterday's
              // remind_at would sit permanently overdue in Apple Reminders.
              remind_at: triggerRemindAt(today, routine.trigger_time, routine.remind),
            },
          })
          return
        }
      } else if (!isStack) {
        // Legacy path: skip spawn while a LIVE instance exists. Terminal ones
        // (done, and the three deferral statuses) release the loop — see
        // TERMINAL_STATUSES for the bug this closes. A deferral also moved the
        // schedule on via deferLoopCycle, so the release can't respawn the same
        // cycle immediately.
        const hasActive = existingTasks.some(
          t => t.routine_id === routine.id && !TERMINAL_STATUSES.has(t.status),
        )
        if (hasActive) return
      }

      const nextDue = getNextDueDate(routine)
      const dueYMD = localYMD(nextDue)

      if (isStack) {
        // Stack guard: don't double-spawn the same cycle, but DO spawn a new
        // cycle even if a prior cycle still has unfinished members (those stay
        // on the list as overdue cards — the app's "a missed cycle surfaces as
        // overdue, not a pileup" philosophy). The cycle key is the due date.
        const alreadySpawned = existingTasks.some(
          t => t.routine_id === routine.id && t.due_date === dueYMD,
        )
        if (alreadySpawned) return
        spawnStackMembers(routine, dueYMD).forEach(t => spawned.push(t))
        return
      }

      const task = createTask(routine.title, routine.tags, dueYMD, routine.notes)
      task.routine_id = routine.id
      task.notion_page_id = routine.notion_page_id
      task.notion_url = routine.notion_url
      if (routine.high_priority) task.high_priority = true
      if (routine.assignee) task.assignee = routine.assignee
      if (routine.impact) task.impact = routine.impact
      if (Array.isArray(routine.follow_ups) && routine.follow_ups.length > 0) {
        task.follow_ups = routine.follow_ups
      }
      task.snoozed_until = triggerSnooze(dueYMD, routine.trigger_time)
      task.remind_at = triggerRemindAt(dueYMD, routine.trigger_time, routine.remind)
      spawned.push(task)
    })
    return { spawned, rolled }
  }, [routines])

  // Loop-reconcile review actions (per-day Mark done / Skip). Both key off a
  // local 'YYYY-MM-DD' day so they're stable regardless of clock time.

  // Credit a specific local DAY (`ymd`) as a completion, idempotently. Used by
  // "Mark done" on the loop's needs-attention list, by the loop-detail
  // calendar (tap a day) and by its date field — the three ways a day the app
  // never recorded gets put right. The stamping rules (local-day bucketing,
  // duplicate self-heal, clearing a prior skip) live in stampLoopDay so
  // scripts/cycles.test.mjs can pin them.
  const markRoutineDayDone = useCallback((routineId, ymd, iso) => {
    if (!ymd) return
    setRoutines(prev => prev.map(r => (r.id === routineId ? stampLoopDay(r, ymd, iso) : r)))
  }, [])

  // Undo twin: take one completion back off a day. A manual log is a typed
  // date and a tapped calendar cell, so the wrong day is one slip away — and
  // without this the only way back would be the "Last done" field, which
  // REPLACES the newest entry rather than removing the one you meant.
  const unmarkRoutineDayDone = useCallback((routineId, ymd) => {
    if (!ymd) return
    setRoutines(prev => prev.map(r => (r.id === routineId ? unstampLoopDay(r, ymd) : r)))
  }, [])

  // "Push it out" — move a loop's next due date on by one cycle and record
  // nothing else. Same lever as skipCycle; separate name because the away
  // prompt reads as rescheduling, not skipping.
  const pushLoopOut = useCallback((routineId) => {
    setRoutines(prev => prev.map(r =>
      r.id === routineId ? { ...r, resume_at: pushOutOneCycle(r) } : r
    ))
  }, [])

  // Acknowledge a day as "didn't do it, move on" — record it in skipped_days so
  // it stops surfacing as needing attention, WITHOUT crediting a completion
  // (the trail stays honestly uncaught). Used by "Skip" on the same list.
  const skipRoutineDay = useCallback((routineId, ymd) => {
    if (!ymd) return
    setRoutines(prev => prev.map(r => {
      if (r.id !== routineId) return r
      const skipped = Array.isArray(r.skipped_days) ? r.skipped_days : []
      if (skipped.includes(ymd)) return r
      return { ...r, skipped_days: [...skipped, ymd].sort() }
    }))
  }, [])

  const hydrateRoutines = useCallback((data) => {
    if (!Array.isArray(data)) return
    // Self-heal exact-duplicate completed_history stamps (artifacts of the
    // re-stamp bug that inflated lifetime counts). Identical timestamps are
    // never legitimate — even habit double-logs differ by milliseconds — so
    // collapsing them is safe and corrects an inflated count on next load.
    const healed = data.map(r => {
      const h = Array.isArray(r.completed_history) ? r.completed_history : []
      const deduped = Array.from(new Set(h))
      return deduped.length === h.length ? r : { ...r, completed_history: deduped }
    })
    // Keep the SAME array when the server sent us what we already have. A new
    // reference re-runs the spawn pass in AppV2 (its effect is keyed on
    // `routines`), and that effect runs `spawnDueTasks` — so every SSE echo
    // from another device used to re-enter the one code path in the app that
    // manufactures tasks. Nothing about a no-op hydrate should cost that.
    setRoutines(prev => (sameJson(prev, healed) ? prev : healed))
  }, [])

  return {
    routines,
    addRoutine,
    deleteRoutine,
    togglePause,
    completeRoutine,
    uncompleteRoutine,
    adjustRoutineHistory,
    updateRoutine,
    updateRoutineNotion,
    spawnDueTasks,
    spawnNow,
    deferLoopCycle,
    logHabit,
    skipCycle,
    pushLoopOut,
    markRoutineDayDone,
    unmarkRoutineDayDone,
    skipRoutineDay,
    hydrateRoutines,
  }
}

export async function enhanceSpawnedTasks(spawnedTasks, routines) {
  for (const task of spawnedTasks) {
    if (!task.routine_id) continue
    const routine = routines.find(r => r.id === task.routine_id)
    if (!routine || !routine.notes) continue

    try {
      const lastCompleted = routine.completed_history.length > 0
        ? routine.completed_history[routine.completed_history.length - 1]
        : null
      const result = await suggestRoutineDueDate(routine.title, routine.notes, routine.cadence, lastCompleted)
      if (result?.date) task.due_date = result.date
    } catch { /* use default date */ }
  }
  return spawnedTasks
}
