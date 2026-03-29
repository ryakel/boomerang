import { getSnoozeOptions } from '../store'

export default function SnoozeModal({ task, onSnooze, onClose }) {
  const options = getSnoozeOptions()

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">{task.title}</div>
        <div className="sheet-subtitle">When should this come back?</div>

        <div className="snooze-options">
          {options.map(opt => (
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
      </div>
    </div>
  )
}
