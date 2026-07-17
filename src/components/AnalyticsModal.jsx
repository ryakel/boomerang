import { useState, useEffect, useMemo, useRef } from 'react'
import { Flame, Trophy, Star, Zap, Target, CalendarCheck } from 'lucide-react'
import BadgesGrid from './BadgesGrid'
import { computeBadges } from '../badges'
import '../kept/flightlog.css'
import { ENERGY_TYPES, loadLabels } from '../store'
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

// Build heatmap grid (52 weeks × 7 days). Uses UTC throughout so keys match
// the server's UTC-bucketed completed_at.split('T')[0] day strings.
function buildHeatMapGrid(dailyData, metric) {
  const dataMap = {}
  for (const d of (dailyData || [])) dataMap[d.day] = d
  const now = new Date()
  const cells = []
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 363))
  start.setUTCDate(start.getUTCDate() - start.getUTCDay())
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  end.setUTCDate(end.getUTCDate() + (6 - end.getUTCDay()))
  const d = new Date(start)
  while (d <= end) {
    const key = d.toISOString().split('T')[0]
    const data = dataMap[key]
    const value = data ? (metric === 'points' ? data.points : data.tasks) : 0
    cells.push({ key, value, dow: d.getUTCDay(), isFuture: d > now })
    d.setUTCDate(d.getUTCDate() + 1)
  }
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  const months = []
  let lastMonth = -1
  weeks.forEach((week, wi) => {
    const firstDay = week.find(c => !c.isFuture) || week[0]
    const m = new Date(firstDay.key + 'T00:00:00Z').getUTCMonth()
    if (m !== lastMonth) { months.push({ index: wi, label: MONTH_LABELS[m] }); lastMonth = m }
  })
  const maxVal = Math.max(1, ...cells.map(c => c.value))
  return { weeks, months, maxVal }
}

// One surface for everything stat-shaped (2026-07-17: Flight log merged in —
// two surfaces showed the same data under different names). The Overview tab
// leads with the profile hero (rally/best/lifetime/points) and ends with
// Achievements; charts/patterns/AI live in the tabs.
export default function AnalyticsModal({ open, onClose, tasks = [], routines = [], records = {}, streak = 0, dailyStats = {} }) {
  const labels = useMemo(() => loadLabels(), [])
  const labelMap = useMemo(() => Object.fromEntries(labels.map(l => [l.id, l])), [labels])
  const [range, setRange] = useState(30)
  const [metric, setMetric] = useState('tasks')
  const [tab, setTab] = useState('overview') // overview | tasks | habits
  const [history, setHistory] = useState(null)
  const [heatMapData, setHeatMapData] = useState(null)
  const [heatMapMetric, setHeatMapMetric] = useState('tasks')
  const [radarMode, setRadarMode] = useState('tags')
  const [throttleDecisions, setThrottleDecisions] = useState([])
  const [aiUsage, setAiUsage] = useState(null)

  const loadThrottleDecisions = async () => {
    try {
      const api = await import('../api')
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
      const api = await import('../api')
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

  // AI usage summary — follows the selected range (default 30d).
  useEffect(() => {
    if (!open || tab !== 'ai') return
    import('../api').then(m => m.getAiUsage(range || 365))
      .then(setAiUsage)
      .catch(() => setAiUsage(null))
  }, [open, tab, range])

  // Heatmap always fetches a full year.
  useEffect(() => {
    if (!open) return
    fetch('/api/analytics/history?days=365')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setHeatMapData(data.daily) })
      .catch(() => {})
  }, [open])

  const heatMap = useMemo(() => buildHeatMapGrid(heatMapData, heatMapMetric), [heatMapData, heatMapMetric])

  // The grid is wider than a phone; start scrolled to NOW (right edge) —
  // otherwise mobile shows only the year-old left half, which reads as a
  // completely empty heatmap (2026-07-17 prod report).
  const heatmapScrollRef = useRef(null)
  useEffect(() => {
    const el = heatmapScrollRef.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [open, tab, heatMap])

  // Profile hero + achievements (absorbed from the Flight log).
  const lifetimeDone = useMemo(() => tasks.filter(t => t.status === 'done').length, [tasks])
  const yearPoints = useMemo(() => (heatMapData || []).reduce((n, d) => n + (d.points || 0), 0), [heatMapData])
  const badges = useMemo(() => computeBadges({
    lifetimeDone, routines, records, streak, history: heatMapData || [], tasks,
  }), [lifetimeDone, routines, records, streak, heatMapData, tasks])
  const heroStats = [
    { Icon: Flame, label: 'rally', value: `\u21bb ${streak || 0}` },
    { Icon: Trophy, label: 'best rally', value: Math.max(streak || 0, records?.longestStreak || 0) },
    { Icon: Star, label: 'lifetime', value: `${lifetimeDone}\u00d7` },
    { Icon: Zap, label: 'points (yr)', value: yearPoints },
    { Icon: Target, label: 'best day', value: `${records?.bestTasks || 0}\u00d7` },
    { Icon: CalendarCheck, label: 'today', value: `${dailyStats?.tasksToday ?? 0}\u00d7` },
  ]

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
    <ModalShell open={open} onClose={onClose} title="Analytics" width="wide">
      {/* Section tabs — the modal's primary navigation, so they come FIRST
          and are styled as underline tabs (2026-07-17: they used to render
          below two identical-looking segmented controls and read as a third
          picker — the AI tab was invisible in practice). */}
      <div className="v2-analytics-tabs" role="tablist" aria-label="Analytics sections">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'tasks', label: 'Tasks' },
          { id: 'habits', label: 'Habits' },
          { id: 'ai', label: 'AI' },
        ].map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`v2-analytics-tab${tab === t.id ? ' v2-analytics-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >{t.label}</button>
        ))}
      </div>

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
        {(tab === 'overview' || tab === 'tasks') && (
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
        )}
      </div>

      {!history ? (
        <EmptyState
          icon={BarChart3}
          title="Loading analytics…"
          body="Pulling completion data from the server."
        />
      ) : history.totalTasks === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No completed tasks yet"
          body="Finish a task to start seeing patterns."
        />
      ) : (
        <>
          {/* Summary line */}
          {(tab === 'overview' || tab === 'tasks') && (
            <div className="v2-analytics-summary">
              <span className="v2-analytics-summary-num">{metric === 'tasks' ? history.totalTasks : history.totalPoints}</span>
              <span className="v2-analytics-summary-label">{metric === 'tasks' ? 'tasks' : 'points'} · last {range || 'all'} {range ? 'days' : 'time'}</span>
            </div>
          )}

          {/* Daily chart */}
          {tab === 'overview' && (
            <div className="bm-fl-stats" style={{ marginBottom: 16 }}>
              {heroStats.map(s => (
                <div key={s.label} className="bm-fl-stat">
                  <s.Icon size={14} strokeWidth={2.1} className="bm-fl-stat-icon" />
                  <div className="bm-fl-stat-num">{s.value}</div>
                  <div className="bm-fl-stat-cap">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {tab === 'overview' && history.daily?.length > 0 && (
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
          {tab === 'tasks' && history.byDayOfWeek && (
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
          {tab === 'tasks' && (
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
          )}

          {/* Tag breakdown */}
          {tab === 'tasks' && Object.keys(history.byTag || {}).length > 0 && (
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
          {tab === 'tasks' && Object.keys(history.byEnergy || {}).length > 0 && (
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
          {tab === 'tasks' && Object.keys(history.bySize || {}).length > 0 && (
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

          {/* Impact breakdown — "was this week impactful?" gets a real answer.
              Bucket "2" includes never-inferred tasks (the display default). */}
          {tab === 'tasks' && Object.keys(history.byImpact || {}).length > 0 && (
            <section className="v2-analytics-section">
              <h3 className="v2-analytics-heading">By impact</h3>
              <ul className="v2-analytics-bd">
                {['3', '2', '1'].filter(k => history.byImpact[k]).map(k => {
                  const data = history.byImpact[k]
                  const v = metric === 'tasks' ? data.tasks : data.points
                  const max = Math.max(...Object.values(history.byImpact).map(d => metric === 'tasks' ? d.tasks : d.points))
                  const color = k === '3' ? '#F26640' : k === '2' ? '#E8B04B' : '#9CA3AF'
                  const label = k === '3' ? '●●● High' : k === '2' ? '●● Med' : '● Low'
                  return (
                    <li key={k} className="v2-analytics-bd-row">
                      <span className="v2-analytics-bd-dot" style={{ background: color }} />
                      <span className="v2-analytics-bd-label">{label}</span>
                      <div className="v2-analytics-bd-track">
                        <div className="v2-analytics-bd-fill" style={{ width: `${(v / max) * 100}%`, background: color }} />
                      </div>
                      <span className="v2-analytics-bd-value">{v}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* 52-week heatmap */}
          {tab === 'overview' && heatMap.weeks.length > 0 && (
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
              <div className="v2-analytics-heatmap-wrap" ref={heatmapScrollRef}>
                <div className="v2-analytics-heatmap-inner">
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
              </div>
            </section>
          )}

          {tab === 'overview' && (
            <section className="v2-analytics-section">
              <div className="v2-analytics-section-head">
                <h2 className="v2-analytics-section-title">Achievements</h2>
              </div>
              <BadgesGrid badges={badges} />
            </section>
          )}

          {tab === 'habits' && <HabitsAnalytics routines={routines} />}

          {tab === 'ai' && <AiUsagePanel usage={aiUsage} range={range} />}

          {tab === 'tasks' && throttleDecisions.filter(d => !d.feedback).length > 0 && (
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

// Habits tab — per-routine completion summary from data we already have
// (routine.completed_history). No new endpoint. Theme-agnostic.
function habitStreak(history) {
  const days = new Set((history || []).map(ts => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }))
  const cur = new Date(); cur.setHours(0, 0, 0, 0)
  const key = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (!days.has(key(cur))) cur.setDate(cur.getDate() - 1) // today optional
  let n = 0
  while (days.has(key(cur))) { n++; cur.setDate(cur.getDate() - 1) }
  return n
}

function HabitsAnalytics({ routines = [] }) {
  const rows = routines
    .map(r => ({
      id: r.id,
      title: r.title,
      total: (r.completed_history?.length || 0),
      last: (r.completed_history || []).slice().sort().pop() || null,
      streak: habitStreak(r.completed_history),
    }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)

  if (rows.length === 0) {
    return (
      <section className="v2-analytics-section">
        <p className="v2-analytics-section-sub">No habit completions yet — check a routine off to start tracking.</p>
      </section>
    )
  }
  const max = Math.max(...rows.map(r => r.total))
  const ago = (ts) => {
    if (!ts) return '—'
    const days = Math.floor((Date.now() - new Date(ts)) / 86400000)
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
  }
  return (
    <section className="v2-analytics-section">
      <h3 className="v2-analytics-heading">By habit</h3>
      <ul className="v2-analytics-bd v2-analytics-bd-habits">
        {rows.map(r => (
          <li key={r.id} className="v2-analytics-bd-row">
            <span className="v2-analytics-bd-label">{r.title}</span>
            <div className="v2-analytics-bd-track">
              <div className="v2-analytics-bd-fill" style={{ width: `${(r.total / max) * 100}%` }} />
            </div>
            <span className="v2-analytics-bd-value">{r.total}×{r.streak > 1 ? ` · 🔥${r.streak}` : ''} · {ago(r.last)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}


// --- AI usage dashboard (2026-07-17) ---
// Local per-call telemetry from the ai_usage table: totals, then breakdowns
// per provider, per model, and per feature, with cost estimated from the
// aiModels.js pricing table at log time. "est." because prices are a
// snapshot and unpriced (custom) models contribute tokens but no dollars.

function fmtTokens(n) {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function fmtCost(c) {
  if (c == null) return '—'
  if (c > 0 && c < 0.01) return '<$0.01'
  return `$${c.toFixed(2)}`
}

function AiUsagePanel({ usage, range }) {
  if (!usage) {
    return (
      <section className="v2-analytics-section">
        <h3 className="v2-analytics-heading">AI usage</h3>
        <div className="v2-analytics-empty">No usage data yet — AI calls are logged from the moment this feature shipped.</div>
      </section>
    )
  }
  const t = usage.totals || {}
  const providerName = (p) => p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic' : (p || 'unknown')

  const table = (rows, nameFn, keyFn) => (
    <div className="v2-analytics-ai-tablewrap">
      <table className="v2-analytics-ai-table">
        <thead>
          <tr><th>Name</th><th>Calls</th><th>In</th><th>Out</th><th>Est. cost</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={keyFn ? keyFn(r) : i}>
              <td>{nameFn(r)}</td>
              <td>{r.calls}</td>
              <td>{fmtTokens(r.input_tokens)}</td>
              <td>{fmtTokens(r.output_tokens)}</td>
              <td>{fmtCost(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <>
      <section className="v2-analytics-section">
        <h3 className="v2-analytics-heading">AI usage · last {range || 365} days</h3>
        <div className="v2-analytics-ai-cards">
          <div className="v2-analytics-ai-card">
            <span className="v2-analytics-ai-num">{fmtCost(t.cost)}</span>
            <span className="v2-analytics-ai-label">est. cost{t.unpriced_calls > 0 ? ` (+${t.unpriced_calls} unpriced calls)` : ''}</span>
          </div>
          <div className="v2-analytics-ai-card">
            <span className="v2-analytics-ai-num">{t.calls || 0}</span>
            <span className="v2-analytics-ai-label">calls</span>
          </div>
          <div className="v2-analytics-ai-card">
            <span className="v2-analytics-ai-num">{fmtTokens((t.input_tokens || 0) + (t.output_tokens || 0))}</span>
            <span className="v2-analytics-ai-label">tokens</span>
          </div>
        </div>
      </section>

      {(usage.byProvider || []).length > 0 && (
        <section className="v2-analytics-section">
          <h3 className="v2-analytics-heading">By provider</h3>
          {table(usage.byProvider, r => providerName(r.provider), r => r.provider)}
        </section>
      )}

      {(usage.byModel || []).length > 0 && (
        <section className="v2-analytics-section">
          <h3 className="v2-analytics-heading">By model</h3>
          {table(usage.byModel, r => `${r.model} · ${providerName(r.provider)}`, r => `${r.provider}:${r.model}`)}
        </section>
      )}

      {(usage.byFeature || []).length > 0 && (
        <section className="v2-analytics-section">
          <h3 className="v2-analytics-heading">By feature</h3>
          {table(usage.byFeature, r => r.feature || 'untagged', r => r.feature || 'untagged')}
        </section>
      )}

      {(usage.totals?.calls || 0) === 0 && (
        <section className="v2-analytics-section">
          <div className="v2-analytics-empty">No AI calls logged in this window yet.</div>
        </section>
      )}
    </>
  )
}
