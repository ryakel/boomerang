import { useMemo } from 'react'
import { localYMD } from '../dates'
import './viz.css'

// Month Dots — Kept calendar view (spec §5.2): numbered circle cells, done
// days filled with the loop's feather, adjacent done-days bridged by arcs.
//
// Optionally EDITABLE (`onToggleDay`): on the loop detail each cell is a
// button, so stepping back a month and tapping a day is how a completion the
// app never recorded gets logged after the fact. Read-only everywhere else —
// the Loops list cards pass no handler and keep role="img".
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

export default function MonthDots({
  monthRef = new Date(),
  valueByDay = {},
  color = 'var(--bm-ember)',
  onToggleDay = null,
  // Bounds for the editable form. Future days are never loggable; `minDay`
  // keeps taps off days before the loop existed (a stamp there would mint a
  // window predating the routine — the same false-history the window anchor
  // math refuses to create).
  maxDay = null,
  minDay = null,
}) {
  const editable = typeof onToggleDay === 'function'
  const cells = useMemo(() => {
    const first = new Date(monthRef.getFullYear(), monthRef.getMonth(), 1)
    const startPad = (first.getDay() + 6) % 7
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    const out = []
    for (let i = 0; i < startPad; i++) out.push(null)
    for (let d = 1; d <= daysInMonth; d++) {
      const key = localYMD(new Date(first.getFullYear(), first.getMonth(), d))
      const outOfRange = (maxDay && key > maxDay) || (minDay && key < minDay)
      out.push({ d, key, done: (valueByDay[key] || 0) > 0, locked: !!outOfRange })
    }
    return out
  }, [monthRef, valueByDay, maxDay, minDay])

  const step = 32, rstep = 30, r = 7.5
  const rows = Math.ceil(cells.length / 7)
  const W = 7 * step, H = rows * rstep + 16
  const els = DOW.map((d, i) => (
    <text key={`h${i}`} x={i * step + step / 2} y={9} textAnchor="middle"
      fontSize="8.5" fontWeight="700" fill="var(--bm-text-faint)" fontFamily="inherit">{d}</text>
  ))
  const hits = []
  cells.forEach((c, idx) => {
    if (!c) return
    const i = idx % 7, ri = Math.floor(idx / 7)
    const x = i * step + step / 2, y = ri * rstep + 26
    els.push(
      <circle key={c.key} cx={x} cy={y} r={r}
        fill={c.done ? color : 'transparent'}
        stroke={c.done ? color : 'var(--bm-hairline-strong)'} strokeWidth="1.4"
        opacity={editable && c.locked ? 0.4 : 1} />,
      <text key={`t${c.key}`} x={x} y={y + 3} textAnchor="middle" fontSize="8.5"
        fontWeight="650" fill={c.done ? 'var(--bm-on-ember)' : 'var(--bm-text-meta)'} fontFamily="inherit"
        opacity={editable && c.locked ? 0.4 : 1}>{c.d}</text>,
    )
    const next = cells[idx + 1]
    if (c.done && next && next.done && i < 6) {
      const x1 = (i + 1) * step + step / 2
      els.push(
        <path key={`a${c.key}`} d={`M ${x + 4} ${y - 8} Q ${(x + x1) / 2} ${y - 16} ${x1 - 4} ${y - 8}`}
          stroke={color} strokeWidth="1.6" fill="none" opacity="0.75" />,
      )
    }
    // Hit targets last so they sit above the art. A finger-sized transparent
    // rect, not the 7.5px circle — this is a phone surface first.
    if (editable && !c.locked) {
      hits.push(
        <rect key={`h${c.key}`} className="bm-month-hit"
          x={x - step / 2 + 1} y={y - rstep / 2 + 1} width={step - 2} height={rstep - 2}
          rx="8" fill="transparent" role="button" tabIndex={0}
          aria-label={`${c.key} — ${c.done ? 'logged, tap to remove' : 'tap to log as done'}`}
          onClick={() => onToggleDay(c.key, c.done)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            onToggleDay(c.key, c.done)
          }} />,
      )
    }
  })

  return (
    <div className={`bm-month${editable ? ' is-editable' : ''}`}
      {...(editable ? { 'aria-label': 'Month completion calendar — tap a day to log or remove it' } : { role: 'img', 'aria-label': 'Month completion calendar' })}>
      <svg viewBox={`0 0 ${W} ${H}`}>{els}{hits}</svg>
    </div>
  )
}
