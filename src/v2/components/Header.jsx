import { useEffect, useRef, useState } from 'react'
import { Plus, Sparkles, Package, MoreVertical, Target } from 'lucide-react'
import Logo from '../../components/Logo'
import { MiniRings } from '../../components/Rings'
import './Header.css'

const WORDMARK_LETTERS = 'BOOMERANG'.split('')

// Sync-state derivation. Maps useServerSync's syncStatus + transient
// "just-synced" pulse + queue length into the visual states the wordmark
// reflects. Permanent states (offline / degraded) fade ambient stress into
// the brand instead of using a separate icon. "Just-synced" is a brief flash
// that decays back to idle.
function deriveSyncVisualState(syncStatus, queueLength, justSynced) {
  if (syncStatus === 'offline') return 'offline'
  if (syncStatus === 'saving') return 'saving'
  if (justSynced) return 'just-synced'
  if (queueLength > 0) return 'degraded'
  return 'idle'
}

export default function Header({
  onOpenAdviser, onOpenPackages, onOpenMenu, onOpenAdd, onOpenWhatNow,
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
  const [justSynced, setJustSynced] = useState(false)
  const prevSyncStatus = useRef(syncStatus)
  useEffect(() => {
    if (prevSyncStatus.current === 'saving' && syncStatus === 'synced') {
      setJustSynced(true)
      const t = setTimeout(() => setJustSynced(false), 700)
      return () => clearTimeout(t)
    }
    prevSyncStatus.current = syncStatus
  }, [syncStatus])

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

  const syncVisualState = deriveSyncVisualState(syncStatus, queueLength, justSynced)
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
        {todayCount > 0 ? (
          <button
            className="v2-header-today"
            onClick={onOpenDone}
            title="Tap to open the Done list"
          >
            <span className="v2-header-today-count">{todayCount}</span>
            <span className="v2-header-today-label">today</span>
          </button>
        ) : hasDone ? (
          <button
            className="v2-header-today v2-header-today-link"
            onClick={onOpenDone}
            title="Tap to open the Done list"
          >
            Done
          </button>
        ) : null}
        {onOpenWhatNow && (
          <button className="v2-header-whatnow" onClick={onOpenWhatNow}>
            <Target size={14} strokeWidth={2} />
            <span className="v2-header-whatnow-label">What now?</span>
          </button>
        )}
        {onOpenAdd && (
          <button className="v2-header-icon v2-header-icon-primary" onClick={onOpenAdd} aria-label="New task">
            <Plus size={20} strokeWidth={2} />
          </button>
        )}
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
