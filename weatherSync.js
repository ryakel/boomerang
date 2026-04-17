/**
 * Server-side weather sync + notification engine.
 *
 * Pulls a 7-day forecast from Open-Meteo every 30 minutes when enabled,
 * caches it in app_data, and emits push + email notifications when the
 * outlook meaningfully shifts (e.g. rainy weekend ahead after a nice stretch,
 * or today is a rare nice day before incoming bad weather).
 *
 * Gracefully tolerant: if weather is not enabled or no location is set,
 * the engine is a no-op.
 */

import crypto from 'crypto'
import { getData, setData, getNotifThrottle, setNotifThrottle, logNotifPush, logNotifEmail, getAllPushSubscriptions, deletePushSubscription } from './db.js'

const CACHE_KEY = 'weather_cache'
const FETCH_INTERVAL_MS = 30 * 60 * 1000 // 30 min
const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast'
const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'

let loopTimer = null
let lastFetchAt = 0

// --- WMO weather code → condition label + emoji ---
// https://open-meteo.com/en/docs (WMO Weather interpretation codes)
const WEATHER_CODES = {
  0:  { label: 'clear',           icon: '☀️',  kind: 'clear' },
  1:  { label: 'mostly clear',    icon: '🌤️', kind: 'clear' },
  2:  { label: 'partly cloudy',   icon: '⛅',  kind: 'clear' },
  3:  { label: 'overcast',        icon: '☁️',  kind: 'cloudy' },
  45: { label: 'fog',             icon: '🌫️', kind: 'cloudy' },
  48: { label: 'icy fog',         icon: '🌫️', kind: 'cloudy' },
  51: { label: 'light drizzle',   icon: '🌦️', kind: 'rain' },
  53: { label: 'drizzle',         icon: '🌦️', kind: 'rain' },
  55: { label: 'heavy drizzle',   icon: '🌦️', kind: 'rain' },
  56: { label: 'freezing drizzle', icon: '🌨️', kind: 'snow' },
  57: { label: 'freezing drizzle', icon: '🌨️', kind: 'snow' },
  61: { label: 'light rain',      icon: '🌧️', kind: 'rain' },
  63: { label: 'rain',            icon: '🌧️', kind: 'rain' },
  65: { label: 'heavy rain',      icon: '🌧️', kind: 'rain' },
  66: { label: 'freezing rain',   icon: '🌨️', kind: 'snow' },
  67: { label: 'freezing rain',   icon: '🌨️', kind: 'snow' },
  71: { label: 'light snow',      icon: '🌨️', kind: 'snow' },
  73: { label: 'snow',            icon: '❄️',  kind: 'snow' },
  75: { label: 'heavy snow',      icon: '❄️',  kind: 'snow' },
  77: { label: 'snow grains',     icon: '❄️',  kind: 'snow' },
  80: { label: 'rain showers',    icon: '🌦️', kind: 'rain' },
  81: { label: 'rain showers',    icon: '🌦️', kind: 'rain' },
  82: { label: 'heavy showers',   icon: '⛈️', kind: 'rain' },
  85: { label: 'snow showers',    icon: '🌨️', kind: 'snow' },
  86: { label: 'snow showers',    icon: '❄️',  kind: 'snow' },
  95: { label: 'thunderstorm',    icon: '⛈️', kind: 'storm' },
  96: { label: 'thunderstorm',    icon: '⛈️', kind: 'storm' },
  99: { label: 'thunderstorm',    icon: '⛈️', kind: 'storm' },
}

export function describeWeatherCode(code) {
  return WEATHER_CODES[code] || { label: 'unknown', icon: '•', kind: 'unknown' }
}

// "Nice" = clear or partly cloudy AND no meaningful precipitation
function isNiceDay(day) {
  if (!day) return false
  const { kind } = describeWeatherCode(day.weather_code)
  if (kind !== 'clear') return false
  if (day.precipitation_sum > 0.05) return false
  return true
}

function isBadDay(day) {
  if (!day) return false
  const { kind } = describeWeatherCode(day.weather_code)
  if (kind === 'rain' || kind === 'snow' || kind === 'storm') return true
  if (day.precipitation_sum > 0.1) return true
  return false
}

// --- Geocoding ---

export async function geocodeLocation(query) {
  if (!query || !query.trim()) return []
  const url = `${OPEN_METEO_GEOCODE}?name=${encodeURIComponent(query.trim())}&count=5&language=en&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Geocoding failed: ${res.status}`)
  const data = await res.json()
  return (data.results || []).map(r => ({
    latitude: r.latitude,
    longitude: r.longitude,
    name: r.name,
    admin1: r.admin1 || null,
    country: r.country || null,
    timezone: r.timezone || null,
    label: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
  }))
}

// --- Forecast fetch ---

async function fetchForecast(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,precipitation,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    timezone: 'auto',
    forecast_days: '7',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
  })
  const url = `${OPEN_METEO_FORECAST}?${params.toString()}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Open-Meteo fetch failed (${res.status}): ${text.slice(0, 200)}`)
  }
  return await res.json()
}

function normalizeForecast(raw) {
  const daily = raw.daily || {}
  const days = (daily.time || []).map((date, i) => ({
    date,
    weather_code: daily.weather_code?.[i] ?? 0,
    temp_max: daily.temperature_2m_max?.[i] ?? null,
    temp_min: daily.temperature_2m_min?.[i] ?? null,
    precipitation_sum: daily.precipitation_sum?.[i] ?? 0,
    precipitation_prob_max: daily.precipitation_probability_max?.[i] ?? null,
    sunrise: daily.sunrise?.[i] ?? null,
    sunset: daily.sunset?.[i] ?? null,
  }))
  return {
    current: raw.current ? {
      temperature: raw.current.temperature_2m ?? null,
      precipitation: raw.current.precipitation ?? 0,
      weather_code: raw.current.weather_code ?? 0,
      time: raw.current.time || null,
    } : null,
    days,
    timezone: raw.timezone || null,
    units: {
      temperature: raw.current_units?.temperature_2m || '°F',
      precipitation: raw.daily_units?.precipitation_sum || 'inch',
    },
  }
}

// --- Cache ---

export function getWeatherCache() {
  return getData(CACHE_KEY) || null
}

function saveWeatherCache(forecast, location) {
  const cache = {
    fetched_at: new Date().toISOString(),
    location,
    forecast,
  }
  setData(CACHE_KEY, cache)
  return cache
}

export function clearWeatherCache() {
  setData(CACHE_KEY, null)
}

// --- Public refresh (called from endpoint or loop) ---

export async function refreshWeather({ force = false } = {}) {
  const settings = getData('settings') || {}
  if (!settings.weather_enabled) return { ok: false, reason: 'disabled' }
  const lat = settings.weather_latitude
  const lon = settings.weather_longitude
  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return { ok: false, reason: 'no_location' }
  }

  const cache = getWeatherCache()
  if (!force && cache?.fetched_at) {
    const age = Date.now() - new Date(cache.fetched_at).getTime()
    if (age < FETCH_INTERVAL_MS) return { ok: true, cached: true, cache }
  }

  try {
    const raw = await fetchForecast(lat, lon)
    const forecast = normalizeForecast(raw)
    const location = {
      latitude: lat,
      longitude: lon,
      label: settings.weather_location_name || null,
    }
    const saved = saveWeatherCache(forecast, location)
    lastFetchAt = Date.now()

    // Evaluate notifications after every refresh (no-op if nothing meaningful)
    try {
      await evaluateWeatherNotifications(saved, settings)
    } catch (err) {
      console.error('[Weather] Notification evaluation failed:', err.message)
    }

    return { ok: true, cached: false, cache: saved }
  } catch (err) {
    console.error('[Weather] Refresh failed:', err.message)
    return { ok: false, reason: 'fetch_failed', error: err.message }
  }
}

// --- Notification evaluation ---

function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).getDay() // 0 Sun … 6 Sat
}

function isWeekend(dateStr) {
  const dow = dayOfWeek(dateStr)
  return dow === 0 || dow === 6
}

function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', { weekday: 'short' })
}

/**
 * Build a set of "events" from the forecast that are notification-worthy.
 * Each event has a stable id used for throttle dedup so we don't renotify
 * for the same weekend rain twice.
 */
function detectWeatherEvents(forecast) {
  if (!forecast?.days?.length) return []
  const today = forecast.days[0]
  const next3 = forecast.days.slice(1, 4)
  const weekendDays = forecast.days.filter(d => isWeekend(d.date))
  const events = []

  // "Rare nice day" — today is nice, and at least 2 of the next 3 days are bad
  if (isNiceDay(today) && next3.filter(isBadDay).length >= 2) {
    const nextBad = next3.find(isBadDay)
    const nextBadInfo = nextBad ? describeWeatherCode(nextBad.weather_code) : null
    events.push({
      id: `nice_day:${today.date}`,
      type: 'nice_day',
      title: 'Nice day ahead of rough weather',
      body: nextBad
        ? `${describeWeatherCode(today.weather_code).icon} ${shortDate(today.date)} is clear (${Math.round(today.temp_max)}°). ${nextBadInfo.icon} ${nextBadInfo.label} rolling in by ${shortDate(nextBad.date)} — good day to knock out outdoor tasks.`
        : `${shortDate(today.date)} is clear — make it count.`,
      forecast_window: [today.date, ...next3.map(d => d.date)],
    })
  }

  // "Rough weekend" — at least one upcoming weekend day within 7 days is bad
  const badWeekend = weekendDays.find(d => isBadDay(d) && d.date !== today.date)
  if (badWeekend) {
    const info = describeWeatherCode(badWeekend.weather_code)
    events.push({
      id: `bad_weekend:${badWeekend.date}:${info.kind}`,
      type: 'bad_weekend',
      title: 'Rough weekend incoming',
      body: `${info.icon} ${info.label} on ${shortDate(badWeekend.date)} (${Math.round(badWeekend.temp_max)}°/${Math.round(badWeekend.temp_min)}°). Lean into indoor tasks this weekend.`,
      forecast_window: [badWeekend.date],
    })
  }

  // "Outdoor window" — stretch of 2+ nice days starting tomorrow after bad weather
  const nice2Days = forecast.days.slice(1, 4).every(isNiceDay)
    && forecast.days.slice(0, 1).some(isBadDay)
  if (nice2Days) {
    const first = forecast.days[1]
    const last = forecast.days[3] || forecast.days[2] || first
    events.push({
      id: `nice_window:${first.date}:${last.date}`,
      type: 'nice_window',
      title: 'Nice stretch coming up',
      body: `${describeWeatherCode(first.weather_code).icon} ${shortDate(first.date)}–${shortDate(last.date)} looking clear. Plan outdoor errands now.`,
      forecast_window: [first.date, last.date],
    })
  }

  return events
}

function checkThrottle(key, freqMs) {
  const last = getNotifThrottle(key)
  if (!last) return true
  return Date.now() - new Date(last).getTime() >= freqMs
}

function markThrottle(key) {
  setNotifThrottle(key, new Date().toISOString())
}

function genId() {
  return crypto.randomUUID()
}

function isInQuietHours(settings) {
  if (!settings.quiet_hours_enabled) return false
  const now = new Date()
  const currentMins = now.getHours() * 60 + now.getMinutes()
  const [startH, startM] = (settings.quiet_hours_start || '22:00').split(':').map(Number)
  const [endH, endM] = (settings.quiet_hours_end || '08:00').split(':').map(Number)
  const startMins = startH * 60 + startM
  const endMins = endH * 60 + endM
  if (startMins <= endMins) return currentMins >= startMins && currentMins < endMins
  return currentMins >= startMins || currentMins < endMins
}

// Lazy-load push/email engines to avoid circular imports
let pushModule = null
let emailModule = null

async function sendWeatherPush(title, body, eventId) {
  if (!pushModule) pushModule = await import('./pushNotifications.js')
  if (!pushModule.isConfigured || !pushModule.isConfigured()) {
    // Fallback: directly use web-push via the exported helpers
  }
  // Use dynamic access — pushNotifications.js only exports high-level functions.
  // Easiest: send via its public sendTestPush-like path. We'll replicate the
  // sendPush loop here to keep this module decoupled.
  const webpush = (await import('web-push')).default
  const publicKey = pushModule.getVapidPublicKey?.()
  if (!publicKey) return false
  const subs = getAllPushSubscriptions()
  if (subs.length === 0) return false
  const payload = JSON.stringify({ title, body, tag: `weather:${eventId}` })
  let sent = false
  for (const sub of subs) {
    const pushSub = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }
    try {
      await webpush.sendNotification(pushSub, payload)
      sent = true
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404 || err.statusCode === 403) {
        deletePushSubscription(sub.endpoint)
      } else {
        console.error(`[Weather] Push send failed (${err.statusCode || 'unknown'}):`, err.message)
      }
    }
  }
  return sent
}

async function sendWeatherEmail(subject, body) {
  if (!emailModule) emailModule = await import('./emailNotifications.js')
  // emailNotifications exports sendPackageEmail + sendTestEmail but sendEmail is internal.
  // We'll use the transporter via Nodemailer directly through the public resetTransporter path.
  // Simplest approach: create our own tiny SMTP send using env vars here.
  const nodemailer = (await import('nodemailer')).default
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return false
  const settings = getData('settings') || {}
  const to = process.env.NOTIFICATION_EMAIL || settings.email_address
  if (!to) return false
  const from = process.env.SMTP_FROM || user
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const transport = nodemailer.createTransport({
    host, port, secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  })
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#1a1a2e;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
    <div style="max-width:500px;margin:0 auto;padding:24px">
      <div style="background:#16213e;border-radius:12px;padding:24px;color:#e0e0e0">
        <div style="font-size:18px;font-weight:600;color:#fff;margin-bottom:16px">${subject}</div>
        <div style="font-size:14px;color:#ccc;line-height:1.5">${body}</div>
        <div style="margin-top:24px;padding-top:16px;border-top:1px solid #2a2a4a;font-size:12px;color:#666">Boomerang Task Manager · Weather</div>
      </div>
    </div></body></html>`
  try {
    await transport.sendMail({ from: `"Boomerang" <${from}>`, to, subject, text: body, html })
    return true
  } catch (err) {
    console.error('[Weather] Email send failed:', err.message)
    return false
  }
}

async function evaluateWeatherNotifications(cache, settings) {
  if (!settings.weather_notifications_enabled) return
  if (isInQuietHours(settings)) return

  const events = detectWeatherEvents(cache.forecast)
  if (events.length === 0) return

  const pushEnabled = settings.push_notifications_enabled && settings.weather_notif_push !== false
  const emailEnabled = settings.email_notifications_enabled && settings.weather_notif_email !== false

  // De-dup per event: once an event is notified we don't re-fire for ~18h.
  // Different events on the same day are still allowed (e.g. nice_day + bad_weekend).
  const WEATHER_EVENT_TTL_MS = 18 * 60 * 60 * 1000

  for (const event of events) {
    const throttleKey = `weather:${event.id}`
    if (!checkThrottle(throttleKey, WEATHER_EVENT_TTL_MS)) continue

    let delivered = false
    if (pushEnabled) {
      const sent = await sendWeatherPush(event.title, event.body, event.id)
      if (sent) {
        logNotifPush(genId(), `weather_${event.type}`, null, event.title, event.body)
        delivered = true
      }
    }
    if (emailEnabled) {
      const sent = await sendWeatherEmail(event.title, event.body)
      if (sent) {
        logNotifEmail(genId(), `weather_${event.type}`, null, event.title, event.body)
        delivered = true
      }
    }
    if (delivered) markThrottle(throttleKey)
  }
}

// --- Weather summary for digest / What Now / AI context ---

export function buildWeatherSummary(cache) {
  if (!cache?.forecast?.days?.length) return null
  const days = cache.forecast.days
  const today = days[0]
  const tomorrow = days[1]
  const todayInfo = describeWeatherCode(today.weather_code)
  const pieces = []
  pieces.push(`Today: ${todayInfo.icon} ${todayInfo.label}, ${Math.round(today.temp_max)}°/${Math.round(today.temp_min)}°`)
  if (tomorrow) {
    const tInfo = describeWeatherCode(tomorrow.weather_code)
    pieces.push(`Tomorrow: ${tInfo.icon} ${tInfo.label}, ${Math.round(tomorrow.temp_max)}°`)
  }
  const weekend = days.find(d => isWeekend(d.date) && d.date !== today.date)
  if (weekend) {
    const wInfo = describeWeatherCode(weekend.weather_code)
    pieces.push(`${shortDate(weekend.date)}: ${wInfo.icon} ${wInfo.label}, ${Math.round(weekend.temp_max)}°`)
  }
  return pieces.join(' · ')
}

// --- Lifecycle ---

async function runWeatherTick() {
  try {
    await refreshWeather()
  } catch (err) {
    console.error('[Weather] Tick failed:', err.message)
  }
}

export function startWeatherSync() {
  if (loopTimer) return
  loopTimer = setInterval(runWeatherTick, FETCH_INTERVAL_MS)
  // First check after 30s so DB has settled
  setTimeout(runWeatherTick, 30 * 1000)
  const settings = getData('settings') || {}
  if (settings.weather_enabled && typeof settings.weather_latitude === 'number') {
    console.log(`[Weather] Sync started (${settings.weather_location_name || `${settings.weather_latitude},${settings.weather_longitude}`})`)
  } else {
    console.log('[Weather] Sync loop running (not configured — will no-op)')
  }
}

export function stopWeatherSync() {
  if (loopTimer) {
    clearInterval(loopTimer)
    loopTimer = null
  }
}

// --- Status ---

export function getWeatherStatus() {
  const settings = getData('settings') || {}
  const cache = getWeatherCache()
  return {
    enabled: !!settings.weather_enabled,
    location: settings.weather_location_name || null,
    latitude: settings.weather_latitude ?? null,
    longitude: settings.weather_longitude ?? null,
    fetched_at: cache?.fetched_at || null,
    has_forecast: !!cache?.forecast?.days?.length,
  }
}
