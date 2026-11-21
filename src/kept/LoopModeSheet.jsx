import { useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import SheetPortal from './SheetPortal'
import './alarm.css'
import './loops2.css'

// Switching a loop's mode from its own page (BOOM-54). It used to open the old
// RoutinesModal editor for anything structural. These sheets set exactly what
// that editor sets for a mode change, in the same field shapes, and save
// through the same update path (updateRoutineFromEditor):
//   practice  → spawn_mode 'habit' + target_count/target_period, no ringing
//   checklist → members [{ id, title }] (and back to spawn_mode 'auto')
//   reminder  → from a checklist, members [] after a confirm
// A loop's mode stays derived (src/loopModes.js); nothing stores a mode.

const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`)

function Sheet({ title, sub, onClose, children }) {
  return (
    <SheetPortal>
      <div className="bm-sheet-backdrop" onClick={onClose}>
        <div className="bm-sheet bm-t2 t2-sheet al-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
          <div className="bm-grabber" />
          <h2 className="bm-sheet-title">{title}</h2>
          {sub && <p className="t2-sheet-sub">{sub}</p>}
          {children}
        </div>
      </div>
    </SheetPortal>
  )
}

export default function LoopModeSheet({ kind, routine, onClose, onSave }) {
  if (kind === 'practice') return <PracticeSheet routine={routine} onClose={onClose} onSave={onSave} />
  if (kind === 'checklist') return <ChecklistSheet routine={routine} onClose={onClose} onSave={onSave} />
  if (kind === 'reminder') return <ReminderSheet routine={routine} onClose={onClose} onSave={onSave} />
  return null
}

function PracticeSheet({ routine, onClose, onSave }) {
  const [count, setCount] = useState(Math.max(1, Number(routine.target_count) || 3))
  const [period, setPeriod] = useState(routine.target_period === 'month' ? 'month' : 'week')
  const items = Array.isArray(routine.members) ? routine.members.length : 0
  const max = period === 'month' ? 31 : 14
  const save = () => onSave({
    spawn_mode: 'habit', target_count: Math.min(max, Math.max(1, count)), target_period: period,
    remind: false, auto_roll: false,
    ...(items ? { members: [] } : {}),
  })
  return (
    <Sheet title="Practice" sub="No task and no due date. Log it when you do it. The target is a direction, not a score." onClose={onClose}>
      <div className="al-time">
        <span>Aim for</span>
        <span className="lp-stepper">
          <button className="al-x" aria-label="Fewer" onClick={() => setCount(c => Math.max(1, c - 1))}><Minus size={15} strokeWidth={2.2} /></button>
          <b aria-live="polite">{count}</b>
          <button className="al-x" aria-label="More" onClick={() => setCount(c => Math.min(max, c + 1))}><Plus size={15} strokeWidth={2.2} /></button>
        </span>
      </div>
      <div className="al-time">
        <span>Each</span>
        <div className="al-toggle" role="radiogroup" aria-label="Each">
          <button role="radio" aria-checked={period === 'week'} className={period === 'week' ? 'is-on' : ''} onClick={() => setPeriod('week')}>Week</button>
          <button role="radio" aria-checked={period === 'month'} className={period === 'month' ? 'is-on' : ''} onClick={() => { setPeriod('month') }}>Month</button>
        </div>
      </div>
      {items > 0 && (
        <p className="al-note al-left" role="alert">Practice has no checklist, so its {items} item{items === 1 ? '' : 's'} will be removed.</p>
      )}
      <div className="al-actions">
        <button className="t2-btn t2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="t2-btn t2-btn-primary" onClick={save}>{items > 0 ? 'Remove items and switch' : 'Switch to practice'}</button>
      </div>
    </Sheet>
  )
}

function ChecklistSheet({ routine, onClose, onSave }) {
  const [items, setItems] = useState(() => (Array.isArray(routine.members) ? routine.members : []).map(m => ({ ...m })))
  const [draft, setDraft] = useState('')
  const add = () => {
    const title = draft.trim()
    if (!title) return
    setItems(list => [...list, { id: uid(), title }])
    setDraft('')
  }
  const clean = [...items, ...(draft.trim() ? [{ id: uid(), title: draft.trim() }] : [])]
    .filter(m => (m.title || '').trim())
    .map(m => ({ ...m, title: m.title.trim() }))
  const leavesMode = routine.spawn_mode === 'habit' || routine.spawn_mode === 'autopilot'
  const save = () => onSave({
    members: clean,
    ...(leavesMode ? { spawn_mode: 'auto', target_count: null, target_period: null } : {}),
  })
  return (
    <Sheet title="Checklist" sub="A set of items that comes back together. Each one shows up on Today when it’s due." onClose={onClose}>
      {items.map((m, i) => (
        <div key={m.id || i} className="al-time">
          <input className="v2-form-input al-input lp-item-input" value={m.title} aria-label={`Item ${i + 1}`} maxLength={200}
            onChange={e => setItems(list => list.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
          <button className="al-x" aria-label={`Remove ${m.title || 'item'}`} onClick={() => setItems(list => list.filter((_, j) => j !== i))}><X size={14} strokeWidth={2.2} /></button>
        </div>
      ))}
      <div className="al-add-row al-address">
        <input className="v2-form-input al-input" placeholder={items.length ? 'Add another item' : 'First item'} value={draft} maxLength={200}
          onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} aria-label="New item" />
        <button className="t2-chip" onClick={add} disabled={!draft.trim()}>Add</button>
      </div>
      <div className="al-actions">
        <button className="t2-btn t2-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="t2-btn t2-btn-primary" disabled={!clean.length} onClick={save}>Save checklist</button>
      </div>
      <p className="al-note">The time it comes back is set in Edit.</p>
    </Sheet>
  )
}

function ReminderSheet({ routine, onClose, onSave }) {
  const n = Array.isArray(routine.members) ? routine.members.length : 0
  return (
    <Sheet title="Make it a reminder?" sub={`A reminder is one task each time it comes back. Its ${n} checklist item${n === 1 ? '' : 's'} will be removed.`} onClose={onClose}>
      <div className="al-actions">
        <button className="t2-btn t2-btn-ghost" onClick={onClose}>Keep the checklist</button>
        <button className="t2-btn t2-btn-primary" onClick={() => onSave({ members: [] })}>Remove items</button>
      </div>
    </Sheet>
  )
}
