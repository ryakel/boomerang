import { useState, useEffect, useCallback } from 'react'
import { Sprout, Trash2, Pencil, X, Check } from 'lucide-react'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import { getGrowthAreas, createGrowthArea, updateGrowthArea, deleteGrowthArea } from '../api'
import './GrowthAreasModal.css'

const MODE_OPTIONS = [
  { value: 'morning', label: 'Morning', hint: 'Once-a-day rotation' },
  { value: 'persistent', label: 'Persistent', hint: 'Surfaces when relevant' },
  { value: 'both', label: 'Both', hint: 'Morning + relevant moments' },
]

const MODE_LABEL = { morning: 'Morning', persistent: 'Persistent', both: 'Both' }

const ENERGY_LABEL = { desk: 'Desk', people: 'People', errand: 'Errand', confrontation: 'Confrontation', creative: 'Creative', physical: 'Physical' }

function AreaRow({ area, onUpdate, onDelete, busy }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(area.title)
  const [mode, setMode] = useState(area.mode)

  const save = async () => {
    const t = title.trim()
    if (!t) return
    await onUpdate(area.id, { title: t, mode })
    setEditing(false)
  }
  const cancel = () => { setTitle(area.title); setMode(area.mode); setEditing(false) }

  if (editing) {
    return (
      <li className="v2-growth-row v2-growth-row-editing">
        <input
          className="v2-growth-edit-input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          autoFocus
        />
        <select className="v2-growth-edit-mode" value={mode} onChange={e => setMode(e.target.value)}>
          {MODE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <button className="v2-growth-icon-btn" onClick={save} disabled={busy} title="Save">
          <Check size={16} strokeWidth={2} />
        </button>
        <button className="v2-growth-icon-btn" onClick={cancel} disabled={busy} title="Cancel">
          <X size={16} strokeWidth={2} />
        </button>
      </li>
    )
  }

  return (
    <li className={`v2-growth-row ${area.active ? '' : 'v2-growth-row-inactive'}`}>
      <div className="v2-growth-row-main">
        <span className="v2-growth-title">{area.title}</span>
        <div className="v2-growth-chips">
          <span className="v2-growth-chip">{MODE_LABEL[area.mode] || area.mode}</span>
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

export default function GrowthAreasModal({ open, onClose }) {
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newMode, setNewMode] = useState('both')
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
      const area = await createGrowthArea({ title: t, mode: newMode })
      setAreas(prev => [...prev, area])
      setNewTitle('')
      setNewMode('both')
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
        <input
          className="v2-growth-add-input"
          placeholder="e.g. Be more patient on calls"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          maxLength={80}
        />
        <select className="v2-growth-add-mode" value={newMode} onChange={e => setNewMode(e.target.value)}>
          {MODE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <button className="v2-growth-add-btn" type="submit" disabled={adding || !newTitle.trim()}>
          {adding ? '...' : 'Add'}
        </button>
      </form>
      <div className="v2-growth-hint">Works best with 2-3 active areas — a longer list just means each one is seen less often.</div>

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
