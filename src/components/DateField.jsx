import { useEffect, useState } from 'react'
import { Calendar } from 'lucide-react'
import { parseNaturalDate } from '../utils/parseNaturalDate'
import './DateField.css'

// Date field with natural-language typing. The text box accepts "tomorrow",
// "next tue", "in 3 days", "6/9", or a raw YYYY-MM-DD — parsed locally via
// parseNaturalDate (no AI). A calendar button opens the native <input type=date>
// (overlaid at opacity:0 so the tap reliably opens the picker, even on iOS PWA
// Safari where showPicker() is flaky). Theme-agnostic; used by every due-date
// field, so it works in all skins.
export default function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = 'e.g. tomorrow, next tue, 6/9',
  ariaLabelEmpty,
  ariaLabelFilled,
  clearLabel = 'Clear due date',
  showClear = true,
}) {
  const [text, setText] = useState(value || '')
  // Re-sync the text box when the value changes from outside (picker, reset).
  useEffect(() => { setText(value || '') }, [value])

  const preview = (() => {
    const t = text.trim()
    if (!t || t === value) return null
    const parsed = parseNaturalDate(t)
    return parsed && parsed !== t ? parsed : null
  })()

  const commit = () => {
    const t = text.trim()
    if (!t) { onChange(''); return }
    const parsed = parseNaturalDate(t)
    if (parsed) onChange(parsed)
    else setText(value || '') // unparseable → revert
  }

  const emptyLabel = ariaLabelEmpty || 'Due date — type or pick'
  const filledLabel = ariaLabelFilled ? ariaLabelFilled(value) : `Due ${value} — type or pick to change`

  return (
    <div className={`v2-form-date-field${value ? ' v2-form-date-field-filled' : ''}`}>
      <div className="v2-form-date-stack">
        <input
          type="text"
          className="v2-form-date-text"
          value={text}
          placeholder={placeholder}
          onChange={e => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
          aria-label={value ? filledLabel : emptyLabel}
          autoComplete="off"
        />
        <button
          type="button"
          className="v2-form-date-cal"
          aria-label="Open calendar"
          title="Pick from calendar"
        >
          <Calendar size={16} strokeWidth={1.9} />
          <input
            type="date"
            className="v2-form-date-input"
            value={value || ''}
            min={min || undefined}
            max={max || undefined}
            onChange={e => onChange(e.target.value)}
            aria-label={value ? filledLabel : emptyLabel}
          />
        </button>
      </div>
      {preview && <span className="v2-form-date-preview">→ {preview}</span>}
      {value && showClear && (
        <button
          type="button"
          className="v2-form-date-clear"
          onClick={() => onChange('')}
          title={clearLabel}
          aria-label={clearLabel}
        >
          × clear
        </button>
      )}
    </div>
  )
}
