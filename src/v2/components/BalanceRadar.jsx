/**
 * Reusable radar/spider chart for v2 Analytics.
 *
 * Pure SVG, no chart library. Data comes in as a `spokes` array — each entry
 * is { label, value, color? }. Values are normalized to the largest one in
 * the set (= outer ring); 0 sits at the center. Background grid renders 4
 * concentric guide rings + spokes from center to each point on the outer ring.
 *
 * Optional `comparison` prop is a same-length array of values that draws a
 * dashed polygon (no fill) for previous-period comparison. Tap a spoke label
 * to drill into that segment via `onSpokeClick(spokeIndex)`.
 */

import './BalanceRadar.css'

export default function BalanceRadar({ spokes, comparison, size = 280, onSpokeClick }) {
  const cx = size / 2
  const cy = size / 2
  const padding = 56  // room for labels around the radar
  const r = (size - padding * 2) / 2
  const N = spokes.length
  if (N === 0) {
    return (
      <div className="v2-radar-empty">No data in this period yet.</div>
    )
  }

  const maxVal = Math.max(1, ...spokes.map(s => s.value), ...(comparison || []))

  // Each spoke at angle θ_i = -π/2 + 2π*i/N (start at top, go clockwise)
  const angle = (i) => -Math.PI / 2 + (2 * Math.PI * i) / N
  const point = (i, valOrR) => {
    const v = typeof valOrR === 'number' ? valOrR : valOrR.value
    const radius = (v / maxVal) * r
    const a = angle(i)
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)]
  }
  const labelPoint = (i) => {
    const a = angle(i)
    const radius = r + 18
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)]
  }

  // Background concentric rings (25%, 50%, 75%, 100%).
  const guideRings = [0.25, 0.5, 0.75, 1].map(scale => {
    const points = spokes.map((_, i) => {
      const a = angle(i)
      return `${cx + r * scale * Math.cos(a)},${cy + r * scale * Math.sin(a)}`
    }).join(' ')
    return points
  })

  const spokeLines = spokes.map((_, i) => {
    const [x, y] = point(i, { value: maxVal })
    return { x1: cx, y1: cy, x2: x, y2: y }
  })

  const polygonPoints = spokes.map((s, i) => point(i, s).join(',')).join(' ')
  const comparisonPoints = comparison
    ? comparison.map((v, i) => point(i, v).join(',')).join(' ')
    : null

  return (
    <svg
      className="v2-radar"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Balance radar"
    >
      {/* Guide rings */}
      {guideRings.map((pts, i) => (
        <polygon
          key={i}
          points={pts}
          className="v2-radar-guide"
          style={{ opacity: 0.10 + i * 0.04 }}
        />
      ))}

      {/* Spokes */}
      {spokeLines.map((line, i) => (
        <line
          key={i}
          {...line}
          className="v2-radar-spoke"
        />
      ))}

      {/* Comparison polygon (previous period) */}
      {comparisonPoints && (
        <polygon
          points={comparisonPoints}
          className="v2-radar-comparison"
        />
      )}

      {/* Current polygon */}
      <polygon
        points={polygonPoints}
        className="v2-radar-current"
      />

      {/* Vertex dots */}
      {spokes.map((s, i) => {
        const [x, y] = point(i, s)
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={4}
            className="v2-radar-dot"
            style={{ fill: s.color || 'var(--v2-accent)' }}
          />
        )
      })}

      {/* Labels (with tappable invisible hitbox if onSpokeClick provided) */}
      {spokes.map((s, i) => {
        const [lx, ly] = labelPoint(i)
        const a = angle(i)
        // Anchor based on horizontal position around the circle.
        let anchor = 'middle'
        if (Math.cos(a) > 0.3) anchor = 'start'
        else if (Math.cos(a) < -0.3) anchor = 'end'
        return (
          <g
            key={i}
            className={onSpokeClick ? 'v2-radar-label-group v2-radar-label-clickable' : 'v2-radar-label-group'}
            onClick={onSpokeClick ? () => onSpokeClick(i) : undefined}
          >
            <text
              x={lx}
              y={ly}
              className="v2-radar-label"
              textAnchor={anchor}
              dominantBaseline="middle"
              style={s.color ? { fill: s.color } : undefined}
            >
              {s.label}
            </text>
            <text
              x={lx}
              y={ly + 13}
              className="v2-radar-label-value"
              textAnchor={anchor}
              dominantBaseline="middle"
            >
              {s.value}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
