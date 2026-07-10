import { useRef, useCallback } from 'react'

// Swipe-down-to-dismiss for a bottom sheet (Kept's `.bm-sheet` family —
// ThrowSheet, the Tasks action sheet). The grabber bar has always LOOKED
// draggable but had no touch handling behind it — this wires the gesture up.
// Attach `sheetRef` to the sheet's root element and spread `handleProps` onto
// the draggable region (the grabber/handle, not the whole sheet, so the
// title/input/buttons stay normal tap targets).
//
// `extraOffsetRef` is optional: a ref holding another live transform offset
// (in px) the caller is animating independently — e.g. ThrowSheet's keyboard-
// occlusion translateY — so the two don't stomp each other's `style.transform`.
// Call the returned `applyExtraOffset(0)` whenever that other offset changes.
export default function useSheetSwipeDown(sheetRef, onDismiss, extraOffsetRef) {
  const dragRef = useRef(null)

  const applyTransform = useCallback((dy) => {
    const sheet = sheetRef.current
    if (!sheet) return
    const total = (extraOffsetRef?.current || 0) + dy
    sheet.style.transform = total === 0 ? '' : `translateY(${total}px)`
  }, [sheetRef, extraOffsetRef])

  const onPointerDown = useCallback((e) => {
    dragRef.current = { y: e.clientY, t: performance.now() }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e) => {
    const s = dragRef.current
    if (!s) return
    applyTransform(Math.max(0, e.clientY - s.y))
  }, [applyTransform])

  const endDrag = useCallback((e) => {
    const s = dragRef.current
    if (!s) return
    dragRef.current = null
    const dy = Math.max(0, e.clientY - s.y)
    const velocity = dy / Math.max(1, performance.now() - s.t)
    const sheet = sheetRef.current
    // Dismiss past ~1/4 of a typical sheet drag or on a quick flick;
    // otherwise snap back with a short eased transition.
    if (dy > 90 || velocity > 0.6) {
      onDismiss?.()
      return
    }
    if (sheet) {
      sheet.style.transition = 'transform 180ms ease'
      applyTransform(0)
      setTimeout(() => { if (sheet) sheet.style.transition = '' }, 200)
    }
  }, [sheetRef, onDismiss, applyTransform])

  return {
    applyExtraOffset: applyTransform,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  }
}
