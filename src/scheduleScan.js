// Scan a schedule — the pure half. A photo of a class timetable, a shift rota,
// a screenshot of someone else's calendar or a PDF goes to Claude vision
// (`scanSchedule` in api.js); what comes back is parsed and normalized here,
// with no clock and no network, so `scripts/scheduleScan.test.mjs` can pin it.
//
// The scan is a user-REVIEWED import: nothing becomes a task until the user
// ticks entries in ScanScheduleModal and taps Import. It never runs in the
// background, which is why it doesn't route through the Review section.

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export function scanSystemPrompt(today) {
  const weekday = WEEKDAYS[ymdToUTC(today).getUTCDay()]
  return `You read schedules from images and PDFs: class timetables, shift rotas, screenshots of calendars, event flyers, appointment letters. Extract every distinct scheduled entry.

Today is ${weekday} ${today}. Use it to fill in a missing year, and to read relative headings ("Tomorrow", "Next Mon").

Return JSON only, no prose:
{"entries":[{"title":"...","date":"YYYY-MM-DD","weekday":"monday","start":"HH:MM","end":"HH:MM","location":"..."}]}

Rules:
- One entry per occurrence. A week grid with Maths on Monday and Wednesday is two entries.
- "date" when the schedule shows a real date; otherwise null and set "weekday" (lowercase English) for grids that only name days.
- Times in 24-hour HH:MM, null when not shown. "end" null when not shown.
- "title" is short and specific — the class, shift or event name as written. Put rooms/addresses in "location", not the title.
- Skip headers, legends, breaks and blank slots. If nothing schedule-like is readable, return {"entries":[]}.`
}

function ymdToUTC(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function utcToYMD(dt) {
  return dt.toISOString().slice(0, 10)
}

function validYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const dt = ymdToUTC(s)
  return !Number.isNaN(dt.getTime()) && utcToYMD(dt) === s
}

function normTime(s) {
  if (typeof s !== 'string') return null
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1]); const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

// Next date on or after `today` that falls on `weekday` — a timetable that
// only names days is read as "this coming week".
export function nextWeekday(today, weekday) {
  const target = WEEKDAYS.indexOf(String(weekday || '').toLowerCase().trim())
  if (target < 0) return null
  const start = ymdToUTC(today)
  const delta = (target - start.getUTCDay() + 7) % 7
  start.setUTCDate(start.getUTCDate() + delta)
  return utcToYMD(start)
}

// Raw model text → normalized entries, sorted by date then start time.
// Entries with no title or no resolvable date are dropped rather than
// guessed — an undated row would silently land on today. `past` marks rows
// dated before today so the preview can leave them unticked.
export function parseScanResponse(raw, today) {
  const match = String(raw || '').match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not read a schedule from that file')
  let parsed
  try { parsed = JSON.parse(match[0]) } catch { throw new Error('Could not read a schedule from that file') }
  const list = Array.isArray(parsed?.entries) ? parsed.entries : []
  const out = []
  for (const e of list) {
    const title = typeof e?.title === 'string' ? e.title.trim() : ''
    if (!title) continue
    const date = validYMD(e.date) ? e.date : nextWeekday(today, e.weekday)
    if (!date) continue
    const start = normTime(e.start)
    const end = start ? normTime(e.end) : null
    const location = typeof e?.location === 'string' && e.location.trim() ? e.location.trim() : null
    out.push({ title, date, start, end, location, past: date < today })
  }
  out.sort((a, b) => (a.date === b.date ? (a.start || '99').localeCompare(b.start || '99') : a.date.localeCompare(b.date)))
  return out
}

// Entry → the addTask() payload. Time and place ride in notes; `remindAt` is
// set only when asked AND the entry has a start time (a datetime-local
// string, the same shape the add form hands addTask).
export function entryToTask(entry, { remind = false } = {}) {
  const when = entry.start ? (entry.end ? `${entry.start}–${entry.end}` : entry.start) : null
  const notes = [when, entry.location].filter(Boolean).join(' · ')
  return {
    title: entry.title,
    dueDate: entry.date,
    notes: notes ? `${notes}\n\nFrom a scanned schedule.` : 'From a scanned schedule.',
    remindAt: remind && entry.start ? `${entry.date}T${entry.start}` : null,
  }
}
