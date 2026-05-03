import { useState, useEffect } from 'react'
import { Sparkles, Trash2, FolderKanban, Archive } from 'lucide-react'
import { loadLabels, ENERGY_TYPES, STATUS_META } from '../../store'
import { useTaskForm } from '../../hooks/useTaskForm'
import ModalShell from './ModalShell'
import './AddTaskModal.css' // shared form-control styles
import './EditTaskModal.css'

const ENERGY_LEVEL_LABELS = [
  { lvl: 1, label: 'Low' },
  { lvl: 2, label: 'Medium' },
  { lvl: 3, label: 'High' },
]

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL']

// Status options shown as segmented buttons. Mirrors v1's STATUS_CYCLE +
// the explicit Done/Backlog/Projects affordances. We collapse "open" to
// "not_started" since that's how STATUS_META keys it.
const STATUS_OPTIONS = ['not_started', 'doing', 'waiting']

const CADENCE_OPTIONS = ['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'custom']

export default function EditTaskModal({ task, onSave, onClose, onDelete, onBacklog, onProject, onStatusChange, onConvertToRoutine }) {
  const form = useTaskForm({
    title: task.title,
    notes: task.notes || '',
    tags: task.tags || [],
    dueDate: task.due_date || '',
    size: task.size || null,
    energy: task.energy || null,
    energyLevel: task.energyLevel || null,
    highPriority: task.high_priority || false,
    lowPriority: task.low_priority || false,
    sizeInferred: !!task.size_inferred,
  })

  const [currentStatus, setCurrentStatus] = useState(task.status === 'open' ? 'not_started' : task.status)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [cadence, setCadence] = useState('weekly')
  const [customDays, setCustomDays] = useState(14)

  const labels = loadLabels()
  const today = new Date().toISOString().split('T')[0]

  // Auto-save title/notes/due/priority/size/energy/tags on blur/change is
  // common in v1 EditTaskModal. v2 keeps the explicit Save button for now —
  // less surprising for the new UI, easier to reason about. PR8 polish can
  // add per-field autosave if it feels natural in use.
  const handleSave = () => {
    if (!form.title.trim()) return
    onSave(task.id, {
      title: form.title.trim(),
      notes: form.notes,
      tags: form.selectedTags,
      due_date: form.dueDate || null,
      size: form.size,
      energy: form.energy,
      energyLevel: form.energyLevel,
      high_priority: form.highPriority,
      low_priority: form.lowPriority,
      size_inferred: !!form.size,
      last_touched: new Date().toISOString(),
    })
    onClose()
  }

  const handleStatusChange = (newStatus) => {
    setCurrentStatus(newStatus)
    onStatusChange(task.id, newStatus)
  }

  const handleConvertToRoutine = () => {
    if (!form.title.trim()) return
    onConvertToRoutine(task.id, {
      title: form.title.trim(),
      cadence,
      customDays: cadence === 'custom' ? Number(customDays) : undefined,
      tags: form.selectedTags,
      notes: form.notes,
    })
  }

  const priorityState = form.highPriority ? 'high' : form.lowPriority ? 'low' : 'normal'
  const cyclePriority = () => {
    if (priorityState === 'normal') { form.setHighPriority(true); form.setLowPriority(false) }
    else if (priorityState === 'high') { form.setHighPriority(false); form.setLowPriority(true) }
    else { form.setHighPriority(false); form.setLowPriority(false) }
  }
  const priorityLabel = priorityState === 'high' ? '! High' : priorityState === 'low' ? '↓ Low' : 'Normal'

  // Esc on confirm-delete view rolls back to normal view rather than closing.
  useEffect(() => {
    if (!confirmDelete) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirmDelete(false) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [confirmDelete])

  return (
    <ModalShell open={!!task} onClose={onClose} title="Edit task" width="narrow">
      <input
        className="v2-form-input v2-form-title"
        placeholder="What needs doing?"
        value={form.title}
        onChange={e => form.setTitle(e.target.value)}
      />

      <div className="v2-form-section">
        <label className="v2-form-label">Status</label>
        <div className="v2-form-segmented v2-edit-status-row">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              className={`v2-form-seg${currentStatus === s ? ' v2-form-seg-active' : ''}`}
              onClick={() => handleStatusChange(s)}
            >
              {STATUS_META[s]?.label || s}
            </button>
          ))}
          <button
            className="v2-form-seg v2-edit-status-done"
            onClick={() => handleStatusChange('done')}
            title="Mark complete"
          >
            ✓ Done
          </button>
        </div>
      </div>

      <div className="v2-form-section">
        <label className="v2-form-label">Notes</label>
        <div className="v2-form-textarea-wrap">
          <textarea
            className="v2-form-textarea"
            placeholder="Brain dump here…"
            value={form.notes}
            onChange={e => form.setNotes(e.target.value)}
          />
          {form.notes.trim() && (
            <button className="v2-form-ai-pill" onClick={form.handlePolish} disabled={form.polishing}>
              {form.polishing ? <span className="v2-spinner" /> : <Sparkles size={12} strokeWidth={1.75} />}
              {form.polishing ? 'Polishing…' : 'Polish'}
            </button>
          )}
        </div>
        {form.polishError && <div className="v2-form-error">{form.polishError}</div>}
      </div>

      <div className="v2-form-row">
        <div className="v2-form-field">
          <label className="v2-form-label">Due</label>
          <input
            className="v2-form-input"
            type="date"
            value={form.dueDate}
            min={today}
            onChange={e => form.setDueDate(e.target.value)}
          />
        </div>
        <div className="v2-form-field">
          <label className="v2-form-label">Priority</label>
          <button
            className={`v2-form-pri-toggle v2-form-pri-${priorityState}`}
            onClick={cyclePriority}
          >
            {priorityLabel}
          </button>
        </div>
      </div>

      <div className="v2-form-section">
        <label className="v2-form-label">Size</label>
        <div className="v2-form-segmented">
          {SIZE_OPTIONS.map(s => (
            <button
              key={s}
              className={`v2-form-seg${form.size === s ? ' v2-form-seg-active' : ''}`}
              onClick={() => form.setSize(form.size === s ? null : s)}
            >
              {s}
            </button>
          ))}
          <button
            className="v2-form-ai-pill v2-form-ai-pill-inline"
            onClick={form.handleInferSize}
            disabled={form.sizing || !form.title.trim()}
          >
            {form.sizing ? <span className="v2-spinner" /> : <Sparkles size={12} strokeWidth={1.75} />}
            {form.sizing ? 'Sizing…' : 'Auto'}
          </button>
        </div>
      </div>

      <div className="v2-form-section">
        <label className="v2-form-label">Energy type</label>
        <div className="v2-form-energy-grid">
          {ENERGY_TYPES.map(et => {
            const selected = form.energy === et.id
            return (
              <button
                key={et.id}
                className={`v2-form-energy-pill${selected ? ' v2-form-energy-pill-active' : ''}`}
                onClick={() => form.setEnergy(form.energy === et.id ? null : et.id)}
                style={selected ? { borderColor: et.color, color: et.color } : undefined}
              >
                {et.label}
              </button>
            )
          })}
        </div>
        {form.energy && (
          <>
            <label className="v2-form-label" style={{ marginTop: 14 }}>Energy drain</label>
            <div className="v2-form-segmented">
              {ENERGY_LEVEL_LABELS.map(({ lvl, label }) => (
                <button
                  key={lvl}
                  className={`v2-form-seg${form.energyLevel === lvl ? ' v2-form-seg-active' : ''}`}
                  onClick={() => form.setEnergyLevel(form.energyLevel === lvl ? null : lvl)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {labels.length > 0 && (
        <div className="v2-form-section">
          <label className="v2-form-label">Labels</label>
          <div className="v2-form-label-grid">
            {labels.map(lbl => {
              const active = form.selectedTags.includes(lbl.id)
              return (
                <button
                  key={lbl.id}
                  className={`v2-form-label-pill${active ? ' v2-form-label-pill-active' : ''}`}
                  onClick={() => form.toggleTag(lbl.id)}
                  style={active ? { background: lbl.color, borderColor: lbl.color, color: '#fff' } : undefined}
                >
                  {lbl.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Routine conversion — only meaningful for non-routine-spawned tasks */}
      {!task.routine_id && (
        <div className="v2-form-section">
          <label className="v2-form-label">Make recurring</label>
          {!makeRecurring ? (
            <button className="v2-edit-routine-toggle" onClick={() => setMakeRecurring(true)}>
              Convert to routine
            </button>
          ) : (
            <div className="v2-edit-routine-row">
              <select
                className="v2-form-input v2-edit-routine-select"
                value={cadence}
                onChange={e => setCadence(e.target.value)}
              >
                {CADENCE_OPTIONS.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              {cadence === 'custom' && (
                <input
                  className="v2-form-input v2-edit-routine-days"
                  type="number"
                  min="1"
                  value={customDays}
                  onChange={e => setCustomDays(e.target.value)}
                  placeholder="days"
                />
              )}
              <button className="v2-edit-routine-confirm" onClick={handleConvertToRoutine}>Convert</button>
              <button className="v2-edit-routine-cancel" onClick={() => setMakeRecurring(false)}>Cancel</button>
            </div>
          )}
        </div>
      )}

      <div className="v2-form-section v2-edit-actions-row">
        <button
          className="v2-edit-action"
          onClick={() => { onBacklog(task.id, true); onClose() }}
          title="Move to backlog"
        >
          <Archive size={14} strokeWidth={1.75} /> Backlog
        </button>
        <button
          className="v2-edit-action"
          onClick={() => { onProject(task.id, true); onClose() }}
          title="Move to projects"
        >
          <FolderKanban size={14} strokeWidth={1.75} /> Projects
        </button>
        {!confirmDelete ? (
          <button
            className="v2-edit-action v2-edit-action-danger"
            onClick={() => setConfirmDelete(true)}
            title="Delete task"
          >
            <Trash2 size={14} strokeWidth={1.75} /> Delete
          </button>
        ) : (
          <div className="v2-edit-confirm-delete">
            <span className="v2-edit-confirm-label">Delete?</span>
            <button
              className="v2-edit-action v2-edit-action-confirm-yes"
              onClick={() => { onDelete(task.id); onClose() }}
            >
              Yes
            </button>
            <button
              className="v2-edit-action"
              onClick={() => setConfirmDelete(false)}
            >
              No
            </button>
          </div>
        )}
      </div>

      <button
        className="v2-form-submit"
        disabled={!form.title.trim()}
        onClick={handleSave}
      >
        Save changes
      </button>
    </ModalShell>
  )
}
