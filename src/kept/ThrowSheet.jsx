import { useEffect, useRef, useState } from 'react'
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
  const inputRef = useRef(null)
  const sheetRef = useRef(null)

  // Keyboard-occlusion handling — same visualViewport pattern BottomTabs.jsx
  // and FloatingCapture.jsx already use. Without this, an input this close to
  // the bottom of the layout viewport gets panned/covered by the iOS
  // keyboard, and the sheet (a fixed bottom overlay) never moves out of the
  // way of it.
  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    const sheet = sheetRef.current
    if (!vv || !sheet) return
    const update = () => {
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      sheet.style.transform = occluded > 0 ? `translateY(${-occluded}px)` : ''
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      sheet.style.transform = ''
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [open])

  // Escape closes, same as every other modal/sheet primitive (ModalShell,
  // ConfirmDialog) — this sheet previously only dismissed via backdrop tap.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  // Blur before closing — otherwise the focused input unmounts while the
  // keyboard is still up, and its dismiss animation unwinds mid-re-render of
  // whatever's now visible underneath (prod report: new tasks landing behind
  // the collapsing keyboard).
  const closeAndBlur = () => {
    inputRef.current?.blur()
    onClose?.()
  }

  const send = () => {
    const t = title.trim()
    if (!t) return
    onThrow?.({ title: t, dueDate: resolve(dateId) })
    setTitle(''); setDateId('none')
    closeAndBlur()
  }

  const openMoreOptions = () => {
    closeAndBlur()
    onMoreOptions?.({ title: title.trim(), dueDate: resolve(dateId) })
  }

  return (
    <div className="bm-sheet-backdrop" onClick={closeAndBlur}>
      <div className="bm-sheet" ref={sheetRef} onClick={e => e.stopPropagation()}>
        <div className="bm-grabber" />
        <h3 className="bm-sheet-title">Throw a task</h3>
        <input
          ref={inputRef}
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
          <button className="bm-btn bm-btn-ghost" onClick={openMoreOptions} aria-label="More options">
            <SlidersHorizontal size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
