import { useEffect, useRef } from 'react'
import { generateRealityCheck } from '../api'
import { isRepairTaskShape, loadSettings } from '../store'

// Space assessments out like the other background inferrers.
const THROTTLE_MS = 900

/**
 * DIY-or-hire "Reality check" — background net over the task list, same
 * pattern as useSizeAutoInfer/useCrisisTriage. Any active repair/
 * construction-shaped task (isRepairTaskShape) that hasn't been assessed
 * gets ONE blunt AI verdict: 'hire' (the default stance — the user has said
 * pride pushes them to DIY jobs they shouldn't) or 'diy' (trivially easy
 * only). Stored on the task (diy_verdict/diy_reason/diy_first_move,
 * migration 042); a 'hire' verdict switches the task's notification framing
 * server-side to push the call instead of the repair.
 *
 * Auto-run on purpose (decision: "auto, every time") — pride would never
 * tap a "question my competence" button. Gated by settings.diy_reality_check
 * (default on). Manual overrides happen in EditTaskModal by flipping the
 * verdict, never by re-running. On API failure diy_assessed stays false and
 * the next app load retries.
 */
export function useRealityCheck(tasks, updateTask) {
  const attempted = useRef(new Set())

  useEffect(() => {
    // Stable Set — captured locally so the cleanup reads the same object the
    // effect body used (and the exhaustive-deps lint stays quiet).
    const attemptedSet = attempted.current
    const settings = loadSettings()
    if (settings.diy_reality_check === false) return
    const next = tasks.find(t =>
      !t.diy_assessed
      && ['not_started', 'doing', 'waiting'].includes(t.status)
      && !t.gmail_pending
      && !attemptedSet.has(t.id)
      && t.title?.trim()
      && isRepairTaskShape(t)
    )
    if (!next) return

    attemptedSet.add(next.id)
    let started = false

    const timer = setTimeout(async () => {
      started = true
      try {
        const check = await generateRealityCheck(next.title, next.notes || '')
        // Deliberately NOT gated on effect cleanup — the effect re-runs on
        // every task-list change, which is the normal state right after
        // creating a task; dropping the result here starved the assessment
        // forever (2026-07-14 prod bug). updateTask by id is safe.
        if (check) {
          updateTask(next.id, {
            diy_assessed: true,
            diy_verdict: check.verdict,
            diy_reason: check.reason,
            diy_first_move: check.first_move,
          })
        }
        // null (API error / no key): leave diy_assessed false, retry next
        // session.
      } catch {
        // swallow — retry next session
      }
    }, THROTTLE_MS)

    return () => {
      clearTimeout(timer)
      // If the call never started, release the id so the next effect run
      // re-picks it — otherwise list churn inside the throttle window
      // permanently starves the task for the session.
      if (!started) attemptedSet.delete(next.id)
    }
  }, [tasks, updateTask])
}
