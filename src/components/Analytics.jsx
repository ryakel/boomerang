import { useState, useRef, useEffect } from 'react'
import { FullRings } from './Rings'
import { loadSettings, saveSettings } from '../store'

export default function Analytics({ onClose, isDesktop }) {
  const settings = loadSettings()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    fetch('/api/analytics')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setStats(data) })
      .catch(() => {})
  }, [])

  const tasksToday = stats?.tasksToday || 0
  const pointsToday = stats?.pointsToday || 0
  const streak = stats?.streak || 0
  const bestTasks = stats?.bestTasks || 0
  const bestPoints = stats?.bestPoints || 0
  const longestStreak = stats?.longestStreak || 0

  const taskGoal = settings.daily_task_goal || 3
  const pointsGoal = settings.daily_points_goal || 15

  const rings = [
    { progress: taskGoal > 0 ? tasksToday / taskGoal : 0, color: '#52C97F' },
    { progress: pointsGoal > 0 ? pointsToday / pointsGoal : 0, color: '#FFB347' },
    { progress: streak > 0 ? Math.min(streak / 7, 1) : 0, color: '#4A9EFF' },
  ]

  const [vacationMode, setVacationMode] = useState(settings.vacation_mode || false)
  const [showVacationPicker, setShowVacationPicker] = useState(false)
  const [customDays, setCustomDays] = useState('')
  const todayStr = new Date().toISOString().split('T')[0]
  const [isFreeDay, setIsFreeDay] = useState(() => (settings.free_days || []).includes(todayStr))
  const [resetState, setResetState] = useState('idle') // 'idle' | 'confirming'
  const resetTimer = useRef(null)

  // Check if vacation has expired
  useEffect(() => {
    if (vacationMode && settings.vacation_end) {
      const endDate = new Date(settings.vacation_end)
      if (new Date() >= endDate) {
        const current = loadSettings()
        saveSettings({ ...current, vacation_mode: false, vacation_end: null, vacation_started: null })
        setVacationMode(false)
      }
    }
  }, [vacationMode, settings.vacation_end])

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  const handleVacationClick = () => {
    if (vacationMode) {
      // Turn off vacation
      const current = loadSettings()
      saveSettings({
        ...current,
        vacation_mode: false,
        vacation_started: null,
        vacation_end: null,
        streak_current: streak,
      })
      setVacationMode(false)
    } else {
      setShowVacationPicker(true)
    }
  }

  const startVacation = (days) => {
    const current = loadSettings()
    const end = new Date()
    end.setDate(end.getDate() + days)
    saveSettings({
      ...current,
      vacation_mode: true,
      vacation_started: new Date().toISOString(),
      vacation_end: end.toISOString(),
      streak_current: streak,
    })
    setVacationMode(true)
    setShowVacationPicker(false)
    setCustomDays('')
  }

  const handleReset = () => {
    if (resetState === 'idle') {
      setResetState('confirming')
      resetTimer.current = setTimeout(() => setResetState('idle'), 3000)
    } else {
      // Second tap — reset
      if (resetTimer.current) clearTimeout(resetTimer.current)
      setResetState('idle')
      const current = loadSettings()
      saveSettings({ ...current, streak_current: 0 })
    }
  }

  const centerLabel = `${pointsToday}`

  const content = (
    <>
      <FullRings rings={rings} label={centerLabel} />

      <div className="ring-legend">
        <div className="ring-legend-item">
          <div className="ring-legend-dot" style={{ background: '#52C97F' }} />
          <span>Tasks: {tasksToday}/{taskGoal}</span>
        </div>
        <div className="ring-legend-item">
          <div className="ring-legend-dot" style={{ background: '#FFB347' }} />
          <span>Points: {pointsToday}/{pointsGoal}</span>
        </div>
        <div className="ring-legend-item">
          <div className="ring-legend-dot" style={{ background: '#4A9EFF' }} />
          <span>Streak: {streak}d</span>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{streak}</div>
          <div className="stat-label">Current Streak</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{longestStreak}</div>
          <div className="stat-label">Longest Streak</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{bestPoints}</div>
          <div className="stat-label">Best Daily Points</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{bestTasks}</div>
          <div className="stat-label">Best Daily Tasks</div>
        </div>
      </div>

      <div className="streak-actions-row">
        <button
          className={`vacation-btn ${vacationMode ? 'active' : ''}`}
          onClick={handleVacationClick}
        >
          {vacationMode ? 'End vacation' : 'Vacation mode'}
        </button>
        <button
          className={`free-day-btn ${isFreeDay ? 'active' : ''}`}
          onClick={() => {
            const current = loadSettings()
            const freeDays = new Set(current.free_days || [])
            if (isFreeDay) {
              freeDays.delete(todayStr)
            } else {
              freeDays.add(todayStr)
            }
            saveSettings({ ...current, free_days: [...freeDays] })
            setIsFreeDay(!isFreeDay)
          }}
        >
          {isFreeDay ? 'Free day on' : 'Free day'}
        </button>
      </div>

      {showVacationPicker && (
        <div className="vacation-picker">
          <div className="vacation-picker-title">How long?</div>
          <div className="vacation-picker-options">
            <button className="vacation-option" onClick={() => startVacation(3)}>3 days</button>
            <button className="vacation-option" onClick={() => startVacation(5)}>5 days</button>
            <button className="vacation-option" onClick={() => startVacation(7)}>7 days</button>
          </div>
          <div className="vacation-custom-row">
            <input
              type="number"
              className="vacation-custom-input"
              placeholder="Custom days"
              min="1"
              max="365"
              value={customDays}
              onChange={e => setCustomDays(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
            <button
              className="vacation-option vacation-custom-go"
              disabled={!customDays || customDays < 1}
              onClick={() => startVacation(parseInt(customDays, 10))}
            >
              Go
            </button>
          </div>
          <button className="vacation-picker-cancel" onClick={() => { setShowVacationPicker(false); setCustomDays('') }}>
            Cancel
          </button>
        </div>
      )}

      {vacationMode && settings.vacation_started && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginTop: 6 }}>
          Streak frozen since {new Date(settings.vacation_started).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {settings.vacation_end && (
            <> · ends {new Date(settings.vacation_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
          )}
        </div>
      )}

      <button className="reset-btn" onClick={handleReset}>
        {resetState === 'confirming' ? 'Are you sure?' : 'Reset streaks'}
      </button>
    </>
  )

  if (isDesktop) {
    return (
      <div className="sheet-overlay" onClick={onClose}>
        <div className="sheet" onClick={e => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
          <div className="edit-task-title-row">
            <div className="sheet-title">Analytics</div>
          </div>
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Analytics</div>
        <div style={{ width: 50 }} />
      </div>
      {content}
    </div>
  )
}
