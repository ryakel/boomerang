import { useMemo } from 'react'

// Spaces data layer. Reads from existing useTasks / useRoutines state —
// no new fetches — so re-renders track the same dependency graph the
// rest of v2 already invalidates on. Kept here as the data shape the
// future SpacesHub preview-card upgrade (C-upgrade) will consume.
//
// Note: an earlier iteration also exposed `wantsAttention` for a Spaces
// tab-bar badge dot driven by stale pinned projects. The signal was
// noisy in practice — the user found the dot more annoying than useful —
// so the badge was removed. See PR-trail for the stalePinnedCount logic
// if the signal is ever revisited (probably with a richer rule than
// "3-day no-session").

export function useSpaces({ tasks, routines }) {
  return useMemo(() => {
    const todayStr = new Date().toDateString()

    const allProjects = tasks.filter(t => t.status === 'project')
    const pinnedProjects = allProjects.filter(t => t.pinned_to_today)
    const activeRoutines = routines.filter(r => !r.paused)

    // Routines that fired today. Exposed for the C-upgrade's per-row
    // meta ("1 routine spawned today"). Not currently surfaced anywhere.
    const spawnedTodayCount = activeRoutines.filter(r => {
      const history = r.completed_history
      if (!Array.isArray(history) || history.length === 0) return false
      return new Date(history[history.length - 1]).toDateString() === todayStr
    }).length

    // Knowledge count is fetched lazily in the C-upgrade (one-shot
    // network call on mount). For D we stub the object so the hook
    // contract is stable and consumers can switch over without renaming.
    const knowledge = {
      itemCount: null,
      lastAddedTitle: null,
    }

    return {
      projects: {
        pinnedCount: pinnedProjects.length,
        totalCount: allProjects.length,
      },
      routines: {
        activeCount: activeRoutines.length,
        spawnedTodayCount,
      },
      knowledge,
    }
  }, [tasks, routines])
}
