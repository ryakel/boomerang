import { useState, useEffect, useMemo } from 'react'
import { ENERGY_TYPES, loadLabels } from '../../store'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import BalanceRadar from './BalanceRadar'
import { BarChart3 } from 'lucide-react'
import './AnalyticsModal.css'

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL']
const SIZE_COLORS = { XS: '#6B8AFD', S: '#5DBC9B', M: '#F2A100', L: '#FF6240', XL: '#E8443A' }
const RANGE_OPTIONS = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 365, label: '1y' },
  { value: null, label: 'All' },
]

// Build heatmap grid (52 weeks × 7 days). Identical algorithm to v1, just
// rendered with v2 tokens.
function buildHeatMapGrid(dailyData, metric) {
  const dataMap = {}
  for (const d of (dailyData || [])) dataMap[d.day] = d
  const today = new Date()
  const cells = []
  const start = new Date(today); start.setDate(start.getDate() - 363); start.setDate(start.getDate() - start.getDay())
  const end = new Date(today); end.setDate(end.getDate() + (6 - end.getDay()))
  const d = new Date(start)
  while (d <= end) {
    const key = d.toISOString().split('T')[0]
    const data = dataMap[key]
    const value = data ? (metric === 'points' ? data.points : data.tasks) : 0
    cells.push({ key, value, dow: d.getDay(), isFuture: d > today })
    d.setDate(d.getDate() + 1)
  }
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const months = []
  let lastMonth = -1
  weeks.forEach((week, wi) => {
    const firstDay = week.find(c => !c.isFuture) || week[0]
    const m = new Date(firstDay.key).getMonth()
    if (m !== lastMonth) { months.push({ index: wi, label: MONTH_LABELS[m] }); lastMonth = m }
  })
  const maxVal = Math.max(1, ...cells.map(c => c.value))
  return { weeks, months, maxVal }
}

export default function AnalyticsModal({ open, onClose }) {
  const labels = useMemo(() => loadLabels(), [])
  const labelMap = useMemo(() => Object.fromEntries(labels.map(l => [l.id, l])), [labels])
  const [range, setRange] = useState(30)
  const [metric, setMetric] = useState('tasks')
  const [history, setHistory] = useState(null)
  const [heatMapData, setHeatMapData] = useState(null)
  const [heatMapMetric, setHeatMapMetric] = useState('tasks')
  const [radarMode, setRadarMode] = useState('tags')
  const [throttleDecisions, setThrottleDecisions] = useState([])

  const loadThrottleDecisions = async () => {
    try {
      const api = await import('../../api')
      const data = await api.getThrottleDecisions(30)
      setThrottleDecisions(Array.isArray(data) ? data : [])
    } catch { /* swallow — section just won't render */ }
  }

  useEffect(() => {
    if (!open) return
    loadThrottleDecisions()
  }, [open])

  const handleThrottleFeedback = async (id, feedback) => {
    try {
      const api = await import('../../api')
      await api.markThrottleFeedback(id, feedback)
      loadThrottleDecisions()
    } catch { /* no-op */ }
  }

  // Range-filtered history feeds the daily chart, dow patterns, breakdowns, radar.
  useEffect(() => {
    if (!open) return
    const params = range ? `?days=${range}` : ''
    fetch(`/api/analytics/history${params}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setHistory(data) })
      .catch(() => {})
  }, [open, range])

  // Heatmap always fetches a full year.
  useEffect(() => {
    if (!open) return
    fetch('/api/analytics/history?days=365')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setHeatMapData(data.daily) })
      .catch(() => {})
  }, [open])

  const heatMap = useMemo(() => buildHeatMapGrid(heatMapData, heatMapMetric), [heatMapData, heatMapMetric])

  // Radar spokes derived from history.
  const radarSpokes = useMemo(() => {
    if (!history) return []
    if (radarMode === 'tags') {
      const entries = Object.entries(history.byTag || {})
        .map(([id, data]) => {
          const lbl = labelMap[id]
          return {
            label: lbl?.name || id,
            value: metric === 'points' ? data.points : data.tasks,
            color: lbl?.color,
          }
        })
        .filter(s => s.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
      return entries
    }
    // energy
    return ENERGY_TYPES.map(et => ({
      label: et.label,
      value: metric === 'points'
        ? (history.byEnergy?.[et.id]?.points || 0)
        : (history.byEnergy?.[et.id]?.tasks || 0),
      color: et.color,
    }))
  }, [history, radarMode, metric, labelMap])

  // Day-of-week pattern: scale to the busiest DOW.
  const dowMax = useMemo(() => {
    if (!history?.byDayOfWeek) return 1
    return Math.max(1, ...history.byDayOfWeek.map(d => metric === 'tasks' ? d.tasks : d.points))
  }, [history, metric])

  const dailyMax = useMemo(() => {
    if (!history?.daily) return 1
    return Math.max(1, ...history.daily.map(d => metric === 'tasks' ? d.tasks : d.points))
  }, [history, metric])

  return (
    <ModalShell open={open} onClose={onClose} title="Analytics" terminalTitle="$ stats" width="wide">
      {/* Range + metric controls */}
      <div className="v2-analytics-toolbar">
        <div className="v2-analytics-range">
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.label}
              className={`v2-analytics-range-btn${range === opt.value ? ' v2-analytics-range-btn-active' : ''}`}
              onClick={() => setRange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="v2-analytics-metric">
          <button
            className={`v2-analytics-metric-btn${metric === 'tasks' ? ' v2-analytics-metric-btn-active' : ''}`}
            onClick={() => setMetric('tasks')}
          >
            Tasks
          </button>
          <button
            className={`v2-analytics-metric-btn${metric === 'points' ? ' v2-analytics-metric-btn-active' : ''}`}
            onClick={() => setMetric('points')}
          >
            Points
          </button>
        </div>
      </div>

      {!history ? (
        <EmptyState
          icon={BarChart3}
          title="Loading analytics…"
          body="Pulling completion data from the server."
          terminalCommand="// loading stats — pulling completion data from the server"
        />
      ) : history.totalTasks === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No completed tasks yet"
          body="Finish a task to start seeing patterns."
          terminalCommand="// no completions yet — finish a task to start seeing patterns"
        />
      ) : (
        <>
          {/* Summary line */}
          <div className="v2-analytics-summary">
            <span className="v2-analytics-summary-num">{metric === 'tasks' ? history.totalTasks : history.totalPoints}</span>
            <span className="v2-analytics-summary-label">{metric === 'tasks' ? 'tasks' : 'points'} · last {range || 'all'} {range ? 'days' : 'time'}</span>
          </div>

          {/* Daily chart */}
          {history.daily?.length > 0 && (
            <section className="v2-analytics-section">
              <h3 className="v2-analytics-heading">Daily completions</h3>
              <div className="v2-analytics-daily-chart">
                {history.daily.map(d => {
                  const v = metric === 'tasks' ? d.tasks : d.points
                  const h = (v / dailyMax) * 100
                  return (
                    <div key={d.day} className="v2-analytics-daily-col" title={`${d.day}: ${v} ${metric}`}>
                      <div className="v2-analytics-daily-bar" style={{ height: `${h}%`, minHeight: v > 0 ? 2 : 0 }} />
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Day-of-week pattern */}
          {history.byDayOfWeek && (
            <section className="v2-analytics-section">
              <h3 className="v2-analytics-heading">By day of week</h3>
              <div className="v2-analytics-dow">
                {history.byDayOfWeek.map((d, i) => {
                  const v = metric === 'tasks' ? d.tasks : d.points
                  const w = (v / dowMax) * 100
                  return (
                    <div key={i} className="v2-analytics-dow-row">
                      <span className="v2-analytics-dow-label">{DOW_LABELS[i]}</span>
                      <div className="v2-analytics-dow-track">
                        <div className="v2-analytics-dow-fill" style={{ width: `${w}%` }} />
                      </div>
                      <span className="v2-analytics-dow-value">{v}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Balance radar */}
          <section className="v2-analytics-section">
            <div className="v2-analytics-section-head">
              <h3 className="v2-analytics-heading">Balance</h3>
              <div className="v2-analytics-metric">
                <button
                  className={`v2-analytics-metric-btn${radarMode === 'tags' ? ' v2-analytics-metric-btn-active' : ''}`}
                  onClick={() => setRadarMode('tags')}
                >
                  Tags
                </button>
                <button
                  className={`v2-analytics-metric-btn${radarMode === 'energy' ? ' v2-analytics-metric-btn-active' : ''}`}
                  onClick={() => setRadarMode('energy')}
                >
                  Energy
                </button>
              </div>
            </div>
            <p className="v2-analytics-section-sub">
              {radarMode === 'tags'
                ? 'Distribution across your most-used tags. Empty spokes = areas of life you haven\'t touched.'
                : 'Distribution across energy types. Skewed toward one type? Avoidance pattern worth noticing.'}
            </p>
            <BalanceRadar spokes={radarSpokes} size={300} />
          </section>

          {/* Tag breakdown */}
          {Object.keys(history.byTag || {}).length > 0 && (
            <section className="v2-analytics-section">
              <h3 className="v2-analytics-heading">By tag</h3>
              <ul className="v2-analytics-bd">
                {Object.entries(history.byTag)
                  .map(([id, data]) => ({ id, lbl: labelMap[id], data }))
                  .filter(x => x.lbl)
                  .sort((a, b) => (metric === 'tasks' ? b.data.tasks - a.data.tasks : b.data.points - a.data.points))
                  .map(({ id, lbl, data }) => {
                    const v = metric === 'tasks' ? data.tasks : data.points
                    const max = Math.max(...Object.values(history.byTag).map(d => metric === 'tasks' ? d.tasks : d.points))
                    return (
                      <li key={id} className="v2-analytics-bd-row">
                        <span className="v2-analytics-bd-dot" style={{ background: lbl.color }} />
                        <span className="v2-analytics-bd-label">{lbl.name}</span>
                        <div className="v2-analytics-bd-track">
                          <div className="v2-analytics-bd-fill" style={{ width: `${(v / max) * 100}%`, background: lbl.color }} />
                        </div>
                        <span className="v2-analytics-bd-value">{v}</span>
                      </li>
                    )
                  })}
              </ul>
            </section>
          )}

          {/* Energy breakdown */}
          {Object.keys(history.byEnergy || {}).length > 0 && (
            <section className="v2-analytics-section">
              <h3 className="v2-analytics-heading">By energy type</h3>
              <ul className="v2-analytics-bd">
                {ENERGY_TYPES
                  .filter(e => history.byEnergy[e.id])
                  .sort((a, b) => (metric === 'tasks' ? (history.byEnergy[b.id]?.tasks || 0) - (history.byEnergy[a.id]?.tasks || 0) : (history.byEnergy[b.id]?.points || 0) - (history.byEnergy[a.id]?.points || 0)))
                  .map(e => {
                    const data = history.byEnergy[e.id]
                    const v = metric === 'tasks' ? data.tasks : data.points
                    const max = Math.max(...Object.values(history.byEnergy).map(d => metric === 'tasks' ? d.tasks : d.points))
                    return (
                      <li key={e.id} className="v2-analytics-bd-row">
                        <span className="v2-analytics-bd-dot" style={{ background: e.color }} />
                        <span className="v2-analytics-bd-label">{e.label}</span>
                        <div className="v2-analytics-bd-track">
                          <div className="v2-analytics-bd-fill" style={{ width: `${(v / max) * 100}%`, background: e.color }} />
                        </div>
                        <span className="v2-analytics-bd-value">{v}</span>
                      </li>
                    )
                  })}
              </ul>
            </section>
          )}

          {/* Size breakdown */}
          {Object.keys(history.bySize || {}).length > 0 && (
            <section className="v2-analytics-section">
              <h3 className="v2-analytics-heading">By size</h3>
              <ul className="v2-analytics-bd">
                {SIZE_ORDER.filter(s => history.bySize[s]).map(s => {
                  const data = history.bySize[s]
                  const v = metric === 'tasks' ? data.tasks : data.points
                  const max = Math.max(...Object.values(history.bySize).map(d => metric === 'tasks' ? d.tasks : d.points))
                  return (
                    <li key={s} className="v2-analytics-bd-row">
                      <span className="v2-analytics-bd-dot" style={{ background: SIZE_COLORS[s] }} />
                      <span className="v2-analytics-bd-label">{s}</span>
                      <div className="v2-analytics-bd-track">
                        <div className="v2-analytics-bd-fill" style={{ width: `${(v / max) * 100}%`, background: SIZE_COLORS[s] }} />
                      </div>
                      <span className="v2-analytics-bd-value">{v}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* 52-week heatmap */}
          {heatMap.weeks.length > 0 && (
            <section className="v2-analytics-section">
              <div className="v2-analytics-section-head">
                <h3 className="v2-analytics-heading">52-week pattern</h3>
                <div className="v2-analytics-metric">
                  <button
                    className={`v2-analytics-metric-btn${heatMapMetric === 'tasks' ? ' v2-analytics-metric-btn-active' : ''}`}
                    onClick={() => setHeatMapMetric('tasks')}
                  >
                    Tasks
                  </button>
                  <button
                    className={`v2-analytics-metric-btn${heatMapMetric === 'points' ? ' v2-analytics-metric-btn-active' : ''}`}
                    onClick={() => setHeatMapMetric('points')}
                  >
                    Points
                  </button>
                </div>
              </div>
              <div className="v2-analytics-heatmap-wrap">
                <div className="v2-analytics-heatmap-months">
                  {heatMap.months.map((m, i) => (
                    <span key={i} className="v2-analytics-heatmap-month" style={{ left: `${(m.index / heatMap.weeks.length) * 100}%` }}>
                      {m.label}
                    </span>
                  ))}
                </div>
                <div className="v2-analytics-heatmap">
                  {heatMap.weeks.map((week, wi) => (
                    <div key={wi} className="v2-analytics-heatmap-week">
                      {week.map(cell => {
                        const intensity = cell.value === 0 ? 0 : Math.min(1, cell.value / heatMap.maxVal)
                        return (
                          <div
                            key={cell.key}
                            className={`v2-analytics-heatmap-cell${cell.isFuture ? ' v2-analytics-heatmap-cell-future' : ''}`}
                            title={`${cell.key}: ${cell.value} ${heatMapMetric}`}
                            style={cell.value > 0 && !cell.isFuture
                              ? { background: `rgba(255, 98, 64, ${0.15 + intensity * 0.75})` }
                              : undefined}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {throttleDecisions.filter(d => !d.feedback).length > 0 && (
            <section className="v2-analytics-section">
              <div className="v2-analytics-section-head">
                <h2 className="v2-analytics-section-title">Adaptive throttle decisions</h2>
              </div>
              <p className="v2-analytics-section-sub">
                Boomerang auto-tuned these notification frequencies because the recent ones weren't being tapped. Was that right?
              </p>
              <ul className="v2-analytics-throttle-list">
                {throttleDecisions.filter(d => !d.feedback).slice(0, 10).map(d => {
                  const date = new Date(d.decided_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                  return (
                    <li key={d.id} className="v2-analytics-throttle-item">
                      <span className="v2-analytics-throttle-text">
                        <strong className="v2-analytics-throttle-channel">{d.channel}</strong>{' '}
                        {d.type.replace(/_/g, ' ')} backed off {d.multiplier_old.toFixed(1)}× → {d.multiplier_new.toFixed(1)}×
                        <span className="v2-analytics-throttle-date">{date}</span>
                      </span>
                      <button
                        className="v2-analytics-throttle-up"
                        onClick={() => handleThrottleFeedback(d.id, 'up')}
                        title="Yes, that was right"
                        aria-label="Approve back-off"
                      >👍</button>
                      <button
                        className="v2-analytics-throttle-down"
                        onClick={() => handleThrottleFeedback(d.id, 'down')}
                        title="No, undo this back-off and don't auto-tune for 7 days"
                        aria-label="Revert back-off"
                      >👎</button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </ModalShell>
  )
}
