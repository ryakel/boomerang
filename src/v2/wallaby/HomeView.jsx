import { useMemo, useState } from 'react'
import {
  Check, Flame, ChevronRight, ChevronLeft,
  Monitor, Users, MapPin, Palette, Dumbbell, Repeat,
} from 'lucide-react'
import { WALLABY_COLORS, historyByDay, currentStreak, localYMD } from './heatmapUtils'
import './HomeView.css'

const ENERGY_ICONS = { desk: Monitor, people: Users, errand: MapPin, creative: Palette, physical: Dumbbell }
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Wallaby "Home" — the daily agenda (loggd IMG_1582). Tappable date + week
// strip: pick a day (or page weeks) and the habit rows reflect/toggle that
// day's completion. "Checking" toggles the selected day in completed_history.
export default function HomeView({ routines = [], onToggleHabit, onOpenProfile }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayKey = localYMD(today)
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedKey, setSelectedKey] = useState(todayKey)

  const habits = useMemo(() => routines.filter(r => !r.paused), [routines])
  const enriched = useMemo(() => habits.map((r, i) => {
    const byDay = historyByDay(r.completed_history)
    return { routine: r, color: WALLABY_COLORS[i % WALLABY_COLORS.length], byDay, streak: currentStreak(byDay) }
  }), [habits])

  // Streak at risk: a live streak not yet logged TODAY.
  const atRisk = enriched.filter(h => !h.byDay[todayKey] && h.streak > 0)

  // Week strip (Sunday-anchored), paged by weekOffset.
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() - today.getDay() + weekOffset * 7)
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart); d.setDate(weekStart.getDate() + i)
    const key = localYMD(d)
    return {
      key, dow: DOW[i], date: d.getDate(),
      isToday: key === todayKey,
      isSelected: key === selectedKey,
      isFuture: key > todayKey,
      active: enriched.some(h => h.byDay[key]),
    }
  })

  const selDate = new Date(`${selectedKey}T12:00:00`)
  const isFutureSel = selectedKey > todayKey

  return (
    <div className="wb-home">
      <header className="wb-home-head">
        <button
          className="wb-home-date"
          onClick={() => { setSelectedKey(todayKey); setWeekOffset(0) }}
          aria-label="Jump to today"
        >
          <span className={`wb-home-daycircle${selectedKey === todayKey ? '' : ' is-other'}`}>{selDate.getDate()}</span>
          <div className="wb-home-datetext">
            <span className="wb-home-weekday">{selDate.toLocaleDateString('en-US', { weekday: 'long' })}</span>
            <span className="wb-home-month">{selDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
          </div>
          {selectedKey !== todayKey && <span className="wb-home-todaypill">Today</span>}
        </button>
        <div className="wb-home-weekrow">
          <button className="wb-home-weeknav" onClick={() => setWeekOffset(o => o - 1)} aria-label="Previous week"><ChevronLeft size={18} strokeWidth={2.25} /></button>
          <div className="wb-home-week">
            {week.map(d => (
              <button
                key={d.key}
                className={`wb-home-weekday-cell${d.isSelected ? ' is-selected' : ''}${d.isToday ? ' is-today' : ''}${d.isFuture ? ' is-future' : ''}`}
                onClick={() => setSelectedKey(d.key)}
                disabled={d.isFuture}
              >
                <span className="wb-home-week-dow">{d.dow}</span>
                <span className="wb-home-week-date">{d.date}</span>
                <span className={`wb-home-week-dot${d.active ? ' is-active' : ''}`} />
              </button>
            ))}
          </div>
          <button className="wb-home-weeknav" onClick={() => setWeekOffset(o => Math.min(0, o + 1))} disabled={weekOffset >= 0} aria-label="Next week"><ChevronRight size={18} strokeWidth={2.25} /></button>
        </div>
        {onOpenProfile && <button className="wb-home-avatar" onClick={onOpenProfile} aria-label="Profile" />}
      </header>

      {atRisk.length > 0 && selectedKey === todayKey && (
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
        {enriched.map(({ routine, color, byDay, streak }) => {
          const Icon = ENERGY_ICONS[routine.energy] || Repeat
          const doneSel = !!byDay[selectedKey]
          return (
            <div key={routine.id} className={`wb-home-habit${doneSel ? ' is-done' : ''}`}>
              <span className="wb-home-habit-icon" style={{ color }}><Icon size={18} strokeWidth={2} /></span>
              <div className="wb-home-habit-text">
                <span className="wb-home-habit-title">{routine.title}</span>
                <span className="wb-home-habit-streak"><Flame size={12} strokeWidth={2.25} /> {streak} day{streak === 1 ? '' : 's'}</span>
              </div>
              <button
                className={`wb-home-check${doneSel ? ' is-done' : ''}`}
                style={doneSel ? { background: color, borderColor: color } : { borderColor: color }}
                onClick={() => !isFutureSel && onToggleHabit?.(routine, selectedKey)}
                disabled={isFutureSel}
                aria-label={doneSel ? 'Mark not done' : 'Mark done'}
              >
                {doneSel && <Check size={18} strokeWidth={3} color="#fff" />}
              </button>
            </div>
          )
        })}
        {habits.length === 0 && <p className="wb-home-empty">No habits yet. Add routines to see them here.</p>}
      </div>
    </div>
  )
}
