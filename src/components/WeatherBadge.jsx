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

export default memo(function WeatherBadge({ day }) {
  if (!day) return null
  const icon = WMO_ICON[day.weather_code] || ''
  const label = WMO_LABEL[day.weather_code] || 'weather'
  const high = day.temp_max != null ? `${Math.round(day.temp_max)}°` : null
  const title = `${label}${high ? `, ${high}` : ''}${day.precipitation_prob_max != null ? ` · ${day.precipitation_prob_max}% precip` : ''}`
  return (
    <span className="weather-badge" title={title} aria-label={title}>
      <span className="weather-badge-icon">{icon}</span>
      {high && <span className="weather-badge-temp">{high}</span>}
    </span>
  )
})
