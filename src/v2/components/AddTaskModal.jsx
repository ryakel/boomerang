import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { loadLabels, getDefaultDueDate, ENERGY_TYPES } from '../../store'
import { useTaskForm } from '../../hooks/useTaskForm'
import ModalShell from './ModalShell'
import './AddTaskModal.css'

const ENERGY_LEVEL_LABELS = [
  { lvl: 1, label: 'Low' },
  { lvl: 2, label: 'Medium' },
  { lvl: 3, label: 'High' },
]

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL']

export default function AddTaskModal({ open, onAdd, onClose }) {
  const form = useTaskForm({ dueDate: getDefaultDueDate() })
  const titleRef = useRef(null)

  useEffect(() => {
    if (open) {
      // Wait one tick for the modal to mount before focusing the title input.
      setTimeout(() => titleRef.current?.focus(), 50)
    }
  }, [open])

  const labels = loadLabels()
  const today = new Date().toISOString().split('T')[0]

  const handleSubmit = () => {
    if (!form.title.trim()) return
    onAdd(form.getFormData())
    onClose()
  }

  // Priority cycles: Normal → High → Low → Normal
  const priorityState = form.highPriority ? 'high' : form.lowPriority ? 'low' : 'normal'
  const cyclePriority = () => {
    if (priorityState === 'normal') { form.setHighPriority(true); form.setLowPriority(false) }
    else if (priorityState === 'high') { form.setHighPriority(false); form.setLowPriority(true) }
    else { form.setHighPriority(false); form.setLowPriority(false) }
  }
  const priorityLabel = priorityState === 'high' ? '! High' : priorityState === 'low' ? '↓ Low' : 'Normal'

  return (
    <ModalShell open={open} onClose={onClose} title="New task" width="narrow">
      <input
        ref={titleRef}
        className="v2-form-input v2-form-title"
        placeholder="What needs doing?"
        value={form.title}
        onChange={e => form.setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSubmit() }}
      />

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
            <button
              className="v2-form-ai-pill"
              onClick={form.handlePolish}
              disabled={form.polishing}
            >
              {form.polishing ? <span className="v2-spinner" /> : <Sparkles size={12} strokeWidth={1.75} />}
              {form.polishing ? 'Polishing…' : 'Polish'}
            </button>
          )}
        </div>
        {form.polishError && <div className="v2-form-error">{form.polishError}</div>}
        {form.polishApplied?.addedLabels?.length > 0 && (
          <div className="v2-edit-polish-applied">
            <span>Polish added label{form.polishApplied.addedLabels.length === 1 ? '' : 's'}: {form.polishApplied.addedLabels.join(', ')}.</span>
          </div>
        )}
        {form.suggestedChecklist && (
          <div className="v2-edit-polish-applied">
            <span>Checklist suggested ({form.suggestedChecklist.items.length} items). Save and re-open this task to apply.</span>
          </div>
        )}
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

      {(form.energy || form.size) && (
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
                  title={et.label}
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
      )}

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

      <button
        className="v2-form-submit"
        disabled={!form.title.trim()}
        onClick={handleSubmit}
      >
        Add task
      </button>
    </ModalShell>
  )
}
