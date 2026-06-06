import { useMemo } from 'react'
import { localYMD } from './heatmapUtils'
import './ContributionHeatmap.css'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// GitHub-style contribution grid. Columns = weeks (Monday-anchored), rows =
// days (Mon..Sun, top to bottom). Theme-agnostic: empty cells use
// --wb-heat-empty, filled cells use the per-habit `color` at an intensity
// scaled to the busiest day in the window. The signature Wallaby visual.
export default function ContributionHeatmap({
  valueByDay = {},
  color = '#4F8DF5',
  weeks = 24,
  cellSize = 12,
  gap = 3,
  showMonths = false,
  radius = 2,
}) {
  const { cols, months } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // End on the Sunday closing the current (Monday-anchored) week.
    const dow = (today.getDay() + 6) % 7
    const end = new Date(today)
    end.setDate(end.getDate() + (6 - dow))
    const start = new Date(end)
    start.setDate(start.getDate() - weeks * 7 + 1)

    let max = 1
    const cols = []
    const months = []
    let lastMonth = -1
    for (let w = 0; w < weeks; w++) {
      const col = []
      for (let d = 0; d < 7; d++) {
        const cur = new Date(start)
        cur.setDate(start.getDate() + w * 7 + d)
        const key = localYMD(cur)
        const value = valueByDay[key] || 0
        if (value > max) max = value
        col.push({ key, value, future: cur > today, date: cur })
      }
      // Month label when the first day of a column crosses into a new month.
      const firstReal = col.find(c => !c.future) || col[0]
      const m = firstReal.date.getMonth()
      if (m !== lastMonth) { months.push({ index: w, label: MONTHS[m] }); lastMonth = m }
      cols.push(col)
    }
    // attach intensity now that max is known
    for (const col of cols) for (const c of col) {
      c.intensity = c.value === 0 ? 0 : Math.min(1, 0.32 + 0.68 * (c.value / max))
    }
    return { cols, months }
  }, [valueByDay, weeks])

  return (
    <div
      className="wb-heat"
      style={{ '--wb-cell': `${cellSize}px`, '--wb-gap': `${gap}px`, '--wb-radius': `${radius}px` }}
    >
      {showMonths && (
        <div className="wb-heat-months">
          {months.map((m, i) => (
            <span
              key={i}
              className="wb-heat-month"
              style={{ left: `calc(${m.index} * (var(--wb-cell) + var(--wb-gap)))` }}
            >{m.label}</span>
          ))}
        </div>
      )}
      <div className="wb-heat-grid" role="img" aria-label="Activity heatmap">
        {cols.map((col, ci) => (
          <div key={ci} className="wb-heat-col">
            {col.map(c => (
              <div
                key={c.key}
                className={`wb-heat-cell${c.future ? ' wb-heat-cell-future' : ''}`}
                title={`${c.key}: ${c.value}`}
                style={c.value > 0 && !c.future
                  ? { background: color, opacity: c.intensity }
                  : undefined}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
