import { useEffect, useMemo, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import SheetPortal from './SheetPortal'
import { useCalendarEvents } from './today2Hooks'
import { gcalStatus } from '../api'
import { loadSettings } from '../store'
import { localYMD } from '../dates'
import { normalizeEvents } from '../todayModel'
import { BLOCK_LENGTHS, defaultBlockMinutes, suggestSlots, slotLabel, blockLabel } from '../blockModel'
import { setTaskBlock, removeTaskBlock } from '../blockActions'
import './alarm.css'

// "Give it a block" (BOOM-57): one Google Calendar event for this task, at a
// free slot Boomerang suggests or a time you pick. Moving keeps the same event;
// Remove deletes only that event. Nothing happens until you tap.
export default function BlockSheet({ task, updateTask, onClose }) {
  const todayKey = localYMD()
  const raw = useCalendarEvents(todayKey)
  const [connected, setConnected] = useState(null) // null = checking
  useEffect(() => {
    let live = true
    gcalStatus().then(s => { if (live) setConnected(!!s?.connected) }).catch(() => { if (live) setConnected(false) })
    return () => { live = false }
  }, [])

  const [minutes, setMinutes] = useState(() => task.block_minutes || defaultBlockMinutes(task))
  const [picked, setPicked] = useState(null) // a suggested slot's startMs
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const now = Date.now()

  const events = useMemo(() => normalizeEvents(raw || [], []), [raw])
  const slots = useMemo(() => suggestSlots({ events, now, minutes, ignoreEventId: task.block_event_id }),
    // `now` moves every render; the minute is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, minutes, task.block_event_id, Math.floor(now / 60000)])
  const chosen = date && time ? new Date(`${date}T${time}`).getTime() : null
  const startMs = chosen ?? picked
  const current = blockLabel(task, now)

  const run = async (fn) => {
    setBusy(true); setError(null)
    try { await fn(); onClose() } catch (e) { setError(e.message || 'Something went wrong.') } finally { setBusy(false) }
  }
  const save = () => run(() => setTaskBlock(task, { startMs, minutes }, { calendarId: loadSettings().gcal_calendar_id || 'primary', updateTask }))
  const remove = () => run(() => removeTaskBlock(task, { updateTask }))

  return (
    <SheetPortal>
      <div className="bm-sheet-backdrop bm-block-backdrop" onClick={onClose}>
        <div className="bm-sheet bm-t2 t2-sheet al-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Block">
          <div className="bm-grabber" />
          <h2 className="bm-sheet-title">{current ? 'Your block' : 'Give it a block'}</h2>
          <p className="t2-sheet-sub">{current
            ? <>Blocked {current}. Move it or remove it; only this event changes.</>
            : <>One event on your calendar for {task.title}. Nothing else goes there.</>}</p>

          {connected === false && (
            <p className="al-note al-left" role="alert">Connect Google Calendar in Settings to give tasks a block.</p>
          )}
          {connected && (
            <>
              <div className="al-time">
                <span>Length</span>
                <div className="al-toggle" role="radiogroup" aria-label="Length">
                  {BLOCK_LENGTHS.map(n => (
                    <button key={n} role="radio" aria-checked={minutes === n} className={minutes === n ? 'is-on' : ''} onClick={() => setMinutes(n)}>{n} min</button>
                  ))}
                </div>
              </div>

              <p className="al-note al-left">{raw === null ? 'Checking your calendar…' : slots.length ? 'Free on your calendar' : 'No free time left today or tomorrow. Pick a time below.'}</p>
              {slots.map(sl => (
                <button key={sl.startMs} className={`al-kv${picked === sl.startMs && !chosen ? ' is-picked' : ''}`} aria-pressed={picked === sl.startMs && !chosen}
                  onClick={() => { setPicked(sl.startMs); setDate(''); setTime('') }}>
                  <CalendarClock size={15} strokeWidth={2} aria-hidden="true" />
                  <span>{slotLabel(sl.startMs, minutes, now)}</span>
                </button>
              ))}

              <div className="al-time">
                <span>Or pick</span>
                <span className="al-add-row">
                  <input type="date" aria-label="Block date" value={date} min={todayKey} onChange={e => setDate(e.target.value)} />
                  <input type="time" aria-label="Block time" value={time} step={900} onChange={e => setTime(e.target.value)} />
                </span>
              </div>
              {chosen && <p className="al-note al-left">{slotLabel(chosen, minutes, now)}</p>}
            </>
          )}

          {error && <p className="al-note al-error" role="alert">{error}</p>}
          <div className="al-actions">
            {current
              ? <button className="t2-btn t2-btn-ghost" disabled={busy} onClick={remove}>Remove block</button>
              : <button className="t2-btn t2-btn-ghost" onClick={onClose}>Cancel</button>}
            {connected && (
              <button className="t2-btn t2-btn-primary" disabled={busy || !startMs} onClick={save}>
                {busy ? 'Saving…' : current ? 'Move block' : 'Block it'}
              </button>
            )}
          </div>
        </div>
      </div>
    </SheetPortal>
  )
}
