import { useEffect, useState } from 'react'

// True when the active theme uses the mobile "full-page modal" IA — the
// Kept shell (overlay modals become full-screen pages with a back arrow
// instead of sheets with an X). Subscribes to documentElement's
// data-theme via MutationObserver: theme flips happen by direct DOM mutation
// (Settings + the pre-paint script), so no context is needed.
const matches = () => {
  if (typeof document === 'undefined') return false
  const t = document.documentElement.getAttribute('data-theme') || ''
  return t.startsWith('kept')
}

export function useMobilePages() {
  const [on, setOn] = useState(matches)
  useEffect(() => {
    const root = document.documentElement
    const update = () => setOn(matches())
    const observer = new MutationObserver(update)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    update()
    return () => observer.disconnect()
  }, [])
  return on
}
