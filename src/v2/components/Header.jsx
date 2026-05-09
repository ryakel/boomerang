import { Plus, Sparkles, Package, MoreVertical, Target, Cloud, CloudOff } from 'lucide-react'
import Logo from '../../components/Logo'
import { MiniRings } from '../../components/Rings'
import './Header.css'

export default function Header({
  onOpenAdviser, onOpenPackages, onOpenMenu, onOpenAdd, onOpenWhatNow,
  miniRingsData, onOpenAnalytics,
  todayCount, hasDone, onOpenDone,
  syncStatus, queueLength,
}) {
  const showStats = (miniRingsData && miniRingsData.length > 0) || todayCount > 0 || hasDone || syncStatus
  return (
    <header className="v2-header">
      <div className="v2-header-brand">
        <Logo size={26} />
        <span className="v2-header-wordmark">BOOMERANG</span>
      </div>
      <nav className="v2-header-actions">
        {showStats && (
          <div className="v2-header-stats">
            {miniRingsData && miniRingsData.length > 0 && (
              <button
                className="v2-header-stat-btn v2-header-rings-btn"
                onClick={onOpenAnalytics}
                aria-label="Open analytics"
                title="Daily progress — tap to open Analytics"
              >
                <MiniRings rings={miniRingsData} />
              </button>
            )}
            {todayCount > 0 ? (
              <button
                className="v2-header-stat-btn v2-header-today"
                onClick={onOpenDone}
                title="Tap to open the Done list"
              >
                <span className="v2-header-today-count">{todayCount}</span>
                <span className="v2-header-today-label">today</span>
              </button>
            ) : hasDone ? (
              <button
                className="v2-header-stat-btn v2-header-today-link"
                onClick={onOpenDone}
                title="Tap to open the Done list"
              >
                Done
              </button>
            ) : null}
            {syncStatus && (
              <span
                className={`v2-header-sync v2-header-sync-${syncStatus}`}
                title={
                  syncStatus === 'offline'
                    ? `Offline${queueLength ? ` (${queueLength} pending)` : ''}`
                    : syncStatus === 'saving'
                      ? 'Syncing…'
                      : 'Synced'
                }
                aria-label={syncStatus}
              >
                {syncStatus === 'offline' ? <CloudOff size={13} strokeWidth={1.75} /> : <Cloud size={13} strokeWidth={1.75} />}
              </span>
            )}
          </div>
        )}
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
