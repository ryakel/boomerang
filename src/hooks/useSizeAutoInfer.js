import { useEffect, useRef } from 'react'
import { inferSize } from '../api'
import { ACTIVE_STATUSES, loadSettings } from '../store'

// Labels the AI may auto-assign EXCLUDE the quiet-hours bypass label AND the
// crisis label — auto tagging "wake-me" would silently change a task's
// notification behavior, and an AI silently declaring a crisis (Emergency
// pages, 2h nag loop) is worse. Only a human escalates to crisis.
function taggableLabels(labels) {
  const settings = loadSettings()
  const bypass = settings?.quiet_hours_bypass_label || 'wake-me'
  const crisis = settings?.crisis_label || 'critical'
  return (labels || []).filter(l => l && l.id && l.id !== bypass && l.id !== crisis)
}

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
export function useSizeAutoInfer(tasks, updateTask, labels = []) {
  const attempted = useRef(new Set())
  // Latest task list, read at write time — the AI call takes seconds and the
  // task's tags/impact may have changed underneath it.
  const latestTasks = useRef(tasks)
  latestTasks.current = tasks

  useEffect(() => {
    // Stable Set — captured locally so the cleanup reads the same object the
    // effect body used (and the exhaustive-deps lint stays quiet).
    const attemptedSet = attempted.current
    const next = tasks.find(t =>
      !t.size_inferred
      && ACTIVE_STATUSES.includes(t.status)
      && !t.gmail_pending
      && !attemptedSet.has(t.id)
      && t.title?.trim()
    )
    if (!next) return

    attemptedSet.add(next.id)
    let started = false

    const timer = setTimeout(async () => {
      started = true
      try {
        const inferred = await inferSize(next.title, next.notes || '', taggableLabels(labels))
        // Deliberately NOT gated on effect cleanup: the effect re-runs on
        // every task-list change (sync echoes, our own writes) — the normal
        // state right after a task is created — and dropping the result here
        // starved inference for the whole session (2026-07-14 prod bug,
        // found via the crisis-triage twin of this hook). updateTask by id
        // is safe regardless of list churn; merge against the LATEST state.
        if (inferred?.size) {
          const current = latestTasks.current.find(t => t.id === next.id) || next
          const updates = {
            size: inferred.size,
            energy: inferred.energy || current.energy || null,
            energyLevel: inferred.energyLevel || current.energyLevel || null,
            size_inferred: true,
          }
          // Impact rides the same single inference call. Never overwrite a
          // hand-set value (impact_inferred flips true on manual picks too).
          if (inferred.impact && current.impact == null && !current.impact_inferred) {
            updates.impact = inferred.impact
            updates.impact_inferred = true
          }
          // Merge AI-suggested tags into whatever's already on the task — never
          // drop a tag the user set by hand. Only write if it actually adds one.
          if (Array.isArray(inferred.tags) && inferred.tags.length > 0) {
            const have = Array.isArray(current.tags) ? current.tags : []
            const merged = Array.from(new Set([...have, ...inferred.tags]))
            if (merged.length !== have.length) updates.tags = merged
          }
          updateTask(next.id, updates)
        }
        // If inferred.size is null (API error / no key), leave size_inferred
        // false. Next session's page load will try again.
      } catch {
        // swallow — retry on next session
      }
    }, THROTTLE_MS)

    return () => {
      clearTimeout(timer)
      // If the call never started, release the id so the next effect run
      // re-picks it — otherwise list churn inside the 500ms throttle window
      // permanently starves the task for the session.
      if (!started) attemptedSet.delete(next.id)
    }
  }, [tasks, updateTask, labels])
}
