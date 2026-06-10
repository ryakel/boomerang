import { Check, Trash2 } from 'lucide-react'
import { useSwipeActions } from '../hooks/useSwipeActions'
import './shell.css'

// Swipe-left-to-reveal wrapper for Kept hairline rows (parity with the v2
// TaskCard / Wallaby TaskRow gesture): Catch (gold) + Delete behind the row.
export default function RowSwipe({ done = false, onCatch, onDelete, children }) {
  const swipe = useSwipeActions({ openOffset: -132 })
  return (
    <div className="bm-row-swipe">
      <div className="bm-row-swipe-actions">
        <button
          className="bm-row-swipe-act bm-row-swipe-catch"
          onClick={() => { onCatch?.(); swipe.close() }}
        ><Check size={16} strokeWidth={2.5} />{done ? 'Reopen' : 'Catch'}</button>
        <button
          className="bm-row-swipe-act bm-row-swipe-del"
          onClick={() => { onDelete?.(); swipe.close() }}
        ><Trash2 size={16} strokeWidth={2} />Delete</button>
      </div>
      <div
        className="bm-row-swipe-body"
        style={{ transform: swipe.x !== 0 ? `translateX(${swipe.x}px)` : undefined }}
        {...swipe.handlers}
        onClickCapture={(e) => { if (swipe.open || swipe.swiping) { e.stopPropagation(); swipe.close() } }}
      >
        {children}
      </div>
    </div>
  )
}
