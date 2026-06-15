import { useEffect, useRef } from 'react'
import './viz.css'

// Day Arc — the Kept daily hero. NOT a semicircle gauge (that reads as a stock
// fitness widget); the day's progress is drawn as a real boomerang flight: a
// flat out-and-back trajectory launched from the hand, out over the top, curling
// the right tip, returning along the bottom. Ember = points flown toward the
// goal, faint = the remaining return; the boomerang rides the leading edge and
// spins itself to rest on entry. The count is left-weighted, breaking the
// centered-everything rhythm. Respects prefers-reduced-motion (static end-state).
const PATH = 'M 116 78 C 168 30 262 30 312 62 C 264 100 168 104 116 86'
const HAND = [116, 82]

export default function DayArc({ value = 0, goal = 1, caption = 'points today' }) {
  const pct = Math.max(0, Math.min(1, goal > 0 ? value / goal : 0))
  const fpRef = useRef(null)
  const doneRef = useRef(null)
  const boomRef = useRef(null)
  const spinRef = useRef(null)

  useEffect(() => {
    const fp = fpRef.current, done = doneRef.current, boom = boomRef.current, spin = spinRef.current
    if (!fp || !done || !boom) return
    const L = fp.getTotalLength()
    done.style.strokeDasharray = `${L} ${L}`
    const place = (flown, deg) => {
      done.style.strokeDashoffset = String(L - L * flown)
      const p = fp.getPointAtLength(Math.max(0.001, flown) * L)
      boom.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`)
      if (spin) spin.setAttribute('transform', `rotate(${deg.toFixed(1)})`)
    }
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || pct === 0) { place(pct, -16); return }
    // fly from the hand to the current progress, spin decaying into rest
    const DUR = 1300, t0 = performance.now()
    const ease = t => 1 - Math.pow(1 - t, 3)
    let raf = 0
    const tick = now => {
      const e = Math.min(1, (now - t0) / DUR)
      place(pct * ease(e), -16 + (1 - e) * 540)
      if (e < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pct])

  return (
    <div className="bm-dayarc" role="img" aria-label={`${value} of ${goal} ${caption}`}>
      <svg viewBox="0 0 340 150" className="bm-dayarc-svg">
        <circle cx={HAND[0]} cy={HAND[1]} r="3.4" fill="var(--bm-text-faint)" />
        <path ref={fpRef} d={PATH} stroke="var(--bm-trail-empty)" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path ref={doneRef} d={PATH} stroke="var(--bm-ember)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <g ref={boomRef}>
          <circle r="13" fill="var(--bm-ember-soft)" />
          <g ref={spinRef}>
            <path d="M -10 -3 L 0 7 L 10 -3" fill="none" stroke="var(--bm-ember)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        </g>
      </svg>
      <div className="bm-dayarc-num">{value}<span className="bm-dayarc-goal"> / {goal}</span></div>
      <div className="bm-dayarc-cap">{caption}</div>
    </div>
  )
}
