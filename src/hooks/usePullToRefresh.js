import { useRef, useCallback } from 'react'

export function usePullToRefresh(onRefresh) {
  const startY = useRef(0)
  const pulling = useRef(false)

  const onTouchStart = useCallback((e) => {
    if (e.currentTarget.scrollTop === 0) {
      startY.current = e.touches[0].clientY
      pulling.current = true
    }
  }, [])

  const onTouchEnd = useCallback((e) => {
    if (!pulling.current) return
    const diff = e.changedTouches[0].clientY - startY.current
    pulling.current = false
    if (diff > 80) onRefresh()
  }, [onRefresh])

  return { onTouchStart, onTouchEnd }
}
