import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import './WeekStrip.css'

// 7-day calendar strip rendered above the task list. Each day cell shows
// day-of-week label + date number + an activity-intensity indicator
// (dot in light/dark, block in terminal mode) reflecting how many tasks
// were completed that day relative to `daily_task_goal`.
//
// Opt-in via the `show_week_strip` setting. Theme-aware visuals: rounded
// card cells in light/dark; bare monospace strip with `*` today marker
// + block-character intensity in terminal mode (CSS-only difference).
//
// Tap a day = no-op for v1. Hook reserved for future "filter list to
// that day" or "jump to that day" interactions.
//
// Week navigation: < prev / next > arrows on the edges. State managed
// locally — defaults to the week containing today; arrow clicks shift
// the offset by ±7 days.

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ymd(date) {
  return date.toISOString().slice(0, 10)
}

function startOfWeekSunday(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

export default function WeekStrip({ tasks, dailyTaskGoal }) {
  const [weekOffset, setWeekOffset] = useState(0)

  // Pre-bucket task completions by ISO date. Cheap; runs on every tasks
  // change, but the list is bounded and the bucket is just a count.
  const completionsByDate = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      if (t.status !== 'done' || !t.completed_at) continue
      const key = ymd(new Date(t.completed_at))
      map[key] = (map[key] || 0) + 1
    }
    return map
  }, [tasks])

  const days = useMemo(() => {
    const start = startOfWeekSunday(new Date())
    start.setDate(start.getDate() + weekOffset * 7)
    const todayKey = ymd(new Date())
    const out = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      const key = ymd(d)
      const count = completionsByDate[key] || 0
      const goal = dailyTaskGoal > 0 ? dailyTaskGoal : 3
      // Intensity: 0 = no completions, 1 = some, 2 = met goal, 3 = exceeded
      let intensity = 0
      if (count > 0 && count < goal) intensity = 1
      else if (count >= goal && count < goal * 2) intensity = 2
      else if (count >= goal * 2) intensity = 3
      out.push({
        date: d,
        key,
        label: DAY_LABELS[d.getDay()],
        dayNumber: d.getDate(),
        isToday: key === todayKey,
        isFuture: d > new Date(),
        count,
        intensity,
      })
    }
    return out
  }, [completionsByDate, weekOffset, dailyTaskGoal])

  // Range label — "May 4–10" or "Apr 27–May 3" if straddling a month.
  const rangeLabel = useMemo(() => {
    const first = days[0].date
    const last = days[6].date
    const firstMonth = first.toLocaleString('en', { month: 'short' })
    const lastMonth = last.toLocaleString('en', { month: 'short' })
    if (firstMonth === lastMonth) {
      return `${firstMonth} ${first.getDate()}–${last.getDate()}`
    }
    return `${firstMonth} ${first.getDate()}–${lastMonth} ${last.getDate()}`
  }, [days])

  return (
    <div className="v2-week-strip">
      <div className="v2-week-strip-head">
        <button
          className="v2-week-strip-nav"
          onClick={() => setWeekOffset(o => o - 1)}
          aria-label="Previous week"
        >
          <ChevronLeft size={14} strokeWidth={2} />
        </button>
        <span className="v2-week-strip-range">{rangeLabel}</span>
        <button
          className="v2-week-strip-nav"
          onClick={() => setWeekOffset(o => o + 1)}
          aria-label="Next week"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
      </div>
      <ol className="v2-week-strip-row">
        {days.map(d => (
          <li
            key={d.key}
            className={[
              'v2-week-strip-day',
              d.isToday ? 'v2-week-strip-day-today' : '',
              d.isFuture ? 'v2-week-strip-day-future' : '',
              `v2-week-strip-day-i${d.intensity}`,
            ].filter(Boolean).join(' ')}
            aria-label={`${d.label} ${d.dayNumber}: ${d.count} task${d.count === 1 ? '' : 's'} completed`}
          >
            <span className="v2-week-strip-label">{d.label}</span>
            <span className="v2-week-strip-num">{d.dayNumber}</span>
            <span className="v2-week-strip-bar" aria-hidden="true" />
          </li>
        ))}
      </ol>
    </div>
  )
}
