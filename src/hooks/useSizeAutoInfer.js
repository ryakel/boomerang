import { useEffect, useRef } from 'react'
import { inferSize } from '../api'
import { ACTIVE_STATUSES } from '../store'

// Throttle between inferSize calls so we don't hammer the Anthropic API
// after the migration on first load (could be dozens of tasks at once).
const THROTTLE_MS = 500

/**
 * Background auto-sizer. Watches the task list for active tasks where
 * `size_inferred` is false, runs inferSize for each (one at a time, throttled),
 * and updates the task with the returned size/energy/energyLevel plus
 * size_inferred=true.
 *
 * If inferSize fails (no API key, Claude error, malformed JSON), the task's
 * size_inferred stays false — the hook will retry on the next app load.
 * The task's fallback size is already 'M' (set by createTask), so points
 * compute correctly in the meantime.
 *
 * Processes one task per effect run, then re-renders kick in when
 * updateTask flips size_inferred=true and the effect picks up the next
 * candidate. An in-session `attempted` set avoids immediate retries when
 * inferSize returns null (e.g. Claude can't parse).
 *
 * Decoupled from create paths — any task created anywhere (quick-add,
 * routines, Gmail, Notion, Trello, GCal pull, markdown import) eventually
 * gets inferred here as long as its `size_inferred` flag is false.
 */
export function useSizeAutoInfer(tasks, updateTask) {
  const attempted = useRef(new Set())

  useEffect(() => {
    const next = tasks.find(t =>
      !t.size_inferred
      && ACTIVE_STATUSES.includes(t.status)
      && !t.gmail_pending
      && !attempted.current.has(t.id)
      && t.title?.trim()
    )
    if (!next) return

    let cancelled = false
    attempted.current.add(next.id)

    const timer = setTimeout(async () => {
      if (cancelled) return
      try {
        const inferred = await inferSize(next.title, next.notes || '')
        if (cancelled) return
        if (inferred?.size) {
          updateTask(next.id, {
            size: inferred.size,
            energy: inferred.energy || next.energy || null,
            energyLevel: inferred.energyLevel || next.energyLevel || null,
            size_inferred: true,
          })
        }
        // If inferred.size is null (API error / no key), leave size_inferred
        // false. Next session's page load will try again.
      } catch {
        // swallow — retry on next session
      }
    }, THROTTLE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tasks, updateTask])
}
