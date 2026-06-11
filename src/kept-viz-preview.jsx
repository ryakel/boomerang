// Dev-only harness mounting the Kept K2 viz components with mock data so they
// can be screenshot-verified in isolation. Never shipped (not in index.html).
import { createRoot } from 'react-dom/client'
import './index.css'
import './tokens.css'
import './kept/palette.css'
import FlightTrail from './kept/FlightTrail'
import MonthDots from './kept/MonthDots'
import DensityRibbon from './kept/DensityRibbon'
import DayArc from './kept/DayArc'
import { localYMD, addDays } from './dates'

const root = document.documentElement
root.setAttribute('data-ui', 'v2')
root.setAttribute('data-theme', new URLSearchParams(location.search).get('mode') === 'light' ? 'kept-light' : 'kept-dark')

// Deterministic mock history: ~68% done-rate over the past year.
let seed = 42
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
const byDay = {}
for (let i = 0; i < 366; i++) {
  if (rnd() > 0.32) byDay[localYMD(addDays(new Date(), -i))] = 1 + Math.floor(rnd() * 3)
}

const card = { background: 'var(--bm-card)', border: '1px solid var(--bm-hairline)', borderRadius: 16, padding: 16, marginBottom: 14 }
const label = { font: '700 11px DM Sans', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--bm-text-meta)', marginBottom: 10 }

createRoot(document.getElementById('root')).render(
  <div style={{ width: 390, margin: '0 auto', padding: 16, background: 'var(--bm-bg)', minHeight: '100vh', fontFamily: 'DM Sans' }}>
    <div style={card}><div style={label}>Day Arc</div><DayArc value={21} goal={30} /></div>
    <div style={card}><div style={label}>Flight Trail (10 weeks)</div><FlightTrail valueByDay={byDay} color="var(--bm-f-eucalypt)" /></div>
    <div style={card}><div style={label}>Flight Trail (mini)</div><FlightTrail valueByDay={byDay} color="var(--bm-f-ironbark)" mini /></div>
    <div style={card}><div style={label}>Month Dots</div><MonthDots valueByDay={byDay} color="var(--bm-f-billabong)" /></div>
    <div style={card}><div style={label}>Density Ribbon (year)</div><DensityRibbon valueByDay={byDay} color="var(--bm-f-heath)" /></div>
  </div>,
)
