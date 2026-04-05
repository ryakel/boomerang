import { getSnoozeOptions, getSnoozeOptionsShort } from '../store'

export default function SnoozeModal({ task, onSnooze, onClose }) {
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
        const label = `Due Date (${dueMidnight.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`
        filteredOptions.push({ label, date: dueAt9 })
      }
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">{task.title}</div>
        <div className="sheet-subtitle">When should this come back?</div>

        {filteredOptions.length === 0 ? (
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
      </div>
    </div>
  )
}
