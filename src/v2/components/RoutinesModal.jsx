import { useState, useEffect } from 'react'
import { Plus, Play, Pause, Pencil, Trash2, RotateCw, FastForward } from 'lucide-react'
import { loadLabels, RECURRENCE_OPTIONS, formatCadence, getNextDueDate } from '../../store'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
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

function RoutineRow({ routine, expanded, onToggleExpand, onSpawnNow, onSkipCycle, onEdit, onTogglePause, onDelete }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => { if (!expanded) setConfirmDelete(false) }, [expanded])

  const cadenceLabel = formatCadence(routine)
  const dayOfWeek = routine.schedule_day_of_week != null
    ? ` · ${DAY_OF_WEEK_SHORT[routine.schedule_day_of_week]}`
    : ''
  const completeCount = routine.completed_history?.length || 0

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
            <button className="v2-routine-action v2-routine-action-primary" onClick={() => onSpawnNow(routine.id)} title="Create a one-off task now without affecting the schedule">
              <Plus size={14} strokeWidth={2} /> Spawn now
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

  const labels = loadLabels()
  const today = new Date().toISOString().split('T')[0]
  const parsedDay = scheduleDayOfWeek === '' ? null : parseInt(scheduleDayOfWeek, 10)

  const toggleTag = (id) => {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  const handleSave = () => {
    if (!title.trim()) return
    onSave({
      title: title.trim(),
      cadence,
      customDays: cadence === 'custom' ? Number(customDays) : null,
      tags: selectedTags,
      notes: notes.trim(),
      highPriority,
      endDate: endDate || null,
      scheduleDayOfWeek: parsedDay,
    })
  }

  return (
    <div className="v2-routine-form">
      <div className="v2-routine-form-top">
        <button className="v2-routine-back" onClick={onCancel}>← Back</button>
        <h2 className="v2-routine-form-title">{isNew ? 'New routine' : 'Edit routine'}</h2>
      </div>

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
    </div>
  )
}

export default function RoutinesModal({
  open, routines, onAdd, onDelete, onTogglePause, onUpdate, onSpawnNow, onSkipCycle, onClose,
  editRoutineId, onClearEditRoutineId,
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
      })
    } else {
      onAdd(
        data.title, data.cadence, data.customDays,
        data.tags, data.notes, data.highPriority,
        data.endDate, data.scheduleDayOfWeek,
      )
    }
    setView('list')
    setEditing(null)
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={view === 'form' ? '' : 'Routines'}
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
