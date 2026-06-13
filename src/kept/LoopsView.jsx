import { useEffect, useMemo, useState } from 'react'
import { Repeat2, Pencil, Sparkle } from 'lucide-react'
import MonthDots from './MonthDots'
import DensityRibbon from './DensityRibbon'
import CycleChips from './CycleChips'
import LoopDetail from './LoopDetail'
import LoopSwipe from './LoopSwipe'
import { cycleWindows, habitWindows, cycleUnitLabel, cycleRally } from './cycles'
import { historyByDay } from './heatmapUtils'
import { routineFeathers } from './feathers'
import './shell.css'

const RANGES = [
  { id: 'trail', label: 'Trail' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

// Kept "Loops" — one card per loop carrying its Flight Trail / Month Dots /
// Density Ribbon (spec §6). Edit routes to the existing routine editor.
export default function LoopsView({ routines = [], tasks = [], onEditLoop, onAddLoop, onSpawnNow, onSkipCycle, onOpenSuggestions }) {
  const [range, setRange] = useState('trail')
  // Tapping a card opens the loop DETAIL (K4) — stats + month calendar —
  // not the editor. Edit is a deliberate button on the detail page.
  const [detailId, setDetailId] = useState(null)
  // Pending pattern-scan suggestions — drives the dot badge on the
  // Suggestions button so a passive Sunday-scan find still waves at you.
  const [suggestionCount, setSuggestionCount] = useState(0)
  useEffect(() => {
    let alive = true
    fetch('/api/suggestions')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive && d) setSuggestionCount(d.count || 0) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  const loops = useMemo(() => {
    const feathers = routineFeathers(routines)
    return routines.filter(r => !r.paused).map(r => {
      const byDay = historyByDay(r.completed_history)
      const isHabit = r.spawn_mode === 'habit' && r.target_count
      const wins = isHabit ? habitWindows(r, 60) : cycleWindows(r, 60)
      // Rally in the loop's own cycles (consecutive weeks/months/etc caught),
      // not calendar days — day-streaks read as 1 forever on non-dailies.
      const { rally } = cycleRally(wins, isHabit ? r.target_count : 1)
      // Spawn is blocked while an instance is still active on the list (mirrors
      // the spawn guard in AppV2.handleSpawnLoop) — greys the swipe action.
      const hasActive = tasks.some(t =>
        t.routine_id === r.id && !['done', 'completed', 'cancelled'].includes(t.status),
      )
      return { r, color: feathers[r.id], byDay, rally, hasActive, total: r.completed_history?.length || 0 }
    })
  }, [routines, tasks])

  if (detailId) {
    const sel = loops.find(l => l.r.id === detailId)
    if (sel) {
      return (
        <LoopDetail
          routine={sel.r}
          color={sel.color}
          spawnBlocked={sel.hasActive}
          onBack={() => setDetailId(null)}
          onEdit={(r) => { setDetailId(null); onEditLoop?.(r) }}
          onSpawnNow={onSpawnNow}
          onSkipCycle={onSkipCycle}
        />
      )
    }
  }

  return (
    <div className="bm-surface">
      <div className="bm-title-row">
        <h1 className="bm-h1">Loops</h1>
        <button className="bm-btn bm-suggest-btn" onClick={onOpenSuggestions}>
          <Sparkle size={14} strokeWidth={2.1} /> Suggestions
          {suggestionCount > 0 && <span className="bm-suggest-dot" aria-label={`${suggestionCount} pending`} />}
        </button>
        <button className="bm-btn bm-btn-tonal" style={{ padding: '9px 14px' }} onClick={onAddLoop}>New loop</button>
      </div>
      <div className="bm-seg" role="tablist" aria-label="History range">
        {RANGES.map(m => (
          <button key={m.id} role="tab" aria-selected={range === m.id}
            className={`bm-seg-btn${range === m.id ? ' is-active' : ''}`}
            onClick={() => setRange(m.id)}>{m.label}</button>
        ))}
      </div>
      {loops.length === 0 && <p className="bm-empty">No loops yet — things that come back around live here.</p>}
      {loops.map(({ r, color, byDay, rally, total, hasActive }) => {
        const isHabit = r.spawn_mode === 'habit' && r.target_count
        const card = (
        <div className="bm-card" style={{ '--loop': color }}>
          <div className="bm-card-title">
            <span className="bm-loop-ring" style={{ width: 28, height: 28 }}><Repeat2 size={13} strokeWidth={2.2} /></span>
            <button
              style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              onClick={() => setDetailId(r.id)}
            >{r.title}</button>
            {rally > 0 && <span className="bm-loop-rally" style={{ fontSize: 11.5 }}>↻ {rally}</span>}
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--bm-text-meta)' }}>{total}×</span>
            <button className="bm-back" style={{ width: 28, height: 28 }} onClick={() => onEditLoop?.(r)} aria-label="Edit loop">
              <Pencil size={13} strokeWidth={2} />
            </button>
          </div>
          {range === 'trail' && (() => {
            // Cadence-fit visuals (§13a): ONE language for every card —
            // cycle chips. Dailies get one chip per day, habit loops get
            // target-aware chips, everything else one chip per cadence
            // window. (The daily mini-trail exception made the page speak
            // two visual languages at once — prod report 2026-06-11.)
            if (r.spawn_mode === 'habit' && r.target_count) {
              const wins = habitWindows(r, 12)
              const cur = wins[wins.length - 1]
              const past = wins.filter(w => !w.current)
              const met = past.filter(w => w.hits >= r.target_count).length
              const periodWord = r.target_period === 'month' ? 'month' : 'week'
              return (
                <CycleChips
                  windows={wins}
                  target={r.target_count}
                  caption={`this ${periodWord} ${cur?.hits ?? 0}/${r.target_count} · target met ${met} of last ${past.length} ${periodWord}${past.length === 1 ? '' : 's'}`}
                />
              )
            }
            const wins = cycleWindows(r, 12)
            const past = wins.filter(w => !w.current)
            const caught = past.filter(w => w.caught).length
            const cur = wins[wins.length - 1]
            const unit = cycleUnitLabel(r, past.length === 1)
            const nowWord = r.cadence === 'daily' ? 'today' : 'this one'
            return (
              <CycleChips
                windows={wins}
                caption={past.length > 0
                  ? `caught ${caught} of last ${past.length} ${unit}${cur?.caught ? ` · ${nowWord} ✓` : ''}`
                  : 'first cycle in flight'}
              />
            )
          })()}
          {range === 'month' && <MonthDots valueByDay={byDay} color={color} />}
          {range === 'year' && <DensityRibbon valueByDay={byDay} color={color} />}
        </div>
        )
        // Cadence loops get swipe-to-Spawn/Skip (plan item 1). Habit loops are
        // logged, not spawned/skipped (parity with the modal), so they render
        // as a plain card.
        return isHabit ? (
          <div key={r.id}>{card}</div>
        ) : (
          <LoopSwipe
            key={r.id}
            blocked={hasActive}
            onSpawn={() => onSpawnNow?.(r.id)}
            onSkip={() => onSkipCycle?.(r.id)}
          >{card}</LoopSwipe>
        )
      })}
    </div>
  )
}
