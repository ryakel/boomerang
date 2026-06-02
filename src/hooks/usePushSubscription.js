import { useState, useEffect, useCallback } from 'react'
import { getVapidPublicKey, subscribePush, unsubscribePush } from '../api'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function usePushSubscription() {
  const [subscription, setSubscription] = useState(null)
  const [supported, setSupported] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const check = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setSupported(false)
        setLoading(false)
        return
      }
      setSupported(true)
      try {
        const reg = await navigator.serviceWorker.ready
        let existing = await reg.pushManager.getSubscription()
        // Self-heal: the subscription is owned by the SW *registration*, so it
        // dies whenever the SW is unregistered — which the version-update
        // handler does on every deploy (AppV2 onNewVersion), the ErrorBoundary
        // does on a render crash, and iOS Safari does on its own whim. If the
        // user previously granted permission but the subscription is gone,
        // silently re-create it (no prompt — permission is already 'granted')
        // and re-register it server-side. Without this, web push silently dies
        // after every release until the user manually re-enables it.
        if (!existing && Notification.permission === 'granted') {
          try {
            const vapidKey = await getVapidPublicKey()
            if (vapidKey) {
              existing = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(vapidKey),
              })
              await subscribePush(existing)
              console.log('[Push] Re-subscribed after a lost subscription (deploy/SW reset/iOS eviction)')
            }
          } catch (healErr) {
            console.warn('[Push] Auto-resubscribe failed; user can re-enable in Settings:', healErr?.message)
          }
        }
        setSubscription(existing)
      } catch { /* SW not ready yet */ }
      setLoading(false)
    }
    check()
  }, [])

  const subscribe = useCallback(async () => {
    try {
      setLoading(true)

      const vapidKey = await getVapidPublicKey()
      if (!vapidKey) throw new Error('VAPID key not configured on server')

      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error('Notification permission ' + permission + '. Check Settings > Notifications > Boomerang.')
      }

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })

      await subscribePush(sub)
      setSubscription(sub)
      return { success: true }
    } catch (err) {
      console.error('[Push] Subscribe failed:', err)
      return { success: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }, [])

  const unsubscribe = useCallback(async () => {
    try {
      setLoading(true)
      if (subscription) {
        const endpoint = subscription.endpoint
        await subscription.unsubscribe()
        await unsubscribePush(endpoint).catch(() => {})
      }
      setSubscription(null)
      return { success: true }
    } catch (err) {
      console.error('[Push] Unsubscribe failed:', err)
      return { success: false, error: err.message }
    } finally {
      setLoading(false)
    }
  }, [subscription])

  return { subscription, supported, loading, subscribed: !!subscription, subscribe, unsubscribe }
}
