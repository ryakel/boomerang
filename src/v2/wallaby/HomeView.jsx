import { useMemo } from 'react'
import {
  Check, Flame, ChevronRight,
  Monitor, Users, MapPin, Palette, Dumbbell, Repeat,
} from 'lucide-react'
import { WALLABY_COLORS, historyByDay, currentStreak, localYMD } from './heatmapUtils'
import './HomeView.css'

const ENERGY_ICONS = { desk: Monitor, people: Users, errand: MapPin, creative: Palette, physical: Dumbbell }
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Wallaby "Home" — the daily agenda (loggd IMG_1582). Date hero + week strip,
// a streak-at-risk banner, and today's habits as checkable rows. "Checking" a
// habit toggles today's entry in its completed_history.
export default function HomeView({ routines = [], onToggleHabit, onOpenProfile }) {
  const today = new Date()
  const todayKey = localYMD(today)

  const habits = useMemo(() => routines.filter(r => !r.paused), [routines])

  const enriched = useMemo(() => habits.map((r, i) => {
    const byDay = historyByDay(r.completed_history)
    return {
      routine: r,
      color: WALLABY_COLORS[i % WALLABY_COLORS.length],
      doneToday: !!byDay[todayKey],
      streak: currentStreak(byDay),
      byDay,
    }
  }), [habits, todayKey])

  // Streak at risk: a live streak that hasn't been logged today yet.
  const atRisk = enriched.filter(h => !h.doneToday && h.streak > 0)

  // Week strip (Sunday-anchored) with activity dots.
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay()); weekStart.setHours(0, 0, 0, 0)
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i)
    const key = localYMD(d)
    return {
      key, dow: DOW[i], date: d.getDate(),
      isToday: key === todayKey,
      active: enriched.some(h => h.byDay[key]),
    }
  })

  return (
    <div className="wb-home">
      <header className="wb-home-head">
        <div className="wb-home-date">
          <span className="wb-home-daycircle">{today.getDate()}</span>
          <div className="wb-home-datetext">
            <span className="wb-home-weekday">{today.toLocaleDateString('en-US', { weekday: 'long' })}</span>
            <span className="wb-home-month">{today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          </div>
          {onOpenProfile && (
            <button className="wb-home-avatar" onClick={onOpenProfile} aria-label="Profile" />
          )}
        </div>
        <div className="wb-home-week">
          {week.map(d => (
            <div key={d.key} className={`wb-home-weekday-cell${d.isToday ? ' is-today' : ''}`}>
              <span className="wb-home-week-dow">{d.dow}</span>
              <span className="wb-home-week-date">{d.date}</span>
              <span className={`wb-home-week-dot${d.active ? ' is-active' : ''}`} />
            </div>
          ))}
        </div>
      </header>

      {atRisk.length > 0 && (
        <div className="wb-home-risk">
          <Flame size={16} strokeWidth={2.25} className="wb-home-risk-icon" />
          <span className="wb-home-risk-text">
            {atRisk.length} streak{atRisk.length === 1 ? '' : 's'} at risk: {atRisk.slice(0, 2).map(h => h.routine.title).join(', ')}
            {atRisk.length > 2 ? '…' : ''}
          </span>
          <ChevronRight size={16} strokeWidth={2} className="wb-home-risk-chev" />
        </div>
      )}

      <div className="wb-home-section-label">Habits <span className="wb-home-count">{habits.length}</span></div>

      <div className="wb-home-habits">
        {enriched.map(({ routine, color, doneToday, streak }) => {
          const Icon = ENERGY_ICONS[routine.energy] || Repeat
          return (
            <div key={routine.id} className={`wb-home-habit${doneToday ? ' is-done' : ''}`}>
              <span className="wb-home-habit-icon" style={{ color }}><Icon size={18} strokeWidth={2} /></span>
              <div className="wb-home-habit-text">
                <span className="wb-home-habit-title">{routine.title}</span>
                <span className="wb-home-habit-streak"><Flame size={12} strokeWidth={2.25} /> {streak} day{streak === 1 ? '' : 's'}</span>
              </div>
              <button
                className={`wb-home-check${doneToday ? ' is-done' : ''}`}
                style={doneToday ? { background: color, borderColor: color } : { borderColor: color }}
                onClick={() => onToggleHabit?.(routine)}
                aria-label={doneToday ? 'Mark not done' : 'Mark done'}
              >
                {doneToday && <Check size={18} strokeWidth={3} color="#fff" />}
              </button>
            </div>
          )
        })}
        {habits.length === 0 && <p className="wb-home-empty">No habits yet. Add routines to see them here.</p>}
      </div>
    </div>
  )
}
