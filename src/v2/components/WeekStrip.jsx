import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { localYMD } from '../../store'
import { calculateTaskPoints } from '../../scoring'
import './WeekStrip.css'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ymd = localYMD

function startOfWeekSunday(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

export default function WeekStrip({ tasks, dailyTaskGoal, easterEggWins }) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(null)

  const completionsByDate = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      if (t.status === 'done' && t.completed_at) {
        const key = ymd(new Date(t.completed_at))
        if (!map[key]) map[key] = []
        map[key].push(t)
      } else if (t.status === 'waiting' && t.waiting_at) {
        const key = ymd(new Date(t.waiting_at))
        if (!map[key]) map[key] = []
        map[key].push(t)
      }
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
      const dayTasks = completionsByDate[key] || []
      const eggBonus = easterEggWins?.[key] ? 1 : 0
      const count = dayTasks.length + eggBonus
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
  }, [completionsByDate, weekOffset, dailyTaskGoal, easterEggWins])

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

  const selectedTasks = useMemo(() => {
    if (!selectedDate) return null
    const dayTasks = completionsByDate[selectedDate] || []
    const items = dayTasks.map(t => ({ id: t.id, title: t.title, points: calculateTaskPoints(t) }))
    if (easterEggWins?.[selectedDate]) {
      items.push({ id: '__egg__', title: 'Daily Bonus', points: 1 })
    }
    return items
  }, [selectedDate, completionsByDate, easterEggWins])

  return (
    <div className="v2-week-strip">
      <div className="v2-week-strip-head">
        <button
          className="v2-week-strip-nav"
          onClick={() => { setWeekOffset(o => o - 1); setSelectedDate(null) }}
          aria-label="Previous week"
        >
          <ChevronLeft size={14} strokeWidth={2} />
        </button>
        <span className="v2-week-strip-range">
          <span className="v2-week-strip-range-label">{rangeLabel}</span>
        </span>
        <button
          className="v2-week-strip-nav"
          onClick={() => { setWeekOffset(o => o + 1); setSelectedDate(null) }}
          aria-label="Next week"
        >
          <ChevronRight size={14} strokeWidth={2} />
        </button>
      </div>
      <ol id="v2-week-strip-days" className="v2-week-strip-row">
        {days.map(d => (
          <li
            key={d.key}
            className={[
              'v2-week-strip-day',
              d.isToday ? 'v2-week-strip-day-today' : '',
              d.isFuture ? 'v2-week-strip-day-future' : '',
              selectedDate === d.key ? 'v2-week-strip-day-selected' : '',
              `v2-week-strip-day-i${d.intensity}`,
            ].filter(Boolean).join(' ')}
            aria-label={`${d.label} ${d.dayNumber}: ${d.count} task${d.count === 1 ? '' : 's'} completed`}
          >
            <button
              type="button"
              className="v2-week-strip-day-btn"
              onClick={() => setSelectedDate(prev => prev === d.key ? null : d.key)}
              aria-expanded={selectedDate === d.key}
            >
              <span className="v2-week-strip-label">{d.label}</span>
              <span className="v2-week-strip-num">{d.dayNumber}</span>
              {d.isToday && (
                <span className="v2-week-strip-count">{d.count}/{d.goal}</span>
              )}
              <span className="v2-week-strip-bar" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
      {selectedDate && selectedTasks && (
        <div className="v2-week-strip-detail">
          {selectedTasks.length === 0 ? (
            <div className="v2-week-strip-detail-empty">No tasks completed</div>
          ) : (
            <>
              <div className="v2-week-strip-detail-summary">
                {selectedTasks.length} task{selectedTasks.length === 1 ? '' : 's'} · {selectedTasks.reduce((s, t) => s + t.points, 0)} pts
              </div>
              {selectedTasks.map(t => (
                <div key={t.id} className="v2-week-strip-detail-item">
                  <span className="v2-week-strip-detail-title">✓ {t.title}</span>
                  <span className="v2-week-strip-detail-pts">{t.points} pts</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
