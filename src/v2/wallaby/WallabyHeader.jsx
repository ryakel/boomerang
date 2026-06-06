import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import Logo from '../../components/Logo'
import './WallabyHeader.css'

const WORDMARK_LETTERS = 'BOOMERANG'.split('')

// Mirrors Header.jsx so the wordmark bounces on save the same way.
function deriveSyncVisualState(syncStatus, queueLength, animState) {
  if (syncStatus === 'offline') return 'offline'
  if (animState === 'saving') return 'saving'
  if (animState === 'just-synced') return 'just-synced'
  if (queueLength > 0) return 'degraded'
  return 'idle'
}

// Wallaby persistent top app bar: bouncing BOOMERANG wordmark + logo (to the
// right of the text), then Quokka · Packages · notifications bell · avatar.
export default function WallabyHeader({
  unread = 0, onBell, onAvatar,
  syncStatus = 'synced', queueLength = 0,
}) {
  const SAVING_MIN_HOLD = 1300
  const FLASH_MS = 700
  const [animState, setAnimState] = useState('idle')
  const allowFlashRef = useRef(false)
  const timerRef = useRef(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  useEffect(() => {
    if (syncStatus === 'saving') {
      allowFlashRef.current = false
      setAnimState('saving')
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (allowFlashRef.current) {
          setAnimState('just-synced')
          timerRef.current = setTimeout(() => { timerRef.current = null; setAnimState('idle') }, FLASH_MS)
        } else { setAnimState('idle') }
      }, SAVING_MIN_HOLD)
    } else if (syncStatus === 'synced' && animState === 'saving') {
      allowFlashRef.current = true
    }
  }, [syncStatus, animState])

  const syncVisualState = deriveSyncVisualState(syncStatus, queueLength, animState)

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
        <button className="wb-header-avatar" onClick={onAvatar} aria-label="Profile" />
      </div>
    </header>
  )
}
