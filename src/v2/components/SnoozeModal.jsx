import { useState } from 'react'
import { getSnoozeOptions, getSnoozeOptionsShort } from '../../store'
import ModalShell from './ModalShell'
import './SnoozeModal.css'

export default function SnoozeModal({ task, onSnooze, onClose }) {
  const [showCustom, setShowCustom] = useState(false)
  const defaultDate = () => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split('T')[0] }
  const [customDate, setCustomDate] = useState(defaultDate)
  const [customTime, setCustomTime] = useState('09:00')

  const options = task.high_priority ? getSnoozeOptionsShort() : getSnoozeOptions()

  // Filter past-due options if the task has a due date — snoozing past the
  // due date defeats the purpose. Mirrors v1 logic.
  let filteredOptions = options
  if (task.due_date) {
    const [y, m, d] = task.due_date.split('-').map(Number)
    const dueEnd = new Date(y, m - 1, d, 23, 59, 59, 999)
    filteredOptions = options.filter(opt => opt.date <= dueEnd)
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

  const minDate = new Date()
  minDate.setDate(minDate.getDate() + 1)
  const minDateStr = minDate.toISOString().split('T')[0]

  const customLabel = customDate
    ? `${new Date(customDate + 'T' + customTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${new Date('2000-01-01T' + customTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
    : '...'

  return (
    <ModalShell
      open={!!task}
      onClose={onClose}
      title={task.title}
      subtitle="When should this come back?"
    >
      {filteredOptions.length === 0 && !showCustom ? (
        <p className="v2-snooze-empty">This task is due today or overdue — snoozing isn't available.</p>
      ) : (
        <ul className="v2-snooze-list">
          {filteredOptions.map(opt => {
            const [primary, ...rest] = opt.label.split(' · ')
            const meta = rest.join(' · ')
            return (
              <li key={opt.label}>
                <button
                  className="v2-snooze-row"
                  onClick={() => { onSnooze(task.id, opt.date); onClose() }}
                >
                  <span className="v2-snooze-row-label">{primary}</span>
                  {meta && <span className="v2-snooze-row-meta">{meta}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {showCustom ? (
        <div className="v2-snooze-custom">
          <div className="v2-snooze-custom-row">
            <input
              className="v2-snooze-input"
              type="date"
              value={customDate}
              min={minDateStr}
              onChange={e => setCustomDate(e.target.value)}
            />
            <input
              className="v2-snooze-input"
              type="time"
              value={customTime}
              onChange={e => setCustomTime(e.target.value)}
            />
          </div>
          <button
            className="v2-snooze-confirm"
            disabled={!customDate}
            onClick={handleCustomSnooze}
          >
            Snooze until {customLabel}
          </button>
        </div>
      ) : (
        <button className="v2-snooze-custom-toggle" onClick={() => setShowCustom(true)}>
          Pick a date…
        </button>
      )}
    </ModalShell>
  )
}
