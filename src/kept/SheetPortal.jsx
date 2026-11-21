import { useContext } from 'react'
import { createPortal } from 'react-dom'
import { SheetHostContext } from './sheetHost'

// Bottom sheets opened from inside a surface (Today's "To look over" and
// "Suggestions to review", the Tasks row sheet) render here, OUT of the
// scrolling surface. Left inside it, iOS WebKit traps the sheet's fixed
// backdrop in the scroller's own layer: the header and bottom nav paint on top
// of it, the nav hides the sheet's first rows, and a drag on the sheet scrolls
// the page behind (2026-11-21, owner screenshots). The Throw sheet never had
// the problem because KeptShell renders it beside the surface, not in it.
//
// The host is the shell root (.bm-shell on mobile, .bm-desktop on desktop),
// so the sheet still sits in the shell's stacking context (above the nav) and
// keeps the desktop's centered-dialog styling. Theme tokens live on :root, so
// nothing is lost by leaving the surface.

// React bubbles synthetic events through portals along the COMPONENT tree, so
// a touch inside the sheet would still reach PullToRefresh's handlers and pull
// the page down while you scroll the sheet. Stop them at the portal.
const stop = (e) => e.stopPropagation()

export default function SheetPortal({ children }) {
  const host = useContext(SheetHostContext)
  const target = host || (typeof document !== 'undefined' ? document.body : null)
  if (!target) return null
  return createPortal(
    <div style={{ display: 'contents' }} onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop}>
      {children}
    </div>,
    target,
  )
}
