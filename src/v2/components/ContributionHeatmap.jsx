import './ContributionHeatmap.css'

// Generic GitHub-style contribution grid — the Loggd signature visual.
// Theme-agnostic: consumes the --lg-heat-* tokens with fallbacks so it
// renders correctly in all four palettes. The caller supplies a
// `valueByDay` map ({ 'YYYY-MM-DD': number }) keyed by LOCAL date, and the
// component lays out `weeks` columns ending on the current week. Filled
// cells scale opacity-by-intensity in the supplied `color`.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function localKey(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function ContributionHeatmap({
  valueByDay = {},
  weeks = 53,
  color = 'var(--v2-accent)',
  cellSize = 11,
  gap = 3,
  showMonths = false,
  maxValue,
  unitLabel = '',
}) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  // Extend to the Saturday of the current week so the last column is full.
  const end = new Date(today)
  end.setDate(end.getDate() + (6 - end.getDay()))
  const start = new Date(end)
  start.setDate(start.getDate() - (weeks * 7 - 1))

  const cols = []
  const monthMarks = []
  let lastMonth = -1
  const cur = new Date(start)
  for (let w = 0; w < weeks; w++) {
    const col = []
    for (let dow = 0; dow < 7; dow++) {
      const key = localKey(cur)
      const future = cur > today
      const value = future ? 0 : (valueByDay[key] || 0)
      col.push({ key, value, future })
      if (dow === 0) {
        const m = cur.getMonth()
        if (m !== lastMonth) { monthMarks.push({ index: w, label: MONTHS[m] }); lastMonth = m }
      }
      cur.setDate(cur.getDate() + 1)
    }
    cols.push(col)
  }
  const max = maxValue || Math.max(1, ...cols.flat().map(c => c.value))

  return (
    <div
      className="v2-heatmap"
      style={{ '--hm-cell': `${cellSize}px`, '--hm-gap': `${gap}px` }}
    >
      {showMonths && monthMarks.length > 0 && (
        <div className="v2-heatmap-months">
          {monthMarks.map((m, i) => (
            <span
              key={i}
              className="v2-heatmap-month"
              style={{ left: `calc(${m.index} * (var(--hm-cell) + var(--hm-gap)))` }}
            >
              {m.label}
            </span>
          ))}
        </div>
      )}
      <div className="v2-heatmap-grid">
        {cols.map((col, ci) => (
          <div key={ci} className="v2-heatmap-col">
            {col.map(cell => {
              const filled = cell.value > 0 && !cell.future
              const pct = filled ? Math.round((0.20 + Math.min(1, cell.value / max) * 0.80) * 100) : 0
              return (
                <div
                  key={cell.key}
                  className={`v2-heatmap-cell${cell.future ? ' v2-heatmap-cell-future' : ''}`}
                  title={filled ? `${cell.key}: ${cell.value}${unitLabel ? ' ' + unitLabel : ''}` : cell.key}
                  style={filled ? { background: `color-mix(in srgb, ${color} ${pct}%, transparent)` } : undefined}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
