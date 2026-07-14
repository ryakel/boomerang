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

// Fill-only pass eligibility: tasks created since impact ranking shipped
// whose size was settled AT CREATION (Quokka passing a size, a manual size
// pick in the add modal) never enter the primary net — size_inferred is
// already true — so impact/tags/missing-energy were never inferred at all
// ("new tasks didn't get anything", 2026-07-14 prod report). Gating on
// created_at keeps the deliberate lazy backfill for historical tasks: a
// pre-impact task with a settled size stays at the impact-2 baseline
// instead of triggering an upgrade-day inference storm.
const IMPACT_EPOCH = '2026-07-14'

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
    const eligible = t =>
      ACTIVE_STATUSES.includes(t.status)
      && !t.gmail_pending
      && !attemptedSet.has(t.id)
      && t.title?.trim()
    // Primary: size not yet settled — full inference (size/energy/impact/tags).
    const primary = tasks.find(t => !t.size_inferred && eligible(t))
    // Secondary: size settled at creation but impact never inferred — same
    // single API call, but only the still-unset fields get written.
    const secondary = primary ? null : tasks.find(t =>
      t.size_inferred
      && t.impact == null && !t.impact_inferred
      && String(t.created_at || '') >= IMPACT_EPOCH
      && eligible(t)
    )
    const next = primary || secondary
    const fillOnly = !primary
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
          // Fill-only mode never touches a size/energy the user (or Quokka)
          // already settled — it only writes what's still unset. Marking
          // impact_inferred even when the model returned no impact keeps the
          // task from being re-picked forever.
          const updates = fillOnly
            ? {
                impact_inferred: true,
                ...(current.energy ? {} : { energy: inferred.energy || null }),
                ...(current.energyLevel != null ? {} : { energyLevel: inferred.energyLevel || null }),
              }
            : {
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
        // Network-shaped failure (app suspended mid-call, offline blip) —
        // release the id so the next effect run (e.g. the post-resume
        // refetch) retries. Real API errors never reach here; the api
        // helper swallows them and returns the empty shape instead.
        attemptedSet.delete(next.id)
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
