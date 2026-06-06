import { useEffect, useRef, useState } from 'react'
import { ListChecks, FolderKanban, Plus, Compass } from 'lucide-react'
import './BottomTabs.css'

const LONG_PRESS_MS = 500

export default function BottomTabs({ onTabChange, onQuickAdd, onAddLongPress, onWhatNow }) {
  const [quickAddOpen, setQuickAddOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)
  const timerRef = useRef(null)
  const firedRef = useRef(false)

  useEffect(() => {
    if (quickAddOpen && inputRef.current) {
      try { inputRef.current.focus() } catch { /* iOS gesture restriction */ }
    }
  }, [quickAddOpen])

  useEffect(() => {
    if (!quickAddOpen) return
    const vv = window.visualViewport
    if (!vv) return
    const bar = document.querySelector('.v2-bottom-tabs')
    if (!bar) return
    const update = () => {
      const occluded = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      bar.style.transform = occluded > 0 ? `translateY(${-occluded}px)` : ''
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      bar.style.transform = ''
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [quickAddOpen])

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }

  const handlePointerDown = () => {
    firedRef.current = false
    timerRef.current = setTimeout(() => {
      firedRef.current = true
      setQuickAddOpen(false)
      onAddLongPress?.()
    }, LONG_PRESS_MS)
  }

  const handlePointerUp = (e) => {
    clearTimer()
    if (!firedRef.current) {
      e.preventDefault()
      setQuickAddOpen(prev => !prev)
    }
  }

  const handlePointerCancel = () => clearTimer()

  const submitAdd = () => {
    const title = draft.trim()
    if (!title) return
    onQuickAdd?.(title)
    setDraft('')
    inputRef.current?.focus()
  }

  const handleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitAdd() }
    else if (e.key === 'Escape') { setQuickAddOpen(false) }
  }

  return (
    <nav className="v2-bottom-tabs" role="tablist" aria-label="Primary navigation">
      {quickAddOpen && (
        <div className="v2-bt-quickadd">
          <input
            ref={inputRef}
            type="text"
            className="v2-bt-quickadd-input"
            placeholder="Quick add a task…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKey}
            autoFocus
          />
          <button
            type="button"
            className="v2-bt-quickadd-submit"
            onClick={submitAdd}
            disabled={!draft.trim()}
            aria-label="Add task"
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>
        </div>
      )}
      <div className="v2-bottom-tabs-row">
        <button
          type="button"
          className="v2-bottom-tab v2-bottom-tab--today"
          onClick={() => onTabChange('today')}
        >
          <span className="v2-bottom-tab-icon-wrap">
            <ListChecks size={22} strokeWidth={1.75} className="v2-bottom-tab-icon" aria-hidden="true" />
          </span>
          <span className="v2-bottom-tab-label">Today</span>
        </button>
        <button
          type="button"
          className="v2-bottom-tab v2-bottom-tab--new"
          onTouchStart={handlePointerDown}
          onTouchEnd={handlePointerUp}
          onTouchCancel={handlePointerCancel}
          onMouseDown={handlePointerDown}
          onMouseUp={handlePointerUp}
          onContextMenu={e => e.preventDefault()}
          aria-label="New task (hold for full editor)"
        >
          <span className="v2-bottom-tab-icon-wrap">
            <Plus size={22} strokeWidth={2} className="v2-bottom-tab-icon" aria-hidden="true" />
          </span>
          <span className="v2-bottom-tab-label">New</span>
        </button>
        <button
          type="button"
          className="v2-bottom-tab v2-bottom-tab--whatnow"
          onClick={onWhatNow}
          aria-label="What can I do now?"
        >
          <span className="v2-bottom-tab-icon-wrap">
            <Compass size={22} strokeWidth={1.75} className="v2-bottom-tab-icon" aria-hidden="true" />
          </span>
          <span className="v2-bottom-tab-label">What now</span>
        </button>
        <button
          type="button"
          className="v2-bottom-tab v2-bottom-tab--spaces"
          onClick={() => onTabChange('spaces')}
        >
          <span className="v2-bottom-tab-icon-wrap">
            <FolderKanban size={22} strokeWidth={1.75} className="v2-bottom-tab-icon" aria-hidden="true" />
          </span>
          <span className="v2-bottom-tab-label">Spaces</span>
        </button>
      </div>
    </nav>
  )
}
