import { useMemo, useState } from 'react'
import {
  Check, Flame, ChevronRight, ChevronLeft,
  Monitor, Users, MapPin, Palette, Dumbbell, Repeat,
} from 'lucide-react'
import { WALLABY_COLORS, historyByDay, currentStreak, localYMD } from './heatmapUtils'
import './HomeView.css'

const ENERGY_ICONS = { desk: Monitor, people: Users, errand: MapPin, creative: Palette, physical: Dumbbell }
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']

// Wallaby "Home" — the daily "pulse". Tappable date + week strip: pick a day
// and the whole page (summary + tasks + habits) reflects that day. Today shows
// what's due/carrying; past days show what you did. "Checking" toggles the
// selected day's completion.
export default function HomeView({
  routines = [], tasks = [], labels = [],
  onToggleHabit, onCompleteTask, onOpenTask, onOpenProfile,
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayKey = localYMD(today)
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedKey, setSelectedKey] = useState(todayKey)
  const labelsById = useMemo(() => { const m = {}; for (const l of labels) m[l.id] = l; return m }, [labels])

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
  const isToday = selectedKey === todayKey

  // Tasks for the selected day: completed-that-day, plus (active) due-that-day —
  // and on today, anything carrying (due ≤ today). So each day shows its own work.
  const tasksForDay = useMemo(() => {
    return tasks.filter(t => {
      if (t.parent_id || t.gmail_pending) return false
      const dueKey = t.due_date ? String(t.due_date).slice(0, 10) : null
      const doneKey = (t.status === 'done' && t.completed_at) ? localYMD(new Date(t.completed_at)) : null
      if (doneKey === selectedKey) return true
      if (ACTIVE.includes(t.status)) return isToday ? (dueKey ? dueKey <= todayKey : false) : dueKey === selectedKey
      return false
    }).sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0))
  }, [tasks, selectedKey, todayKey, isToday])
  const tasksDone = tasksForDay.filter(t => t.status === 'done').length

  const habitsTotal = habits.length
  const habitsDone = enriched.filter(h => h.byDay[selectedKey]).length

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

      {/* Today's Pulse — the at-a-glance card (today only). */}
      {isToday && (
        <div className="wb-pulse">
          <div className="wb-pulse-title">Today's Pulse</div>
          {atRisk.length > 0 && (
            <div className="wb-pulse-row wb-pulse-risk">
              <Flame size={16} strokeWidth={2.25} />
              <span>{atRisk.length === 1 ? `${atRisk[0].routine.title} streak at risk` : `${atRisk.length} streaks at risk`}</span>
            </div>
          )}
          <div className="wb-pulse-row wb-pulse-habits">
            <span className="wb-pulse-dot" />
            <span>{habitsTotal - habitsDone} habit{habitsTotal - habitsDone === 1 ? '' : 's'} left <em>({habitsDone}/{habitsTotal} done)</em></span>
          </div>
          <div className="wb-pulse-row wb-pulse-tasks">
            <span className="wb-pulse-dot" />
            <span>{tasksForDay.length} task{tasksForDay.length === 1 ? '' : 's'} for today</span>
          </div>
        </div>
      )}

      {/* Tasks for the selected day */}
      <section className="wb-home-card">
        <div className="wb-home-card-head">
          <h2 className="wb-home-card-title">Tasks</h2>
          <span className="wb-home-card-count">{tasksDone}/{tasksForDay.length} done</span>
        </div>
        {tasksForDay.length === 0 ? (
          <p className="wb-home-empty-sm">{isToday ? 'Nothing due — enjoy it.' : 'No tasks that day.'}</p>
        ) : (
          <>
            {tasksForDay.length > 0 && (
              <div className="wb-home-progress"><div className="wb-home-progress-fill" style={{ width: `${Math.round((tasksDone / tasksForDay.length) * 100)}%` }} /></div>
            )}
            <ul className="wb-home-tasks">
              {tasksForDay.map(t => {
                const done = t.status === 'done'
                const overdue = !done && t.due_date && String(t.due_date).slice(0, 10) < todayKey
                const chips = (t.tags || []).map(id => labelsById[id]).filter(Boolean)
                return (
                  <li key={t.id} className="wb-home-task">
                    <button
                      className={`wb-home-taskcheck${done ? ' is-done' : ''}`}
                      onClick={() => onCompleteTask?.(t)}
                      aria-label={done ? 'Reopen' : 'Complete'}
                    >{done && <Check size={13} strokeWidth={3} color="#fff" />}</button>
                    <button className="wb-home-task-body" onClick={() => onOpenTask?.(t)}>
                      <span className={`wb-home-task-title${done ? ' is-done' : ''}`}>{t.title}</span>
                      {(overdue || chips.length > 0) && (
                        <span className="wb-home-task-meta">
                          {overdue && <span className="wb-home-task-overdue">overdue</span>}
                          {chips.slice(0, 2).map(l => <span key={l.id} className="wb-home-task-tag" style={{ '--tag': l.color }}>{l.name}</span>)}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>

      {/* Habits for the selected day */}
      <section className="wb-home-card">
        <div className="wb-home-card-head">
          <h2 className="wb-home-card-title">Habits</h2>
          <span className="wb-home-card-count">{habitsDone}/{habitsTotal} done</span>
        </div>
        <div className="wb-home-habits">
          {enriched.map(({ routine, color, byDay, streak }) => {
            const Icon = ENERGY_ICONS[routine.energy] || Repeat
            const doneSel = !!byDay[selectedKey]
            return (
              <div key={routine.id} className={`wb-home-habit${doneSel ? ' is-done' : ''}`}>
                <span className="wb-home-habit-icon" style={{ background: color }}><Icon size={16} strokeWidth={2} color="#fff" /></span>
                <span className="wb-home-habit-title">{routine.title}</span>
                {streak > 0 && <span className="wb-home-habit-streak"><Flame size={12} strokeWidth={2.25} /> {streak}</span>}
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
          {habits.length === 0 && <p className="wb-home-empty-sm">No habits yet.</p>}
        </div>
      </section>
    </div>
  )
}
