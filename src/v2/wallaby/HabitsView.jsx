import { useMemo, useState } from 'react'
import {
  Plus, Flame, ChevronLeft, ChevronRight, ArrowLeft,
  Monitor, Users, MapPin, Palette, Dumbbell, Repeat,
} from 'lucide-react'
import ContributionHeatmap from './ContributionHeatmap'
import {
  WALLABY_COLORS, historyByDay, currentStreak,
  weekStart, addDays, fmtMonthDay, localYMD,
} from './heatmapUtils'
import './HabitsView.css'

const ENERGY_ICONS = { desk: Monitor, people: Users, errand: MapPin, creative: Palette, physical: Dumbbell }
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MODES = [
  { id: 'single', label: 'Single' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
]

// Wallaby "Habits" surface — Boomerang routines rendered as loggd-style habit
// cards. Each routine gets a stable per-habit color and a GitHub contribution
// grid built from its completed_history. Three views: Single (full heatmap),
// Week (7 day-cells with a date stepper), Month (calendar grid).
export default function HabitsView({ routines = [], onAdd, onClose }) {
  const [mode, setMode] = useState('single')
  const [weekOffset, setWeekOffset] = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)

  const habits = useMemo(() => routines.filter(r => !r.paused), [routines])

  const wkStart = weekStart(new Date(), weekOffset)
  const wkEnd = addDays(wkStart, 6)

  const monthRef = useMemo(() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + monthOffset); d.setHours(0, 0, 0, 0)
    return d
  }, [monthOffset])

  return (
    <div className="wb-habits">
      <header className="wb-habits-head">
        <div className="wb-habits-titlerow">
          {onClose && (
            <button className="wb-back" onClick={onClose} aria-label="Back">
              <ArrowLeft size={20} strokeWidth={2.25} />
            </button>
          )}
          <h1 className="wb-habits-title">Habits</h1>
          <div className="wb-seg" role="tablist" aria-label="Heatmap range">
            {MODES.map(m => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                className={`wb-seg-btn${mode === m.id ? ' is-active' : ''}`}
                onClick={() => setMode(m.id)}
              >{m.label}</button>
            ))}
          </div>
        </div>

        {mode === 'week' && (
          <div className="wb-stepper">
            <button className="wb-stepper-btn" onClick={() => setWeekOffset(o => o - 1)} aria-label="Previous week">
              <ChevronLeft size={18} strokeWidth={2.25} />
            </button>
            <span className="wb-stepper-label">{fmtMonthDay(wkStart)} – {fmtMonthDay(wkEnd)}, {wkEnd.getFullYear()}</span>
            <button
              className="wb-stepper-btn"
              onClick={() => setWeekOffset(o => Math.min(0, o + 1))}
              disabled={weekOffset >= 0}
              aria-label="Next week"
            >
              <ChevronRight size={18} strokeWidth={2.25} />
            </button>
          </div>
        )}
        {mode === 'month' && (
          <div className="wb-stepper">
            <button className="wb-stepper-btn" onClick={() => setMonthOffset(o => o - 1)} aria-label="Previous month">
              <ChevronLeft size={18} strokeWidth={2.25} />
            </button>
            <span className="wb-stepper-label">
              {monthRef.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <button
              className="wb-stepper-btn"
              onClick={() => setMonthOffset(o => Math.min(0, o + 1))}
              disabled={monthOffset >= 0}
              aria-label="Next month"
            >
              <ChevronRight size={18} strokeWidth={2.25} />
            </button>
          </div>
        )}
      </header>

      <div className="wb-habits-list">
        {habits.map((r, i) => (
          <HabitCard
            key={r.id}
            routine={r}
            color={WALLABY_COLORS[i % WALLABY_COLORS.length]}
            mode={mode}
            wkStart={wkStart}
            monthRef={monthRef}
          />
        ))}
      </div>

      <button className="wb-fab wb-fab-habits" onClick={onAdd} aria-label="New habit">
        <Plus size={26} strokeWidth={2.5} />
      </button>
    </div>
  )
}

function HabitCard({ routine, color, mode, wkStart, monthRef }) {
  const Icon = ENERGY_ICONS[routine.energy] || Repeat
  const valueByDay = useMemo(() => historyByDay(routine.completed_history), [routine.completed_history])
  const total = routine.completed_history?.length || 0
  const streak = useMemo(() => currentStreak(valueByDay), [valueByDay])

  return (
    <article className="wb-card" style={{ '--habit': color }}>
      <div className="wb-card-head">
        <span className="wb-card-icon" style={{ background: color }}>
          <Icon size={16} strokeWidth={2} color="#fff" />
        </span>
        <span className="wb-card-title">{routine.title}</span>
        <span className="wb-card-stats">
          {streak > 0 && (
            <span className="wb-stat wb-stat-streak"><Flame size={12} strokeWidth={2.25} /> {streak}</span>
          )}
          <span className="wb-stat wb-stat-total">{total}×</span>
        </span>
      </div>

      {mode === 'single' && (
        <div className="wb-card-body">
          <ContributionHeatmap valueByDay={valueByDay} color={color} weeks={22} cellSize={13} gap={3} />
        </div>
      )}

      {mode === 'week' && (
        <div className="wb-week">
          {Array.from({ length: 7 }, (_, i) => {
            const day = addDays(wkStart, i)
            const key = localYMD(day)
            const done = (valueByDay[key] || 0) > 0
            const isToday = key === localYMD(new Date())
            return (
              <div key={key} className={`wb-week-day${isToday ? ' is-today' : ''}`}>
                <span className="wb-week-dow">{DOW[i]}</span>
                <span
                  className={`wb-week-cell${done ? ' is-done' : ''}`}
                  style={done ? { background: color, borderColor: color } : undefined}
                >{day.getDate()}</span>
              </div>
            )
          })}
        </div>
      )}

      {mode === 'month' && (
        <MonthGrid monthRef={monthRef} valueByDay={valueByDay} color={color} />
      )}
    </article>
  )
}

function MonthGrid({ monthRef, valueByDay, color }) {
  const cells = useMemo(() => {
    const first = new Date(monthRef)
    const startPad = (first.getDay() + 6) % 7 // Monday-anchored leading blanks
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const out = []
    for (let i = 0; i < startPad; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(first.getFullYear(), first.getMonth(), d)
      out.push({ d, key: localYMD(day), done: (valueByDay[localYMD(day)] || 0) > 0 })
    }
    return out
  }, [monthRef, valueByDay])

  return (
    <div className="wb-month">
      {DOW.map((d, i) => <span key={`h${i}`} className="wb-month-dow">{d}</span>)}
      {cells.map((c, i) => c === null
        ? <span key={`b${i}`} className="wb-month-cell wb-month-cell-blank" />
        : (
          <span
            key={c.key}
            className={`wb-month-cell${c.done ? ' is-done' : ''}`}
            style={c.done ? { background: color, borderColor: color } : undefined}
          >{c.d}</span>
        ))}
    </div>
  )
}
