import { useRef, useState, useCallback } from 'react'
import './shell.css'

// Pull-down-to-refresh for the Kept mobile shell. Wraps the scrolling
// surface: dragging down while the scroller is at its top reveals a
// boomerang spinner; releasing past the threshold runs `onRefresh`
// (the server refetch) and holds the spinner until it resolves.
const THRESHOLD = 64
const MAX_PULL = 96

export default function PullToRefresh({ onRefresh, children }) {
  const ref = useRef(null)
  const startY = useRef(null)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const onTouchStart = useCallback((e) => {
    if (refreshing) return
    if ((ref.current?.scrollTop ?? 1) <= 0) {
      startY.current = e.touches[0].clientY
    } else {
      startY.current = null
    }
  }, [refreshing])

  const onTouchMove = useCallback((e) => {
    if (startY.current == null || refreshing) return
    const dy = e.touches[0].clientY - startY.current
    if (dy <= 0 || (ref.current?.scrollTop ?? 0) > 0) {
      setPull(0)
      return
    }
    // dampened drag, capped
    setPull(Math.min(MAX_PULL, dy * 0.45))
  }, [refreshing])

  const onTouchEnd = useCallback(async () => {
    if (startY.current == null) return
    startY.current = null
    if (pull >= THRESHOLD && !refreshing) {
      setRefreshing(true)
      setPull(THRESHOLD * 0.75)
      try { await onRefresh?.() } catch { /* indicator still resets */ }
      setRefreshing(false)
    }
    setPull(0)
  }, [pull, refreshing, onRefresh])

  const active = pull > 0 || refreshing
  const shown = refreshing ? THRESHOLD * 0.75 : pull

  return (
    <div
      ref={ref}
      className="bm-shell-surface"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className={`bm-ptr${refreshing ? ' is-refreshing' : ''}`} style={{ height: active ? shown : 0 }} aria-hidden={!active}>
        <svg
          className="bm-ptr-mark"
          style={{ opacity: Math.min(1, shown / THRESHOLD), transform: refreshing ? undefined : `rotate(${shown * 3}deg)` }}
          width="22" height="22" viewBox="0 0 100 100" fill="none"
        >
          <path d="M 22 52 C 30 18, 70 18, 78 52" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
          <circle cx="78" cy="52" r="8" fill="currentColor" />
        </svg>
      </div>
      {children}
    </div>
  )
}
