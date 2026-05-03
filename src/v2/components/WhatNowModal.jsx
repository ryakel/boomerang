import { useState } from 'react'
import { Target, Monitor, Users, MapPin, Palette, Dumbbell } from 'lucide-react'
import { getWhatNow, getWeather } from '../../api'
import { ENERGY_TYPES } from '../../store'
import ModalShell from './ModalShell'
import './WhatNowModal.css'

const ENERGY_ICONS = { Monitor, Users, MapPin, Palette, Dumbbell }

const TIME_OPTIONS = [
  { label: '5–10 minutes', sub: 'Quick win' },
  { label: '30 minutes', sub: 'A focused chunk' },
  { label: 'A couple hours', sub: 'Real session' },
]
const ENERGY_OPTIONS = [
  { label: 'Running on fumes', sub: 'Low capacity' },
  { label: 'Moderate', sub: 'Average day' },
  { label: "I've got it", sub: 'Peak focus' },
]

// Build a compact summary string for the AI prompt — same shape as v1.
function buildWeatherSummaryFromCache(cache) {
  const days = cache?.cache?.forecast?.days
  if (!days?.length) return null
  const WMO = {
    0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'fog', 48: 'icy fog', 51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain',
    71: 'light snow', 73: 'snow', 75: 'heavy snow',
    80: 'rain showers', 81: 'rain showers', 82: 'heavy showers',
    85: 'snow showers', 86: 'snow showers',
    95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm',
  }
  const describe = (d) => `${WMO[d.weather_code] || 'unknown'}, ${Math.round(d.temp_max)}°/${Math.round(d.temp_min)}°`
  const today = days[0]
  const tomorrow = days[1]
  const weekend = days.find(d => {
    if (d.date === today.date) return false
    const [y, m, day] = d.date.split('-').map(Number)
    const dow = new Date(y, m - 1, day).getDay()
    return dow === 0 || dow === 6
  })
  const parts = [`Today: ${describe(today)}`]
  if (tomorrow) parts.push(`Tomorrow: ${describe(tomorrow)}`)
  if (weekend) {
    const [y, m, day] = weekend.date.split('-').map(Number)
    const name = new Date(y, m - 1, day).toLocaleDateString('en-US', { weekday: 'short' })
    parts.push(`${name}: ${describe(weekend)}`)
  }
  return parts.join(' · ')
}

export default function WhatNowModal({ open, tasks, onClose, onComplete }) {
  const [step, setStep] = useState(1)
  const [time, setTime] = useState(null)
  const [energyLevel, setEnergyLevel] = useState(null)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState(null)
  const [error, setError] = useState(null)

  const reset = () => {
    setStep(1); setTime(null); setEnergyLevel(null)
    setLoading(false); setSuggestions(null); setError(null)
  }

  const handleClose = () => { reset(); onClose() }

  const fetchSuggestions = async (energy, capacity = null) => {
    setStep(4)
    setLoading(true)
    setError(null)
    try {
      let weatherSummary = null
      try {
        const weatherData = await getWeather()
        if (weatherData?.enabled) weatherSummary = buildWeatherSummaryFromCache(weatherData)
      } catch { /* weather optional */ }
      const results = await getWhatNow(tasks, time, energy, capacity, weatherSummary)
      setSuggestions(results)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const stepTitle = {
    1: 'How much time do you have?',
    2: "How's your energy?",
    3: 'What can you do right now?',
    4: 'Try these',
  }[step]

  return (
    <ModalShell open={open} onClose={handleClose} title="What now?" subtitle={stepTitle} width="narrow">
      {step === 1 && (
        <ul className="v2-whatnow-options">
          {TIME_OPTIONS.map(opt => (
            <li key={opt.label}>
              <button className="v2-whatnow-option" onClick={() => { setTime(opt.label); setStep(2) }}>
                <span className="v2-whatnow-option-label">{opt.label}</span>
                <span className="v2-whatnow-option-sub">{opt.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {step === 2 && (
        <ul className="v2-whatnow-options">
          {ENERGY_OPTIONS.map(opt => (
            <li key={opt.label}>
              <button className="v2-whatnow-option" onClick={() => { setEnergyLevel(opt.label); setStep(3) }}>
                <span className="v2-whatnow-option-label">{opt.label}</span>
                <span className="v2-whatnow-option-sub">{opt.sub}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {step === 3 && (
        <>
          <div className="v2-whatnow-capacity">
            {ENERGY_TYPES.map(et => {
              const Icon = ENERGY_ICONS[et.icon]
              return (
                <button
                  key={et.id}
                  className="v2-whatnow-capacity-btn"
                  onClick={() => fetchSuggestions(energyLevel, et.id)}
                >
                  {Icon && <Icon size={16} strokeWidth={1.75} color={et.color} />}
                  <span>{et.label}</span>
                </button>
              )
            })}
            <button
              className="v2-whatnow-capacity-btn"
              onClick={() => fetchSuggestions(energyLevel, null)}
            >
              <Target size={16} strokeWidth={1.75} />
              <span>Anything</span>
            </button>
          </div>
          <button className="v2-whatnow-skip" onClick={() => fetchSuggestions(energyLevel, null)}>
            Skip →
          </button>
        </>
      )}

      {step === 4 && (
        <>
          {loading && (
            <div className="v2-whatnow-loading">
              <span className="v2-spinner" /> Finding the right thing…
            </div>
          )}
          {error && <div className="v2-whatnow-error">{error}</div>}
          {suggestions && (
            <>
              <ul className="v2-whatnow-picks">
                {suggestions.picks.map((s, i) => {
                  const match = tasks.find(t => t.status === 'open' && t.title === s.task)
                  return (
                    <li key={i} className="v2-whatnow-pick">
                      <div className="v2-whatnow-pick-content">
                        <div className="v2-whatnow-pick-task">{s.task}</div>
                        <div className="v2-whatnow-pick-reason">{s.reason}</div>
                      </div>
                      {match && (
                        <button
                          className="v2-whatnow-pick-done"
                          onClick={() => { onComplete(match.id); handleClose() }}
                        >
                          ✓ Done
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
              {suggestions.stretch && (
                <>
                  <div className="v2-whatnow-stretch-label">Feeling ambitious?</div>
                  <ul className="v2-whatnow-picks">
                    {(() => {
                      const s = suggestions.stretch
                      const match = tasks.find(t => t.status === 'open' && t.title === s.task)
                      return (
                        <li className="v2-whatnow-pick v2-whatnow-pick-stretch">
                          <div className="v2-whatnow-pick-content">
                            <div className="v2-whatnow-pick-task">{s.task}</div>
                            <div className="v2-whatnow-pick-reason">{s.reason}</div>
                          </div>
                          {match && (
                            <button
                              className="v2-whatnow-pick-done"
                              onClick={() => { onComplete(match.id); handleClose() }}
                            >
                              ✓ Done
                            </button>
                          )}
                        </li>
                      )
                    })()}
                  </ul>
                </>
              )}
              <button className="v2-form-submit" onClick={handleClose}>
                Got it
              </button>
            </>
          )}
        </>
      )}
    </ModalShell>
  )
}
