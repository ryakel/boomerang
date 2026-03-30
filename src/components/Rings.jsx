function Ring({ cx, cy, radius, strokeWidth, progress, color }) {
  const circumference = 2 * Math.PI * radius
  const clampedProgress = Math.min(Math.max(progress, 0), 1)
  const offset = circumference * (1 - clampedProgress)

  return (
    <>
      <circle
        className="ring-track"
        cx={cx}
        cy={cy}
        r={radius}
        strokeWidth={strokeWidth}
        stroke={color}
      />
      <circle
        className="ring-fill"
        cx={cx}
        cy={cy}
        r={radius}
        strokeWidth={strokeWidth}
        stroke={color}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    </>
  )
}

function RingsSVG({ size, rings, label }) {
  const center = size / 2
  const gap = size * 0.08
  const strokeWidth = size * 0.09
  const outerRadius = center - strokeWidth / 2 - 2

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {rings.map((ring, i) => {
        const radius = outerRadius - i * (strokeWidth + gap)
        return (
          <Ring
            key={i}
            cx={center}
            cy={center}
            radius={radius}
            strokeWidth={strokeWidth}
            progress={ring.progress}
            color={ring.color}
          />
        )
      })}
      {label && (
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="central"
          fill="var(--text)"
          fontFamily="var(--font-display)"
          fontWeight="700"
          fontSize={size * 0.14}
        >
          {label}
        </text>
      )}
    </svg>
  )
}

export function MiniRings({ rings, onClick }) {
  return (
    <div className="mini-rings" onClick={onClick}>
      <RingsSVG size={24} rings={rings} />
    </div>
  )
}

export function FullRings({ rings, label }) {
  return (
    <div className="analytics-rings">
      <RingsSVG size={180} rings={rings} label={label} />
    </div>
  )
}
