import { useState } from 'react'
import { ArrowLeft, Pencil, ChevronLeft, ChevronRight, Repeat2 } from 'lucide-react'
import MonthDots from './MonthDots'
import CycleChips from './CycleChips'
import { cycleWindows, habitWindows, cycleUnitLabel, cycleRally } from './cycles'
import { historyByDay } from '../wallaby/heatmapUtils'
import { formatCadence, formatScheduleAnchor } from '../store'
import './shell.css'

// Loop detail (K4): tapping a loop card lands HERE — rally / best / total
// stat cards, the cycle-chip trail, and a steppable month calendar — instead
// of dumping straight into the editor. Edit is a deliberate button.
export default function LoopDetail({ routine, color, onBack, onEdit }) {
  const [monthRef, setMonthRef] = useState(() => new Date())
  if (!routine) return null

  const byDay = historyByDay(routine.completed_history)
  const total = routine.completed_history?.length || 0
  const isHabit = routine.spawn_mode === 'habit' && routine.target_count

  // Rally/best are measured in the loop's own CYCLES, not calendar days —
  // a weekly loop's rally is consecutive weeks caught. Deep window set so
  // best isn't artificially capped by the visible chip count.
  const deepWins = isHabit ? habitWindows(routine, 60) : cycleWindows(routine, 60)
  const { rally, best } = cycleRally(deepWins, isHabit ? routine.target_count : 1)
  const wins = deepWins.slice(-16)
  const past = wins.filter(w => !w.current)
  const target = isHabit ? routine.target_count : 1
  const met = past.filter(w => w.hits >= target).length
  const unit = isHabit
    ? (routine.target_period === 'month' ? 'months' : 'weeks')
    : cycleUnitLabel(routine, past.length === 1)

  const anchor = formatScheduleAnchor(routine)
  const meta = isHabit
    ? `habit · ${routine.target_count}× / ${routine.target_period}`
    : `${formatCadence(routine)}${anchor ? ` · ${anchor}` : ''}${routine.trigger_time ? ` · ${routine.trigger_time}` : ''}`

  const stepMonth = (dir) => {
    setMonthRef(m => new Date(m.getFullYear(), m.getMonth() + dir, 1))
  }
  const monthLabel = monthRef.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div className="bm-surface bm-loop-detail" style={{ '--loop': color }}>
      <div className="bm-title-row">
        <button className="bm-back" onClick={onBack} aria-label="Back to loops">
          <ArrowLeft size={17} strokeWidth={2.2} />
        </button>
        <h1 className="bm-h1 bm-detail-title">{routine.title}</h1>
        <button className="bm-btn bm-btn-tonal" style={{ marginLeft: 'auto', padding: '9px 14px' }} onClick={() => onEdit?.(routine)}>
          <Pencil size={13} strokeWidth={2.2} /> Edit
        </button>
      </div>
      <div className="bm-detail-meta">
        <span className="bm-loop-ring" style={{ width: 24, height: 24 }}><Repeat2 size={12} strokeWidth={2.2} /></span>
        {meta}{routine.paused ? ' · paused' : ''}
      </div>

      <div className="bm-stat-row">
        <div className="bm-stat-card">
          <div className="bm-stat-num">↻ {rally}</div>
          <div className="bm-stat-cap">rally</div>
        </div>
        <div className="bm-stat-card">
          <div className="bm-stat-num">{best}</div>
          <div className="bm-stat-cap">best</div>
        </div>
        <div className="bm-stat-card">
          <div className="bm-stat-num">{total}×</div>
          <div className="bm-stat-cap">lifetime</div>
        </div>
      </div>

      <div className="bm-card">
        <div className="bm-card-title">Recent cycles</div>
        <CycleChips
          windows={wins}
          target={target}
          caption={past.length > 0
            ? `${isHabit ? 'target met' : 'caught'} ${met} of last ${past.length} ${unit}`
            : 'first cycle in flight'}
        />
      </div>

      <div className="bm-card">
        <div className="bm-card-title bm-month-head">
          <button className="bm-back" style={{ width: 26, height: 26 }} onClick={() => stepMonth(-1)} aria-label="Previous month">
            <ChevronLeft size={14} strokeWidth={2.2} />
          </button>
          <span style={{ flex: '1 1 auto', textAlign: 'center' }}>{monthLabel}</span>
          <button className="bm-back" style={{ width: 26, height: 26 }} onClick={() => stepMonth(1)} aria-label="Next month">
            <ChevronRight size={14} strokeWidth={2.2} />
          </button>
        </div>
        <MonthDots monthRef={monthRef} valueByDay={byDay} color={color} />
      </div>
    </div>
  )
}
