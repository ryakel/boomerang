import { Bell, Sparkles, TrendingUp } from 'lucide-react'
import Logo from '../components/Logo'
import { useSyncBounce } from '../hooks/useSyncBounce'
import './shell.css'

const WORDMARK_LETTERS = 'boomerang.'.split('')

// Kept top bar: mark + bouncing `boomerang.` wordmark (the save-wave from the
// standard header — letters bounce while syncing, flash green on save, the
// gold period rides the wave) · Quokka (one tap from every screen — it is NOT
// a nav tab in Kept) · bell · avatar (spec §6).
export default function KeptHeader({ onQuokka, onBell, onAvatar, unread = 0, syncStatus = 'synced', queueLength = 0 }) {
  const syncVisualState = useSyncBounce(syncStatus, queueLength)
  return (
    <header className="bm-header">
      <div className="bm-header-brand">
        <Logo size={24} />
        <span className="v2-header-wordmark bm-header-mark" data-sync-state={syncVisualState}>
          {WORDMARK_LETTERS.map((ch, i) => (
            <span key={i} className="v2-header-wordmark-letter" style={{ '--letter-index': i }}>{ch}</span>
          ))}
        </span>
      </div>
      <div className="bm-header-actions">
        <button className="bm-header-btn bm-header-quokka" onClick={onQuokka} aria-label="Quokka">
          <Sparkles size={17} strokeWidth={2} />
        </button>
        <button className="bm-header-btn" onClick={onBell} aria-label="Notifications">
          <Bell size={17} strokeWidth={2} />
          {unread > 0 && <span className="bm-header-dot" aria-hidden="true" />}
        </button>
        <button className="bm-header-btn bm-header-avatar" onClick={onAvatar} aria-label="Flight log">
          <TrendingUp size={15} strokeWidth={2.5} />
        </button>
      </div>
    </header>
  )
}
