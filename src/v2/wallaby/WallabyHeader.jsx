import { Bell } from 'lucide-react'
import './WallabyHeader.css'

// Wallaby persistent top app bar (loggd): brand wordmark left, notifications
// bell (with unread badge) + avatar right. Sits above every shell surface.
export default function WallabyHeader({ unread = 0, onBell, onAvatar }) {
  return (
    <header className="wb-header">
      <span className="wb-header-brand">
        <span className="wb-header-mark" aria-hidden="true" />
        Boomerang
      </span>
      <div className="wb-header-actions">
        <button className="wb-header-btn" onClick={onBell} aria-label="Notifications">
          <Bell size={20} strokeWidth={1.9} />
          {unread > 0 && <span className="wb-header-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button className="wb-header-avatar" onClick={onAvatar} aria-label="Profile" />
      </div>
    </header>
  )
}
