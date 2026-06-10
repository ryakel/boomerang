import { useMemo } from 'react'
import { localYMD } from '../dates'
import './viz.css'

// Month Dots — Kept calendar view (spec §5.2): numbered circle cells, done
// days filled with the loop's feather, adjacent done-days bridged by arcs.
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function MonthDots({ monthRef = new Date(), valueByDay = {}, color = 'var(--bm-gold)' }) {
  const cells = useMemo(() => {
    const first = new Date(monthRef.getFullYear(), monthRef.getMonth(), 1)
    const startPad = (first.getDay() + 6) % 7
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const out = []
    for (let i = 0; i < startPad; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const key = localYMD(new Date(first.getFullYear(), first.getMonth(), d))
      out.push({ d, key, done: (valueByDay[key] || 0) > 0 })
    }
    return out
  }, [monthRef, valueByDay])

  const step = 32, rstep = 30, r = 7.5
  const rows = Math.ceil(cells.length / 7)
  const W = 7 * step, H = rows * rstep + 16
  const els = DOW.map((d, i) => (
    <text key={`h${i}`} x={i * step + step / 2} y={9} textAnchor="middle"
      fontSize="8.5" fontWeight="700" fill="var(--bm-text-faint)" fontFamily="inherit">{d}</text>
  ))
  cells.forEach((c, idx) => {
    if (!c) return
    const i = idx % 7, ri = Math.floor(idx / 7)
    const x = i * step + step / 2, y = ri * rstep + 26
    els.push(
      <circle key={c.key} cx={x} cy={y} r={r}
        fill={c.done ? color : 'transparent'}
        stroke={c.done ? color : 'var(--bm-hairline-strong)'} strokeWidth="1.4" />,
      <text key={`t${c.key}`} x={x} y={y + 3} textAnchor="middle" fontSize="8.5"
        fontWeight="650" fill={c.done ? 'var(--bm-on-gold)' : 'var(--bm-text-meta)'} fontFamily="inherit">{c.d}</text>,
    )
    const next = cells[idx + 1]
    if (c.done && next && next.done && i < 6) {
      const x1 = (i + 1) * step + step / 2
      els.push(
        <path key={`a${c.key}`} d={`M ${x + 4} ${y - 8} Q ${(x + x1) / 2} ${y - 16} ${x1 - 4} ${y - 8}`}
          stroke={color} strokeWidth="1.6" fill="none" opacity="0.75" />,
      )
    }
  })

  return (
    <div className="bm-month" role="img" aria-label="Month completion calendar">
      <svg viewBox={`0 0 ${W} ${H}`}>{els}</svg>
    </div>
  )
}
