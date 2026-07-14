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
    const settings = loadSettings()
    if (settings.diy_reality_check === false) return
    const next = tasks.find(t =>
      !t.diy_assessed
      && ['not_started', 'doing', 'waiting'].includes(t.status)
      && !t.gmail_pending
      && !attempted.current.has(t.id)
      && t.title?.trim()
      && isRepairTaskShape(t)
    )
    if (!next) return

    let cancelled = false
    attempted.current.add(next.id)

    const timer = setTimeout(async () => {
      if (cancelled) return
      try {
        const check = await generateRealityCheck(next.title, next.notes || '')
        if (cancelled) return
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
      cancelled = true
      clearTimeout(timer)
    }
  }, [tasks, updateTask])
}
