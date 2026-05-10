import { useState, useEffect } from 'react'
import { Plus, Play, Pause, Pencil, Trash2, RotateCw, FastForward, X, ChevronUp, ChevronDown, Check } from 'lucide-react'
import { loadLabels, RECURRENCE_OPTIONS, formatCadence, getNextDueDate } from '../../store'
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

const DAY_OF_WEEK_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  const days = Math.floor((Date.now() - last.getTime()) / 86400000)
  if (days === 0) return 'done today'
  if (days === 1) return 'done yesterday'
  return `done ${days}d ago`
}

function RoutineRow({ routine, expanded, onToggleExpand, onSpawnNow, onSkipCycle, onEdit, onTogglePause, onDelete, hasActiveTask }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  // 'idle' | 'spawned' — local tap feedback so the user sees a check icon
  // immediately on tap. Reverts after 1500ms. Blocked state (an instance is
  // already active) is rendered straight from `hasActiveTask` and is sticky;
  // no time-based reversion since the underlying condition isn't transient.
  const [spawnState, setSpawnState] = useState('idle')
  useEffect(() => { if (!expanded) setConfirmDelete(false) }, [expanded])

  const cadenceLabel = formatCadence(routine)
  const dayOfWeek = routine.schedule_day_of_week != null
    ? ` · ${DAY_OF_WEEK_SHORT[routine.schedule_day_of_week]}`
    : ''
  const completeCount = routine.completed_history?.length || 0

  const handleSpawn = () => {
    if (hasActiveTask) return  // button is disabled in this state, but defensive
    onSpawnNow(routine.id)
    setSpawnState('spawned')
    setTimeout(() => setSpawnState('idle'), 1500)
  }

  return (
    <li className={`v2-routine-row${expanded ? ' v2-routine-row-expanded' : ''}${routine.paused ? ' v2-routine-row-paused' : ''}`}>
      <button className="v2-routine-summary" onClick={onToggleExpand}>
        <span className="v2-routine-title">{routine.title}</span>
        <span className="v2-routine-cadence">{cadenceLabel}{dayOfWeek}</span>
      </button>
      {expanded && (
        <div className="v2-routine-detail">
          <div className="v2-routine-meta">
            <span>{formatLastDone(routine)}</span>
            <span className="v2-routine-meta-sep">·</span>
            <span>{formatNextDue(routine)}</span>
            <span className="v2-routine-meta-sep">·</span>
            <span>{completeCount}× completed</span>
          </div>
          {routine.notes && (
            <div className="v2-routine-notes">{routine.notes}</div>
          )}
          <div className="v2-routine-actions">
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
            {!routine.paused && (
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

function FollowUpStepRow({ step, index, isFirst, isLast, onChange, onRemove, onMoveUp, onMoveDown }) {
  const display = offsetToDisplay(step.offset_minutes)
  const [unit, setUnit] = useState(display.unit)
  const [valueDraft, setValueDraft] = useState(String(display.value))

  const commitValue = (raw, nextUnit = unit) => {
    const minutes = displayToOffsetMinutes(raw, nextUnit)
    onChange({ offset_minutes: minutes })
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
        <span className="v2-followups-step-meta-label">Offset</span>
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
  const [scheduleDayOfWeek, setScheduleDayOfWeek] = useState(
    initial?.schedule_day_of_week == null ? '' : String(initial.schedule_day_of_week)
  )
  const [selectedTags, setSelectedTags] = useState(initial?.tags || [])
  const [notes, setNotes] = useState(initial?.notes || '')
  const [highPriority, setHighPriority] = useState(initial?.high_priority || false)
  const [endDate, setEndDate] = useState(initial?.end_date || '')
  const [followUps, setFollowUps] = useState(() =>
    Array.isArray(initial?.follow_ups) ? initial.follow_ups.map(s => ({ ...s })) : []
  )

  const labels = loadLabels()
  const today = new Date().toISOString().split('T')[0]
  const parsedDay = scheduleDayOfWeek === '' ? null : parseInt(scheduleDayOfWeek, 10)

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

  // Sequences PR 4. When the user finishes editing the chain and clicks
  // Save, we look for *title* changes against the original (the only kind
  // of edit that propagates linguistically). If we find any AND the chain
  // is large enough to be worth scanning (2+ steps), we pause the save
  // flow inside `pendingSave` and pop the reconcile modal — the modal
  // calls `commitSave(finalChain)` once the user picks Apply / Skip.
  // Empty / single-step / pure-offset edits skip the gate entirely.
  const [pendingSave, setPendingSave] = useState(null)

  const buildSavePayload = (followUpsArray) => ({
    title: title.trim(),
    cadence,
    customDays: cadence === 'custom' ? Number(customDays) : null,
    tags: selectedTags,
    notes: notes.trim(),
    highPriority,
    endDate: endDate || null,
    scheduleDayOfWeek: parsedDay,
    followUps: followUpsArray,
  })

  const handleSave = () => {
    if (!title.trim()) return
    const cleanFollowUps = followUps
      .filter(s => s.title?.trim())
      .map(s => ({
        id: s.id,
        title: s.title.trim(),
        offset_minutes: Math.max(0, Number(s.offset_minutes) || 0),
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
        placeholder="What recurring task?"
        value={title}
        onChange={e => setTitle(e.target.value)}
      />

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
        </div>
      </div>

      {cadence === 'custom' && (
        <div className="v2-form-section">
          <label className="v2-form-label">Every N days</label>
          <input
            className="v2-form-input"
            type="number"
            min="1"
            value={customDays}
            onChange={e => setCustomDays(e.target.value)}
          />
        </div>
      )}

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

      <div className="v2-form-section">
        <label className="v2-form-label">Notes</label>
        <textarea
          className="v2-form-textarea"
          placeholder="Anything to remember…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
        />
      </div>

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
  open, routines, onAdd, onDelete, onTogglePause, onUpdate, onSpawnNow, onSkipCycle, onClose,
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
      onUpdate(editing.id, {
        title: data.title,
        cadence: data.cadence,
        custom_days: data.customDays,
        tags: data.tags,
        notes: data.notes,
        high_priority: data.highPriority,
        end_date: data.endDate,
        schedule_day_of_week: data.scheduleDayOfWeek,
        follow_ups: data.followUps,
      })
    } else {
      onAdd(
        data.title, data.cadence, data.customDays,
        data.tags, data.notes, data.highPriority,
        data.endDate, data.scheduleDayOfWeek,
        data.followUps,
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
                        expanded={expandedId === r.id}
                        onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                        onSpawnNow={onSpawnNow}
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
                        expanded={expandedId === r.id}
                        onToggleExpand={() => setExpandedId(expandedId === r.id ? null : r.id)}
                        onSpawnNow={onSpawnNow}
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
