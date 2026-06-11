import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { localYMD, addDays } from '../dates'
import { loadSettings } from '../store'
import { calculateTaskPoints } from '../scoring'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function weekStartSunday(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

// Tap-the-hero-stats breakdown (parity with v2's WeekStrip detail): a
// Sunday-anchored week of day chips with activity intensity, and the
// selected day's caught tasks with per-task points. Selection is OWNED BY
// THE PARENT (TodayView) so the hero arc + counts can follow it.
export default function WeekBreakdown({ tasks = [], selected, onSelect }) {
  const todayKey = localYMD()
  const [offset, setOffset] = useState(0)
  const settings = loadSettings()
  const eggs = settings.easter_egg_wins || {}
  const goal = settings.daily_task_goal > 0 ? settings.daily_task_goal : 3

  const completionsByDay = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      const ts = t.status === 'done' && t.completed_at ? t.completed_at
        : t.status === 'waiting' && t.waiting_at ? t.waiting_at
        : null
      if (!ts) continue
      const key = localYMD(new Date(ts))
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    return map
  }, [tasks])

  const days = useMemo(() => {
    const start = weekStartSunday(new Date())
    start.setDate(start.getDate() + offset * 7)
    const out = []
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i)
      const key = localYMD(d)
      const count = (completionsByDay[key] || []).length + (eggs[key] ? 1 : 0)
      out.push({
        key,
        label: DAY_LABELS[d.getDay()],
        dayNumber: d.getDate(),
        isToday: key === todayKey,
        isFuture: key > todayKey,
        count,
        intensity: count === 0 ? 0 : count < goal ? 1 : count < goal * 2 ? 2 : 3,
      })
    }
    return out
  }, [completionsByDay, offset, todayKey, goal]) // eslint-disable-line react-hooks/exhaustive-deps

  const rangeLabel = useMemo(() => {
    const start = weekStartSunday(new Date())
    start.setDate(start.getDate() + offset * 7)
    const end = addDays(start, 6)
    const sm = start.toLocaleString('en', { month: 'short' })
    const em = end.toLocaleString('en', { month: 'short' })
    return sm === em
      ? `${sm} ${start.getDate()}–${end.getDate()}`
      : `${sm} ${start.getDate()}–${em} ${end.getDate()}`
  }, [offset])

  const items = useMemo(() => {
    if (!selected) return []
    const out = (completionsByDay[selected] || [])
      .map(t => ({ id: t.id, title: t.title, points: calculateTaskPoints(t) }))
    if (eggs[selected]) out.push({ id: '__egg__', title: 'Daily Bonus', points: 1 })
    return out
  }, [selected, completionsByDay]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bm-week">
      <div className="bm-week-head">
        <button className="bm-week-nav" onClick={() => setOffset(o => o - 1)} aria-label="Previous week">
          <ChevronLeft size={14} strokeWidth={2.2} />
        </button>
        <span className="bm-week-range">{rangeLabel}</span>
        <button className="bm-week-nav" onClick={() => setOffset(o => o + 1)} aria-label="Next week">
          <ChevronRight size={14} strokeWidth={2.2} />
        </button>
      </div>
      <div className="bm-week-row">
        {days.map(d => (
          <button
            key={d.key}
            className={[
              'bm-week-day',
              d.isToday ? 'is-today' : '',
              d.isFuture ? 'is-future' : '',
              selected === d.key ? 'is-selected' : '',
              `i${d.intensity}`,
            ].filter(Boolean).join(' ')}
            onClick={() => onSelect?.(selected === d.key ? null : d.key)}
            aria-expanded={selected === d.key}
            aria-label={`${d.label} ${d.dayNumber}: ${d.count} ${d.count === 1 ? 'catch' : 'catches'}`}
          >
            <span className="bm-week-label">{d.label.slice(0, 1)}</span>
            <span className="bm-week-num">{d.dayNumber}</span>
            <span className="bm-week-bar" aria-hidden="true" />
          </button>
        ))}
      </div>
      {selected && (
        <div className="bm-week-detail">
          {items.length === 0 ? (
            <div className="bm-week-empty">Nothing caught this day</div>
          ) : (
            <>
              <div className="bm-week-summary">
                {items.length} {items.length === 1 ? 'catch' : 'catches'} · {items.reduce((s, t) => s + t.points, 0)} pts
              </div>
              {items.map(t => (
                <div key={t.id} className="bm-week-item">
                  <span className="bm-week-item-title">✓ {t.title}</span>
                  <span className="bm-week-item-pts">{t.points} pts</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
