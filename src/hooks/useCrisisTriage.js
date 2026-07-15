import { useEffect, useRef } from 'react'
import { generateCrisisTriage } from '../api'
import { isCrisisTask, loadSettings } from '../store'

// Space triage calls out the same way useSizeAutoInfer does — declaring
// several crises at once shouldn't hammer the API.
const THROTTLE_MS = 800

/**
 * Crisis triage auto-breakdown. Watches the task list for tasks carrying the
 * crisis label ("prio") where `crisis_triage_done` is false, asks Claude for
 * 3-5 concrete stop-the-bleeding-first steps (the first doable in <5 min),
 * and MERGES them into the task's checklists as a "Triage" checklist —
 * hand-written checklist items are never touched. Sets crisis_triage_done so
 * it runs exactly once per crisis (the flag resets server-side when the
 * crisis label is removed, so a re-declared crisis gets a fresh pass).
 *
 * Gated by settings.crisis_auto_breakdown (default on). On API failure the
 * flag stays false and the next app load retries — same posture as the
 * background auto-sizer. See wiki/Crisis-Tag-And-Impact-Ranking.md.
 */
export function useCrisisTriage(tasks, updateTask) {
  const attempted = useRef(new Set())
  // Latest task list, read at write time — the AI call takes seconds and the
  // task's checklists may have changed underneath it (autosave, sync echo).
  const latestTasks = useRef(tasks)
  latestTasks.current = tasks

  useEffect(() => {
    // Stable Set — captured locally so the cleanup reads the same object the
    // effect body used (and the exhaustive-deps lint stays quiet).
    const attemptedSet = attempted.current
    const settings = loadSettings()
    if (settings.crisis_auto_breakdown === false) return
    const next = tasks.find(t =>
      isCrisisTask(t, settings)
      && !t.crisis_triage_done
      && ['not_started', 'doing', 'waiting'].includes(t.status)
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
        const steps = await generateCrisisTriage(next.title, next.notes || '')
        // Deliberately NOT gated on effect cleanup: the effect re-runs on
        // every task-list change (our own writes, sync echoes), which is the
        // NORMAL state right after a task goes critical — dropping the
        // result here starved the triage forever (2026-07-14 prod bug: task
        // went critical, "and then nothing else"). updateTask by id is safe
        // regardless of list churn; merge against the LATEST task state.
        if (steps.length > 0) {
          const current = latestTasks.current.find(t => t.id === next.id) || next
          const existing = Array.isArray(current.checklists) ? current.checklists : []
          // Don't duplicate: skip steps whose text already exists in ANY
          // checklist on the task (case-insensitive).
          const have = new Set(existing.flatMap(cl => (cl.items || []).map(it => String(it.text || '').toLowerCase())))
          const fresh = steps.filter(s => !have.has(s.toLowerCase()))
          if (fresh.length > 0) {
            const triage = {
              id: crypto.randomUUID(),
              name: 'Triage',
              items: fresh.map(text => ({ id: crypto.randomUUID(), text, completed: false })),
            }
            updateTask(next.id, { checklists: [triage, ...existing], crisis_triage_done: true })
          } else {
            updateTask(next.id, { crisis_triage_done: true })
          }
        }
        // steps === [] (API error / no key): leave the flag false and retry
        // next session.
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
      // If the call never STARTED, release the id so the next effect run
      // re-picks it. Without this, any list churn inside the throttle window
      // permanently starved the task for the whole session (the timer died
      // with the cleanup but `attempted` still blocked a retry).
      if (!started) attemptedSet.delete(next.id)
    }
  }, [tasks, updateTask])
}
