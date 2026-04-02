import { useState } from 'react'

export default function ExtendModal({ task, onExtend, onClose }) {
  const [customDate, setCustomDate] = useState('')
  const currentDue = task.due_date ? new Date(task.due_date) : new Date()

  const presets = [
    { label: '+1 day', days: 1 },
    { label: '+1 week', days: 7 },
    { label: '+2 weeks', days: 14 },
  ]

  const extend = (days) => {
    const newDate = new Date(currentDue)
    newDate.setDate(newDate.getDate() + days)
    onExtend(task.id, newDate.toISOString().split('T')[0])
    onClose()
  }

  const handleCustom = () => {
    if (!customDate) return
    onExtend(task.id, customDate)
    onClose()
  }

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const minDate = tomorrow.toISOString().split('T')[0]

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">{task.due_date ? 'Extend Due Date' : 'Set Due Date'}</div>
        <div className="sheet-subtitle">
          {task.title}
          {task.due_date && (
            <span style={{ display: 'block', marginTop: 4, fontSize: 13 }}>
              Currently due: {new Date(task.due_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>

        <div className="snooze-options">
          {presets.map(p => (
            <button key={p.label} className="snooze-option" onClick={() => extend(p.days)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="settings-label" style={{ marginTop: 16, marginBottom: 6 }}>Or pick a date</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="add-input date-input"
            type="date"
            value={customDate}
            min={minDate}
            onChange={e => setCustomDate(e.target.value)}
            style={{ flex: 1, marginBottom: 0 }}
          />
          <button
            className="submit-btn"
            disabled={!customDate}
            onClick={handleCustom}
            style={{ width: 'auto', padding: '10px 20px' }}
          >
            Set
          </button>
        </div>
      </div>
    </div>
  )
}
