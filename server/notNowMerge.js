// "Not now" on Worth doing next, merged across devices (BOOM-43, 2026-11-17).
//
// PURE and shared with the browser (src/kept/today2Hooks.js imports it), so
// the server and every client resolve two devices' dismissals the same way.
// No Node, database or network imports.
//
// State shape (todayModel.recordNotNow): { date: 'YYYY-MM-DD', entries: { [taskId]: reasonKey } }.
// A dismissal only lasts its day, so:
//   - different days: the LATER day wins outright (yesterday's skips are spent);
//   - same day: the union of both devices' entries (a dismissal on either
//     device counts; nothing un-dismisses a pick within the day).
// Lives in its own app_data key, never the settings blob: the blob is
// whole-blob last-writer-wins and would drop one device's dismissals.

const DAY = /^\d{4}-\d{2}-\d{2}$/

export function normalizeNotNow(s) {
  if (!s || typeof s !== 'object' || !DAY.test(String(s.date || ''))) return null
  const entries = {}
  if (s.entries && typeof s.entries === 'object') {
    for (const [id, key] of Object.entries(s.entries)) {
      if (typeof id === 'string' && id && id.length <= 200) entries[id] = typeof key === 'string' ? key.slice(0, 80) : 'other'
    }
  }
  return { date: s.date, entries }
}

export function mergeNotNow(a, b) {
  const x = normalizeNotNow(a)
  const y = normalizeNotNow(b)
  if (!x) return y
  if (!y) return x
  if (x.date !== y.date) return x.date > y.date ? x : y
  return { date: x.date, entries: { ...x.entries, ...y.entries } }
}

// Same content? (so a merge that adds nothing doesn't write or re-render)
export function sameNotNow(a, b) {
  const x = normalizeNotNow(a), y = normalizeNotNow(b)
  if (!x || !y) return x === y
  if (x.date !== y.date) return false
  const kx = Object.keys(x.entries), ky = Object.keys(y.entries)
  return kx.length === ky.length && kx.every(k => x.entries[k] === y.entries[k])
}
