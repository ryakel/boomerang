import { useState } from 'react'
import { Plus, FastForward, Check } from 'lucide-react'
import { useSwipeActions } from '../hooks/useSwipeActions'
import './shell.css'

// Swipe-left-to-reveal quick actions on a Loops-page card (plan item 1):
// Spawn (gold) + Skip cycle revealed behind the card — same mechanic as
// RowSwipe / useSwipeActions, sized for the taller bm-card. Spawn shows a
// brief ✓ confirmation like the modal's spawn feedback; when an instance is
// already on the list it greys out and reads "On list" (the spawn guard would
// refuse anyway). Tapping a revealed action closes the swipe.
export default function LoopSwipe({ onSpawn, onSkip, blocked = false, children }) {
  const swipe = useSwipeActions({ openOffset: -132 })
  const [spawned, setSpawned] = useState(false)

  const handleSpawn = () => {
    if (blocked) { swipe.close(); return }
    onSpawn?.()
    setSpawned(true)
    setTimeout(() => setSpawned(false), 1500)
    swipe.close()
  }

  return (
    <div className="bm-loop-swipe">
      <div className="bm-loop-swipe-actions">
        <button
          className="bm-row-swipe-act bm-loop-swipe-spawn"
          onClick={handleSpawn}
          disabled={blocked}
        >
          {spawned ? <Check size={16} strokeWidth={2.5} /> : <Plus size={16} strokeWidth={2.5} />}
          {spawned ? 'Spawned' : blocked ? 'On list' : 'Spawn'}
        </button>
        <button
          className="bm-row-swipe-act bm-loop-swipe-skip"
          onClick={() => { onSkip?.(); swipe.close() }}
        >
          <FastForward size={16} strokeWidth={2} />Skip
        </button>
      </div>
      <div
        className="bm-loop-swipe-body"
        style={{ transform: swipe.x !== 0 ? `translateX(${swipe.x}px)` : undefined }}
        {...swipe.handlers}
        onClickCapture={(e) => { if (swipe.open || swipe.swiping) { e.stopPropagation(); swipe.close() } }}
      >
        {children}
      </div>
    </div>
  )
}
