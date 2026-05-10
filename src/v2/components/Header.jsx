import { useEffect, useRef, useState } from 'react'
import { Sparkles, Package, MoreVertical } from 'lucide-react'
import Logo from '../../components/Logo'
import { MiniRings } from '../../components/Rings'
import './Header.css'

const WORDMARK_LETTERS = 'BOOMERANG'.split('')

// Sync-state derivation. Maps useServerSync's syncStatus + the local
// `animState` (saving / just-synced / idle, with minimum hold enforcement)
// + queue length into the visual states the wordmark reflects. Permanent
// states (offline / degraded) fade ambient stress into the brand instead
// of using a separate icon. animState wins over instantaneous syncStatus
// for the saving / just-synced phases so a fast sync still gets a full
// wave + flash.
function deriveSyncVisualState(syncStatus, queueLength, animState) {
  if (syncStatus === 'offline') return 'offline'
  if (animState === 'saving') return 'saving'
  if (animState === 'just-synced') return 'just-synced'
  if (queueLength > 0) return 'degraded'
  return 'idle'
}

export default function Header({
  onOpenAdviser, onOpenPackages, onOpenMenu,
  miniRingsData, onOpenAnalytics,
  todayCount, hasDone, onOpenDone, onOpenLogs,
  syncStatus, queueLength,
}) {
  // Brand popover holds the stats that previously cluttered the header
  // (mini-rings, done-today shortcut, sync-status detail). One tap on the
  // wordmark reveals everything; otherwise the header stays a brand strip.
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef(null)
  const brandRef = useRef(null)

  // Just-synced pulse — flashes green for ~700ms after a save completes,
  // then decays. Ambient by design: if everything's working you see the
  // flash once and forget about it.
  //
  // We also enforce a minimum saving-hold (1300ms) so a fast sync doesn't
  // strand the bounce on the B before the wave reaches the G. The wave
  // takes ~1140ms to traverse all nine letters at 60ms stagger; rounding
  // up to 1300 gives margin without feeling sluggish. If saving completes
  // mid-wave, the green flash queues to fire after the hold expires.
  const SAVING_MIN_HOLD = 1300
  const FLASH_MS = 700
  const [animState, setAnimState] = useState('idle')
  const allowFlashRef = useRef(false)
  const timerRef = useRef(null)

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  useEffect(() => {
    if (syncStatus === 'saving') {
      // Start (or restart) the wave. Clear any pending flash.
      allowFlashRef.current = false
      setAnimState('saving')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (allowFlashRef.current) {
          setAnimState('just-synced')
          timerRef.current = setTimeout(() => {
            timerRef.current = null
            setAnimState('idle')
          }, FLASH_MS)
        } else {
          setAnimState('idle')
        }
      }, SAVING_MIN_HOLD)
    } else if (syncStatus === 'synced' && animState === 'saving') {
      // Saving completed mid-wave — queue the green flash for when the hold
      // timer fires. Don't transition yet; wave finishes first.
      allowFlashRef.current = true
    }
  }, [syncStatus, animState])

  // Click outside closes the brand popover.
  useEffect(() => {
    if (!popoverOpen) return
    const onClick = (e) => {
      if (popoverRef.current?.contains(e.target)) return
      if (brandRef.current?.contains(e.target)) return
      setPopoverOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('touchstart', onClick)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('touchstart', onClick)
    }
  }, [popoverOpen])

  const syncVisualState = deriveSyncVisualState(syncStatus, queueLength, animState)
  const syncLabel =
    syncVisualState === 'offline' ? `Offline${queueLength ? ` · ${queueLength} pending` : ''}` :
    syncVisualState === 'degraded' ? `Working through ${queueLength} pending change${queueLength === 1 ? '' : 's'}` :
    syncVisualState === 'saving' ? 'Syncing…' :
    syncVisualState === 'just-synced' ? 'Synced ✓' :
    'Synced'

  return (
    <header className="v2-header">
      <button
        ref={brandRef}
        type="button"
        className="v2-header-brand"
        onClick={() => setPopoverOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-label={`Boomerang. Status: ${syncLabel}. Tap for details.`}
      >
        <Logo size={26} />
        <span className="v2-header-wordmark" data-sync-state={syncVisualState}>
          {WORDMARK_LETTERS.map((ch, i) => (
            <span
              key={i}
              className="v2-header-wordmark-letter"
              style={{ '--letter-index': i }}
            >
              {ch}
            </span>
          ))}
        </span>
      </button>

      {popoverOpen && (
        <div ref={popoverRef} className="v2-header-popover" role="dialog" aria-label="Status">
          {miniRingsData && miniRingsData.length > 0 && (
            <button
              type="button"
              className="v2-header-popover-row v2-header-popover-rings"
              onClick={() => { setPopoverOpen(false); onOpenAnalytics?.() }}
            >
              <MiniRings rings={miniRingsData} />
              <span>Open Analytics</span>
            </button>
          )}
          {(todayCount > 0 || hasDone) && (
            <button
              type="button"
              className="v2-header-popover-row"
              onClick={() => { setPopoverOpen(false); onOpenDone?.() }}
            >
              <span className="v2-header-popover-row-icon" aria-hidden="true">✓</span>
              <span className="v2-header-popover-row-label">
                {todayCount > 0 ? `${todayCount} done today` : 'Recently done'}
              </span>
            </button>
          )}
          <div className={`v2-header-popover-row v2-header-popover-sync v2-header-popover-sync-${syncVisualState}`}>
            <span className="v2-header-popover-row-icon" aria-hidden="true">●</span>
            <span className="v2-header-popover-row-label">{syncLabel}</span>
            {onOpenLogs && (
              <button
                type="button"
                className="v2-header-popover-row-aside"
                onClick={() => { setPopoverOpen(false); onOpenLogs() }}
              >
                Logs
              </button>
            )}
          </div>
        </div>
      )}

      <nav className="v2-header-actions">
        {/* + Add and target/whatnow moved to FloatingCapture (right-edge
         * speed-dial) so the header isn't crowded. Header now carries only
         * brand affordances + integrations + overflow. */}
        <button className="v2-header-icon v2-header-icon-quokka" onClick={onOpenAdviser} aria-label="Quokka">
          <Sparkles size={20} strokeWidth={1.75} />
        </button>
        <button className="v2-header-icon v2-header-icon-packages" onClick={onOpenPackages} aria-label="Packages">
          <Package size={20} strokeWidth={1.75} />
        </button>
        <button className="v2-header-icon" onClick={onOpenMenu} aria-label="More">
          <MoreVertical size={20} strokeWidth={1.75} />
        </button>
      </nav>
    </header>
  )
}
