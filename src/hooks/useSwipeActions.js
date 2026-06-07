import { useCallback, useRef, useState } from 'react'

// Swipe-left-to-reveal-actions gesture, extracted from the v2 TaskCard so the
// Wallaby TaskRow (and any future row) can reuse the exact same behavior.
// Returns the live offset, open state, the touch handlers to spread on the
// moving element, and a close() helper. `openOffset` should match the revealed
// action panel's width (negative px). Vertical scrolling cancels the swipe.
export function useSwipeActions({ openOffset = -132, threshold = 56, vertCancel = 12, disabled = false } = {}) {
  const [x, setX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const [open, setOpen] = useState(false)
  const start = useRef(null)

  const close = useCallback(() => { setOpen(false); setX(0) }, [])

  const onTouchStart = useCallback((e) => {
    if (disabled) return
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, startX: x }
  }, [x, disabled])

  const onTouchMove = useCallback((e) => {
    if (disabled || !start.current) return
    const t = e.touches[0]
    const dx = t.clientX - start.current.x
    const dy = t.clientY - start.current.y
    if (!swiping && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > vertCancel) {
      start.current = null
      return
    }
    if (Math.abs(dx) > 8) {
      setSwiping(true)
      const next = start.current.startX + dx
      setX(Math.max(openOffset, Math.min(0, next)))
    }
  }, [swiping, disabled, vertCancel, openOffset])

  const onTouchEnd = useCallback(() => {
    if (!start.current) { setSwiping(false); return }
    if (x < -threshold) { setOpen(true); setX(openOffset) }
    else close()
    start.current = null
    setTimeout(() => setSwiping(false), 200)
  }, [x, threshold, openOffset, close])

  return { x, swiping, open, close, handlers: { onTouchStart, onTouchMove, onTouchEnd } }
}
