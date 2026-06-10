import { useMemo, useState } from 'react'
import {
  Plus, Flame, ChevronLeft, ChevronRight, ArrowLeft, Pencil, Check, Archive, Trash2,
  Monitor, Users, MapPin, Palette, Dumbbell, Repeat,
} from 'lucide-react'
import ContributionHeatmap from './ContributionHeatmap'
import {
  routineColors, historyByDay, currentStreak, longestStreak, localYMD,
} from './heatmapUtils'
import './HabitsView.css'

const ENERGY_ICONS = { desk: Monitor, people: Users, errand: MapPin, creative: Palette, physical: Dumbbell }
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const MODES = [
  { id: 'single', label: 'Single' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

// Wallaby "Habits" surface — Boomerang routines as loggd-style habit cards.
// Per-habit color + a contribution grid from completed_history. Single (rolling
// heatmap) / Month (calendar) / Year (full-year heatmap). Tapping a card opens
// the habit detail + month-calendar (loggd IMG_1586).
export default function HabitsView({
  routines = [], onAdd, onClose,
  onEditHabit, onArchiveHabit, onDeleteHabit,
}) {
  const [mode, setMode] = useState('single')
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedId, setSelectedId] = useState(null)

  const habits = useMemo(() => routines.filter(r => !r.paused), [routines])
  // Shared color identity — same rule as HomeView/ProfileView (full-list index).
  const colorById = useMemo(() => routineColors(routines), [routines])
  const colorOf = (r) => colorById[r.id]

  const monthRef = useMemo(() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + monthOffset); d.setHours(0, 0, 0, 0)
    return d
  }, [monthOffset])

  const selected = habits.find(h => h.id === selectedId)
  if (selected) {
    return (
      <HabitDetail
        routine={selected}
        color={colorOf(selected)}
        onBack={() => setSelectedId(null)}
        onEdit={onEditHabit}
        onArchive={(r) => { onArchiveHabit?.(r); setSelectedId(null) }}
        onDelete={(r) => { onDeleteHabit?.(r); setSelectedId(null) }}
      />
    )
  }

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
        {habits.map(r => (
          <HabitCard
            key={r.id}
            routine={r}
            color={colorOf(r)}
            mode={mode}
            monthRef={monthRef}
            onOpen={() => setSelectedId(r.id)}
          />
        ))}
      </div>

      <button className="wb-fab wb-fab-habits" onClick={onAdd} aria-label="New habit">
        <Plus size={26} strokeWidth={2.5} />
      </button>
    </div>
  )
}

function HabitCard({ routine, color, mode, monthRef, onOpen }) {
  const Icon = ENERGY_ICONS[routine.energy] || Repeat
  const valueByDay = useMemo(() => historyByDay(routine.completed_history), [routine.completed_history])
  const total = routine.completed_history?.length || 0
  const streak = useMemo(() => currentStreak(valueByDay), [valueByDay])

  return (
    <article className="wb-card wb-card-tappable" style={{ '--habit': color }} onClick={onOpen}>
      <div className="wb-card-head">
        <span className="wb-card-icon" style={{ background: color }}>
          <Icon size={16} strokeWidth={2} color="var(--wb-on-action)" />
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
          <ContributionHeatmap valueByDay={valueByDay} color={color} weeks={26} gap={3} showMonths />
        </div>
      )}
      {mode === 'year' && (
        <div className="wb-card-body">
          <ContributionHeatmap valueByDay={valueByDay} color={color} weeks={53} gap={2} showMonths />
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
    const startPad = (first.getDay() + 6) % 7
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

// ── Habit detail + month calendar (loggd IMG_1586) ─────────────────────────
function HabitDetail({ routine, color, onBack, onEdit, onArchive, onDelete }) {
  const [monthOffset, setMonthOffset] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const Icon = ENERGY_ICONS[routine.energy] || Repeat
  const valueByDay = useMemo(() => historyByDay(routine.completed_history), [routine.completed_history])
  const total = routine.completed_history?.length || 0
  const streak = useMemo(() => currentStreak(valueByDay), [valueByDay])
  const best = useMemo(() => longestStreak(valueByDay), [valueByDay])
  const doneToday = !!valueByDay[localYMD(new Date())]
  const cadence = routine.cadence ? routine.cadence[0].toUpperCase() + routine.cadence.slice(1) : 'Routine'

  const monthRef = useMemo(() => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + monthOffset); d.setHours(0, 0, 0, 0)
    return d
  }, [monthOffset])

  const monthStats = useMemo(() => {
    const first = new Date(monthRef)
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    let done = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(first.getFullYear(), first.getMonth(), d)
      if (valueByDay[localYMD(day)]) done++
    }
    return { done, pct: Math.round((done / daysInMonth) * 100) }
  }, [monthRef, valueByDay])

  return (
    <div className="wb-habits wb-habit-detail">
      <header className="wb-habits-head">
        <div className="wb-habits-titlerow">
          <button className="wb-back" onClick={onBack} aria-label="Back"><ArrowLeft size={20} strokeWidth={2.25} /></button>
          <h1 className="wb-habits-title wb-hd-title">{routine.title}</h1>
          {onEdit && (
            <button className="wb-back" onClick={() => onEdit(routine)} aria-label="Edit habit"><Pencil size={17} strokeWidth={2} /></button>
          )}
        </div>
      </header>

      <div className="wb-hd-body">
        <div className="wb-hd-id">
          <span className="wb-hd-icon" style={{ background: color }}><Icon size={18} strokeWidth={2} color="var(--wb-on-action)" /></span>
          <span className="wb-hd-cadence" style={{ color }}>{cadence}</span>
        </div>
        {routine.notes && <p className="wb-hd-desc">{routine.notes}</p>}

        <div className="wb-hd-stats">
          <div className="wb-hd-stat"><span className="wb-hd-stat-v" style={{ color }}><Flame size={16} strokeWidth={2.25} /> {streak}</span><span className="wb-hd-stat-l">Streak</span></div>
          <div className="wb-hd-stat"><span className="wb-hd-stat-v">{best}</span><span className="wb-hd-stat-l">Best</span></div>
          <div className="wb-hd-stat"><span className="wb-hd-stat-v">{total}</span><span className="wb-hd-stat-l">Total</span></div>
        </div>

        <div className={`wb-hd-today${doneToday ? ' is-done' : ''}`}>
          {doneToday ? <><Check size={15} strokeWidth={2.5} /> Done today</> : 'Not logged today'}
        </div>

        <div className="wb-hd-cal">
          <div className="wb-stepper">
            <button className="wb-stepper-btn" onClick={() => setMonthOffset(o => o - 1)} aria-label="Previous month"><ChevronLeft size={18} strokeWidth={2.25} /></button>
            <span className="wb-stepper-label">{monthRef.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
            <button className="wb-stepper-btn" onClick={() => setMonthOffset(o => Math.min(0, o + 1))} disabled={monthOffset >= 0} aria-label="Next month"><ChevronRight size={18} strokeWidth={2.25} /></button>
          </div>
          <MonthGrid monthRef={monthRef} valueByDay={valueByDay} color={color} />
          <div className="wb-hd-cal-foot">
            <span>{monthStats.done} day{monthStats.done === 1 ? '' : 's'} completed</span>
            <span className="wb-hd-cal-pct" style={{ color }}>{monthStats.pct}%</span>
          </div>
        </div>

        <div className="wb-hd-actions">
          {onArchive && (
            <button className="wb-btn wb-btn-secondary" onClick={() => onArchive(routine)}><Archive size={15} strokeWidth={2} /> Archive</button>
          )}
          {confirmDelete ? (
            <div className="wb-confirm">
              <span>Delete this habit?</span>
              <button className="wb-btn wb-btn-delete-solid" onClick={() => onDelete?.(routine)}>Delete</button>
              <button className="wb-btn wb-btn-ghost" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </div>
          ) : (
            <button className="wb-btn wb-btn-delete" onClick={() => setConfirmDelete(true)}><Trash2 size={15} strokeWidth={2} /> Delete habit</button>
          )}
        </div>
      </div>
    </div>
  )
}
