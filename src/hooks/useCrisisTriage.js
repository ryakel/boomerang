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

  useEffect(() => {
    const settings = loadSettings()
    if (settings.crisis_auto_breakdown === false) return
    const next = tasks.find(t =>
      isCrisisTask(t, settings)
      && !t.crisis_triage_done
      && ['not_started', 'doing', 'waiting'].includes(t.status)
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
        const steps = await generateCrisisTriage(next.title, next.notes || '')
        if (cancelled) return
        if (steps.length > 0) {
          const existing = Array.isArray(next.checklists) ? next.checklists : []
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
        // swallow — retry next session
      }
    }, THROTTLE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tasks, updateTask])
}
