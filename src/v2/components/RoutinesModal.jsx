import { useState, useEffect } from 'react'
import { Plus, Play, Pause, Pencil, Trash2, RotateCw, FastForward, X, ChevronUp, ChevronDown, Check, Flame } from 'lucide-react'
import { loadLabels, loadSettings, RECURRENCE_OPTIONS, formatCadence, formatScheduleAnchor, getNextDueDate, computeHabitStats, localYMD } from '../../store'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import ChainReconcileModal from './ChainReconcileModal'
import SectionLabel from './SectionLabel'
import './RoutinesModal.css'

const DAY_OF_WEEK_OPTIONS = [
  { value: '', label: 'Any day' },
  { value: '0', label: 'Sun' },
  { value: '1', label: 'Mon' },
  { value: '2', label: 'Tue' },
  { value: '3', label: 'Wed' },
  { value: '4', label: 'Thu' },
  { value: '5', label: 'Fri' },
  { value: '6', label: 'Sat' },
]

// Local YYYY-MM-DD for a Date (used by the "Last done" picker).
function ymdLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatNextDue(routine) {
  const endedOrExpired = routine.end_date && new Date() > new Date(routine.end_date + 'T23:59:59')
  if (routine.paused) return 'paused'
  if (endedOrExpired) return 'ended'
  const nextDue = getNextDueDate(routine)
  if (nextDue <= new Date()) return 'due now'
  return `next ${nextDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

function formatLastDone(routine) {
  if (!routine.completed_history?.length) return 'never done'
  const last = new Date(routine.completed_history[routine.completed_history.length - 1])
  const now = new Date()
  const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate())
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today - lastDay) / 86400000)
  if (days === 0) return 'done today'
  if (days === 1) return 'done yesterday'
  return `done ${days}d ago`
}

function RoutineRow({ routine, tasks, expanded, onToggleExpand, onSpawnNow, onLogHabit, onSkipCycle, onEdit, onTogglePause, onDelete, hasActiveTask }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 'idle' | 'spawned' — local tap feedback so the user sees a check icon
  // immediately on tap. Reverts after 1500ms. Blocked state (an instance is
  // already active) is rendered straight from `hasActiveTask` and is sticky;
  // no time-based reversion since the underlying condition isn't transient.
  const [spawnState, setSpawnState] = useState('idle')
  const [logState, setLogState] = useState('idle')
  useEffect(() => { if (!expanded) setConfirmDelete(false) }, [expanded])

  const isHabit = routine.spawn_mode === 'habit'
  const weekStartsOn = loadSettings()?.week_starts_on ?? 1
  const habitStats = isHabit ? computeHabitStats(routine, tasks, weekStartsOn) : null

  const cadenceLabel = isHabit && habitStats
    ? `habit · ${habitStats.target}× / ${routine.target_period}`
    : formatCadence(routine)
  const anchorLabel = !isHabit ? formatScheduleAnchor(routine) : ''
  const dayOfWeek = anchorLabel ? ` · ${anchorLabel}` : ''
  const triggerLabel = !isHabit && routine.trigger_time
    ? ` · ${formatClock(routine.trigger_time)}`
    : ''
  const memberCount = Array.isArray(routine.members) ? routine.members.length : 0
  const stackLabel = memberCount > 0 ? ` · ${memberCount} items` : ''
  const completeCount = routine.completed_history?.length || 0

  const handleSpawn = () => {
    if (hasActiveTask) return  // button is disabled in this state, but defensive
    onSpawnNow(routine.id)
    setSpawnState('spawned')
    setTimeout(() => setSpawnState('idle'), 1500)
  }
  const handleLog = () => {
    onLogHabit?.(routine.id)
    setLogState('logged')
    setTimeout(() => setLogState('idle'), 1500)
  }

  return (
    <li className={`v2-routine-row${expanded ? ' v2-routine-row-expanded' : ''}${routine.paused ? ' v2-routine-row-paused' : ''}${isHabit ? ' v2-routine-row-habit' : ''}`}>
      <button className="v2-routine-summary" onClick={onToggleExpand}>
        <span className="v2-routine-title">{routine.title}</span>
        <span className="v2-routine-cadence">
          {cadenceLabel}{dayOfWeek}{triggerLabel}{stackLabel}
          {isHabit && habitStats && (
            <>
              {' · '}
              <span className={habitStats.behind_pace ? 'v2-habit-progress v2-habit-progress-behind' : 'v2-habit-progress'}>
                {habitStats.completions}/{habitStats.target}
                {habitStats.target_period === 'week' ? ' this week' : ' this month'}
              </span>
              {habitStats.streak > 0 && (
                <span className="v2-habit-streak"> · <Flame size={11} strokeWidth={1.75} /> {habitStats.streak}</span>
              )}
            </>
          )}
        </span>
      </button>
      {expanded && (
        <div className="v2-routine-detail">
          <div className="v2-routine-meta">
            {isHabit ? (
              <>
                <span>
                  {habitStats?.completions || 0} of {habitStats?.target || routine.target_count} this {routine.target_period}
                </span>
                <span className="v2-routine-meta-sep">·</span>
                <span>streak: {habitStats?.streak || 0}</span>
                <span className="v2-routine-meta-sep">·</span>
                <span>{completeCount}× lifetime</span>
              </>
            ) : (
              <>
                <span>{formatLastDone(routine)}</span>
                <span className="v2-routine-meta-sep">·</span>
                <span>{formatNextDue(routine)}</span>
                <span className="v2-routine-meta-sep">·</span>
                <span>{completeCount}× completed</span>
              </>
            )}
          </div>
          {routine.notes && (
            <div className="v2-routine-notes">{routine.notes}</div>
          )}
          <div className="v2-routine-actions">
            {isHabit ? (
              <button
                className={`v2-routine-action v2-routine-action-primary${logState === 'logged' ? ' v2-routine-action-spawn-spawned' : ''}`}
                onClick={handleLog}
                disabled={logState !== 'idle'}
                title="Log a completion of this habit right now (creates a done task linked to this routine)"
              >
                {logState === 'logged' ? (
                  <><Check size={14} strokeWidth={2} /> Logged</>
                ) : (
                  <><Plus size={14} strokeWidth={2} /> Log it</>
                )}
              </button>
            ) : (
              <button
                className={`v2-routine-action v2-routine-action-primary${
                  spawnState === 'spawned' ? ' v2-routine-action-spawn-spawned' : ''
                }${hasActiveTask ? ' v2-routine-action-spawn-blocked' : ''}`}
                onClick={handleSpawn}
                disabled={spawnState !== 'idle' || hasActiveTask}
                title={hasActiveTask
                  ? "An instance is already on your list — finish or skip it before spawning another"
                  : "Create a one-off task now without affecting the schedule"}
              >
                {spawnState === 'spawned' ? (
                  <><Check size={14} strokeWidth={2} /> Spawned</>
                ) : hasActiveTask ? (
                  <>Already on list</>
                ) : (
                  <><Plus size={14} strokeWidth={2} /> Spawn now</>
                )}
              </button>
            )}
            {!routine.paused && !isHabit && (
              <button className="v2-routine-action" onClick={() => onSkipCycle(routine.id)} title="Skip this cycle (advance schedule, no task)">
                <FastForward size={14} strokeWidth={1.75} /> Skip cycle
              </button>
            )}
            <button className="v2-routine-action" onClick={() => onEdit(routine)}>
              <Pencil size={14} strokeWidth={1.75} /> Edit
            </button>
            <button className="v2-routine-action" onClick={() => onTogglePause(routine.id)}>
              {routine.paused
                ? <><Play size={14} strokeWidth={1.75} /> Resume</>
                : <><Pause size={14} strokeWidth={1.75} /> Pause</>}
            </button>
            {!confirmDelete ? (
              <button className="v2-routine-action v2-routine-action-danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={14} strokeWidth={1.75} /> Delete
              </button>
            ) : (
              <>
                <span className="v2-routine-confirm-label">Delete?</span>
                <button
                  className="v2-routine-action v2-routine-action-confirm-yes"
                  onClick={() => { onDelete(routine.id); setConfirmDelete(false) }}
                >
                  Yes
                </button>
                <button className="v2-routine-action" onClick={() => setConfirmDelete(false)}>No</button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

// Convert offset_minutes back to a {value, unit} pair for display. We pick
// the largest unit that produces an integer to avoid awkward decimals like
// "0.5 d" when the user typed "12 h".
function offsetToDisplay(minutes) {
  const m = Math.max(0, Number(minutes) || 0)
  if (m === 0) return { value: 0, unit: 'min' }
  if (m % 1440 === 0) return { value: m / 1440, unit: 'd' }
  if (m % 60 === 0) return { value: m / 60, unit: 'h' }
  return { value: m, unit: 'min' }
}
function displayToOffsetMinutes(value, unit) {
  const v = Math.max(0, Number(value) || 0)
  if (unit === 'd') return v * 1440
  if (unit === 'h') return v * 60
  return v
}

// Format an 'HH:MM' 24h string as a compact 12-hour label, e.g. '20:00' → '8pm',
// '06:30' → '6:30am'. Returns '' for empty/invalid input.
function formatClock(hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const period = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12}${period}` : `${h12}:${String(m).padStart(2, '0')}${period}`
}

function FollowUpStepRow({ step, index, isFirst, isLast, onChange, onRemove, onMoveUp, onMoveDown }) {
  const display = offsetToDisplay(step.offset_minutes)
  const [unit, setUnit] = useState(display.unit)
  const [valueDraft, setValueDraft] = useState(String(display.value))
  // A step is timed either by a relative offset (after the previous step
  // completes) or an absolute clock time. at_time presence selects the mode.
  const mode = step.at_time ? 'at' : 'offset'

  const commitValue = (raw, nextUnit = unit) => {
    const minutes = displayToOffsetMinutes(raw, nextUnit)
    onChange({ offset_minutes: minutes })
  }
  const setMode = (m) => {
    if (m === 'at') onChange({ at_time: step.at_time || '20:00' })
    else onChange({ at_time: '', at_next_day: false })
  }

  return (
    <li className="v2-followups-step">
      <div className="v2-followups-step-head">
        <span className="v2-followups-step-num">{index + 1}</span>
        <input
          className="v2-form-input v2-followups-step-title"
          type="text"
          placeholder="Step title"
          value={step.title}
          onChange={e => onChange({ title: e.target.value })}
        />
        <button
          type="button"
          className="v2-followups-step-icon"
          onClick={onRemove}
          aria-label="Remove step"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>
      <div className="v2-followups-step-body">
        <select
          className="v2-form-input v2-followups-step-mode"
          value={mode}
          onChange={e => setMode(e.target.value)}
          aria-label="Step timing mode"
        >
          <option value="offset">After prev</option>
          <option value="at">At time</option>
        </select>
        {mode === 'offset' ? (
          <>
            <input
              className="v2-form-input v2-followups-step-value"
              type="number"
              min="0"
              step={unit === 'min' ? '1' : '0.25'}
              value={valueDraft}
              onChange={e => {
                setValueDraft(e.target.value)
                commitValue(e.target.value)
              }}
            />
            <select
              className="v2-form-input v2-followups-step-unit"
              value={unit}
              onChange={e => {
                setUnit(e.target.value)
                commitValue(valueDraft, e.target.value)
              }}
            >
              <option value="min">min</option>
              <option value="h">hr</option>
              <option value="d">day</option>
            </select>
          </>
        ) : (
          <>
            <input
              className="v2-form-input v2-followups-step-attime"
              type="time"
              value={step.at_time || ''}
              onChange={e => onChange({ at_time: e.target.value })}
              aria-label="At clock time"
            />
            <label className="v2-followups-step-nextday">
              <input
                type="checkbox"
                checked={!!step.at_next_day}
                onChange={e => onChange({ at_next_day: e.target.checked })}
              />
              next day
            </label>
          </>
        )}
        <span className="v2-followups-step-spacer" />
        <button
          type="button"
          className="v2-followups-step-icon"
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label="Move up"
        >
          <ChevronUp size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          className="v2-followups-step-icon"
          onClick={onMoveDown}
          disabled={isLast}
          aria-label="Move down"
        >
          <ChevronDown size={14} strokeWidth={1.75} />
        </button>
      </div>
    </li>
  )
}

function RoutineForm({ initial, onSave, onCancel }) {
  const isNew = !initial
  const [title, setTitle] = useState(initial?.title || '')
  const [cadence, setCadence] = useState(initial?.cadence || 'weekly')
  const [customDays, setCustomDays] = useState(initial?.custom_days || 14)
  // 'days' | 'months'. Pre-migration custom routines have no unit
  // saved — default to 'days' which preserves their original behavior.
  const [customUnit, setCustomUnit] = useState(initial?.custom_unit || 'days')
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(
    initial?.schedule_day_of_week == null ? '' : String(initial.schedule_day_of_week)
  )
  // Month-scale anchor (monthly / quarterly / annually / custom-months):
  // 'creation' = the routine's creation day-of-month (default fallback),
  // 'dom' = a fixed calendar day ("the 18th"),
  // 'dow' = an ordinal weekday ("1st Monday", "last Friday").
  const [monthMode, setMonthMode] = useState(
    initial?.schedule_day_of_month != null ? 'dom'
      : initial?.schedule_week_of_month != null ? 'dow'
      : 'creation'
  )
  const [dayOfMonth, setDayOfMonth] = useState(initial?.schedule_day_of_month || 1)
  const [weekOfMonth, setWeekOfMonth] = useState(
    initial?.schedule_week_of_month != null ? String(initial.schedule_week_of_month) : '1'
  )
  // Optional 'HH:MM' surface-at time. '' = any time. Spawned tasks are snoozed
  // until this clock time on their due day (don't show or nag before it).
  const [triggerTime, setTriggerTime] = useState(initial?.trigger_time || '')
  const [selectedTags, setSelectedTags] = useState(initial?.tags || [])
  const [notes, setNotes] = useState(initial?.notes || '')
  const [highPriority, setHighPriority] = useState(initial?.high_priority || false)
  const [endDate, setEndDate] = useState(initial?.end_date || '')
  const [autoRoll, setAutoRoll] = useState(initial?.auto_roll || false)
  const [spawnMode, setSpawnMode] = useState(initial?.spawn_mode || 'auto')
  const [targetCount, setTargetCount] = useState(initial?.target_count || 2)
  const [targetPeriod, setTargetPeriod] = useState(initial?.target_period || 'week')
  const [followUps, setFollowUps] = useState(() =>
    Array.isArray(initial?.follow_ups) ? initial.follow_ups.map(s => ({ ...s })) : []
  )
  // Stack members. Non-empty ⇒ this routine fans out into one independent task
  // per member each cycle (vs follow_ups, a dependent chain). Clearing every
  // member of a cycle pays a 20% bonus. Shape:
  // { id, title, energy_type?, energy_level?, notes?, tags? }
  const [members, setMembers] = useState(() =>
    Array.isArray(initial?.members) ? initial.members.map(m => ({ ...m })) : []
  )
  // "Last done" override — lets the user set when the routine was last completed,
  // which drives getNextDueDate. Essential for repairing routines whose
  // completed_history was lost (e.g. a DB wipe) and now fire as if never done.
  // '' = never done. Initialized from the most-recent completion.
  const initialLastDone = initial?.completed_history?.length
    ? ymdLocal(new Date(initial.completed_history[initial.completed_history.length - 1]))
    : ''
  const [lastDone, setLastDone] = useState(initialLastDone)
  const isHabit = spawnMode === 'habit'

  const labels = loadLabels()
  const today = localYMD()
  const parsedDay = scheduleDayOfWeek === '' ? null : parseInt(scheduleDayOfWeek, 10)
  const isMonthScale = cadence === 'monthly' || cadence === 'quarterly'
    || cadence === 'annually' || (cadence === 'custom' && customUnit === 'months')

  // Resolve the three anchor fields the store/db expect from the current form
  // mode. Weekly uses the weekday "On" dropdown; month-scale uses monthMode.
  let outDayOfWeek = parsedDay
  let outDayOfMonth = null
  let outWeekOfMonth = null
  if (isMonthScale) {
    if (monthMode === 'dom') {
      outDayOfMonth = Math.min(Math.max(Number(dayOfMonth) || 1, 1), 31)
      outDayOfWeek = null
    } else if (monthMode === 'dow') {
      outWeekOfMonth = Number(weekOfMonth)
      outDayOfWeek = parsedDay == null ? 1 : parsedDay // need a concrete weekday
    } else {
      outDayOfWeek = null // 'creation' fallback
    }
  } else if (cadence !== 'weekly') {
    // daily / custom-days don't use a weekday anchor in the new model.
    if (cadence === 'daily') outDayOfWeek = null
  }

  const toggleTag = (id) => {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  // Follow-ups editor helpers. Step shape:
  // { id, title, offset_minutes, energy_type?, energy_level?, notes? }
  // For PR1 the editor only exposes title + offset (value + unit). Energy and
  // notes can be added later; missing fields fall back to AI inference on
  // spawn (size_inferred=false, background hook fills them in).
  const addStep = () => {
    setFollowUps(prev => [...prev, {
      id: crypto.randomUUID(),
      title: '',
      offset_minutes: 30,
    }])
  }
  const updateStep = (id, patch) => {
    setFollowUps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  const removeStep = (id) => {
    setFollowUps(prev => prev.filter(s => s.id !== id))
  }
  const moveStep = (id, dir) => {
    setFollowUps(prev => {
      const idx = prev.findIndex(s => s.id === id)
      if (idx < 0) return prev
      const next = idx + dir
      if (next < 0 || next >= prev.length) return prev
      const copy = prev.slice()
      ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
      return copy
    })
  }

  // Stack-member editor helpers (independent items, no offset/ordering meaning).
  const addMember = () => {
    setMembers(prev => [...prev, { id: crypto.randomUUID(), title: '' }])
  }
  const updateMember = (id, patch) => {
    setMembers(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
  }
  const removeMember = (id) => {
    setMembers(prev => prev.filter(m => m.id !== id))
  }
  // Strip empty rows + drop blank optional fields, matching the follow-up clean.
  const cleanMembers = () => members
    .filter(m => m.title?.trim())
    .map(m => ({
      id: m.id,
      title: m.title.trim(),
      ...(m.energy_type ? { energy_type: m.energy_type } : {}),
      ...(m.energy_level ? { energy_level: m.energy_level } : {}),
      ...(m.notes?.trim() ? { notes: m.notes.trim() } : {}),
    }))

  // Sequences PR 4. When the user finishes editing the chain and clicks
  // Save, we look for *title* changes against the original (the only kind
  // of edit that propagates linguistically). If we find any AND the chain
  // is large enough to be worth scanning (2+ steps), we pause the save
  // flow inside `pendingSave` and pop the reconcile modal — the modal
  // calls `commitSave(finalChain)` once the user picks Apply / Skip.
  // Empty / single-step / pure-offset edits skip the gate entirely.
  const [pendingSave, setPendingSave] = useState(null)

  // Build the updated completed_history when the user changed the "Last done"
  // date. Returns undefined when unchanged (so the save path leaves history
  // untouched). Sets the most-recent entry to the chosen date (or appends one
  // if there were none); clearing the field drops the most-recent entry. Time
  // is pinned to local noon so the date can't drift across timezones.
  const resolveCompletedHistory = () => {
    if (lastDone === initialLastDone) return undefined
    const base = Array.isArray(initial?.completed_history) ? initial.completed_history.slice() : []
    if (!lastDone) {
      base.pop()
      return base
    }
    const iso = new Date(`${lastDone}T12:00:00`).toISOString()
    if (base.length > 0) base[base.length - 1] = iso
    else base.push(iso)
    return base
  }

  const buildSavePayload = (followUpsArray) => ({
    title: title.trim(),
    cadence,
    customDays: cadence === 'custom' ? Number(customDays) : null,
    customUnit: cadence === 'custom' ? customUnit : null,
    tags: selectedTags,
    notes: notes.trim(),
    highPriority,
    endDate: endDate || null,
    scheduleDayOfWeek: outDayOfWeek,
    scheduleDayOfMonth: outDayOfMonth,
    scheduleWeekOfMonth: outWeekOfMonth,
    triggerTime: triggerTime || null,
    completedHistory: resolveCompletedHistory(),
    followUps: followUpsArray,
    members: cleanMembers(),
    autoRoll: isHabit ? false : autoRoll,
    spawnMode,
    targetCount: isHabit ? Math.max(1, Number(targetCount) || 1) : null,
    targetPeriod: isHabit ? targetPeriod : null,
  })

  const handleSave = () => {
    if (!title.trim()) return
    const cleanFollowUps = followUps
      .filter(s => s.title?.trim())
      .map(s => ({
        id: s.id,
        title: s.title.trim(),
        // A step is either absolute-clock-time (at_time, optionally next day)
        // or relative-offset — never both. at_time wins when present.
        ...(s.at_time
          ? { at_time: s.at_time, ...(s.at_next_day ? { at_next_day: true } : {}) }
          : { offset_minutes: Math.max(0, Number(s.offset_minutes) || 0) }),
        ...(s.energy_type ? { energy_type: s.energy_type } : {}),
        ...(s.energy_level ? { energy_level: s.energy_level } : {}),
        ...(s.notes?.trim() ? { notes: s.notes.trim() } : {}),
      }))
    const originalFollowUps = Array.isArray(initial?.follow_ups) ? initial.follow_ups : []
    // Detect title-level changes only — offset / notes / energy edits are
    // mechanical and don't usually need linguistic propagation.
    const titleEdits = cleanFollowUps.filter(cur => {
      const orig = originalFollowUps.find(o => o.id === cur.id)
      return orig && orig.title !== cur.title
    })
    const additions = cleanFollowUps.filter(cur => !originalFollowUps.find(o => o.id === cur.id))
    const removals = originalFollowUps.filter(orig => !cleanFollowUps.find(c => c.id === orig.id))
    // Only reconcile when there's a pre-existing chain to compare against.
    // Drafting a brand-new chain doesn't need a "scan for inconsistencies"
    // pass — the user is writing it fresh, not patching it.
    const isExistingChain = originalFollowUps.length > 0
    const shouldReconcile =
      isExistingChain &&
      cleanFollowUps.length >= 2 &&
      (titleEdits.length + additions.length + removals.length) > 0
    if (shouldReconcile) {
      setPendingSave({ originalChain: originalFollowUps, currentChain: cleanFollowUps })
      return
    }
    onSave(buildSavePayload(cleanFollowUps))
  }

  const commitSave = (finalChain) => {
    onSave(buildSavePayload(finalChain))
    setPendingSave(null)
  }
  const cancelReconcile = () => {
    setPendingSave(null)
  }

  return (
    <div className="v2-routine-form">
      <button type="button" className="v2-routine-back" onClick={onCancel}>← Back to routines</button>

      <input
        className="v2-form-input v2-form-title"
        placeholder={isHabit ? "What habit?" : "What recurring task?"}
        value={title}
        onChange={e => setTitle(e.target.value)}
      />

      <div className="v2-form-section">
        <label className="v2-form-label">Mode</label>
        <div className="v2-form-section-hint">
          <strong>Auto</strong> spawns a task on a cadence (daily, weekly, etc.). <strong>Habit</strong> tracks a target frequency (e.g. 2× / week) without locking it to specific days — you log proactively or get a gentle behind-pace nudge.
        </div>
        <div className="v2-form-segmented v2-form-mode-segmented">
          <button
            type="button"
            className={`v2-form-seg${!isHabit ? ' v2-form-seg-active' : ''}`}
            onClick={() => setSpawnMode('auto')}
          >
            Auto (cadence)
          </button>
          <button
            type="button"
            className={`v2-form-seg${isHabit ? ' v2-form-seg-active' : ''}`}
            onClick={() => setSpawnMode('habit')}
          >
            Habit (target frequency)
          </button>
        </div>
      </div>

      {!isHabit && (
        <>
          <div className="v2-form-row">
            <div className="v2-form-field">
              <label className="v2-form-label">Frequency</label>
              <select
                className="v2-form-input"
                value={cadence}
                onChange={e => setCadence(e.target.value)}
              >
                {RECURRENCE_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="v2-form-field">
              {cadence === 'weekly' && (
                <>
                  <label className="v2-form-label">On</label>
                  <select
                    className="v2-form-input"
                    value={scheduleDayOfWeek}
                    onChange={e => setScheduleDayOfWeek(e.target.value)}
                  >
                    {DAY_OF_WEEK_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </>
              )}
              {isMonthScale && (
                <>
                  <label className="v2-form-label">On</label>
                  <select
                    className="v2-form-input"
                    value={monthMode}
                    onChange={e => setMonthMode(e.target.value)}
                  >
                    <option value="creation">Same day it was created</option>
                    <option value="dom">Day of month…</option>
                    <option value="dow">Weekday…</option>
                  </select>
                </>
              )}
            </div>
          </div>

          {isMonthScale && monthMode === 'dom' && (
            <div className="v2-form-row">
              <div className="v2-form-field">
                <label className="v2-form-label">Day of month</label>
                <select
                  className="v2-form-input"
                  value={String(dayOfMonth)}
                  onChange={e => setDayOfMonth(Number(e.target.value))}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="v2-form-field">
                <div className="v2-form-section-hint">
                  Months without this day use their last day (e.g. 31 → Feb 28).
                </div>
              </div>
            </div>
          )}

          {isMonthScale && monthMode === 'dow' && (
            <div className="v2-form-row">
              <div className="v2-form-field">
                <label className="v2-form-label">Which</label>
                <select
                  className="v2-form-input"
                  value={weekOfMonth}
                  onChange={e => setWeekOfMonth(e.target.value)}
                >
                  <option value="1">First</option>
                  <option value="2">Second</option>
                  <option value="3">Third</option>
                  <option value="4">Fourth</option>
                  <option value="-1">Last</option>
                </select>
              </div>
              <div className="v2-form-field">
                <label className="v2-form-label">Weekday</label>
                <select
                  className="v2-form-input"
                  value={scheduleDayOfWeek === '' ? '1' : scheduleDayOfWeek}
                  onChange={e => setScheduleDayOfWeek(e.target.value)}
                >
                  {DAY_OF_WEEK_OPTIONS.slice(1).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="v2-form-row">
            <div className="v2-form-field">
              <label className="v2-form-label">At time</label>
              <input
                type="time"
                className="v2-form-input"
                value={triggerTime}
                onChange={e => setTriggerTime(e.target.value)}
                aria-label="Surface at time"
              />
            </div>
            <div className="v2-form-field">
              {triggerTime && (
                <button
                  type="button"
                  className="v2-routine-time-clear"
                  onClick={() => setTriggerTime('')}
                >
                  Clear time
                </button>
              )}
            </div>
          </div>
          <div className="v2-form-section-hint">
            Don't show or nag before this time. Leave blank for any time.
          </div>

          {!isNew && (
            <>
              <div className="v2-form-row">
                <div className="v2-form-field">
                  <label className="v2-form-label">Last done</label>
                  <input
                    type="date"
                    className="v2-form-input"
                    value={lastDone}
                    max={today}
                    onChange={e => setLastDone(e.target.value)}
                    aria-label="Last completed date"
                  />
                </div>
                <div className="v2-form-field">
                  {lastDone && (
                    <button
                      type="button"
                      className="v2-routine-time-clear"
                      onClick={() => setLastDone('')}
                    >
                      Clear (never done)
                    </button>
                  )}
                </div>
              </div>
              <div className="v2-form-section-hint">
                When you last completed this. Sets the next due date — use it to fix a routine that's nagging after lost history.
              </div>
            </>
          )}

          {cadence === 'custom' && (
            <div className="v2-form-section">
              <label className="v2-form-label">Every</label>
              <div className="v2-form-row">
                <div className="v2-form-field">
                  <input
                    className="v2-form-input"
                    type="number"
                    min="1"
                    value={customDays}
                    onChange={e => setCustomDays(e.target.value)}
                    aria-label={`Every N ${customUnit}`}
                  />
                </div>
                <div className="v2-form-field">
                  <select
                    className="v2-form-input"
                    value={customUnit}
                    onChange={e => setCustomUnit(e.target.value)}
                    aria-label="Interval unit"
                  >
                    <option value="days">days</option>
                    <option value="months">months</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {isHabit && (
        <div className="v2-form-row">
          <div className="v2-form-field">
            <label className="v2-form-label">Target count</label>
            <input
              className="v2-form-input"
              type="number"
              min="1"
              max="100"
              value={targetCount}
              onChange={e => setTargetCount(e.target.value)}
            />
          </div>
          <div className="v2-form-field">
            <label className="v2-form-label">Per</label>
            <select
              className="v2-form-input"
              value={targetPeriod}
              onChange={e => setTargetPeriod(e.target.value)}
            >
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>
        </div>
      )}

      {!isHabit && (
        <div className="v2-form-row">
          <div className="v2-form-field">
            <label className="v2-form-label">End date (optional)</label>
            <input
              className="v2-form-input"
              type="date"
              min={today}
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
          <div className="v2-form-field">
            <label className="v2-form-label">Priority</label>
            <button
              className={`v2-form-pri-toggle v2-form-pri-${highPriority ? 'high' : 'normal'}`}
              onClick={() => setHighPriority(!highPriority)}
            >
              {highPriority ? '! High' : 'Normal'}
            </button>
          </div>
        </div>
      )}

      {isHabit && (
        <div className="v2-form-section">
          <label className="v2-form-label">Priority</label>
          <button
            className={`v2-form-pri-toggle v2-form-pri-${highPriority ? 'high' : 'normal'}`}
            onClick={() => setHighPriority(!highPriority)}
          >
            {highPriority ? '! High' : 'Normal'}
          </button>
        </div>
      )}

      {!isHabit && (
        <div className="v2-form-section">
          <label className="v2-form-label">Auto-roll</label>
          <div className="v2-form-section-hint">
            If a previous task is still active when the next one is due, roll its date forward instead of stacking a duplicate. Useful for medication or anything you can't double up on.
          </div>
          <button
            type="button"
            className={`v2-form-toggle v2-form-toggle-${autoRoll ? 'on' : 'off'}`}
            onClick={() => setAutoRoll(!autoRoll)}
            aria-pressed={autoRoll}
          >
            {autoRoll ? 'On' : 'Off'}
          </button>
        </div>
      )}

      <div className="v2-form-section">
        <label className="v2-form-label">Notes</label>
        <textarea
          className="v2-form-textarea"
          placeholder="Anything to remember…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

      {!isHabit && (
        <div className="v2-form-section">
          <label className="v2-form-label">Items (stack)</label>
          <div className="v2-form-section-hint">
            Add 2+ items and this routine becomes a <strong>stack</strong>: each cycle it spawns one independent task per item, all sharing the cadence and time above. Each item scores its own points; clearing every item in a cycle pays a 20% bonus.
          </div>
          {members.length > 0 && (
            <ol className="v2-stack-member-edit-list">
              {members.map((m) => (
                <li key={m.id} className="v2-stack-member-edit-row">
                  <input
                    className="v2-form-input"
                    placeholder="Item title (e.g. start dishwasher)"
                    value={m.title}
                    onChange={e => updateMember(m.id, { title: e.target.value })}
                  />
                  <button
                    type="button"
                    className="v2-stack-member-edit-remove"
                    onClick={() => removeMember(m.id)}
                    aria-label="Remove item"
                    title="Remove item"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          )}
          <button type="button" className="v2-edit-add-pill" onClick={addMember}>
            + Add item
          </button>
        </div>
      )}

      <div className="v2-form-section">
        <label className="v2-form-label">Follow-ups</label>
        <div className="v2-form-section-hint">
          Steps that auto-spawn when each previous one is completed. Offset is the delay between completion and the next step appearing.
        </div>
        {followUps.length > 0 && (
          <ol className="v2-followups-list">
            {followUps.map((step, idx) => (
              <FollowUpStepRow
                key={step.id}
                step={step}
                index={idx}
                isFirst={idx === 0}
                isLast={idx === followUps.length - 1}
                onChange={patch => updateStep(step.id, patch)}
                onRemove={() => removeStep(step.id)}
                onMoveUp={() => moveStep(step.id, -1)}
                onMoveDown={() => moveStep(step.id, +1)}
              />
            ))}
          </ol>
        )}
        <button type="button" className="v2-edit-add-pill" onClick={addStep}>
          + Add step
        </button>
      </div>

      {labels.length > 0 && (
        <div className="v2-form-section">
          <label className="v2-form-label">Labels</label>
          <div className="v2-form-label-grid">
            {labels.map(lbl => {
              const active = selectedTags.includes(lbl.id)
              return (
                <button
                  key={lbl.id}
                  className={`v2-form-label-pill${active ? ' v2-form-label-pill-active' : ''}`}
                  onClick={() => toggleTag(lbl.id)}
                  style={active ? { background: lbl.color, borderColor: lbl.color, color: '#fff' } : undefined}
                >
                  {lbl.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <button
        className="v2-form-submit"
        disabled={!title.trim()}
        onClick={handleSave}
      >
        {isNew ? 'Create routine' : 'Save changes'}
      </button>
      <ChainReconcileModal
        open={!!pendingSave}
        parentTitle={title.trim() || ''}
        originalChain={pendingSave?.originalChain || []}
        currentChain={pendingSave?.currentChain || []}
        onApply={commitSave}
        onCancel={cancelReconcile}
      />
    </div>
  )
}

export default function RoutinesModal({
  open, routines, tasks = [], onAdd, onDelete, onTogglePause, onUpdate, onSpawnNow, onLogHabit, onSkipCycle, onClose,
  editRoutineId, onClearEditRoutineId, activeRoutineIds,
}) {
  const [view, setView] = useState('list')  // 'list' | 'form'
  const [editing, setEditing] = useState(null)  // routine being edited; null = new
  const [expandedId, setExpandedId] = useState(null)

  // Reset to list view whenever the modal opens fresh.
  useEffect(() => {
    if (!open) {
      setView('list')
      setEditing(null)
      setExpandedId(null)
    }
  }, [open])

  // Open directly into edit form when AppV2 supplies an editRoutineId — same
  // pattern v1 uses (e.g. EditTaskModal → "Open routine" jumps the user here).
  useEffect(() => {
    if (open && editRoutineId) {
      const target = routines.find(r => r.id === editRoutineId)
      if (target) {
        setEditing(target)
        setView('form')
      }
      onClearEditRoutineId?.()
    }
  }, [open, editRoutineId, routines, onClearEditRoutineId])

  const active = routines.filter(r => !r.paused)
  const paused = routines.filter(r => r.paused)

  const handleSubmitForm = (data) => {
    if (editing) {
      const updates = {
        title: data.title,
        cadence: data.cadence,
        custom_days: data.customDays,
        custom_unit: data.customUnit,
        tags: data.tags,
        notes: data.notes,
        high_priority: data.highPriority,
        end_date: data.endDate,
        schedule_day_of_week: data.scheduleDayOfWeek,
        schedule_day_of_month: data.scheduleDayOfMonth,
        schedule_week_of_month: data.scheduleWeekOfMonth,
        trigger_time: data.triggerTime,
        follow_ups: data.followUps,
        members: data.members,
        auto_roll: data.autoRoll,
        spawn_mode: data.spawnMode,
        target_count: data.targetCount,
        target_period: data.targetPeriod,
      }
      // Only touch completed_history when the "Last done" date was changed
      // (undefined = leave it alone; never send undefined into the merge).
      if (data.completedHistory !== undefined) {
        updates.completed_history = data.completedHistory
      }
      onUpdate(editing.id, updates)
    } else {
      onAdd(
        data.title, data.cadence, data.customDays,
        data.tags, data.notes, data.highPriority,
        data.endDate, data.scheduleDayOfWeek,
        data.followUps, data.autoRoll,
        data.spawnMode, data.targetCount, data.targetPeriod,
        data.customUnit, data.triggerTime,
        data.scheduleDayOfMonth, data.scheduleWeekOfMonth,
        data.members,
      )
    }
    setView('list')
    setEditing(null)
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={view === 'form' ? (editing ? 'Edit routine' : 'New routine') : 'Routines'}
      terminalTitle={view === 'form' ? (editing ? '$ routine --edit' : '$ routine --new') : '$ routines'}
      subtitle={view === 'list' && routines.length > 0
        ? `${active.length} active${paused.length ? ` · ${paused.length} paused` : ''}`
        : undefined}
      width="wide"
    >
      {view === 'form' ? (
        <RoutineForm
          initial={editing}
          onSave={handleSubmitForm}
          onCancel={() => { setView('list'); setEditing(null) }}
        />
      ) : (
        <>
          {routines.length === 0 ? (
            <EmptyState
              icon={RotateCw}
              title="No routines yet"
              body="Recurring tasks like dentist visits, plant watering, oil changes. Create one to start tracking the rhythm."
              cta="New routine"
              ctaOnClick={() => { setEditing(null); setView('form') }}
              terminalCommand="// no routines yet. recurring tasks live here — dentist, oil change, water plants."
            />
          ) : (
            <>
              {active.length > 0 && (
                <>
                  <SectionLabel count={active.length}>Active</SectionLabel>
                  <ul className="v2-routine-list">
                    {active.map(r => (
                      <RoutineRow
                        key={r.id}
                        routine={r}
                        tasks={tasks}
                        expanded={expandedId === r.id}
                        onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                        onSpawnNow={onSpawnNow}
                        onLogHabit={onLogHabit}
                        onSkipCycle={onSkipCycle}
                        onEdit={(routine) => { setEditing(routine); setView('form') }}
                        onTogglePause={onTogglePause}
                        onDelete={onDelete}
                        hasActiveTask={activeRoutineIds?.has(r.id) || false}
                      />
                    ))}
                  </ul>
                </>
              )}
              {paused.length > 0 && (
                <>
                  <SectionLabel count={paused.length}>Paused</SectionLabel>
                  <ul className="v2-routine-list">
                    {paused.map(r => (
                      <RoutineRow
                        key={r.id}
                        routine={r}
                        tasks={tasks}
                        expanded={expandedId === r.id}
                        onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                        onSpawnNow={onSpawnNow}
                        onLogHabit={onLogHabit}
                        onSkipCycle={onSkipCycle}
                        onEdit={(routine) => { setEditing(routine); setView('form') }}
                        onTogglePause={onTogglePause}
                        onDelete={onDelete}
                        hasActiveTask={activeRoutineIds?.has(r.id) || false}
                      />
                    ))}
                  </ul>
                </>
              )}
              <button
                className="v2-routine-new-btn"
                onClick={() => { setEditing(null); setView('form') }}
              >
                <Plus size={16} strokeWidth={2} /> New routine
              </button>
            </>
          )}
        </>
      )}
    </ModalShell>
  )
}
