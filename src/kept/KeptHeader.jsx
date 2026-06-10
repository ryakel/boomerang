import { Bell, Sparkles, TrendingUp } from 'lucide-react'
import Logo from '../components/Logo'
import './shell.css'

// Kept top bar: mark + `boomerang.` wordmark · Quokka (gold-tinted, always one
// tap away — it is NOT a nav tab in Kept) · bell · avatar (spec §6).
export default function KeptHeader({ onQuokka, onBell, onAvatar, unread = 0 }) {
  return (
    <header className="bm-header">
      <div className="bm-header-brand">
        <Logo size={24} />
        <span className="bm-header-mark">boomerang<i>.</i></span>
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
