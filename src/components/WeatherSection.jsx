import { memo } from 'react'

const WMO_ICON = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌦️',
  56: '🌨️', 57: '🌨️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  66: '🌨️', 67: '🌨️',
  71: '🌨️', 73: '❄️', 75: '❄️', 77: '❄️',
  80: '🌦️', 81: '🌦️', 82: '⛈️',
  85: '🌨️', 86: '❄️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
}

const WMO_LABEL = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'icy fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  56: 'freezing drizzle', 57: 'freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain',
  66: 'freezing rain', 67: 'freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
  80: 'rain showers', 81: 'rain showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'snow showers',
  95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm',
}

// WMO kind grouping — used to decide "bad" for outdoor suitability
const WMO_KIND = {
  0: 'clear', 1: 'clear', 2: 'clear', 3: 'cloudy',
  45: 'cloudy', 48: 'cloudy',
  51: 'rain', 53: 'rain', 55: 'rain', 56: 'snow', 57: 'snow',
  61: 'rain', 63: 'rain', 65: 'rain', 66: 'snow', 67: 'snow',
  71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
  80: 'rain', 81: 'rain', 82: 'rain',
  85: 'snow', 86: 'snow',
  95: 'storm', 96: 'storm', 99: 'storm',
}

function dayLabel(dateStr, todayDateStr) {
  if (dateStr === todayDateStr) return 'Today'
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const todayParts = todayDateStr.split('-').map(Number)
  const today = new Date(todayParts[0], todayParts[1] - 1, todayParts[2])
  const diff = Math.round((dt - today) / 86400000)
  if (diff === 1) return 'Tmrw'
  return dt.toLocaleDateString('en-US', { weekday: 'short' })
}

/**
 * Score a day for outdoor suitability. Higher is better.
 * Heavy penalties for precipitation, storms, and high wind. Small penalties
 * for uncomfortable temperature extremes.
 */
function scoreDay(d) {
  const kind = WMO_KIND[d.weather_code] || 'unknown'
  let score = 100
  if (kind === 'storm') score -= 80
  else if (kind === 'snow') score -= 60
  else if (kind === 'rain') score -= 45
  else if (kind === 'cloudy') score -= 10
  // Precip probability penalty
  if (d.precipitation_prob_max != null) score -= Math.min(40, d.precipitation_prob_max * 0.4)
  // Precip amount penalty (inches)
  if (d.precipitation_sum > 0.1) score -= 15
  // Wind penalty — breezy is fine, gusty/blustery is not
  if (d.wind_max != null) {
    if (d.wind_max > 25) score -= 25
    else if (d.wind_max > 15) score -= 10
  }
  // Temperature penalty — discomfort at extremes
  if (d.temp_max != null) {
    if (d.temp_max < 32) score -= 20
    else if (d.temp_max < 45) score -= 8
    else if (d.temp_max > 95) score -= 20
    else if (d.temp_max > 85) score -= 5
  }
  return score
}

export function pickBestDays(days, { limit = 3, minScore = 55 } = {}) {
  if (!days?.length) return []
  const scored = days.map(d => ({ ...d, _score: scoreDay(d) }))
  const good = scored.filter(d => d._score >= minScore).sort((a, b) => b._score - a._score)
  // Preserve chronological order for the top picks
  const picked = good.slice(0, limit).sort((a, b) => a.date.localeCompare(b.date))
  return picked
}

// --- Outdoor / visibility detection ---
// Shared between TaskCard and EditTaskModal so card and modal agree on
// when weather is shown vs hidden vs offered behind a drawer.

const OUTDOOR_KEYWORDS_RE = /\b(mow|yard|garden|weed|plant|trim|prune|rake|shovel|snow|leaves|gutter|deck|patio|driveway|paint(?:ing)? (?:the )?(?:deck|fence|house|siding)?|wash car|car wash|detail(?:ing)? car|grill|bbq|hike|walk|run|bike|swim|pool|outside|outdoor|fence|sidewalk|sprinkler|hose|firewood|chainsaw|compost|mulch)\b/i

export function isOutdoorTaskShape({ title, energy }) {
  if (energy === 'physical' || energy === 'errand') return true
  if (title && OUTDOOR_KEYWORDS_RE.test(title)) return true
  return false
}

function hasNamedTag(taskTagIds, labels, names) {
  if (!taskTagIds?.length || !labels?.length) return false
  const lowerNames = names.map(n => n.toLowerCase())
  return taskTagIds.some(id => {
    const label = labels.find(l => l.id === id)
    return label?.name && lowerNames.includes(label.name.toLowerCase())
  })
}

/**
 * Returns one of:
 *   'visible' — render weather inline, expanded
 *   'drawer'  — render a collapsible disclosure that the user can open
 *   'hidden'  — don't render anything
 *
 * Rules (highest priority first):
 * 1. Tag named "outside"/"outdoor"  → visible (explicit user override)
 * 2. Tag named "inside"/"indoor"    → drawer (explicit user override)
 * 3. defaultHidden setting on       → drawer (global "hide on cards" toggle)
 * 4. Auto-detected outdoor task     → visible
 * 5. Otherwise                      → hidden
 *
 * `weatherEnabled` short-circuits everything to 'hidden' when weather isn't
 * configured, so callers don't have to gate twice.
 */
export function resolveWeatherVisibility({ task, labels, weatherEnabled, defaultHidden = false }) {
  if (!weatherEnabled) return 'hidden'
  if (hasNamedTag(task.tags, labels, ['outside', 'outdoor'])) return 'visible'
  if (hasNamedTag(task.tags, labels, ['inside', 'indoor'])) return 'drawer'
  if (defaultHidden) return 'drawer'
  if (isOutdoorTaskShape({ title: task.title, energy: task.energy })) return 'visible'
  return 'hidden'
}

function formatBestDayShort(d, todayDateStr) {
  const label = dayLabel(d.date, todayDateStr)
  const hi = d.temp_max != null ? `${Math.round(d.temp_max)}°` : ''
  return hi ? `${label} ${hi}` : label
}

export function formatBestDaysLine(days, todayDateStr) {
  if (!days?.length) return null
  return `Best days: ${days.map(d => formatBestDayShort(d, todayDateStr)).join(', ')}`
}

export default memo(function WeatherSection({ forecast, dueDate }) {
  if (!forecast?.days?.length) return null
  const todayDateStr = forecast.days[0].date
  const dueDateObj = dueDate || null
  const days = forecast.days.slice(0, 7)
  const topRow = days.slice(0, 3)
  const bottomRow = days.slice(3, 7)

  const renderDay = (d, sizeClass) => {
    const icon = WMO_ICON[d.weather_code] || '•'
    const label = WMO_LABEL[d.weather_code] || 'unknown'
    const hi = d.temp_max != null ? `${Math.round(d.temp_max)}°` : '—'
    const lo = d.temp_min != null ? `${Math.round(d.temp_min)}°` : '—'
    const wind = d.wind_max != null ? `${Math.round(d.wind_max)}mph` : ''
    const precip = d.precipitation_prob_max != null ? `${d.precipitation_prob_max}%` : ''
    const isDue = dueDateObj && d.date === dueDateObj
    return (
      <div
        key={d.date}
        className={`weather-day weather-day-${sizeClass}${isDue ? ' weather-day-due' : ''}`}
        title={`${label}${wind ? ` · ${wind} wind` : ''}${precip ? ` · ${precip} precip` : ''}`}
      >
        <span className="weather-day-name">{dayLabel(d.date, todayDateStr)}</span>
        <span className="weather-day-icon">{icon}</span>
        <span className="weather-day-temp">{hi}/{lo}</span>
        {wind && <span className="weather-day-wind">{wind}</span>}
      </div>
    )
  }

  return (
    <div className="weather-section" onClick={e => e.stopPropagation()}>
      <div className="weather-section-row weather-section-row-top">
        {topRow.map(d => renderDay(d, 'lg'))}
      </div>
      {bottomRow.length > 0 && (
        <div className="weather-section-row weather-section-row-bottom">
          {bottomRow.map(d => renderDay(d, 'sm'))}
        </div>
      )}
    </div>
  )
})
