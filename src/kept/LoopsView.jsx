import { useEffect, useMemo, useState } from 'react'
import { Repeat2, Pencil, Sparkle } from 'lucide-react'
import FlightTrail from './FlightTrail'
import MonthDots from './MonthDots'
import DensityRibbon from './DensityRibbon'
import CycleChips from './CycleChips'
import { cycleWindows, habitWindows, cycleUnitLabel } from './cycles'
import { historyByDay, currentStreak } from '../wallaby/heatmapUtils'
import { routineFeathers } from './feathers'
import './shell.css'

const RANGES = [
  { id: 'trail', label: 'Trail' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
]

// Kept "Loops" — one card per loop carrying its Flight Trail / Month Dots /
// Density Ribbon (spec §6). Edit routes to the existing routine editor.
export default function LoopsView({ routines = [], onEditLoop, onAddLoop, onOpenSuggestions }) {
  const [range, setRange] = useState('trail')
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
      return { r, color: feathers[r.id], byDay, rally: currentStreak(byDay), total: r.completed_history?.length || 0 }
    })
  }, [routines])

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
      {loops.map(({ r, color, byDay, rally, total }) => (
        <div key={r.id} className="bm-card" style={{ '--loop': color }}>
          <div className="bm-card-title">
            <span className="bm-loop-ring" style={{ width: 28, height: 28 }}><Repeat2 size={13} strokeWidth={2.2} /></span>
            <button
              style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
              onClick={() => onEditLoop?.(r)}
            >{r.title}</button>
            {rally > 0 && <span className="bm-loop-rally" style={{ fontSize: 11.5 }}>↻ {rally}</span>}
            <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--bm-text-meta)' }}>{total}×</span>
            <button className="bm-back" style={{ width: 28, height: 28 }} onClick={() => onEditLoop?.(r)} aria-label="Edit loop">
              <Pencil size={13} strokeWidth={2} />
            </button>
          </div>
          {range === 'trail' && (() => {
            // Cadence-fit visuals (§13a): the day-grid only made sense for
            // multi-step dailies. Dailies get a compact 4-week mini trail;
            // habit loops get target-aware cycle chips; everything else gets
            // one chip per cadence window.
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
                  caption={`this ${periodWord} ${cur?.hits ?? 0}/${r.target_count} · target met ${met} of last ${past.length} ${periodWord}s`}
                />
              )
            }
            if (r.cadence === 'daily') {
              return <FlightTrail valueByDay={byDay} color={color} weeks={4} mini />
            }
            const wins = cycleWindows(r, 12)
            const past = wins.filter(w => !w.current)
            const caught = past.filter(w => w.caught).length
            const cur = wins[wins.length - 1]
            return (
              <CycleChips
                windows={wins}
                caption={past.length > 0
                  ? `caught ${caught} of last ${past.length} ${cycleUnitLabel(r)}${cur?.caught ? ' · this one ✓' : ''}`
                  : 'first cycle in flight'}
              />
            )
          })()}
          {range === 'month' && <MonthDots valueByDay={byDay} color={color} />}
          {range === 'year' && <DensityRibbon valueByDay={byDay} color={color} />}
        </div>
      ))}
    </div>
  )
}
