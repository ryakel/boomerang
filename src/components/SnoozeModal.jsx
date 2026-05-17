import { useState } from 'react'
import './SnoozeModal.css'
import { getSnoozeOptions, getSnoozeOptionsShort } from '../store'

export default function SnoozeModal({ task, onSnooze, onClose }) {
  const [showCustom, setShowCustom] = useState(false)
  const defaultDate = () => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0] }
  const [customDate, setCustomDate] = useState(defaultDate)
  const [customTime, setCustomTime] = useState('09:00')

  const options = task.high_priority ? getSnoozeOptionsShort() : getSnoozeOptions()

  let filteredOptions = options
  if (task.due_date) {
    const [y, m, d] = task.due_date.split('-').map(Number)
    const dueEnd = new Date(y, m - 1, d, 23, 59, 59, 999)
    filteredOptions = options.filter(opt => opt.date <= dueEnd)

    // Add "Due Date" fallback if we removed options and due date is in the future
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const dueMidnight = new Date(y, m - 1, d)
    if (filteredOptions.length < options.length && dueMidnight > today) {
      const dueAt9 = new Date(y, m - 1, d, 9, 0, 0, 0)
      const alreadyHas = filteredOptions.some(o => o.date.toDateString() === dueAt9.toDateString())
      if (!alreadyHas) {
        const label = `Due Date · ${dueMidnight.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} 9 AM`
        filteredOptions.push({ label, date: dueAt9 })
      }
    }
  }

  const handleCustomSnooze = () => {
    if (!customDate) return
    const [y, m, d] = customDate.split('-').map(Number)
    const [hh, mm] = customTime.split(':').map(Number)
    const date = new Date(y, m - 1, d, hh, mm, 0, 0)
    if (date <= new Date()) return
    onSnooze(task.id, date)
    onClose()
  }

  // Min date for custom picker = tomorrow
  const minDate = new Date()
  minDate.setDate(minDate.getDate() + 1)
  const minDateStr = minDate.toISOString().split('T')[0]

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">{task.title}</div>
        <div className="sheet-subtitle">When should this come back?</div>

        {filteredOptions.length === 0 && !showCustom ? (
          <p className="snooze-empty-msg">This task is due today or overdue — snoozing is not available.</p>
        ) : (
          <div className="snooze-options">
            {filteredOptions.map(opt => (
              <button
                key={opt.label}
                className="snooze-option"
                onClick={() => {
                  onSnooze(task.id, opt.date)
                  onClose()
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {showCustom ? (
          <div className="snooze-custom">
            <div className="snooze-custom-row">
              <input
                className="routine-select"
                type="date"
                value={customDate}
                min={minDateStr}
                onChange={e => setCustomDate(e.target.value)}
                style={{ marginBottom: 0 }}
              />
              <input
                className="routine-select"
                type="time"
                value={customTime}
                onChange={e => setCustomTime(e.target.value)}
                style={{ marginBottom: 0 }}
              />
            </div>
            <button
              className="snooze-option snooze-custom-confirm"
              disabled={!customDate}
              onClick={handleCustomSnooze}
            >
              Snooze until {customDate
                ? new Date(customDate + 'T' + customTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + new Date('2000-01-01T' + customTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                : '...'}
            </button>
          </div>
        ) : (
          <button
            className="snooze-option snooze-custom-toggle"
            onClick={() => setShowCustom(true)}
          >
            Pick a date...
          </button>
        )}

        <button
          className="snooze-option snooze-indefinite"
          onClick={() => {
            const farFuture = new Date(2099, 11, 31)
            onSnooze(task.id, farFuture, { indefinite: true })
            onClose()
          }}
        >
          Later — set aside (no resurface)
        </button>
      </div>
    </div>
  )
}
