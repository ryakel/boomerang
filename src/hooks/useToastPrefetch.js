import { useCallback, useEffect, useRef } from 'react'
import { generateToastMessages } from '../api'

// Throttle between backfill calls — matches useSizeAutoInfer's posture toward
// the same API. One candidate per pass, not a scheduled fan-out.
const BACKFILL_THROTTLE_MS = 4000

// Debounce per-task, regenerate toast messages when title/energy change
export function useToastPrefetch(tasks, updateTask) {
  const timers = useRef({})
  const snapshots = useRef({}) // track what we last generated for
  const attempted = useRef(new Set())
  const backfillTimer = useRef(null)
  // Live task list, read at WRITE time. The AI call takes seconds and the row
  // may have been filled in by the other client (or completed, or deleted)
  // while it was in flight — see the write guard below.
  const latestTasks = useRef(tasks)
  latestTasks.current = tasks

  // Lazy backfill for tasks missing toast_messages.
  //
  // This used to schedule EVERY candidate up front, `i * 1000` apart, and write
  // each result as its own per-record PATCH. Each write bumps the server
  // version and broadcasts, and every connected client answers a broadcast
  // with a full /api/data fetch — so N missing toasts meant N version bumps and
  // N whole-database hydrates per client, at one per second. In a 1500-task
  // database with a desktop and a phone both awake that is a self-inflicted
  // sync storm, and it fired again on every mount of every device because the
  // guard was a per-client ref (2026-08-31 prod log).
  //
  // Now it advances ONE task per pass, the same shape as useSizeAutoInfer:
  // write → `tasks` changes → effect re-runs → next candidate. An in-session
  // `attempted` set stops a failed call from being retried in a loop. These are
  // cosmetic strings for a toast; they never justify waking every client.
  useEffect(() => {
    if (backfillTimer.current || !Array.isArray(tasks) || tasks.length === 0) return

    const attemptedSet = attempted.current
    const next = tasks.find(t =>
      t.status !== 'done' && t.title && !t.toast_messages && !attemptedSet.has(t.id)
    )
    if (!next) return
    attemptedSet.add(next.id)

    backfillTimer.current = setTimeout(() => {
      backfillTimer.current = null
      generateToastMessages(next.title, {
        energy: next.energy,
        energyLevel: next.energyLevel,
      }).then(messages => {
        // Re-read before committing. The other client runs this same backfill
        // against the same rows, so by now the value may already be there —
        // writing ours over it is a broadcast that changes nothing.
        const live = (latestTasks.current || []).find(t => t.id === next.id)
        if (!live || live.toast_messages || live.status === 'done') return
        updateTask(next.id, { toast_messages: messages })
      }).catch(() => {})
    }, BACKFILL_THROTTLE_MS)
  }, [tasks, updateTask])

  useEffect(() => () => {
    if (backfillTimer.current) clearTimeout(backfillTimer.current)
  }, [])

  const prefetch = useCallback((taskId, title, energy, energyLevel) => {
    if (!title) return

    // Check if anything relevant changed
    const key = `${title}|${energy}|${energyLevel}`
    if (snapshots.current[taskId] === key) return
    snapshots.current[taskId] = key

    // Debounce 3s so rapid edits don't spam API
    if (timers.current[taskId]) clearTimeout(timers.current[taskId])
    timers.current[taskId] = setTimeout(() => {
      delete timers.current[taskId]
      generateToastMessages(title, { energy, energyLevel })
        .then(messages => {
          // Same re-read as the backfill: this fires 3s after the edit that
          // triggered it, by which time the task may be gone.
          const live = (latestTasks.current || []).find(t => t.id === taskId)
          if (!live) return
          updateTask(taskId, { toast_messages: messages })
        })
        .catch(() => {}) // static fallback if AI fails
    }, 3000)
  }, [updateTask])

  return prefetch
}
