import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { localYMD, addDays } from '../dates'
import './shell.css'

const DATES = [
  { id: 'today', label: 'Today' },
  { id: 'tomorrow', label: 'Tomorrow' },
  { id: 'weekend', label: 'Weekend' },
  { id: 'none', label: 'No date' },
]

function resolve(id) {
  if (id === 'today') return localYMD()
  if (id === 'tomorrow') return localYMD(addDays(new Date(), 1))
  if (id === 'weekend') {
    const d = new Date()
    const toSat = (6 - d.getDay() + 7) % 7 || 7
    return localYMD(addDays(d, toSat))
  }
  return null
}

// The Throw sheet — quick capture (spec §6). Title + smart date chips; "More
// options" hands off to the full AddTaskModal with nothing lost.
export default function ThrowSheet({ open, onClose, onThrow, onMoreOptions }) {
  const [title, setTitle] = useState('')
  const [dateId, setDateId] = useState('none')
  if (!open) return null

  const send = () => {
    const t = title.trim()
    if (!t) return
    onThrow?.({ title: t, dueDate: resolve(dateId) })
    setTitle(''); setDateId('none')
    onClose?.()
  }

  return (
    <div className="bm-sheet-backdrop" onClick={onClose}>
      <div className="bm-sheet" onClick={e => e.stopPropagation()}>
        <div className="bm-grabber" />
        <h3 className="bm-sheet-title">Throw a task</h3>
        <input
          className="bm-throw-input"
          placeholder="What needs doing?"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          autoFocus
        />
        <div className="bm-chip-row">
          {DATES.map(d => (
            <button key={d.id} className={`bm-pick${dateId === d.id ? ' is-on' : ''}`} onClick={() => setDateId(d.id)}>{d.label}</button>
          ))}
        </div>
        <div className="bm-throw-actions">
          <button className="bm-btn bm-btn-fill" onClick={send} disabled={!title.trim()}>Throw it</button>
          <button className="bm-btn bm-btn-ghost" onClick={() => { onClose?.(); onMoreOptions?.() }} aria-label="More options">
            <SlidersHorizontal size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
