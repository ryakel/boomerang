import { useState } from 'react'
import { Info, ChevronRight } from 'lucide-react'
import Toggle from './Toggle'
import './settings.css'

// The settings row family (wiki/Settings-Design-Language.md §2).
//
// ONE rule governs all of it: a row at rest shows its VALUE. Not a
// description of what lives inside — the value. The surface this replaces
// spent two lines per row explaining what you'd find if you tapped, and
// nothing at all on what it was set to, so you had to open everything to
// learn anything.
//
// Consequences encoded below:
//   - The LABEL is the largest, brightest thing in the row (500 15px
//     --v2-text). The old surface had it at 600 11px CAPS --v2-text-meta with
//     a 12px description under it — the description outweighed its own label.
//   - Descriptions are optional, subordinate, and folded behind an ⓘ. That
//     honours the standing 2026-07-17 request ("I want to click on each for a
//     description — otherwise they should be minimized") rather than deleting
//     them outright.
//   - The whole row is the touch target wherever the row does one thing.
//   - Chevrons are lucide, trailing, and mean exactly one thing each:
//     ChevronRight navigates. Leading ▸ glyphs are banned.

// ---------------------------------------------------------------------------
// Base row. Every kind below is a thin wrapper over this.
// ---------------------------------------------------------------------------
export function SettingRow({
  label,
  value,          // trailing text (string or node)
  info,           // folded description; omit unless it earns its place (§1.5)
  persistentInfo, // description that must always show — danger/security only
  onPress,        // makes the whole row a button
  trailing,       // custom trailing control (toggle, segment, chevron…)
  disabled,       // dims to 0.45 and blocks interaction (dependent rows)
  as,             // 'label' for toggle rows so the native control drives it
  className = '',
}) {
  const [showInfo, setShowInfo] = useState(false)
  const hasInfo = !!info

  const body = (
    <>
      <span className="v2-set-row-main">
        <span className="v2-set-row-label">
          {label}
          {hasInfo && (
            <button
              type="button"
              className="v2-set-row-info-btn"
              aria-label={showInfo ? 'Hide description' : 'Show description'}
              aria-expanded={showInfo}
              onClick={(e) => {
                // Never let the ⓘ trigger the row's own action — on a toggle
                // row that would flip the setting just for reading about it.
                e.preventDefault()
                e.stopPropagation()
                setShowInfo(s => !s)
              }}
            >
              <Info size={13} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </span>
        {persistentInfo && <span className="v2-set-row-desc v2-set-row-desc-always">{persistentInfo}</span>}
        {hasInfo && showInfo && <span className="v2-set-row-desc">{info}</span>}
      </span>
      {value != null && value !== '' && <span className="v2-set-row-value">{value}</span>}
      {trailing}
    </>
  )

  const cls = `v2-set-row${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`

  if (as === 'label') {
    return <label className={cls}>{body}</label>
  }
  if (onPress && !disabled) {
    return (
      <button type="button" className={`${cls} v2-set-row-pressable`} onClick={onPress}>
        {body}
      </button>
    )
  }
  return <div className={cls}>{body}</div>
}

// ---------------------------------------------------------------------------
// §2.1 Toggle — a boolean that takes effect immediately.
// The switch IS the value, so no text value. Tapping anywhere flips it, which
// is why the row renders as a <label> wrapping the real checkbox.
// ---------------------------------------------------------------------------
export function ToggleRow({ label, checked, onChange, info, disabled }) {
  return (
    <SettingRow
      as="label"
      label={label}
      info={info}
      disabled={disabled}
      trailing={<Toggle checked={checked} onChange={onChange} disabled={disabled} />}
    />
  )
}

// ---------------------------------------------------------------------------
// §2.2 Value — an enum or reference picked from a list.
// ---------------------------------------------------------------------------
export function ValueRow({ label, value, onPress, info, disabled, trailing }) {
  return (
    <SettingRow
      label={label}
      value={value}
      info={info}
      onPress={onPress}
      disabled={disabled}
      trailing={trailing ?? (onPress ? <ChevronRight size={16} strokeWidth={2} className="v2-set-row-chev" /> : null)}
    />
  )
}

// ---------------------------------------------------------------------------
// §2.3 Segment — 2–3 short options where seeing all of them at once matters.
// 4+ options or long labels belong in a ValueRow instead.
// `stacked` puts the control on its own line: the ONLY sanctioned two-line
// row at rest, for when the options can't fit beside the label.
// ---------------------------------------------------------------------------
export function SegmentRow({ label, value, options, onChange, info, stacked, disabled }) {
  const segment = (
    <span className={`v2-settings-segment${options.length >= 4 ? ' v2-settings-segment-4' : ''}`}>
      {options.map(opt => {
        const val = typeof opt === 'string' ? opt : opt.value
        const text = typeof opt === 'string' ? opt : opt.label
        return (
          <button
            key={val}
            type="button"
            className={`v2-settings-segment-btn${val === value ? ' v2-settings-segment-btn-active' : ''}`}
            onClick={() => onChange(val)}
            disabled={disabled}
            aria-pressed={val === value}
          >
            {text}
          </button>
        )
      })}
    </span>
  )
  return (
    <SettingRow
      label={label}
      info={info}
      disabled={disabled}
      className={stacked ? 'v2-set-row-stacked' : ''}
      trailing={segment}
    />
  )
}

// ---------------------------------------------------------------------------
// §2.4 Navigation — drills into a sub-page.
//
// SUMMARY RULE: the summary must be derivable synchronously from state that
// is already loaded. If it would need a fetch, pass nothing — an empty
// trailing area is honest, whereas prose about the destination is the exact
// failure this whole redesign exists to remove.
// ---------------------------------------------------------------------------
export function NavRow({ label, summary, onPress, info, disabled }) {
  return (
    <SettingRow
      label={label}
      value={summary}
      info={info}
      onPress={onPress}
      disabled={disabled}
      trailing={<ChevronRight size={16} strokeWidth={2} className="v2-set-row-chev" />}
    />
  )
}

// ---------------------------------------------------------------------------
// §2.5 Action — a verb. Buttons sit left-aligned in the row body; related
// actions share one row. An action is never disguised as a toggle or a
// navigation row.
// ---------------------------------------------------------------------------
export function ActionRow({ children, info, label }) {
  return (
    <div className="v2-set-row v2-set-row-actions">
      {label && <span className="v2-set-row-label">{label}</span>}
      <span className="v2-set-actions">{children}</span>
      {info && <span className="v2-set-row-desc v2-set-row-desc-always">{info}</span>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// §2.7 Status — a read-only fact. No chevron: there is nothing to open.
// `dot` uses the existing integration-status vocabulary.
// ---------------------------------------------------------------------------
export function StatusRow({ label, value, mono = true, dot, info }) {
  return (
    <SettingRow
      label={label}
      info={info}
      trailing={
        <span className="v2-set-status">
          {dot && <span className={`v2-set-dot v2-set-dot-${dot}`} aria-hidden="true" />}
          <span className={mono ? 'v2-settings-build' : 'v2-set-row-value'}>{value}</span>
        </span>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// §2.8 Credential — never echoes the secret at rest.
//
// Deliberately aligned with the Quokka secret blocklist in
// adviserToolsMisc.js: the settings UI must not display what the adviser is
// forbidden to read. `lastFour` is opt-in and only for values where showing a
// tail is genuinely safe.
// ---------------------------------------------------------------------------
export function SecretRow({ label, set, lastFour, onPress, info }) {
  const value = set ? (lastFour ? `•••• ${lastFour}` : 'Set') : 'Not set'
  return (
    <SettingRow
      label={label}
      value={value}
      info={info}
      onPress={onPress}
      trailing={onPress ? <ChevronRight size={16} strokeWidth={2} className="v2-set-row-chev" /> : null}
    />
  )
}
