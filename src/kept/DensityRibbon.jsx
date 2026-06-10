import { useId, useMemo } from 'react'
import { localYMD, addDays, weekStartMonday, monthShort } from '../dates'
import './viz.css'

// Density Ribbon — the Kept year view (spec §5.3): weekly totals as a smooth
// gradient-filled area curve. Replaces the 53-week contribution grid.
export default function DensityRibbon({ valueByDay = {}, color = 'var(--bm-gold)', weeks = 52 }) {
  const gid = useId()
  const { path, area, labels } = useMemo(() => {
    const end = weekStartMonday(new Date())
    const totals = []
    const labels = []
    // ~6 evenly-spaced month labels across the window.
    const labelEvery = Math.max(1, Math.round(weeks / 6))
    for (let w = weeks - 1; w >= 0; w--) {
      const ws = addDays(end, -7 * w)
      let t = 0
      for (let d = 0; d < 7; d++) t += valueByDay[localYMD(addDays(ws, d))] || 0
      totals.push(t)
      if ((weeks - 1 - w) % labelEvery === Math.floor(labelEvery / 2)) labels.push(monthShort(ws.getMonth()))
    }
    const W = 320, H = 64
    const max = Math.max(1, ...totals)
    const x = i => (i / (totals.length - 1)) * W
    const y = v => H - 8 - (v / max) * (H - 18)
    let d = `M 0 ${y(totals[0]).toFixed(1)}`
    for (let i = 1; i < totals.length; i++) {
      const xm = ((x(i - 1) + x(i)) / 2).toFixed(1)
      d += ` C ${xm} ${y(totals[i - 1]).toFixed(1)}, ${xm} ${y(totals[i]).toFixed(1)}, ${x(i).toFixed(1)} ${y(totals[i]).toFixed(1)}`
    }
    return { path: d, area: `${d} L ${W} ${H} L 0 ${H} Z`, labels }
  }, [valueByDay, weeks])

  return (
    <div className="bm-ribbon" role="img" aria-label="Yearly completion density">
      <svg viewBox="0 0 320 64">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.45" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={path} stroke={color} strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
      {labels.length > 1 && (
        <div className="bm-ribbon-months">{labels.map((l, i) => <span key={i}>{l.toUpperCase()}</span>)}</div>
      )}
    </div>
  )
}
