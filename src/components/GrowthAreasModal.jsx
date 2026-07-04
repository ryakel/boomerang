import { useState, useEffect, useCallback } from 'react'
import { Sprout, Trash2, Pencil, X, Check } from 'lucide-react'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import { getGrowthAreas, createGrowthArea, updateGrowthArea, deleteGrowthArea } from '../api'
import './GrowthAreasModal.css'

const DAY_SCOPE_OPTIONS = [
  { value: 'any', label: 'Any day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekends', label: 'Weekends' },
]
const DAY_SCOPE_LABEL = { any: 'Any day', weekdays: 'Weekdays', weekends: 'Weekends' }

const ENERGY_LABEL = { desk: 'Desk', people: 'People', errand: 'Errand', confrontation: 'Confrontation', creative: 'Creative', physical: 'Physical' }

// Morning/evening/persistent are independent — an area can be any
// combination (e.g. "leave work at work" as evening + weekdays-only).
// Shared by both the add form and the inline row editor.
function TimingControls({ morning, evening, persistent, dayScope, onChange, idPrefix }) {
  return (
    <div className="v2-growth-timing">
      <div className="v2-growth-timing-checks">
        <label className="v2-growth-timing-check">
          <input type="checkbox" checked={morning} onChange={e => onChange({ morning: e.target.checked })} />
          Morning
        </label>
        <label className="v2-growth-timing-check">
          <input type="checkbox" checked={evening} onChange={e => onChange({ evening: e.target.checked })} />
          Evening
        </label>
        <label className="v2-growth-timing-check">
          <input type="checkbox" checked={persistent} onChange={e => onChange({ persistent: e.target.checked })} />
          Persistent
        </label>
      </div>
      <select
        className="v2-growth-add-mode"
        aria-label="Which days this applies to"
        value={dayScope}
        onChange={e => onChange({ day_scope: e.target.value })}
        id={idPrefix ? `${idPrefix}-day-scope` : undefined}
      >
        {DAY_SCOPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function AreaRow({ area, onUpdate, onDelete, busy }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(area.title)
  const [timing, setTiming] = useState({
    morning: !!area.morning, evening: !!area.evening, persistent: !!area.persistent, day_scope: area.day_scope || 'any',
  })

  const save = async () => {
    const t = title.trim()
    if (!t) return
    await onUpdate(area.id, { title: t, ...timing })
    setEditing(false)
  }
  const cancel = () => {
    setTitle(area.title)
    setTiming({ morning: !!area.morning, evening: !!area.evening, persistent: !!area.persistent, day_scope: area.day_scope || 'any' })
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="v2-growth-row v2-growth-row-editing">
        <input
          className="v2-growth-edit-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          autoFocus
        />
        <TimingControls
          morning={timing.morning} evening={timing.evening} persistent={timing.persistent} dayScope={timing.day_scope}
          onChange={patch => setTiming(prev => ({ ...prev, ...patch }))}
          idPrefix={`edit-${area.id}`}
        />
        <div className="v2-growth-row-editing-actions">
          <button className="v2-growth-icon-btn" onClick={save} disabled={busy} title="Save">
            <Check size={16} strokeWidth={2} />
          </button>
          <button className="v2-growth-icon-btn" onClick={cancel} disabled={busy} title="Cancel">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className={`v2-growth-row ${area.active ? '' : 'v2-growth-row-inactive'}`}>
      <div className="v2-growth-row-main">
        <span className="v2-growth-title">{area.title}</span>
        <div className="v2-growth-chips">
          {area.morning && <span className="v2-growth-chip">Morning</span>}
          {area.evening && <span className="v2-growth-chip">Evening</span>}
          {area.persistent && <span className="v2-growth-chip">Persistent</span>}
          {area.day_scope && area.day_scope !== 'any' && (
            <span className="v2-growth-chip v2-growth-chip-scope">{DAY_SCOPE_LABEL[area.day_scope]}</span>
          )}
          {area.energy_affinity && (
            <span className="v2-growth-chip v2-growth-chip-energy">{ENERGY_LABEL[area.energy_affinity] || area.energy_affinity}</span>
          )}
        </div>
      </div>
      <div className="v2-growth-row-actions">
        <label className="v2-settings-toggle" title={area.active ? 'Active' : 'Paused'}>
          <input
            type="checkbox"
            checked={!!area.active}
            disabled={busy}
            onChange={e => onUpdate(area.id, { active: e.target.checked })}
          />
          <span className="v2-settings-toggle-track"><span className="v2-settings-toggle-thumb" /></span>
        </label>
        <button className="v2-growth-icon-btn" onClick={() => setEditing(true)} disabled={busy} title="Edit">
          <Pencil size={15} strokeWidth={1.75} />
        </button>
        <button className="v2-growth-icon-btn v2-growth-icon-btn-danger" onClick={() => onDelete(area.id)} disabled={busy} title="Delete">
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </div>
    </li>
  )
}

const DEFAULT_TIMING = { morning: true, evening: false, persistent: true, day_scope: 'any' }

export default function GrowthAreasModal({ open, onClose }) {
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newTiming, setNewTiming] = useState(DEFAULT_TIMING)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await getGrowthAreas()
      setAreas(list)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const handleAdd = async (e) => {
    e.preventDefault()
    const t = newTitle.trim()
    if (!t) return
    setAdding(true)
    setError(null)
    try {
      const area = await createGrowthArea({ title: t, ...newTiming })
      setAreas(prev => [...prev, area])
      setNewTitle('')
      setNewTiming(DEFAULT_TIMING)
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const handleUpdate = async (id, updates) => {
    setBusyId(id)
    try {
      const area = await updateGrowthArea(id, updates)
      setAreas(prev => prev.map(a => (a.id === id ? area : a)))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (id) => {
    setBusyId(id)
    try {
      await deleteGrowthArea(id)
      setAreas(prev => prev.filter(a => a.id !== id))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Growth areas"
      subtitle="Standing reminders about yourself — not tasks, nothing to check off"
      width="narrow"
    >
      <form className="v2-growth-add" onSubmit={handleAdd}>
        <div className="v2-growth-add-row">
          <input
            className="v2-growth-add-input"
            placeholder="e.g. Be more patient on calls"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            maxLength={80}
          />
          <button className="v2-growth-add-btn" type="submit" disabled={adding || !newTitle.trim()}>
            {adding ? '...' : 'Add'}
          </button>
        </div>
        <TimingControls
          morning={newTiming.morning} evening={newTiming.evening} persistent={newTiming.persistent} dayScope={newTiming.day_scope}
          onChange={patch => setNewTiming(prev => ({ ...prev, ...patch }))}
          idPrefix="new-area"
        />
      </form>
      <div className="v2-growth-hint">
        Works best with 2-3 active areas — a longer list just means each one is seen less often.
        Evening + Weekdays is a good fit for work-life-boundary reminders ("leave work at work") — they simply won't come up on a Saturday.
      </div>

      {error && <div className="v2-growth-error">{error}</div>}

      {areas.length === 0 ? (
        <EmptyState
          icon={Sprout}
          title={loading ? 'Loading…' : 'No growth areas yet'}
          body="Add something you want to work on about yourself — Boomerang will resurface it at the right moments, in fresh wording, never as a static banner."
        />
      ) : (
        <ul className="v2-growth-list">
          {areas.map(a => (
            <AreaRow key={a.id} area={a} onUpdate={handleUpdate} onDelete={handleDelete} busy={busyId === a.id} />
          ))}
        </ul>
      )}
    </ModalShell>
  )
}
