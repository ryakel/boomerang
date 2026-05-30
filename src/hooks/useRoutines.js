import { useState, useCallback, useEffect } from 'react'
import { loadRoutines, saveRoutines, createRoutine, isRoutineDue, getNextDueDate, createTask, localYMD } from '../store'
import { suggestRoutineDueDate } from '../api'

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

export function useRoutines() {
  const [routines, setRoutines] = useState(loadRoutines)

  useEffect(() => {
    saveRoutines(routines)
  }, [routines])

  const addRoutine = useCallback((title, cadence, customDays, tags, notes, highPriority = false, endDate = null, scheduleDayOfWeek = null, followUps = [], autoRoll = false, spawnMode = 'auto', targetCount = null, targetPeriod = null, customUnit = 'days', triggerTime = null) => {
    const routine = createRoutine(title, cadence, customDays, tags, notes, customUnit)
    if (highPriority) routine.high_priority = true
    if (endDate) routine.end_date = endDate
    if (scheduleDayOfWeek != null) routine.schedule_day_of_week = scheduleDayOfWeek
    if (triggerTime) routine.trigger_time = triggerTime
    if (Array.isArray(followUps) && followUps.length > 0) routine.follow_ups = followUps
    if (autoRoll) routine.auto_roll = true
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
  // Stamps completed_history with today so getNextDueDate() rolls forward by
  // one cadence interval. Use case: vacation, illness, anything that should
  // skip this occurrence. The "Nx completed" counter on the card includes
  // skips — close enough for a personal app, no separate skip log needed.
  const skipCycle = useCallback((routineId) => {
    setRoutines(prev => prev.map(r =>
      r.id === routineId ? {
        ...r,
        completed_history: [...r.completed_history, new Date().toISOString()],
      } : r
    ))
  }, [])

  // Habit-mode "+ Log it": spawn a task and immediately mark it done. The
  // returned task lands on the list with status='done' and counts toward the
  // current period total. Use case: "I just did a workout, log it." The
  // routine itself has no cadence so there's no schedule to update.
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
    return task
  }, [routines])

  // Spawn a one-off task from a routine right now, bypassing the schedule.
  // Useful when the user wants to do the routine ad-hoc outside of its
  // scheduled cadence. Due date is today. Does NOT update completed_history
  // until the task is completed (same as normal scheduled spawn), so the
  // routine's cadence clock is unaffected unless the spawned task is done.
  const spawnNow = useCallback((routineId) => {
    const routine = routines.find(r => r.id === routineId)
    if (!routine) return null
    const today = localYMD()
    const task = createTask(routine.title, routine.tags, today, routine.notes)
    task.routine_id = routine.id
    task.notion_page_id = routine.notion_page_id
    task.notion_url = routine.notion_url
    if (routine.high_priority) task.high_priority = true
    if (routine.energy) task.energy = routine.energy
    if (routine.energyLevel) task.energyLevel = routine.energyLevel
    if (Array.isArray(routine.follow_ups) && routine.follow_ups.length > 0) {
      task.follow_ups = routine.follow_ups
    }
    task.snoozed_until = triggerSnooze(today, routine.trigger_time)
    return task
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
    // Statuses we treat as terminal for auto_roll's purposes — these instances
    // should NOT block a new spawn nor get rolled forward. backlog/project are
    // user-driven defers, cancelled is explicit abandonment. (The legacy
    // non-auto-roll path uses a looser `!== 'done'` check — preserved below
    // to avoid scope-creeping a behavior change into PR 1.)
    const TERMINAL_FOR_ROLL = new Set(['done', 'completed', 'cancelled', 'backlog', 'project'])
    const today = localYMD()

    routines.forEach(routine => {
      if (!isRoutineDue(routine)) return

      if (routine.auto_roll) {
        // Auto-roll path: find a truly-active instance and bump it forward.
        // If none, fall through to a normal spawn.
        const activeInstance = existingTasks.find(
          t => t.routine_id === routine.id && !TERMINAL_FOR_ROLL.has(t.status),
        )
        if (activeInstance) {
          const needsDateBump = activeInstance.due_date !== today
          const hasStaleSnooze = activeInstance.snoozed_until &&
            new Date(activeInstance.snoozed_until) <= new Date()
          if (!needsDateBump && !hasStaleSnooze) return

          const updates = {
            due_date: today,
            last_touched: new Date().toISOString(),
          }
          if (hasStaleSnooze) {
            updates.snoozed_until = null
          }
          rolled.push({ taskId: activeInstance.id, updates })
          return
        }
      } else {
        // Legacy path: skip spawn if any non-done instance exists, preserving
        // the original behavior for every routine that hasn't opted into
        // auto-roll. (A separate cleanup PR could revisit whether
        // backlog/project instances should block routine spawning, but that's
        // a behavior change outside PR 1's scope.)
        const hasActive = existingTasks.some(
          t => t.routine_id === routine.id && t.status !== 'done',
        )
        if (hasActive) return
      }

      const nextDue = getNextDueDate(routine)
      const dueYMD = localYMD(nextDue)
      const task = createTask(routine.title, routine.tags, dueYMD, routine.notes)
      task.routine_id = routine.id
      task.notion_page_id = routine.notion_page_id
      task.notion_url = routine.notion_url
      if (routine.high_priority) task.high_priority = true
      if (Array.isArray(routine.follow_ups) && routine.follow_ups.length > 0) {
        task.follow_ups = routine.follow_ups
      }
      task.snoozed_until = triggerSnooze(dueYMD, routine.trigger_time)
      spawned.push(task)
    })
    return { spawned, rolled }
  }, [routines])

  const hydrateRoutines = useCallback((data) => {
    if (Array.isArray(data)) {
      setRoutines(data)
    }
  }, [])

  return {
    routines,
    addRoutine,
    deleteRoutine,
    togglePause,
    completeRoutine,
    adjustRoutineHistory,
    updateRoutine,
    updateRoutineNotion,
    spawnDueTasks,
    spawnNow,
    logHabit,
    skipCycle,
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
