import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react'
import './WeekStrip.css'

// 7-day calendar strip rendered above the task list. Each day cell shows
// day-of-week label + date number + an activity-intensity indicator
// (dot in light/dark, block in terminal mode) reflecting how many tasks
// were completed that day relative to `daily_task_goal`. Today's cell
// also shows the exact `count/goal` inline.
//
// Opt-in via the `show_week_strip` setting (always-on in terminal mode).
// The day cells are hidden by default — clicking the range label
// expands/collapses them. The `alwaysOpen` prop (driven by the
// `week_strip_always_open` setting) keeps them expanded permanently.
//
// Week navigation: < prev / next > arrows. Arrow clicks don't toggle
// expansion; they shift the visible week regardless of state.

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

export default function WeekStrip({ tasks, dailyTaskGoal, alwaysOpen = false }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [userExpanded, setUserExpanded] = useState(false)
  const expanded = alwaysOpen || userExpanded

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
        goal,
        intensity,
      })
    }
    return out
  }, [completionsByDate, weekOffset, dailyTaskGoal])

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

  const today = days.find(d => d.isToday)
  const canToggle = !alwaysOpen

  return (
    <div className={`v2-week-strip${expanded ? ' v2-week-strip-expanded' : ' v2-week-strip-collapsed'}`}>
      <div className="v2-week-strip-head">
        <button
          className="v2-week-strip-nav"
          onClick={() => setWeekOffset(o => o - 1)}
          aria-label="Previous week"
        >
          <ChevronLeft size={14} strokeWidth={2} />
        </button>
        {canToggle ? (
          <button
            className="v2-week-strip-range v2-week-strip-range-toggle"
            onClick={() => setUserExpanded(v => !v)}
            aria-expanded={expanded}
            aria-controls="v2-week-strip-days"
          >
            <span className="v2-week-strip-range-label">{rangeLabel}</span>
            {today && (
              <span className="v2-week-strip-range-today">· today {today.count}/{today.goal}</span>
            )}
            <ChevronDown
              size={12}
              strokeWidth={2}
              className={`v2-week-strip-range-chev${expanded ? ' v2-week-strip-range-chev-open' : ''}`}
            />
          </button>
        ) : (
          <span className="v2-week-strip-range">
            <span className="v2-week-strip-range-label">{rangeLabel}</span>
            {today && (
              <span className="v2-week-strip-range-today">· today {today.count}/{today.goal}</span>
            )}
          </span>
        )}
        <button
          className="v2-week-strip-nav"
          onClick={() => setWeekOffset(o => o + 1)}
          aria-label="Next week"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
      </div>
      {expanded && (
        <ol id="v2-week-strip-days" className="v2-week-strip-row">
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
              {d.isToday && (
                <span className="v2-week-strip-count">{d.count}/{d.goal}</span>
              )}
              <span className="v2-week-strip-bar" aria-hidden="true" />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
