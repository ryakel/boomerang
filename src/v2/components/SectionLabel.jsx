import './SectionLabel.css'

// `sigil` is the bullet glyph rendered before the label. Defaults to
// `✦` so light/dark see a uniform sparkle. Per-section variants
// (`→ doing`, `~ stale`, `+ up next`, `… waiting`, `z snoozed`) drive
// the terminal-mode bullet via `data-sigil` — terminal CSS reads the
// attribute via `attr()` so callers can pass a section-specific glyph
// without it bleeding into the light/dark display (which keeps `✦`).
export default function SectionLabel({ children, count, sigil = '✦' }) {
  return (
    <div className="v2-section-label">
      <span className="v2-section-label-bullet" data-sigil={sigil} aria-hidden="true">✦</span>
      <span className="v2-section-label-text">{children}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="v2-section-label-count">{count}</span>
      )}
    </div>
  )
}
