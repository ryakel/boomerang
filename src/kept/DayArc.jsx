import './viz.css'

// Day Arc — the Kept daily hero gauge (spec §5.4): a semicircular gold sweep
// from 0 to the day's points goal, hairline ticks at tenths, a tip dot, the
// count in the display face beneath the apex.
export default function DayArc({ value = 0, goal = 1, caption = 'points today' }) {
  const W = 250, H = 118, cx = W / 2, cy = H - 4, r = 88
  const pct = Math.max(0, Math.min(1, goal > 0 ? value / goal : 0))
  const pt = a => [cx + r * Math.cos(Math.PI * (1 - a)), cy - r * Math.sin(Math.PI * (1 - a))]
  const arc = (a0, a1) => {
    const [x0, y0] = pt(a0); const [x1, y1] = pt(a1)
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }
  const ticks = []
  for (let i = 1; i < 10; i++) {
    const a = i / 10
    const [x, y] = pt(a)
    const x2 = cx + (r - 7) * Math.cos(Math.PI * (1 - a))
    const y2 = cy - (r - 7) * Math.sin(Math.PI * (1 - a))
    ticks.push(<line key={i} x1={x} y1={y} x2={x2} y2={y2} stroke="var(--bm-hairline-strong)" strokeWidth="1.5" />)
  }
  const tip = pt(pct)

  return (
    <div className="bm-dayarc" role="img" aria-label={`${value} of ${goal} ${caption}`}>
      <svg viewBox={`0 0 ${W} ${H}`}>
        <path d={arc(0, 1)} stroke="var(--bm-trail-empty)" strokeWidth="10" strokeLinecap="round" fill="none" />
        {ticks}
        {pct > 0 && <path d={arc(0, pct)} stroke="var(--bm-gold)" strokeWidth="10" strokeLinecap="round" fill="none" />}
        <circle cx={tip[0]} cy={tip[1]} r="7" fill="var(--bm-gold)" />
        <circle cx={tip[0]} cy={tip[1]} r="2.8" fill="var(--bm-on-gold)" />
      </svg>
      <div className="bm-dayarc-center">
        <div className="bm-dayarc-num">{value}<span className="bm-dayarc-goal"> / {goal}</span></div>
        <div className="bm-dayarc-cap">{caption}</div>
      </div>
    </div>
  )
}
