import { useEffect, useRef, useState } from 'react'
import { Sparkles, X as XIcon } from 'lucide-react'
import { loadLabels, getDefaultDueDate, ENERGY_TYPES, localYMD, uuid } from '../store'
import { useTaskForm } from '../hooks/useTaskForm'
import ModalShell from './ModalShell'
import DateField from './DateField'
import './AddTaskModal.css'
import './EditTaskModal.css'

const ENERGY_LEVEL_LABELS = [
  { lvl: 1, label: 'Low' },
  { lvl: 2, label: 'Medium' },
  { lvl: 3, label: 'High' },
]

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL']

export default function AddTaskModal({ open, onAdd, onClose, parentProject = null, createAsProject = false, initialDraft = null }) {
  // AppV2 remounts this component (via a `key` bump) every time it's freshly
  // opened, so `initial` only ever needs to be read once here — no reset
  // logic required. `initialDraft` seeds a title/date handed off from
  // ThrowSheet's "More options" (previously dropped on the floor).
  const form = useTaskForm({
    title: initialDraft?.title || '',
    dueDate: initialDraft?.dueDate || getDefaultDueDate(),
    // A reminder can arrive from the Throw sheet's "More options" handoff, or
    // from the Reminders lens's "New reminder" button, which opens this modal
    // pre-armed. Both are datetime-local strings already.
    remindAt: initialDraft?.remindAt || '',
  })
  const titleRef = useRef(null)

  // Checklist built at CREATE time. Both editors could add one to an existing
  // task, but no creation surface could — so a multi-step task had to be
  // thrown, then reopened, before its steps could be written down (and a
  // Polish-suggested checklist said "save and re-open this task to apply").
  // One list, same item shape the editors use; more lists stay an editor job.
  const [checkItems, setCheckItems] = useState([])
  const [newCheckItem, setNewCheckItem] = useState('')
  const addCheckItem = () => {
    const text = newCheckItem.trim()
    if (!text) return
    setCheckItems(prev => [...prev, { id: uuid(), text, completed: false }])
    setNewCheckItem('')
  }
  const renameCheckItem = (id, text) => setCheckItems(prev => prev.map(i => (i.id === id ? { ...i, text } : i)))
  const removeCheckItem = (id) => setCheckItems(prev => prev.filter(i => i.id !== id))
  const applySuggestedChecklist = () => {
    const cl = form.consumeSuggestedChecklist()
    if (!cl) return
    setCheckItems(prev => [
      ...prev,
      ...cl.items
        .map(it => (it.text || '').trim())
        .filter(Boolean)
        .map(text => ({ id: uuid(), text, completed: false })),
    ])
  }

  useEffect(() => {
    if (open) {
      // Wait one tick for the modal to mount before focusing the title input.
      setTimeout(() => titleRef.current?.focus(), 50)
    }
  }, [open])

  const labels = loadLabels()
  const today = localYMD()

  const handleSubmit = () => {
    if (!form.title.trim()) return
    // An item typed but not yet entered is still an item — tapping "Add task"
    // with it sitting in the box must not drop it.
    const pending = newCheckItem.trim()
    const items = [
      ...checkItems.map(i => ({ ...i, text: i.text.trim() })).filter(i => i.text),
      ...(pending ? [{ id: uuid(), text: pending, completed: false }] : []),
    ]
    onAdd({
      ...form.getFormData(),
      checklists: items.length > 0
        ? [{ id: uuid(), name: 'Checklist', items, hideCompleted: false }]
        : [],
    })
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
    <ModalShell
      open={open}
      onClose={onClose}
      title={createAsProject ? 'New project' : parentProject ? `New sub in ${parentProject.title}` : 'New task'}
      width="narrow"
    >
      {parentProject && (
        <div className="v2-form-parent-banner">
          Adding a sub-task to <strong>{parentProject.title}</strong>. It surfaces under the pinned project automatically.
        </div>
      )}
      {createAsProject && !parentProject && (
        <div className="v2-form-parent-banner">
          Creating a <strong>project</strong> — silent by default, no nags unless you set a due date or opt in. Add subs after creation to break it into concrete steps.
        </div>
      )}
      <input
        ref={titleRef}
        className="v2-form-input v2-form-title"
        placeholder={createAsProject ? 'What\'s the project?' : parentProject ? 'What\'s the next sub?' : 'What needs doing?'}
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
            <span>Checklist suggested ({form.suggestedChecklist.items.length} items).</span>
            <button type="button" className="v2-edit-polish-apply" onClick={applySuggestedChecklist}>Add</button>
            <button type="button" className="v2-edit-polish-dismiss" onClick={() => form.consumeSuggestedChecklist()}>Dismiss</button>
          </div>
        )}
      </div>

      <div className="v2-form-section">
        <label className="v2-form-label">Checklist</label>
        {checkItems.length > 0 && (
          <ul className="v2-edit-checklist-items">
            {checkItems.map(item => (
              <li key={item.id} className="v2-edit-checklist-item">
                <input
                  className="v2-edit-checklist-text"
                  value={item.text}
                  onChange={e => renameCheckItem(item.id, e.target.value)}
                  aria-label="Checklist item"
                />
                <button
                  type="button"
                  className="v2-edit-checklist-item-remove"
                  onClick={() => removeCheckItem(item.id)}
                  aria-label="Remove item"
                >
                  <XIcon size={12} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          className="v2-edit-checklist-add-input"
          placeholder="Add checklist item…"
          value={newCheckItem}
          onChange={e => setNewCheckItem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCheckItem() } }}
        />
      </div>

      <div className="v2-form-row v2-form-row-due-priority">
        <div className="v2-form-field">
          <label className="v2-form-label">Due</label>
          <DateField value={form.dueDate} onChange={form.setDueDate} min={today} />
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

      {/* A reminder is a MOMENT ("interrupt me at 3pm"); Due above is a DAY.
          Optional here — most tasks want a day and nothing more — but a task
          created with one rings without a second trip through the editor. */}
      <div className="v2-form-section">
        <label className="v2-form-label">Remind</label>
        <input
          type="datetime-local"
          className="v2-form-input"
          aria-label="Reminder time"
          value={form.remindAt}
          onChange={e => form.setRemindAt(e.target.value)}
        />
        {form.remindAt && (
          <button
            className="v2-form-ai-pill v2-form-ai-pill-inline"
            style={{ marginTop: 6 }}
            onClick={() => form.setRemindAt('')}
          >
            Clear reminder
          </button>
        )}
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
                  type="button"
                  className={`v2-form-label-pill${active ? ' v2-form-label-pill-active' : ''}`}
                  onClick={() => form.toggleTag(lbl.id)}
                  style={{ '--label-color': lbl.color }}
                  title={lbl.name}
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
