// Shared helpers for "user-local time" comparisons.
//
// Server-side dispatchers (push/email/pushover/digest) live in whatever
// timezone the host runs in (often UTC in Docker). User-facing settings
// like quiet-hours window and digest time are entered in the user's local
// time. Without timezone awareness, "22:00–08:00" is interpreted in
// server time and quiet hours fire at the wrong window.
//
// `settings.user_timezone` is auto-detected from the browser on first
// load (via Intl.DateTimeFormat().resolvedOptions().timeZone) and synced
// to the server. Falls back to `weather_timezone` (existing setting) and
// then to the server's local time.

function resolveTimezone(settings) {
  return settings.user_timezone || settings.weather_timezone || null
}

// Returns { hours, minutes } in the user's local time. If no timezone is
// known, falls back to the server's local time (matches old behavior).
export function getUserTimeParts(settings) {
  const tz = resolveTimezone(settings)
  if (!tz) {
    const now = new Date()
    return { hours: now.getHours(), minutes: now.getMinutes() }
  }
  try {
    // en-GB gives 24h format reliably
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = fmt.formatToParts(new Date())
    const hh = parseInt(parts.find(p => p.type === 'hour')?.value, 10)
    const mm = parseInt(parts.find(p => p.type === 'minute')?.value, 10)
    if (Number.isFinite(hh) && Number.isFinite(mm)) return { hours: hh, minutes: mm }
  } catch { /* invalid tz string falls through */ }
  const now = new Date()
  return { hours: now.getHours(), minutes: now.getMinutes() }
}

// True if "now" in the user's timezone falls within the configured quiet-hours window.
export function isInQuietHours(settings) {
  if (!settings.quiet_hours_enabled) return false
  const { hours, minutes } = getUserTimeParts(settings)
  const currentMins = hours * 60 + minutes
  const [startH, startM] = (settings.quiet_hours_start || '22:00').split(':').map(Number)
  const [endH, endM] = (settings.quiet_hours_end || '08:00').split(':').map(Number)
  const startMins = startH * 60 + startM
  const endMins = endH * 60 + endM
  if (startMins <= endMins) return currentMins >= startMins && currentMins < endMins
  return currentMins >= startMins || currentMins < endMins
}
