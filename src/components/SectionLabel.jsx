import './SectionLabel.css'

// `sigil` is the bullet glyph rendered before the label. Defaults to
// `✦` so light/dark see a uniform sparkle. Per-section variants
// (`→ doing`, `~ stale`, `+ up next`, `… waiting`, `z snoozed`) drive
// the terminal-mode bullet via `data-sigil` — terminal CSS reads the
// attribute via `attr()` so callers can pass a section-specific glyph
// without it bleeding into the light/dark display (which keeps `✦`).
//
// When `onToggle` is passed, the label becomes a button that fires the
// callback. The trailing chevron rotates 180° based on `collapsed`. The
// section's task list is responsible for honoring the collapsed state.
export default function SectionLabel({ children, count, sigil = '✦', onToggle, collapsed = false }) {
  const interactive = typeof onToggle === 'function'
  const Tag = interactive ? 'button' : 'div'
  return (
    <Tag
      type={interactive ? 'button' : undefined}
      className={`v2-section-label${interactive ? ' v2-section-label-toggle' : ''}${collapsed ? ' v2-section-label-collapsed' : ''}`}
      onClick={interactive ? onToggle : undefined}
      aria-expanded={interactive ? !collapsed : undefined}
    >
      <span className="v2-section-label-bullet" data-sigil={sigil} aria-hidden="true">✦</span>
      <span className="v2-section-label-text">{children}</span>
      {typeof count === 'number' && count > 0 && (
        <span className="v2-section-label-count">{count}</span>
      )}
      {interactive && (
        <span className="v2-section-label-chev" aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
      )}
    </Tag>
  )
}
