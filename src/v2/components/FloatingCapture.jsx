import { useEffect, useRef, useState } from 'react'
import { Plus, Target, X } from 'lucide-react'
import './FloatingCapture.css'

// Right-edge speed-dial. Two circles stacked at the lower-right of the
// viewport — top is "what now" (target/dartboard), bottom is "quick add"
// (+). Each tap expands the circle leftward into a slim card with the
// relevant input. Tap outside or the X closes it.
//
// Why two separate buttons (not a unified composer): user explicitly
// described "pop out from the button for a quick add OR how much time
// kinda thing." Two distinct intents → two affordances. Sharing one
// pop-out would force a tab strip and add friction.
//
// Sits ABOVE the bottom safe-area inset on iOS PWA so the home-bar
// gesture indicator doesn't overlap the +.
const CAPACITIES = [
  { id: '5', label: '5 min', minutes: 5 },
  { id: '15', label: '15 min', minutes: 15 },
  { id: '30', label: '30 min', minutes: 30 },
  { id: '60', label: '1 hr', minutes: 60 },
  { id: '120', label: '2 hr+', minutes: 120 },
]

export default function FloatingCapture({ onAddTask, onOpenWhatNow }) {
  const [mode, setMode] = useState('idle')  // 'idle' | 'add' | 'whatnow'
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  const wrapRef = useRef(null)

  // Focus the input as soon as the add card opens. iOS Safari is finicky
  // about programmatic focus — works reliably from a user-tap callback
  // chain, so we route the focus through the click handler rather than
  // here. Effect is just a safety net for keyboard-only users.
  useEffect(() => {
    if (mode === 'add' && inputRef.current && document.activeElement !== inputRef.current) {
      try { inputRef.current.focus() } catch { /* iOS gesture restrictions — fine */ }
    }
  }, [mode])

  // Tap-outside collapses. Listens at document level; ignores clicks
  // inside the wrap (the FAB itself + its expanded card).
  useEffect(() => {
    if (mode === 'idle') return
    const onDocClick = (e) => {
      if (!wrapRef.current) return
      if (wrapRef.current.contains(e.target)) return
      setMode('idle')
    }
    // Defer attaching the listener so the click that opened us doesn't
    // also immediately close us (capture phase issue).
    const t = setTimeout(() => document.addEventListener('click', onDocClick), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onDocClick)
    }
  }, [mode])

  // Escape key closes any open mode. Useful on desktop; harmless on mobile.
  useEffect(() => {
    if (mode === 'idle') return
    const onKey = (e) => { if (e.key === 'Escape') setMode('idle') }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode])

  // iOS keyboard occlusion fix. When the soft keyboard opens, the floating
  // capture sits at `bottom: 16px` of the layout viewport — but the keyboard
  // covers the bottom ~40% of the screen, so the input lands behind it and
  // the user types blind. Use `visualViewport` to detect the occluded
  // height and translate the wrapper upward by that amount so it floats
  // just above the keyboard. Resize listener handles keyboard show/hide
  // and orientation changes.
  useEffect(() => {
    if (mode !== 'add') return
    const vv = window.visualViewport
    if (!vv) return
    const wrap = wrapRef.current
    if (!wrap) return
    const update = () => {
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      wrap.style.transform = occluded > 0 ? `translateY(${-occluded}px)` : ''
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      wrap.style.transform = ''
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [mode])

  const submitAdd = () => {
    const title = draft.trim()
    if (!title) return
    onAddTask?.(title)
    setDraft('')
    // Keep the card open for rapid-fire capture — user said quick-add is
    // the dominant flow, so the cost of re-tapping + between tasks is real.
    inputRef.current?.focus()
  }

  const handleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitAdd() }
    else if (e.key === 'Escape') { setMode('idle') }
  }

  const pickCapacity = (cap) => {
    setMode('idle')
    onOpenWhatNow?.(cap)
  }

  return (
    <div ref={wrapRef} className="v2-floating-capture" data-mode={mode}>
      {/* Top: What-now (target) — collapsed circle OR expanded chips card */}
      <div className={`v2-fc-slot v2-fc-slot-whatnow${mode === 'whatnow' ? ' v2-fc-slot-open' : ''}`}>
        {mode === 'whatnow' ? (
          <div className="v2-fc-card v2-fc-card-whatnow">
            <div className="v2-fc-chips">
              {CAPACITIES.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className="v2-fc-chip"
                  onClick={() => pickCapacity(c)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="v2-fc-button v2-fc-button-anchor"
              onClick={() => setMode('idle')}
              aria-label="Close"
            >
              <X size={20} strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="v2-fc-button v2-fc-button-whatnow"
            onClick={() => setMode('whatnow')}
            aria-label="What can I do right now?"
          >
            <Target size={20} strokeWidth={2} />
          </button>
        )}
      </div>

      {/* Bottom: Quick-add (+) — collapsed circle OR expanded input card */}
      <div className={`v2-fc-slot v2-fc-slot-add${mode === 'add' ? ' v2-fc-slot-open' : ''}`}>
        {mode === 'add' ? (
          <div className="v2-fc-card v2-fc-card-add">
            <input
              ref={inputRef}
              type="text"
              className="v2-fc-input"
              placeholder="Quick add a task…"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKey}
              autoFocus
            />
            <button
              type="button"
              className="v2-fc-button v2-fc-button-add v2-fc-button-anchor"
              onClick={submitAdd}
              aria-label="Add task"
              disabled={!draft.trim()}
            >
              <Plus size={20} strokeWidth={2} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="v2-fc-button v2-fc-button-add"
            onClick={() => setMode('add')}
            aria-label="Quick add"
          >
            <Plus size={20} strokeWidth={2} />
          </button>
        )}
      </div>
    </div>
  )
}
