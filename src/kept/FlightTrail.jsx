import { useMemo } from 'react'
import { localYMD, addDays, weekStartMonday } from '../dates'
import './viz.css'

// Flight Trail — the Kept signature loop-history viz (spec §5.1). Rows of 14
// round day-dots (2 weeks per row); consecutive done-days are bridged by a
// low ARC stroke, so streaks literally read as flights. `mini` renders a
// single trailing-14-day row for list rows.
export default function FlightTrail({ valueByDay = {}, color = 'var(--bm-gold)', weeks = 10, mini = false }) {
  const { rows, COLS, max } = useMemo(() => {
    const COLS = 14
    const nRows = mini ? 1 : Math.ceil(weeks / 2)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    // End on the Sunday closing the current Monday-anchored week so rows align.
    const end = addDays(weekStartMonday(today), 13)
    const start = addDays(end, -(nRows * COLS) + 1)
    let max = 1
    const rows = []
    for (let r = 0; r < nRows; r++) {
      const row = []
      for (let c = 0; c < COLS; c++) {
        const d = addDays(start, r * COLS + c)
        const key = localYMD(d)
        const v = valueByDay[key] || 0
        if (v > max) max = v
        row.push({ key, v, future: d > today })
      }
      rows.push(row)
    }
    return { rows, COLS, max }
  }, [valueByDay, weeks, mini])

  const step = 23, rstep = 30, r = 4
  const W = COLS * step, H = rows.length * rstep + 4
  const els = []
  rows.forEach((row, ri) => {
    const y = ri * rstep + 22
    row.forEach((c, i) => {
      const x = i * step + step / 2
      els.push(
        <circle
          key={c.key}
          cx={x} cy={y} r={r}
          fill={c.v > 0 && !c.future ? color : 'var(--bm-trail-empty)'}
          opacity={c.v > 0 ? 0.55 + 0.45 * (c.v / max) : c.future ? 0.35 : 1}
        >
          <title>{`${c.key}: ${c.v}`}</title>
        </circle>,
      )
    })
    // streak arcs over consecutive runs
    let i = 0
    while (i < row.length) {
      if (row[i].v > 0 && !row[i].future) {
        let j = i
        while (j + 1 < row.length && row[j + 1].v > 0 && !row[j + 1].future) j++
        if (j > i) {
          const x0 = i * step + step / 2, x1 = j * step + step / 2
          const lift = Math.min(13, 5 + (j - i) * 1.7)
          els.push(
            <path
              key={`arc-${ri}-${i}`}
              d={`M ${x0} ${y - 6} Q ${(x0 + x1) / 2} ${y - 6 - lift} ${x1} ${y - 6}`}
              stroke={color} strokeWidth="1.8" fill="none" opacity="0.8"
            />,
          )
        }
        i = j + 1
      } else i++
    }
  })

  return (
    <div className="bm-trail" role="img" aria-label="Completion trail">
      <svg viewBox={`0 0 ${W} ${H}`} style={mini ? { width: COLS * 9, height: H * (9 / step) } : undefined}>
        {els}
      </svg>
    </div>
  )
}
