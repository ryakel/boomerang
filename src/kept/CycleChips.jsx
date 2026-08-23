import { useMemo } from 'react'
import { bridgedAwayKeys } from './cycles'
import './shell.css'

// One chip per cadence cycle (design doc §13a) — filled = caught, faded =
// partial progress toward a habit target, hollow = missed, ringed = the
// current in-flight window. Reads at a glance for ANY cadence, unlike the
// day-grid that only made sense for multi-step dailies.
//
// A cycle you were AWAY for draws as a connector running through the break
// instead of a hollow "missed" square, so the trail extends over a trip to the
// next completion rather than reading as a run of failures. Only where the loop
// actually came back — see bridgedAwayKeys.
export default function CycleChips({ windows = [], target = 1, caption, awayDays = null }) {
  const bridged = useMemo(() => bridgedAwayKeys(windows, awayDays), [windows, awayDays])
  return (
    <div className="bm-cycles">
      <div className="bm-cycle-row" aria-hidden="true">
        {windows.map(w => (
          <span
            key={w.key}
            className={[
              'bm-cycle-chip',
              w.hits >= target ? 'is-caught' : w.hits > 0 ? 'is-partial' : '',
              w.hits < target && bridged.has(w.key) ? 'is-away' : '',
              w.current ? 'is-current' : '',
            ].filter(Boolean).join(' ')}
            title={w.key}
          />
        ))}
      </div>
      {caption && <div className="bm-cycle-cap">{caption}</div>}
    </div>
  )
}
