import { useState, useEffect, useCallback } from 'react'
import { getVapidPublicKey, subscribePush, unsubscribePush } from '../api'

// Convert VAPID key from base64 URL to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

// Wrap a promise with a timeout
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)),
  ])
}

export function usePushSubscription() {
  const [subscription, setSubscription] = useState(null)
  const [supported, setSupported] = useState(false)
  const [loading, setLoading] = useState(true)

  // Check support and current subscription on mount
  useEffect(() => {
    const check = async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setSupported(false)
        setLoading(false)
        return
      }
      setSupported(true)

      try {
        const reg = await withTimeout(navigator.serviceWorker.ready, 5000, 'SW ready')
        const existing = await reg.pushManager.getSubscription()
        setSubscription(existing)
      } catch (err) {
        console.error('[Push] Error checking subscription:', err)
      }
      setLoading(false)
    }
    check()
  }, [])

  const subscribe = useCallback(async () => {
    try {
      setLoading(true)

      // Step 1: Get VAPID key
      const vapidKey = await withTimeout(getVapidPublicKey(), 5000, 'VAPID key fetch')
      if (!vapidKey) throw new Error('VAPID key not configured on server')

      // Step 2: Wait for service worker
      const reg = await withTimeout(navigator.serviceWorker.ready, 5000, 'Service worker ready')

      // Step 3: Request notification permission explicitly
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error(`Notification permission ${permission}. Check Settings > Notifications > Boomerang.`)
      }

      // Step 4: Subscribe to push
      const sub = await withTimeout(
        reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }),
        10000,
        'Push subscribe'
      )

      // Step 5: Send subscription to server
      await withTimeout(subscribePush(sub), 5000, 'Server registration')
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

  return {
    subscription,
    supported,
    loading,
    subscribed: !!subscription,
    subscribe,
    unsubscribe,
  }
}
