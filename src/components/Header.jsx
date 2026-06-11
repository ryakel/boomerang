import { useRef, useState } from 'react'
import { Sparkles, Package, Settings as SettingsIcon } from 'lucide-react'
import Logo from './Logo'
import { MiniRings } from './Rings'
import { useSyncBounce } from '../hooks/useSyncBounce'
import './Header.css'

const WORDMARK_LETTERS = 'BOOMERANG'.split('')

export default function Header({
  onOpenAdviser, onOpenPackages, onOpenSystemMenu, systemMenuOpen,
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

  const syncVisualState = useSyncBounce(syncStatus, queueLength)
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
        <button
          className="v2-header-icon"
          onClick={onOpenSystemMenu}
          aria-label="System menu"
          aria-haspopup="menu"
          aria-expanded={!!systemMenuOpen}
          data-system-menu-anchor
        >
          <SettingsIcon size={20} strokeWidth={1.75} />
        </button>
      </nav>
    </header>
  )
}
