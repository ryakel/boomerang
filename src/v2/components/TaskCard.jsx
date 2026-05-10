import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Check, Pencil, Moon, Monitor, Users, MapPin, Palette, Dumbbell, Zap, SkipForward } from 'lucide-react'
import {
  isStale, isSnoozed, isOverdue,
  formatSnoozeLabel, formatDueDate, daysOld, ENERGY_TYPES,
} from '../../store'
import WeatherBadge from './WeatherBadge'
import { useTerminalMode } from '../hooks/useTerminalMode'
import './TaskCard.css'

const ENERGY_ICONS = { Monitor, Users, MapPin, Palette, Dumbbell }

// Swipe tuning. v2 only supports swipe-left for action reveal — destructive
// actions stay in EditTaskModal with explicit confirm so the calm aesthetic
// holds. Swipe-right-to-delete from v1 isn't ported.
const SWIPE_THRESHOLD = 60       // px before we commit to revealing actions
const SWIPE_OPEN_OFFSET = -160   // resting position when actions are revealed; must match .v2-card-swipe-actions width
const SWIPE_VERT_CANCEL = 12     // px of vertical movement that cancels the swipe

function TaskCard({ task, expanded, onToggleExpand, onComplete, onEdit, onSnooze, onSkipAdvance, weatherByDate, selected, routineStreaks }) {
  const isTerminal = useTerminalMode()
  // Track a brief "completing" window so the checkbox can stay `[✓]` and
  // the row can fade out while still visible — without this the card
  // unmounts on the next render after onComplete and the user never sees
  // the checkmark land. ~350ms feels confirmatory without dragging.
  const [completing, setCompleting] = useState(false)
  const completeTimer = useRef(null)
  const completeWithFade = useCallback((taskId) => {
    if (completing) return
    setCompleting(true)
    // 700ms — long enough for the `[✓]` checkmark to register before the
    // card unmounts. Bumped from 350ms after user feedback that it was
    // too brief. Matches the CSS keyframe duration.
    completeTimer.current = setTimeout(() => onComplete(taskId), 700)
  }, [completing, onComplete])

  useEffect(() => () => {
    if (completeTimer.current) clearTimeout(completeTimer.current)
  }, [])
  const overdue = isOverdue(task)
  const stale = isStale(task)
  const snoozed = isSnoozed(task)
  // Status economy: only overdue + high-pri get a colored left border in v2.
  // Stale + low-pri move to inline meta / opacity treatment.
  const tone = overdue ? 'overdue' : (task.high_priority ? 'high-pri' : null)

  const energyType = ENERGY_TYPES.find(e => e.id === task.energy)
  const EnergyIcon = energyType ? ENERGY_ICONS[energyType.icon] : null
  const energyLevel = task.energyLevel || 1

  const meta = []
  if (task.due_date) meta.push(formatDueDate(task.due_date))
  if (snoozed) meta.push(formatSnoozeLabel(task.snoozed_until))
  if (stale && !snoozed) meta.push(`${daysOld(task)}d on list`)

  // Weather badge: only render if the task has a due_date that falls within
  // the cached forecast window (Open-Meteo gives 7 days). v1 lookup pattern
  // — same byDate map shape from useWeather().
  const weatherDay = task.due_date && weatherByDate ? weatherByDate[task.due_date] : null

  // Checklist preview — sum items across all checklists. Multi-list shape:
  // task.checklists = [{ id, name, items: [{ completed, text }], hideCompleted }]
  const checklists = Array.isArray(task.checklists) ? task.checklists : []
  const totalItems = checklists.reduce((n, cl) => n + (cl.items?.length || 0), 0)
  const checkedItems = checklists.reduce((n, cl) => n + (cl.items?.filter(i => i.completed).length || 0), 0)

  // Routine streak — only renders for routine-spawned tasks. The map is
  // computed once at AppV2 level and threaded down; missing key is fine
  // (one-off tasks). Currently CSS-gated to terminal mode; the markup
  // ships in every theme so flipping the gate later is a one-line change.
  const routineStreak = task.routine_id && routineStreaks ? routineStreaks[task.routine_id] : 0

  // First-line notes preview for the collapsed card. Trimmed + first
  // newline cut so a multi-line notes string renders as a single sentence.
  // CSS clamps to one line and hides this outside terminal mode.
  const notesPreview = task.notes
    ? task.notes.replace(/\s+/g, ' ').trim().slice(0, 140)
    : ''

  // Swipe state — kept local to TaskCard so each card swipes independently.
  const [swipeX, setSwipeX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [swipeOpen, setSwipeOpen] = useState(false)
  const touchStart = useRef(null)

  const closeSwipe = useCallback(() => {
    setSwipeOpen(false)
    setSwipeX(0)
  }, [])

  const handleTouchStart = useCallback((e) => {
    // Terminal mode replaces the swipe-action gesture with a tappable
    // `[ ]` checkbox + expanded action row. Bail early to keep the
    // gesture from stealing taps that should expand or check off.
    if (isTerminal) return
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY, startX: swipeX }
  }, [swipeX, isTerminal])

  const handleTouchMove = useCallback((e) => {
    if (isTerminal) return
    if (!touchStart.current) return
    const t = e.touches[0]
    const dx = t.clientX - touchStart.current.x
    const dy = t.clientY - touchStart.current.y
    // Vertical scroll wins — bail out of swipe.
    if (!swiping && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_VERT_CANCEL) {
      touchStart.current = null
      return
    }
    if (Math.abs(dx) > 8) {
      setSwiping(true)
      const next = touchStart.current.startX + dx
      // Clamp: only swipe-left (negative) opens the panel; rightward drags
      // close it but never go past 0.
      setSwipeX(Math.max(-160, Math.min(0, next)))
    }
  }, [swiping, isTerminal])

  const handleTouchEnd = useCallback(() => {
    if (!touchStart.current) { setSwiping(false); return }
    if (swipeX < -SWIPE_THRESHOLD) {
      setSwipeOpen(true)
      setSwipeX(SWIPE_OPEN_OFFSET)
    } else {
      closeSwipe()
    }
    touchStart.current = null
    setTimeout(() => setSwiping(false), 200)
  }, [swipeX, closeSwipe])

  const onMainClick = useCallback((e) => {
    if (swiping) return
    if (swipeOpen) { closeSwipe(); return }
    // Don't toggle when clicking inside the toolbar actions or the
    // swipe-revealed action panel.
    if (e.target.closest('.v2-card-actions, .v2-card-action, .v2-card-swipe-action')) return
    onToggleExpand(expanded ? null : task.id)
  }, [swiping, swipeOpen, closeSwipe, expanded, task.id, onToggleExpand])

  return (
    <div className="v2-card-swipe-wrap">
      {(swipeX < 0 || swipeOpen) && (
        <div className="v2-card-swipe-actions">
          <button
            className="v2-card-swipe-action v2-card-swipe-edit"
            onClick={(e) => { e.stopPropagation(); closeSwipe(); onEdit(task) }}
            aria-label="Edit"
          >
            <Pencil size={16} strokeWidth={1.75} />
            <span>Edit</span>
          </button>
          <button
            className="v2-card-swipe-action v2-card-swipe-done"
            onClick={(e) => { e.stopPropagation(); closeSwipe(); onComplete(task.id) }}
            aria-label="Done"
          >
            <Check size={16} strokeWidth={2} />
            <span>Done</span>
          </button>
        </div>
      )}
    <div
      data-task-id={task.id}
      className={[
        'v2-card',
        tone ? `v2-card-${tone}` : '',
        task.low_priority ? 'v2-card-faded' : '',
        expanded ? 'v2-card-expanded-state' : '',
        selected ? 'v2-card-selected' : '',
        completing ? 'v2-card-completing' : '',
      ].filter(Boolean).join(' ')}
      style={{
        transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
        transition: swiping ? 'none' : `transform var(--v2-dur-standard) var(--v2-ease-standard)`,
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <button type="button" className="v2-card-main" onClick={onMainClick}>
        <div className="v2-card-content">
          <div className="v2-card-title">
            {/* Clickable checkbox — visible in terminal mode only, hidden in
              * light/dark via CSS. Renders `[ ]` / `[!]` / `[*]` per the
              * task's overdue/high-pri state via ::before; tap toggles done.
              * Uses span+role=button so it can nest inside .v2-card-main
              * (which is already a <button>). */}
            <span
              role="button"
              tabIndex={0}
              className="v2-card-checkbox"
              aria-label={`Mark "${task.title}" done`}
              onClick={(e) => { e.stopPropagation(); completeWithFade(task.id) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  completeWithFade(task.id)
                }
              }}
            />
            {task.title}
            {totalItems > 0 && (
              <span className="v2-card-checklist-inline" aria-label={`${checkedItems} of ${totalItems} checklist items done`}>
                [{checkedItems}/{totalItems}]
              </span>
            )}
            {routineStreak > 0 && (
              <span className="v2-card-routine-streak" aria-label={`Routine streak: ${routineStreak}`}>
                🔥{routineStreak}
              </span>
            )}
          </div>
          {!expanded && notesPreview && (
            <div className="v2-card-notes-preview" aria-hidden="true">{notesPreview}</div>
          )}
          {(meta.length > 0 || weatherDay) && (
            <div className="v2-card-meta">
              {meta.map((m, i) => (
                <span key={i}>
                  {i > 0 && <span className="v2-card-meta-sep">·</span>}
                  {m}
                </span>
              ))}
              {weatherDay && (
                <>
                  {meta.length > 0 && <span className="v2-card-meta-sep">·</span>}
                  <WeatherBadge day={weatherDay} />
                </>
              )}
            </div>
          )}
        </div>
        {energyType && EnergyIcon && (
          <div className="v2-card-energy" title={`${energyType.label} · level ${energyLevel}`}>
            <EnergyIcon size={16} strokeWidth={1.75} color={energyType.color} />
            <span className="v2-card-energy-bolts">
              {Array.from({ length: energyLevel }).map((_, i) => (
                <Zap key={i} size={10} strokeWidth={2.25} fill={energyType.color} color={energyType.color} />
              ))}
            </span>
          </div>
        )}
      </button>

      {expanded && (
        <div className="v2-card-expanded">
          {task.notes && (
            <div className="v2-card-notes">{task.notes}</div>
          )}
          {totalItems > 0 && (
            <div className="v2-card-checklist-summary">
              {checkedItems} / {totalItems} done
            </div>
          )}
          <div className="v2-card-actions">
            <button
              className="v2-card-action v2-card-action-primary"
              onClick={() => onComplete(task.id)}
              aria-label="Mark done"
            >
              <Check size={16} strokeWidth={2} />
              <span>Done</span>
            </button>
            {/* Skip-advance — only on chain-step tasks (i.e., tasks with
              * queued follow_ups). Marks this step cancelled+skipped and
              * fires the next step in the chain anyway. Useful when the
              * user can't do this step but the rest of the cycle should
              * still proceed (e.g., "I forgot to clean the mop, but the
              * dirty-tank-empty step still needs to happen"). */}
            {Array.isArray(task.follow_ups) && task.follow_ups.length > 0 && onSkipAdvance && (
              <button
                className="v2-card-action v2-card-action-skip"
                onClick={() => onSkipAdvance(task)}
                aria-label={`Skip step and advance chain (${task.follow_ups.length} step${task.follow_ups.length === 1 ? '' : 's'} remaining)`}
                title="Skip step & advance chain"
              >
                <SkipForward size={16} strokeWidth={1.75} />
              </button>
            )}
            <button
              className="v2-card-action"
              onClick={() => onSnooze(task)}
              aria-label="Snooze"
            >
              <Moon size={16} strokeWidth={1.75} />
            </button>
            <button
              className="v2-card-action"
              onClick={() => onEdit(task)}
              aria-label="Edit"
            >
              <Pencil size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}

export default memo(TaskCard)
