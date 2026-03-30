import { useState, useRef, useEffect } from 'react'
import { FullRings } from './Rings'
import { loadSettings, saveSettings, computeDailyStats, computeStreak, computeRecords } from '../store'

export default function Analytics({ tasks, onClose }) {
  const settings = loadSettings()
  const { tasksToday, pointsToday } = computeDailyStats(tasks)
  const streak = computeStreak(tasks, settings)
  const { bestTasks, bestPoints, longestStreak } = computeRecords(tasks)

  const taskGoal = settings.daily_task_goal || 3
  const pointsGoal = settings.daily_points_goal || 15

  const rings = [
    { progress: taskGoal > 0 ? tasksToday / taskGoal : 0, color: '#52C97F' },
    { progress: pointsGoal > 0 ? pointsToday / pointsGoal : 0, color: '#FFB347' },
    { progress: streak > 0 ? Math.min(streak / 7, 1) : 0, color: '#4A9EFF' },
  ]

  const [vacationMode, setVacationMode] = useState(settings.vacation_mode || false)
  const todayStr = new Date().toISOString().split('T')[0]
  const [isFreeDay, setIsFreeDay] = useState(() => (settings.free_days || []).includes(todayStr))
  const [resetState, setResetState] = useState('idle') // 'idle' | 'confirming'
  const resetTimer = useRef(null)

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
  }, [])

  const handleVacationToggle = () => {
    const current = loadSettings()
    const newMode = !vacationMode
    const updates = {
      ...current,
      vacation_mode: newMode,
      vacation_started: newMode ? new Date().toISOString() : null,
    }
    if (!newMode) {
      // Preserve streak when coming back from vacation
      updates.streak_current = streak
    }
    if (newMode) {
      // Freeze current streak
      updates.streak_current = streak
    }
    saveSettings(updates)
    setVacationMode(newMode)
  }

  const handleReset = () => {
    if (resetState === 'idle') {
      setResetState('confirming')
      resetTimer.current = setTimeout(() => setResetState('idle'), 3000)
    } else {
      // Second tap — reset
      if (resetTimer.current) clearTimeout(resetTimer.current)
      setResetState('idle')
      // Clear all completion history (mark all done tasks' completed_at as null won't work — just reset streak settings)
      const current = loadSettings()
      saveSettings({ ...current, streak_current: 0 })
    }
  }

  const centerLabel = `${pointsToday}`

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Analytics</div>
        <div style={{ width: 50 }} />
      </div>

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
          onClick={handleVacationToggle}
        >
          {vacationMode ? 'On vacation' : 'Vacation mode'}
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

      {vacationMode && settings.vacation_started && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginTop: 6 }}>
          Streak frozen since {new Date(settings.vacation_started).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>
      )}

      <button className="reset-btn" onClick={handleReset}>
        {resetState === 'confirming' ? 'Are you sure?' : 'Reset streaks'}
      </button>
    </div>
  )
}
