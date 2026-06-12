import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Trash2, Plus, Check, ChevronDown, Sliders, Sparkles,
  Monitor, Users, MapPin, Palette, Dumbbell, Zap,
} from 'lucide-react'
import ModalShell from '../components/ModalShell'
import AutosaveIndicator from '../components/AutosaveIndicator'
import DateField from '../components/DateField'
import { useTaskForm } from '../hooks/useTaskForm'
import { loadLabels, uuid } from '../store'
import './QuickEditTask.css'

const STATUSES = [
  { id: 'not_started', label: 'Not started' },
  { id: 'doing', label: 'Doing' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
]
const SIZES = ['XS', 'S', 'M', 'L', 'XL']
// Energy accents resolve via the shared --energy-* tokens (single source —
// tokens.css standard values, per-theme overrides in wallaby/kept palettes).
const ENERGY = [
  { id: 'desk', label: 'Desk', Icon: Monitor, color: 'var(--energy-desk)' },
  { id: 'people', label: 'People', Icon: Users, color: 'var(--energy-people)' },
  { id: 'errand', label: 'Errand', Icon: MapPin, color: 'var(--energy-errand)' },
  { id: 'creative', label: 'Creative', Icon: Palette, color: 'var(--energy-creative)' },
  { id: 'physical', label: 'Physical', Icon: Dumbbell, color: 'var(--energy-physical)' },
]
const DRAIN = [{ v: 1, label: 'Low' }, { v: 2, label: 'Medium' }, { v: 3, label: 'High' }]

// Wallaby task editor — loggd-style chip language. Core config is presented as
// tappable chips that expand an inline picker, instead of always-on rows of
// segmented pills. Reuses useTaskForm + the same partial-save contract as
// EditTaskModal (updateTask merges, so the advanced fields it doesn't manage
// are preserved). Heavy/rare config lives behind "More options" → full editor.
export default function WallabyEditTask({ task, onSave, onClose, onDelete, onStatusChange, onOpenFull }) {
  const form = useTaskForm({
    title: task.title, notes: task.notes, tags: task.tags || [],
    dueDate: task.due_date || '', size: task.size, size_inferred: task.size_inferred,
    // Client task objects carry camelCase energyLevel (db.js maps the
    // energy_level column on read); the snake_case fallback covers raw rows.
    energy: task.energy, energyLevel: task.energyLevel ?? task.energy_level,
    highPriority: task.high_priority, lowPriority: task.low_priority,
  })
  const [status, setStatus] = useState(task.status)
  const [checklists, setChecklists] = useState(Array.isArray(task.checklists) ? task.checklists : [])
  const [openChip, setOpenChip] = useState(null)
  const [newSub, setNewSub] = useState('')
  const labels = useMemo(() => loadLabels(), [])
  const labelById = useMemo(() => Object.fromEntries(labels.map(l => [l.id, l])), [labels])

  // ── autosave (mirrors EditTaskModal; subset of fields — partial merge) ──────
  const savePayload = useMemo(() => ({
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
    checklists,
  }), [form.title, form.notes, form.selectedTags, form.dueDate, form.size,
    form.energy, form.energyLevel, form.highPriority, form.lowPriority, checklists])

  const lastSavedJson = useRef(null)
  const [justSaved, setJustSaved] = useState(false)
  const justSavedTimer = useRef(null)
  useEffect(() => {
    const json = JSON.stringify(savePayload)
    if (lastSavedJson.current === null) { lastSavedJson.current = json; return }
    if (lastSavedJson.current === json) return
    if (!savePayload.title) return
    const t = setTimeout(() => {
      lastSavedJson.current = json
      onSave(task.id, savePayload)
      setJustSaved(true)
      if (justSavedTimer.current) clearTimeout(justSavedTimer.current)
      justSavedTimer.current = setTimeout(() => setJustSaved(false), 2000)
    }, 500)
    return () => clearTimeout(t)
  }, [savePayload, onSave, task.id])
  useEffect(() => () => { if (justSavedTimer.current) clearTimeout(justSavedTimer.current) }, [])

  // The debounce timer is cancelled on unmount, so an edit made <500ms before
  // leaving (back arrow or "More options") would silently drop. Flush it.
  const flushSave = () => {
    const json = JSON.stringify(savePayload)
    if (lastSavedJson.current !== null && lastSavedJson.current !== json && savePayload.title) {
      lastSavedJson.current = json
      onSave(task.id, savePayload)
    }
  }
  const handleClose = () => { flushSave(); onClose?.() }

  // ── status (separate path — handles completion / chain-breaks / trello) ─────
  const pickStatus = (s) => {
    setOpenChip(null)
    if (s === status) return
    setStatus(s)
    onStatusChange(task.id, s)
    // done + the chain-breaking moves take the task out of the active list.
    if (['done', 'cancelled', 'backlog', 'project'].includes(s)) handleClose()
  }

  // ── subtasks (single default checklist) ─────────────────────────────────────
  const subItems = checklists.flatMap(cl => (cl.items || []).map(it => ({ ...it, clId: cl.id })))
  const addSub = () => {
    const text = newSub.trim()
    if (!text) return
    setChecklists(prev => {
      const next = prev.length ? prev.map(c => ({ ...c, items: [...(c.items || [])] })) : [{ id: uuid(), name: 'Checklist', items: [] }]
      next[0].items.push({ id: uuid(), text, completed: false })
      return next
    })
    setNewSub('')
  }
  const toggleSub = (clId, itemId) => setChecklists(prev => prev.map(cl =>
    cl.id !== clId ? cl : { ...cl, items: cl.items.map(it => it.id === itemId ? { ...it, completed: !it.completed } : it) }))
  const removeSub = (clId, itemId) => setChecklists(prev => prev.map(cl =>
    cl.id !== clId ? cl : { ...cl, items: cl.items.filter(it => it.id !== itemId) }))

  // ── chip value labels ───────────────────────────────────────────────────────
  const energyMeta = ENERGY.find(e => e.id === form.energy)
  const priorityLabel = form.highPriority ? 'High' : form.lowPriority ? 'Low' : 'Normal'
  const tagChips = form.selectedTags.map(id => labelById[id]).filter(Boolean)

  const chip = (id, label, value, tone) => (
    <button
      type="button"
      className={`wb-edit-chip${openChip === id ? ' is-open' : ''}${tone ? ` wb-edit-chip-${tone}` : ''}`}
      onClick={() => setOpenChip(openChip === id ? null : id)}
    >
      <span className="wb-edit-chip-key">{label}</span>
      <span className="wb-edit-chip-val">{value}</span>
      <ChevronDown size={13} strokeWidth={2.25} className="wb-edit-chip-caret" />
    </button>
  )

  return (
    <ModalShell
      open
      onClose={handleClose}
      title="Edit task"
      width="narrow"
      headerSlot={<AutosaveIndicator saved={justSaved} />}
    >
      <input
        className="wb-edit-title"
        value={form.title}
        onChange={e => form.setTitle(e.target.value)}
        placeholder="Task title"
      />

      <textarea
        className="wb-edit-notes"
        value={form.notes}
        onChange={e => form.setNotes(e.target.value)}
        placeholder="Add details or notes…"
        rows={3}
      />

      {/* Subtasks */}
      <div className="wb-edit-subs">
        {subItems.map(it => (
          <div key={it.id} className="wb-edit-sub">
            <button className={`wb-edit-sub-check${it.completed ? ' is-done' : ''}`} onClick={() => toggleSub(it.clId, it.id)} aria-label={it.completed ? 'Uncheck' : 'Check'}>
              {it.completed && <Check size={12} strokeWidth={3} color="var(--wb-on-action)" />}
            </button>
            <span className={`wb-edit-sub-text${it.completed ? ' is-done' : ''}`}>{it.text}</span>
            <button className="wb-edit-sub-del" onClick={() => removeSub(it.clId, it.id)} aria-label="Remove"><Trash2 size={13} strokeWidth={2} /></button>
          </div>
        ))}
        <div className="wb-edit-sub wb-edit-sub-add">
          <Plus size={15} strokeWidth={2.25} className="wb-edit-sub-addicon" />
          <input
            className="wb-edit-sub-input"
            value={newSub}
            onChange={e => setNewSub(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSub() } }}
            onBlur={addSub}
            placeholder="Add subtask…"
          />
        </div>
      </div>

      {/* Config chips */}
      <div className="wb-edit-chips">
        {chip('status', 'Status', STATUSES.find(s => s.id === status)?.label || status, status === 'done' ? 'done' : null)}
        {chip('due', 'Due', form.dueDate || 'No date')}
        {chip('priority', 'Priority', priorityLabel, form.highPriority ? 'high' : null)}
        {chip('energy', 'Energy', energyMeta ? `${energyMeta.label}${form.energyLevel ? ' ' + '⚡'.repeat(form.energyLevel) : ''}` : 'None')}
        {chip('size', 'Size', form.size || 'Auto')}
        {chip('tags', 'Tags', tagChips.length ? `${tagChips.length} selected` : 'None')}
      </div>

      {/* Inline pickers */}
      {openChip === 'status' && (
        <div className="wb-edit-picker">
          {STATUSES.map(s => (
            <button key={s.id} className={`wb-edit-opt${status === s.id ? ' is-active' : ''}`} onClick={() => pickStatus(s.id)}>{s.label}</button>
          ))}
        </div>
      )}
      {openChip === 'due' && (
        <div className="wb-edit-picker wb-edit-picker-block">
          <DateField value={form.dueDate} onChange={form.setDueDate} />
        </div>
      )}
      {openChip === 'priority' && (
        <div className="wb-edit-picker">
          <button className={`wb-edit-opt${priorityLabel === 'Normal' ? ' is-active' : ''}`} onClick={() => { form.setHighPriority(false); form.setLowPriority(false) }}>Normal</button>
          <button className={`wb-edit-opt${form.highPriority ? ' is-active' : ''}`} onClick={() => { form.setHighPriority(true); form.setLowPriority(false) }}>High</button>
          <button className={`wb-edit-opt${form.lowPriority ? ' is-active' : ''}`} onClick={() => { form.setLowPriority(true); form.setHighPriority(false) }}>Low</button>
        </div>
      )}
      {openChip === 'energy' && (
        <div className="wb-edit-picker wb-edit-picker-block">
          <div className="wb-edit-picker-row">
            {ENERGY.map(e => {
              const E = e.Icon
              return (
                <button key={e.id} className={`wb-edit-opt wb-edit-opt-energy${form.energy === e.id ? ' is-active' : ''}`} style={form.energy === e.id ? { '--ec': e.color } : undefined} onClick={() => { form.setEnergy(form.energy === e.id ? null : e.id); if (!form.energyLevel) form.setEnergyLevel(2) }}>
                  <E size={15} strokeWidth={2} /> {e.label}
                </button>
              )
            })}
          </div>
          {form.energy && (
            <div className="wb-edit-picker-row">
              {DRAIN.map(d => (
                <button key={d.v} className={`wb-edit-opt${form.energyLevel === d.v ? ' is-active' : ''}`} onClick={() => form.setEnergyLevel(d.v)}>
                  {Array.from({ length: d.v }).map((_, i) => <Zap key={i} size={11} strokeWidth={2.5} />)} {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {openChip === 'size' && (
        <div className="wb-edit-picker">
          {SIZES.map(s => (
            <button key={s} className={`wb-edit-opt${form.size === s ? ' is-active' : ''}`} onClick={() => form.setSize(form.size === s ? null : s)}>{s}</button>
          ))}
          <button className="wb-edit-opt wb-edit-opt-auto" onClick={form.handleInferSize} disabled={form.sizing}>
            <Sparkles size={13} strokeWidth={2} /> {form.sizing ? 'Auto…' : 'Auto'}
          </button>
        </div>
      )}
      {openChip === 'tags' && (
        <div className="wb-edit-picker wb-edit-picker-wrap">
          {labels.map(l => (
            <button key={l.id} className={`wb-edit-tag${form.selectedTags.includes(l.id) ? ' is-active' : ''}`} style={{ '--tag': l.color }} onClick={() => form.toggleTag(l.id)}>{l.name}</button>
          ))}
          {labels.length === 0 && <span className="wb-edit-empty">No labels yet.</span>}
        </div>
      )}

      {/* Footer */}
      <div className="wb-edit-footer">
        <button className="wb-edit-more" onClick={() => { flushSave(); onOpenFull() }}>
          <Sliders size={15} strokeWidth={2} /> More options
        </button>
        <button className="wb-edit-delete" onClick={() => { onDelete?.(task.id) }}>
          <Trash2 size={15} strokeWidth={2} /> Delete
        </button>
      </div>
    </ModalShell>
  )
}
