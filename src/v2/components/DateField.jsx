import './DateField.css'

// Date picker field. The visible trigger reads as bracketed text in
// terminal and a regular field in light/dark. The actual <input type="date">
// is overlaid on top of the trigger at opacity:0 with full pointer events
// — so tapping anywhere on the trigger opens the native picker directly,
// no JS showPicker() dance required. That dance silently failed on iOS
// PWA Safari in some versions; overlaying the input bypasses the bug.
export default function DateField({
  value,
  onChange,
  min,
  max,
  placeholder = 'due date',
  ariaLabelEmpty,
  ariaLabelFilled,
  clearLabel = 'Clear due date',
  showClear = true,
}) {
  const emptyLabel = ariaLabelEmpty || 'Pick due date'
  const filledLabel = ariaLabelFilled
    ? ariaLabelFilled(value)
    : `Due ${value} — tap to change`
  return (
    <div className={`v2-form-date-field${value ? ' v2-form-date-field-filled' : ''}`}>
      <div className="v2-form-date-stack">
        <span className="v2-form-date-display" aria-hidden="true">
          {value ? value : placeholder}
        </span>
        <input
          type="date"
          className="v2-form-date-input"
          value={value || ''}
          min={min || undefined}
          max={max || undefined}
          onChange={e => onChange(e.target.value)}
          aria-label={value ? filledLabel : emptyLabel}
        />
      </div>
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
