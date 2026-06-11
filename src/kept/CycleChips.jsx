import './shell.css'

// One chip per cadence cycle (design doc §13a) — filled = caught, faded =
// partial progress toward a habit target, hollow = missed, ringed = the
// current in-flight window. Reads at a glance for ANY cadence, unlike the
// day-grid that only made sense for multi-step dailies.
export default function CycleChips({ windows = [], target = 1, caption }) {
  return (
    <div className="bm-cycles">
      <div className="bm-cycle-row" aria-hidden="true">
        {windows.map(w => (
          <span
            key={w.key}
            className={[
              'bm-cycle-chip',
              w.hits >= target ? 'is-caught' : w.hits > 0 ? 'is-partial' : '',
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
