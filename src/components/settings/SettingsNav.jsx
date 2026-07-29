import { useEffect, useRef, useState } from 'react'
import './settings.css'

// Stack navigation for the settings surface (§6).
//
// This replaces the six-tab strip, which overflowed on a phone — "Notifications"
// clipped to "Notifica" with nothing indicating the strip scrolled. Scrollable
// tabs were rejected (off-screen state is undiscoverable, and horizontal scroll
// inside a sheet fights the iOS dismiss gesture); merging further was rejected
// too, since the current six ARE already a merge.
//
// The index wins on a point the tabs could never match: its rows carry live
// value summaries, so the root screen answers "what's my setup?" instead of
// being pure chrome.
//
// Depth is capped at two — categories, then the named sub-pages. Anything
// deeper means the page needs splitting, not another level.
//
// Page identity is component state only. It is NEVER persisted: the settings
// blob is last-writer-wins and UI chrome must not ride it.
export default function SettingsNav({ page, children }) {
  const [dir, setDir] = useState('forward')
  const prev = useRef(page)
  // Page ids are paths: 'index', 'Tasks', 'Tasks/impact'. Depth drives which
  // way the slide runs, so going BACK from a sub-page animates back rather
  // than forward. Two levels below the index is the cap (§6) — anything
  // deeper means the page needs splitting, not another level.
  const depth = (id) => (id === 'index' ? 0 : String(id).split('/').length)

  useEffect(() => {
    if (prev.current !== page) {
      setDir(depth(page) >= depth(prev.current) ? 'forward' : 'back')
      prev.current = page
    }
  }, [page])

  return (
    // Keyed on the page so React remounts on navigation — that both restarts
    // the slide and guarantees a sub-page can't inherit scroll position or
    // transient state from the page it replaced.
    <div key={page} className={`v2-set-nav v2-set-nav-${dir}`}>
      {children}
    </div>
  )
}
