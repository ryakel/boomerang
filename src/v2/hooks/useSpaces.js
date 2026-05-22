import { useMemo } from 'react'

// Spaces data layer. Reads from existing useTasks / useRoutines state —
// no new fetches — so re-renders track the same dependency graph the
// rest of v2 already invalidates on.
//
// In D this hook powers a single boolean (`wantsAttention`) for the
// BottomTabs badge dot. In the future C-upgrade, the same hook feeds
// rich preview cards inside SpacesHub (per-space counts, last-touched
// timestamps, "fresh" vs "stale" treatment per row). Same data layer,
// two render paths.

// A pinned project is "stale" if it has no recent session activity.
// Three days is the threshold where the user committed to caring
// (pinning) but the project is drifting; sooner than that is just
// "give it time."
const STALE_PROJECT_DAYS = 3
const STALE_THRESHOLD_MS = STALE_PROJECT_DAYS * 24 * 60 * 60 * 1000

export function useSpaces({ tasks, routines }) {
  return useMemo(() => {
    const now = Date.now()
    const todayStr = new Date().toDateString()

    const allProjects = tasks.filter(t => t.status === 'project')
    const pinnedProjects = allProjects.filter(t => t.pinned_to_today)
    const activeRoutines = routines.filter(r => !r.paused)

    // Pinned projects with no session activity in STALE_PROJECT_DAYS.
    // `last_session_at` null counts as stale — a pinned project that has
    // never been touched needs more attention than one touched yesterday.
    const stalePinnedCount = pinnedProjects.filter(p => {
      if (!p.last_session_at) return true
      const last = new Date(p.last_session_at).getTime()
      return Number.isFinite(last) && (now - last) > STALE_THRESHOLD_MS
    }).length

    // Routines that fired today. Not currently a badge signal — the
    // spawned tasks already appear in the Today list — but exposed for
    // the C-upgrade's per-row meta ("1 routine spawned today").
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
        stalePinnedCount,
      },
      routines: {
        activeCount: activeRoutines.length,
        spawnedTodayCount,
      },
      knowledge,
      // Single boolean that drives the tab-bar badge dot. Future
      // signals (e.g. new knowledge in last 24h, routine ready to
      // spawn) can OR in here without changing BottomTabs' contract.
      wantsAttention: stalePinnedCount > 0,
    }
  }, [tasks, routines])
}
