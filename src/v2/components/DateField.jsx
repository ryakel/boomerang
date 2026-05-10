import { useRef } from 'react'
import './DateField.css'

// Date picker field that renders as a bracketed text trigger and opens
// the native calendar picker on tap. Empty: `[ due date ]`. Filled:
// `[ YYYY-MM-DD ] × clear`. Same UX in every theme — terminal-flat
// monospace gets it for free since the trigger is just text + the
// clear button is bracketed text.
//
// We hide the actual <input type="date"> off-screen and call
// `.showPicker()` on tap. Falls back to focus+click if the browser
// doesn't support showPicker (older Safari, etc.). Modern browsers
// (iOS 16.4+, Chrome 99+, Firefox 101+) all support it.
export default function DateField({ value, onChange, min }) {
  const inputRef = useRef(null)

  const open = () => {
    const el = inputRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return } catch { /* fall through */ }
    }
    el.focus()
    el.click()
  }

  return (
    <div className="v2-form-date-field">
      <button
        type="button"
        className={`v2-form-date-trigger${value ? ' v2-form-date-trigger-filled' : ''}`}
        onClick={open}
      >
        {value ? value : 'due date'}
      </button>
      {value && (
        <button
          type="button"
          className="v2-form-date-clear"
          onClick={() => onChange('')}
          title="Clear due date"
          aria-label="Clear due date"
        >
          × clear
        </button>
      )}
      <input
        ref={inputRef}
        type="date"
        className="v2-form-date-hidden-input"
        value={value || ''}
        min={min || undefined}
        onChange={e => onChange(e.target.value)}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}
