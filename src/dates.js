// Canonical date helpers — THE one date module (Kept K2). Merges the two
// historical localYMD implementations (store.js expected a Date;
// wallaby/heatmapUtils accepted anything) into one contract:
//
//   * 'YYYY-MM-DD' strings are LOCAL calendar days. Never feed them to bare
//     new Date(): the spec parses them as UTC midnight, which is the
//     PREVIOUS local day anywhere west of UTC (the bug class behind tasks
//     due today grouping as Overdue, off-by-one target dates, and broken
//     streak chains — three separate incidents).
//   * Full ISO timestamps and Date objects parse normally.
//
// Tested by scripts/dates.test.mjs (runs in `npm test`).

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/

// → Date at LOCAL midnight for date-only strings; normal parse otherwise.
//   Returns null for unparseable input.
export function parseLocalDate(d) {
  if (typeof d === 'string' && YMD_RE.test(d)) {
    const [y, m, day] = d.split('-').map(Number)
    return new Date(y, m - 1, day)
  }
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? null : x
}

// → 'YYYY-MM-DD' local day key. Date-only strings pass through unchanged
//   (they already ARE local day keys). Defaults to today.
export function localYMD(d = new Date()) {
  if (typeof d === 'string' && YMD_RE.test(d)) return d
  const x = parseLocalDate(d)
  if (!x) return null
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

// → 'YYYY-MM-DDTHH:MM' local, the value shape <input type="datetime-local">
//   requires. NOT toISOString().slice(0,16) — that is UTC, and it would seed
//   every picker hours off wherever the user isn't on UTC.
export function localDateTimeValue(d = new Date()) {
  const x = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(x.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`
}

// A sane default moment for a reminder picker: the next :00 or :30 at least
// five minutes out. Seeding "now" would hand back a moment that is already
// gone by the time the sheet is dismissed, and iOS silently discards a local
// notification scheduled in the past.
export function nextHalfHour(from = new Date()) {
  const x = new Date(from.getTime() + 5 * 60 * 1000)
  x.setSeconds(0, 0)
  x.setMinutes(x.getMinutes() <= 30 ? 30 : 60)
  return x
}

// → new Date offset by n days (local-calendar aware via setDate).
export function addDays(d, n) {
  const x = parseLocalDate(d)
  x.setDate(x.getDate() + n)
  return x
}

// → Monday-anchored start of the week containing `ref` (+ weekOffset weeks).
export function weekStartMonday(ref, weekOffset = 0) {
  const d = parseLocalDate(ref)
  d.setHours(0, 0, 0, 0)
  const dow = (d.getDay() + 6) % 7 // 0 = Monday
  d.setDate(d.getDate() - dow + weekOffset * 7)
  return d
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function fmtMonthDay(d) {
  const x = parseLocalDate(d)
  return `${MONTHS[x.getMonth()]} ${x.getDate()}`
}
export function monthShort(i) { return MONTHS[i] }
