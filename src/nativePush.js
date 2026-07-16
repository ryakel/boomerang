// nativePush.js — native iOS push (APNs) client wiring for the Capacitor
// shell. Phase 4 of the native app. Everything here is a no-op on the web.
//
// enableNativePush(): asks iOS for notification permission, registers with
// APNs, and POSTs the device token to the server (which stores it in the
// apns_devices carve-out). Returns { ok, error? } for the Settings UI.
//
// wireNativePushTapHandler(onDeepLink): routes a banner tap into the app's
// shared deep-link applier — the payload's custom `url` field carries the
// same '/?task=<id>' shape web push and Pushover use.
import { PushNotifications } from '@capacitor/push-notifications'
import { isNativeShell } from './apiConfig'

export async function enableNativePush() {
  if (!isNativeShell()) return { ok: false, error: 'Native push only works in the iOS app.' }
  try {
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') {
      perm = await PushNotifications.requestPermissions()
    }
    if (perm.receive !== 'granted') {
      return { ok: false, error: 'Notification permission denied. Enable it in iOS Settings → Boomerang → Notifications.' }
    }

    const token = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for the APNs token (device offline, or the app is missing the Push Notifications capability).')), 15000)
      PushNotifications.addListener('registration', (t) => { clearTimeout(timer); resolve(t.value) })
      PushNotifications.addListener('registrationError', (e) => { clearTimeout(timer); reject(new Error(e?.error || 'APNs registration failed')) })
      PushNotifications.register().catch((e) => { clearTimeout(timer); reject(e) })
    })

    const res = await fetch('/api/apns/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `Server rejected the token (${res.status}).` }
    // Remember this device's token so the Settings UI can ask the server
    // "is THIS device registered?" instead of showing a stateless button.
    try { localStorage.setItem('boom_apns_token', token) } catch { /* quota — state check degrades */ }
    return { ok: true, devices: data.devices }
  } catch (err) {
    return { ok: false, error: err?.message || 'Native push setup failed.' }
  }
}

// The APNs token this device registered with, if any. Used by Settings to
// query per-device registration state.
export function getStoredApnsToken() {
  try { return localStorage.getItem('boom_apns_token') || null } catch { return null }
}

// Silent keep-fresh: APNs tokens can rotate (restore from backup, OS
// reinstall), and Apple's guidance is to re-register on every launch. Called
// from AppV2's mount effect — only acts when permission is ALREADY granted,
// so it can never trigger the iOS permission prompt; if the user has never
// enabled (or denied), it does nothing.
export async function refreshNativePushRegistration() {
  if (!isNativeShell()) return
  try {
    const perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') return
    await enableNativePush()
  } catch { /* background freshness only — Settings has the loud path */ }
}

export function wireNativePushTapHandler(onDeepLink) {
  if (!isNativeShell()) return () => {}
  let handle
  PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url = action?.notification?.data?.url
    if (typeof url === 'string' && url.includes('?')) {
      onDeepLink(`?${url.split('?')[1]}`)
    }
  }).then((h) => { handle = h }).catch(() => {})
  return () => { handle?.remove?.() }
}
