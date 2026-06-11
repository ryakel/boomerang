import { Bell, TrendingUp } from 'lucide-react'
import Logo from '../components/Logo'
import { useSyncBounce } from '../hooks/useSyncBounce'
import './WallabyHeader.css'

const WORDMARK_LETTERS = 'BOOMERANG'.split('')

// Wallaby persistent top app bar: bouncing BOOMERANG wordmark + logo (to the
// right of the text), then Quokka · Packages · notifications bell · avatar.
export default function WallabyHeader({
  unread = 0, onBell, onAvatar,
  syncStatus = 'synced', queueLength = 0,
}) {
  const syncVisualState = useSyncBounce(syncStatus, queueLength)

  return (
    <header className="wb-header">
      <div className="wb-header-brand">
        <Logo size={24} />
        <span className="v2-header-wordmark wb-header-wordmark" data-sync-state={syncVisualState}>
          {WORDMARK_LETTERS.map((ch, i) => (
            <span key={i} className="v2-header-wordmark-letter" style={{ '--letter-index': i }}>{ch}</span>
          ))}
        </span>
      </div>
      <div className="wb-header-actions">
        <button className="wb-header-btn" onClick={onBell} aria-label="Notifications">
          <Bell size={20} strokeWidth={1.9} />
          {unread > 0 && <span className="wb-header-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button className="wb-header-avatar" onClick={onAvatar} aria-label="Profile">
          <TrendingUp size={17} strokeWidth={2.5} color="var(--wb-on-action)" />
        </button>
      </div>
    </header>
  )
}
