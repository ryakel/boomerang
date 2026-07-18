import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { localYMD, addDays } from '../dates'
import useSheetSwipeDown from '../hooks/useSheetSwipeDown'
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
// options" hands off to the full AddTaskModal with nothing lost. A Task|Note
// mode toggle (2026-07-18) makes jotting a note as fast as adding a task —
// note mode drops the date chips (notes have no dates) and routes to
// onThrowNote instead.
export default function ThrowSheet({ open, onClose, onThrow, onThrowNote, onMoreOptions }) {
  const [title, setTitle] = useState('')
  const [dateId, setDateId] = useState('none')
  const [mode, setMode] = useState('task')
  const inputRef = useRef(null)
  const sheetRef = useRef(null)
  // The keyboard-occlusion offset below (px, <= 0) — kept in a ref rather
  // than composed ad-hoc so the swipe-down handler can add its own live drag
  // offset on top of it without the two effects fighting over
  // sheet.style.transform.
  const kbOffsetRef = useRef(0)

  // Blur before closing — otherwise the focused input unmounts while the
  // keyboard is still up, and its dismiss animation unwinds mid-re-render of
  // whatever's now visible underneath (prod report: new tasks landing behind
  // the collapsing keyboard).
  const closeAndBlur = () => {
    inputRef.current?.blur()
    onClose?.()
  }

  const { applyExtraOffset, handleProps } = useSheetSwipeDown(sheetRef, closeAndBlur, kbOffsetRef)

  // Keyboard-occlusion handling — same visualViewport pattern BottomTabs.jsx
  // and FloatingCapture.jsx already use. Without this, an input this close to
  // the bottom of the layout viewport gets panned/covered by the iOS
  // keyboard, and the sheet (a fixed bottom overlay) never moves out of the
  // way of it.
  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      kbOffsetRef.current = occluded > 0 ? -occluded : 0
      applyExtraOffset(0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      kbOffsetRef.current = 0
      applyExtraOffset(0)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [open, applyExtraOffset])

  // Escape closes, same as every other modal/sheet primitive (ModalShell,
  // ConfirmDialog) — this sheet previously only dismissed via backdrop tap.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const send = () => {
    const t = title.trim()
    if (!t) return
    if (mode === 'note') {
      onThrowNote?.({ body: t })
    } else {
      onThrow?.({ title: t, dueDate: resolve(dateId) })
    }
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
        <div className="bm-sheet-handle" {...handleProps}>
          <div className="bm-grabber" />
        </div>
        <div className="bm-throw-mode-row">
          <h3 className="bm-sheet-title">{mode === 'note' ? 'Leave a note' : 'Throw a task'}</h3>
          <div className="bm-throw-mode">
            <button className={`bm-pick${mode === 'task' ? ' is-on' : ''}`} onClick={() => setMode('task')}>Task</button>
            <button className={`bm-pick${mode === 'note' ? ' is-on' : ''}`} onClick={() => setMode('note')}>Note</button>
          </div>
        </div>
        <input
          ref={inputRef}
          className="bm-throw-input"
          placeholder={mode === 'note' ? 'What do you want to remember?' : 'What needs doing?'}
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          autoFocus
        />
        {mode === 'task' && (
          <div className="bm-chip-row">
            {DATES.map(d => (
              <button key={d.id} className={`bm-pick${dateId === d.id ? ' is-on' : ''}`} onClick={() => setDateId(d.id)}>{d.label}</button>
            ))}
          </div>
        )}
        <div className="bm-throw-actions">
          <button className="bm-btn bm-btn-fill" onClick={send} disabled={!title.trim()}>
            {mode === 'note' ? 'Leave it' : 'Throw it'}
          </button>
          {mode === 'task' && (
            <button className="bm-btn bm-btn-ghost" onClick={openMoreOptions} aria-label="More options">
              <SlidersHorizontal size={15} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
