import { useMemo, useState } from 'react'
import { ArrowLeft, Pencil, ChevronLeft, ChevronRight, Repeat2, Plus, FastForward, Check, AlertCircle } from 'lucide-react'
import MonthDots from './MonthDots'
import CycleChips from './CycleChips'
import { cycleWindows, habitWindows, cycleUnitLabel, cycleRally, loopGaps } from './cycles'
import { historyByDay } from './heatmapUtils'
import { formatCadence, formatScheduleAnchor } from '../store'
import './shell.css'

// Loop detail (K4): tapping a loop card lands HERE — rally / best / total
// stat cards, the cycle-chip trail, and a steppable month calendar — instead
// of dumping straight into the editor. Edit is a deliberate button.
export default function LoopDetail({ routine, color, spawnBlocked = false, tasks = [], onBack, onEdit, onSpawnNow, onSkipCycle, onMarkLoopDay, onSkipLoopDay }) {
  const [monthRef, setMonthRef] = useState(() => new Date())
  const [spawned, setSpawned] = useState(false)
  const [skipped, setSkipped] = useState(false)

  // Days needing attention (plan follow-up): unrecorded completions + missed
  // cycles, each fixable per-day (Mark done / Skip). Recomputed live so a row
  // disappears the instant it's resolved. (Hooks run before the null guard
  // below — rules-of-hooks; the helper no-ops for a null routine.)
  const gaps = useMemo(() => loopGaps(routine, tasks), [routine, tasks])
  const gapItems = useMemo(() => [
    ...gaps.unrecorded.map(g => ({ ...g, kind: 'unrecorded' })),
    ...gaps.missed.map(g => ({ ...g, kind: 'missed' })),
  ].sort((a, b) => b.day.localeCompare(a.day)), [gaps])

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
  const meta = (isHabit
    ? `habit · ${routine.target_count}× / ${routine.target_period}`
    : `${formatCadence(routine)}${anchor ? ` · ${anchor}` : ''}${routine.trigger_time ? ` · ${routine.trigger_time}` : ''}`)
    + (routine.assignee ? ` · for ${routine.assignee}` : '')

  const handleSpawn = () => {
    if (spawnBlocked) return
    onSpawnNow?.(routine.id)
    setSpawned(true)
    setTimeout(() => setSpawned(false), 1500)
  }
  const handleSkip = () => {
    onSkipCycle?.(routine.id)
    setSkipped(true)
    setTimeout(() => setSkipped(false), 1500)
  }

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

      {/* Quick actions (plan item 1) — Spawn now + Skip cycle, the tap-through
          twins of the Loops-card swipe. Habit loops are logged elsewhere, so
          they don't carry these. */}
      {!isHabit && (
        <div className="bm-loop-actions">
          <button
            className="bm-btn bm-loop-action-spawn"
            onClick={handleSpawn}
            disabled={spawnBlocked || spawned}
            title={spawnBlocked
              ? 'An instance is already on your list — finish or skip it first'
              : 'Create a one-off task now without affecting the schedule'}
          >
            {spawned ? <Check size={14} strokeWidth={2.4} /> : <Plus size={14} strokeWidth={2.4} />}
            {spawned ? 'Spawned' : spawnBlocked ? 'On list' : 'Spawn now'}
          </button>
          <button
            className="bm-btn bm-loop-action-skip"
            onClick={handleSkip}
            disabled={skipped}
            title="Skip this cycle — advance the schedule without spawning a task"
          >
            {skipped ? <Check size={14} strokeWidth={2.4} /> : <FastForward size={14} strokeWidth={2} />}
            {skipped ? 'Skipped' : 'Skip cycle'}
          </button>
        </div>
      )}

      {/* Needs attention — days the loop never recorded (you finished the task)
          and cycles you were due but missed. Mark done credits the cycle; Skip
          acknowledges it without crediting. Each row vanishes when resolved. */}
      {!isHabit && gapItems.length > 0 && (
        <div className="bm-card bm-loop-fix">
          <div className="bm-card-title">
            <span className="bm-loop-fix-icon"><AlertCircle size={15} strokeWidth={2.2} /></span>
            Needs attention
            <span className="bm-loop-fix-count">{gapItems.length}</span>
          </div>
          <p className="bm-loop-fix-hint">
            Mark a day done to credit the cycle, or skip it to move on without crediting.
          </p>
          <ul className="bm-loop-fix-list">
            {gapItems.map(g => (
              <li key={`${g.kind}-${g.key}`} className="bm-loop-fix-row">
                <span className="bm-loop-fix-day">
                  <span className="bm-loop-fix-date">{g.label}</span>
                  <span className={`bm-loop-fix-tag bm-loop-fix-tag-${g.kind}`}>
                    {g.kind === 'unrecorded' ? 'finished, not recorded' : 'missed'}
                  </span>
                </span>
                <span className="bm-loop-fix-acts">
                  <button
                    className="bm-loop-fix-btn bm-loop-fix-done"
                    onClick={() => onMarkLoopDay?.(routine.id, g.day, g.iso)}
                  ><Check size={13} strokeWidth={2.6} /> Mark done</button>
                  <button
                    className="bm-loop-fix-btn bm-loop-fix-skip"
                    onClick={() => onSkipLoopDay?.(routine.id, g.day)}
                  >Skip</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
