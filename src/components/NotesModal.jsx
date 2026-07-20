import { useState } from 'react'
import { StickyNote, Trash2, Pencil, X, Check, Pin, PinOff, ListPlus, Sprout } from 'lucide-react'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import { GrowthAreasPanel } from './GrowthAreasModal'
import './NotesModal.css'

function fmtWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NoteRow({ note, onUpdate, onDelete, onPromote, busy }) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(note.body)

  const save = async () => {
    const b = body.trim()
    if (!b) return
    await onUpdate(note.id, { body: b })
    setEditing(false)
  }
  const cancel = () => {
    setBody(note.body)
    setEditing(false)
  }

  if (editing) {
    return (
      <li className="v2-notes-row v2-notes-row-editing">
        <textarea
          className="v2-notes-edit-input"
          value={body}
          onChange={e => setBody(e.target.value)}
          autoFocus
        />
        <div className="v2-notes-row-editing-actions">
          <button className="v2-notes-icon-btn" onClick={save} disabled={busy || !body.trim()} title="Save">
            <Check size={16} strokeWidth={2} />
          </button>
          <button className="v2-notes-icon-btn" onClick={cancel} disabled={busy} title="Cancel">
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className={`v2-notes-row${note.pinned ? ' v2-notes-row-pinned' : ''}`}>
      <div className="v2-notes-row-main">
        <span className="v2-notes-body">{note.body}</span>
        <span className="v2-notes-meta">
          {note.pinned ? 'Pinned to Today · ' : ''}{fmtWhen(note.updated_at || note.created_at)}
        </span>
      </div>
      <div className="v2-notes-row-actions">
        <button
          className={`v2-notes-icon-btn${note.pinned ? ' is-pinned' : ''}`}
          onClick={() => onUpdate(note.id, { pinned: !note.pinned })}
          disabled={busy}
          title={note.pinned ? 'Unpin from Today' : 'Pin to Today'}
        >
          {note.pinned ? <PinOff size={15} strokeWidth={1.75} /> : <Pin size={15} strokeWidth={1.75} />}
        </button>
        <button className="v2-notes-icon-btn" onClick={() => setEditing(true)} disabled={busy} title="Edit">
          <Pencil size={15} strokeWidth={1.75} />
        </button>
        <button className="v2-notes-icon-btn" onClick={() => onPromote(note)} disabled={busy} title="Make it a task">
          <ListPlus size={15} strokeWidth={1.75} />
        </button>
        <button className="v2-notes-icon-btn v2-notes-icon-btn-danger" onClick={() => onDelete(note.id)} disabled={busy} title="Delete">
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </div>
    </li>
  )
}

// Notebook — the "things I tell myself" surface (2026-07-19 More
// consolidation): Notes on top, Growth areas below. Notes are one-off
// thoughts with no task semantics (no due date, no status, no points, no
// nagging; pinned notes show as a sticky strip on Today; "Make it a task"
// promotes first line → title, rest → task notes). Growth areas are the
// standing self-reminders — same CRUD panel the legacy-theme Growth areas
// modal wraps. Component keeps the NotesModal name; renaming plumbing
// provides no value.
export default function NotesModal({ open, onClose, notes = [], loading = false, onAdd, onUpdate, onDelete, onPromote }) {
  const [newBody, setNewBody] = useState('')
  const [newPinned, setNewPinned] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)

  const handleAdd = async (e) => {
    e.preventDefault()
    const b = newBody.trim()
    if (!b) return
    setAdding(true)
    setError(null)
    try {
      await onAdd({ body: b, pinned: newPinned })
      setNewBody('')
      setNewPinned(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const wrap = (id, fn) => async (...args) => {
    setBusyId(id)
    setError(null)
    try {
      await fn(...args)
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
      title="Notebook"
      subtitle="Notes and standing reminders about yourself — nothing here nags or needs checking off"
      width="narrow"
    >
      <form className="v2-notes-add" onSubmit={handleAdd}>
        <textarea
          className="v2-notes-add-input"
          placeholder="Jot something down…"
          value={newBody}
          onChange={e => setNewBody(e.target.value)}
          maxLength={4000}
        />
        <div className="v2-notes-add-row">
          <label className="v2-notes-add-pin">
            <input type="checkbox" checked={newPinned} onChange={e => setNewPinned(e.target.checked)} />
            Pin to Today
          </label>
          <button className="v2-notes-add-btn" type="submit" disabled={adding || !newBody.trim()}>
            {adding ? '...' : 'Add note'}
          </button>
        </div>
      </form>
      <div className="v2-notes-hint">
        Pinned notes stay visible at the top of Today — like a note on the fridge.
        If a note turns out to be something you need to actually do, promote it with "Make it a task."
      </div>

      {error && <div className="v2-notes-error">{error}</div>}

      {notes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title={loading ? 'Loading…' : 'No notes yet'}
          body="Notes are for thoughts that aren't tasks — an idea, a reminder-to-self, something to mention to someone. They never nag."
        />
      ) : (
        <ul className="v2-notes-list">
          {notes.map(n => (
            <NoteRow
              key={n.id}
              note={n}
              busy={busyId === n.id}
              onUpdate={wrap(n.id, onUpdate)}
              onDelete={wrap(n.id, onDelete)}
              onPromote={wrap(n.id, onPromote)}
            />
          ))}
        </ul>
      )}

      <div className="v2-notebook-sec">
        <Sprout size={16} strokeWidth={2} />
        <span>Growth areas</span>
      </div>
      <div className="v2-notebook-sec-sub">
        Standing reminders about yourself — resurfaced on Today in fresh wording, never a static banner.
      </div>
      <GrowthAreasPanel />
    </ModalShell>
  )
}
