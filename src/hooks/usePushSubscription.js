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
        const reg = await navigator.serviceWorker.ready
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
      const vapidKey = await getVapidPublicKey()
      if (!vapidKey) throw new Error('VAPID key not configured on server')

      // Use the existing Workbox service worker (push-sw.js is imported via importScripts)
      const reg = await navigator.serviceWorker.ready

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      })

      // Send subscription to server
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
        await unsubscribePush(endpoint)
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
