import { localYMD } from '../../store'

// Shared helpers for the Loggd contribution heatmaps (routine cards +
// Profile dashboard). Kept in one place so the per-routine accent palette
// and the day-bucketing stay consistent across surfaces.

// Cycle the Loggd category palette by a stable hash of the routine id so
// each habit reads as its own color (like the loggd.life habit cards).
// Falls back to --v2-accent in Standard themes where --lg-* is undefined.
export const HEATMAP_COLORS = [
  'var(--lg-blue, var(--v2-accent))',
  'var(--lg-purple, var(--v2-accent))',
  'var(--lg-green, var(--v2-accent))',
  'var(--lg-orange, var(--v2-accent))',
  'var(--lg-pink, var(--v2-accent))',
]

export function routineHeatColor(id) {
  let h = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return HEATMAP_COLORS[h % HEATMAP_COLORS.length]
}

// Bucket a list of ISO timestamps into { 'YYYY-MM-DD': count } keyed by
// LOCAL date (matches ContributionHeatmap's local-date grid).
export function historyByDay(history) {
  const map = {}
  for (const ts of (history || [])) {
    const d = new Date(ts)
    if (isNaN(d)) continue
    const key = localYMD(d)
    map[key] = (map[key] || 0) + 1
  }
  return map
}
