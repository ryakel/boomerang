// Kept nav + loop icons — custom arc-vocabulary glyphs that replace the stock
// lucide set, so the navigation reads as an authored system rather than a
// starter kit. Every glyph is built from the same primitives as the data-viz
// and section markers: arcs, a returning dot, the flight trail.
// API mirrors lucide (size, strokeWidth, className) so call sites are drop-in.

function Glyph({ size = 24, strokeWidth = 2, className, children }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true"
    >{children}</svg>
  )
}

// Today — the Day Arc gauge: a sun-arc on a baseline with a rider dot. The
// home tab literally is the daily hero.
export function IconToday(props) {
  return (
    <Glyph {...props}>
      <path d="M3.5 17a8.5 8.5 0 0 1 17 0" />
      <line x1="2" y1="20.5" x2="22" y2="20.5" />
      <circle cx="18.4" cy="10.9" r="1.5" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

// Loops — a return-arc closing into a "caught" dot. A loop that comes back,
// not the generic two-arrow repeat. Doubles as the loop-ring glyph.
export function IconLoops(props) {
  return (
    <Glyph {...props}>
      <path d="M19.4 7.8a8 8 0 1 1-3.1-3.2" />
      <path d="M20.7 2.6 19.4 7.8 14.2 6.5" />
      <circle cx="19.9" cy="3" r="1.6" fill="currentColor" stroke="none" />
    </Glyph>
  )
}

// Tasks — stacked arc-ticks: the same upturned-dome marker as the section
// labels, used here as checklist bullets.
export function IconTasks(props) {
  return (
    <Glyph {...props}>
      <path d="M3 7a2 2 0 0 1 3.6 0" />
      <line x1="9.5" y1="7" x2="21" y2="7" />
      <path d="M3 12.5a2 2 0 0 1 3.6 0" />
      <line x1="9.5" y1="12.5" x2="21" y2="12.5" />
      <path d="M3 18a2 2 0 0 1 3.6 0" />
      <line x1="9.5" y1="18" x2="16" y2="18" />
    </Glyph>
  )
}

// More — three flight-trail dots bridged by streak arcs (the FlightTrail
// primitive in miniature).
export function IconMore(props) {
  return (
    <Glyph {...props}>
      <circle cx="5" cy="14" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="19" cy="14" r="1.6" fill="currentColor" stroke="none" />
      <path d="M5 12q3.5-4 7 0" />
      <path d="M12 12q3.5-4 7 0" opacity=".5" />
    </Glyph>
  )
}
