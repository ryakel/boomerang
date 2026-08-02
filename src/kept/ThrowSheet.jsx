import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { localYMD, addDays, localDateTimeValue, nextHalfHour } from '../dates'
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

// The Throw sheet — quick capture (spec §6). Title + a mode-specific second
// row; "More options" hands off to the full AddTaskModal with nothing lost.
//
// THREE MODES, one control: Task | Reminder | Note (2026-08-02). Each swaps the
// row under the title for the only thing that mode needs — day chips for a
// task, a date-and-time picker for a reminder, nothing for a note. They are
// alternatives to each other, which is exactly what the toggle at the top
// already says, so a reminder is picked the same way a note is rather than
// hidden behind an extra chip in an extra row at the bottom.
//
// A reminder is still an ordinary task carrying remind_at — the mode picks the
// SHAPE of the capture, not a different kind of record. And a reminder with no
// due date lands on Today: TodayView reads remind_at as the day when there is
// no due date, so nothing here needs to set one.
export default function ThrowSheet({ open, onClose, onThrow, onThrowNote, onMoreOptions }) {
  const [title, setTitle] = useState('')
  const [dateId, setDateId] = useState('none')
  const [mode, setMode] = useState('task')
  const [remindAt, setRemindAt] = useState('')
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
      onThrow?.({
        title: t,
        dueDate: mode === 'reminder' ? null : resolve(dateId),
        remindAt: mode === 'reminder' ? (remindAt || null) : null,
      })
    }
    setTitle(''); setDateId('none'); setRemindAt('')
    closeAndBlur()
  }

  const openMoreOptions = () => {
    closeAndBlur()
    // Hand the reminder over too — a value typed here and then silently
    // dropped on the way to the full editor is the same class of bug as the
    // title/date handoff this callback exists to fix.
    onMoreOptions?.({
      title: title.trim(),
      dueDate: mode === 'reminder' ? null : resolve(dateId),
      remindAt: mode === 'reminder' ? (remindAt || null) : null,
    })
  }

  // Switching INTO reminder mode seeds the picker, so the common case is one
  // tap and done. Seeding on mount instead would mean every task capture
  // carried a time it never asked for.
  const pickMode = (m) => {
    setMode(m)
    if (m === 'reminder' && !remindAt) setRemindAt(localDateTimeValue(nextHalfHour()))
  }

  const HEADINGS = { task: 'Throw a task', reminder: 'Set a reminder', note: 'Leave a note' }
  const PLACEHOLDERS = {
    task: 'What needs doing?',
    reminder: 'What should I remind you about?',
    note: 'What do you want to remember?',
  }
  const ACTIONS = { task: 'Throw it', reminder: 'Set it', note: 'Leave it' }

  return (
    <div className="bm-sheet-backdrop" onClick={closeAndBlur}>
      <div className="bm-sheet" ref={sheetRef} onClick={e => e.stopPropagation()}>
        <div className="bm-sheet-handle" {...handleProps}>
          <div className="bm-grabber" />
        </div>
        <div className="bm-throw-mode-row">
          <h3 className="bm-sheet-title">{HEADINGS[mode]}</h3>
          <div className="bm-throw-mode">
            <button className={`bm-pick${mode === 'task' ? ' is-on' : ''}`} onClick={() => pickMode('task')}>Task</button>
            <button className={`bm-pick${mode === 'reminder' ? ' is-on' : ''}`} onClick={() => pickMode('reminder')}>Reminder</button>
            <button className={`bm-pick${mode === 'note' ? ' is-on' : ''}`} onClick={() => pickMode('note')}>Note</button>
          </div>
        </div>
        <input
          ref={inputRef}
          className="bm-throw-input"
          placeholder={PLACEHOLDERS[mode]}
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
        {mode === 'reminder' && (
          // The row a reminder needs, in the slot the day chips occupy for a
          // task — same position, same rhythm, no extra row.
          <input
            type="datetime-local"
            className="bm-throw-when"
            aria-label="Reminder time"
            value={remindAt}
            onChange={e => setRemindAt(e.target.value)}
          />
        )}
        <div className="bm-throw-actions">
          <button className="bm-btn bm-btn-fill" onClick={send} disabled={!title.trim()}>
            {ACTIONS[mode]}
          </button>
          {/* A reminder is still a task, so the full editor is just as valid a
              destination for one as it is for a plain capture. */}
          {mode !== 'note' && (
            <button className="bm-btn bm-btn-ghost" onClick={openMoreOptions} aria-label="More options">
              <SlidersHorizontal size={15} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
