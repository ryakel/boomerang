import { useState } from 'react'
import { getWhatNow } from '../api'
import { ENERGY_TYPES } from '../store'

const TIME_OPTIONS = ['5–10 minutes', '30 minutes', 'A couple hours']
const ENERGY_OPTIONS = ['Running on fumes', 'Moderate', "I've got it"]

export default function WhatNow({ tasks, onClose, onComplete }) {
  const [step, setStep] = useState(1)
  const [time, setTime] = useState(null)
  const [energyLevel, setEnergyLevel] = useState(null)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState(null)
  const [error, setError] = useState(null)

  const fetchSuggestions = async (energy, capacity = null) => {
    setStep(4)
    setLoading(true)
    setError(null)
    try {
      const results = await getWhatNow(tasks, time, energy, capacity)
      setSuggestions(results)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleEnergy = (energy) => {
    setEnergyLevel(energy)
    setStep(3)
  }

  const handleCapacity = (capacity) => {
    fetchSuggestions(energyLevel, capacity)
  }

  return (
    <div className="what-now-overlay">
      {step === 1 && (
        <>
          <div className="what-now-question">How much time do you have?</div>
          <div className="what-now-options">
            {TIME_OPTIONS.map(opt => (
              <button
                key={opt}
                className="what-now-option"
                onClick={() => { setTime(opt); setStep(2) }}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div className="what-now-question">How's your energy?</div>
          <div className="what-now-options">
            {ENERGY_OPTIONS.map(opt => (
              <button
                key={opt}
                className="what-now-option"
                onClick={() => handleEnergy(opt)}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <div className="what-now-question">What can you do right now?</div>
          <div className="what-now-options what-now-capacity">
            {ENERGY_TYPES.map(et => (
              <button
                key={et.id}
                className="what-now-option what-now-capacity-btn"
                onClick={() => handleCapacity(et.id)}
              >
                <span className={`energy-icon energy-type-icon ${et.iconClass}`} /> {et.label}
              </button>
            ))}
            <button
              className="what-now-option what-now-capacity-btn"
              onClick={() => handleCapacity(null)}
            >
              🎯 Anything
            </button>
          </div>
          <button
            className="what-now-skip"
            onClick={() => fetchSuggestions(energyLevel, null)}
          >
            Skip →
          </button>
        </>
      )}

      {step === 4 && (
        <>
          {loading && (
            <div className="what-now-loading">
              <span className="spinner" /> Finding the right thing...
            </div>
          )}
          {error && (
            <div style={{ color: 'var(--accent)', textAlign: 'center', fontSize: 14 }}>
              {error}
            </div>
          )}
          {suggestions && (
            <>
              <div className="what-now-question">Try these</div>
              <div className="what-now-options">
                {suggestions.picks.map((s, i) => {
                  const match = tasks.find(t => t.status === 'open' && t.title === s.task)
                  return (
                    <div key={i} className="suggestion-card">
                      <div className="suggestion-top">
                        <div>
                          <div className="suggestion-name">{s.task}</div>
                          <div className="suggestion-reason">{s.reason}</div>
                        </div>
                        {match && (
                          <button
                            className="action-btn done suggestion-done"
                            onClick={() => onComplete(match.id)}
                          >
                            Done ✓
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {suggestions.stretch && (
                <>
                  <div className="what-now-question stretch-label">Feeling ambitious?</div>
                  <div className="what-now-options">
                    {(() => {
                      const s = suggestions.stretch
                      const match = tasks.find(t => t.status === 'open' && t.title === s.task)
                      return (
                        <div className="suggestion-card stretch-card">
                          <div className="suggestion-top">
                            <div>
                              <div className="suggestion-name">{s.task}</div>
                              <div className="suggestion-reason">{s.reason}</div>
                            </div>
                            {match && (
                              <button
                                className="action-btn done suggestion-done"
                                onClick={() => onComplete(match.id)}
                              >
                                Done ✓
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </>
              )}
              <button className="submit-btn" style={{ marginTop: 20, maxWidth: 320 }} onClick={onClose}>
                Got it
              </button>
            </>
          )}
        </>
      )}

      {!suggestions && (
        <button className="what-now-dismiss" onClick={onClose}>
          Never mind
        </button>
      )}
    </div>
  )
}
