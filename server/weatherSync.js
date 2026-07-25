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

import { getData, setData } from './db.js'

const CACHE_KEY = 'weather_cache'
const FETCH_INTERVAL_MS = 30 * 60 * 1000 // 30 min
const OPEN_METEO_FORECAST = 'https://api.open-meteo.com/v1/forecast'
const OPEN_METEO_GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search'

let loopTimer = null

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
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset',
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
    wind_max: daily.wind_speed_10m_max?.[i] ?? null,
    wind_gust_max: daily.wind_gusts_10m_max?.[i] ?? null,
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
      wind: raw.daily_units?.wind_speed_10m_max || 'mph',
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
export function detectWeatherEvents(forecast) {
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

// Weather alert pushes (nice_day / bad_weekend / nice_window) were deleted
// in the 2026-07-24 digest reshape — the forecast folds into the morning
// digest's weather line instead (buildWeatherSummary below). The event
// detector survives for any future digest "best days" enrichment.

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
