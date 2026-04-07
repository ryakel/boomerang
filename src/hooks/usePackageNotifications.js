import { useEffect, useRef } from 'react'
import { loadSettings } from '../store'

const THROTTLE_KEY = 'boom_package_notif_timestamps'
const THROTTLE_MINUTES = 30

function getThrottleMap() {
  try {
    return JSON.parse(localStorage.getItem(THROTTLE_KEY) || '{}')
  } catch { return {} }
}

function setThrottled(key) {
  const map = getThrottleMap()
  map[key] = Date.now()
  localStorage.setItem(THROTTLE_KEY, JSON.stringify(map))
}

function isThrottled(key) {
  const map = getThrottleMap()
  const last = map[key]
  if (!last) return false
  return (Date.now() - last) < THROTTLE_MINUTES * 60 * 1000
}

function isQuietHours(settings) {
  if (!settings.quiet_hours_enabled) return false
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const start = settings.quiet_hours_start || '22:00'
  const end = settings.quiet_hours_end || '08:00'
  if (start <= end) return hhmm >= start && hhmm < end
  return hhmm >= start || hhmm < end
}

function sendNotification(title, body, tag) {
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body, tag, icon: '/icon-192.png' })
  } catch { /* SW fallback not needed for package notifs */ }
}

export function usePackageNotifications(packages, prevPackagesRef) {
  const lastPackages = useRef(prevPackagesRef?.current || [])

  useEffect(() => {
    if (!packages || packages.length === 0) return
    const settings = loadSettings()
    if (!settings.notifications_enabled) return
    if (isQuietHours(settings)) return

    const prevMap = new Map(lastPackages.current.map(p => [p.id, p]))

    for (const pkg of packages) {
      const prev = prevMap.get(pkg.id)
      if (!prev) continue // new package, skip notification

      const label = pkg.label || pkg.tracking_number

      // Delivery notification
      if (pkg.status === 'delivered' && prev.status !== 'delivered') {
        if (settings.package_notify_delivered !== false && !isThrottled(`delivered-${pkg.id}`)) {
          sendNotification('\u{1F4EC} Package Delivered!', `${label} has been delivered`, `pkg-delivered-${pkg.id}`)
          setThrottled(`delivered-${pkg.id}`)
        }
      }

      // Exception notification
      if (pkg.status === 'exception' && prev.status !== 'exception') {
        if (settings.package_notify_exception !== false && !isThrottled(`exception-${pkg.id}`)) {
          sendNotification('\u26A0\uFE0F Package Issue', `${label}: ${pkg.status_detail || 'Delivery exception'}`, `pkg-exception-${pkg.id}`)
          setThrottled(`exception-${pkg.id}`)
        }
      }

      // Out for delivery notification
      if (pkg.status === 'out_for_delivery' && prev.status !== 'out_for_delivery') {
        if (!isThrottled(`ofd-${pkg.id}`)) {
          sendNotification('\u{1F69A} Out for Delivery', `${label} is out for delivery!`, `pkg-ofd-${pkg.id}`)
          setThrottled(`ofd-${pkg.id}`)
        }
      }

      // Signature required notification
      if (pkg.signature_required && !prev.signature_required) {
        if (settings.package_notify_signature !== false && !isThrottled(`sig-${pkg.id}`)) {
          sendNotification('\u270D\uFE0F Signature Required', `${label} requires a signature for delivery`, `pkg-sig-${pkg.id}`)
          setThrottled(`sig-${pkg.id}`)
        }
      }
    }

    lastPackages.current = packages
  }, [packages])
}
