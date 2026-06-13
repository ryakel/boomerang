import { useEffect, useRef } from 'react'
import { inferSize } from '../api'
import { ACTIVE_STATUSES, loadSettings } from '../store'

// Labels the AI may auto-assign EXCLUDES the quiet-hours bypass label — auto
// tagging "wake-me" would silently change a task's notification behavior.
function taggableLabels(labels) {
  const bypass = loadSettings()?.quiet_hours_bypass_label || 'wake-me'
  return (labels || []).filter(l => l && l.id && l.id !== bypass)
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
        const inferred = await inferSize(next.title, next.notes || '', taggableLabels(labels))
        if (cancelled) return
        if (inferred?.size) {
          const updates = {
            size: inferred.size,
            energy: inferred.energy || next.energy || null,
            energyLevel: inferred.energyLevel || next.energyLevel || null,
            size_inferred: true,
          }
          // Merge AI-suggested tags into whatever's already on the task — never
          // drop a tag the user set by hand. Only write if it actually adds one.
          if (Array.isArray(inferred.tags) && inferred.tags.length > 0) {
            const have = Array.isArray(next.tags) ? next.tags : []
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
      cancelled = true
      clearTimeout(timer)
    }
  }, [tasks, updateTask, labels])
}
