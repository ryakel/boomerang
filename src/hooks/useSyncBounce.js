import { useEffect, useRef, useState } from 'react'

// Wordmark sync-state machine — shared by the standard Header, WallabyHeader,
// and KeptHeader (it lived as three copies before Kept). Maps useServerSync's
// syncStatus + queue length into the visual states the bouncing wordmark
// reflects, enforcing a minimum saving-hold so a fast sync still plays a full
// letter-wave, and queueing the green "just-synced" flash to fire after the
// hold expires.
//
//   idle | saving (bounce wave) | just-synced (green flash) |
//   degraded (queue backlog) | offline
const SAVING_MIN_HOLD = 1300 // full wave across the letters + margin
const FLASH_MS = 700

export function useSyncBounce(syncStatus, queueLength = 0) {
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
        } else {
          setAnimState('idle')
        }
      }, SAVING_MIN_HOLD)
    } else if (syncStatus === 'synced' && animState === 'saving') {
      // Saving completed mid-wave — queue the flash for when the hold expires.
      allowFlashRef.current = true
    }
  }, [syncStatus, animState])

  if (syncStatus === 'offline') return 'offline'
  if (animState === 'saving') return 'saving'
  if (animState === 'just-synced') return 'just-synced'
  if (queueLength > 0) return 'degraded'
  return 'idle'
}
