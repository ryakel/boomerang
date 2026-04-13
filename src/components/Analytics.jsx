import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import './Analytics.css'
import { FullRings } from './Rings'
import { loadSettings, saveSettings, loadLabels, ENERGY_TYPES } from '../store'
import { SIZE_POINTS } from '../scoring'
import EnergyIcon from './EnergyIcon'
import { Search, ChevronRight } from 'lucide-react'

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL']
const SIZE_COLORS = { XS: '#60A5FA', S: '#52C97F', M: '#FFB347', L: '#F97316', XL: '#EF4444' }

// Build heat map grid (52 weeks x 7 days, most recent week on the right)
function buildHeatMapGrid(dailyData, metric) {
  const dataMap = {}
  for (const d of dailyData) {
    dataMap[d.day] = d
  }

  const today = new Date()
  const cells = []
  // Go back 364 days (52 weeks)
  const start = new Date(today)
  start.setDate(start.getDate() - 363)
  // Align to Sunday
  start.setDate(start.getDate() - start.getDay())

  const end = new Date(today)
  end.setDate(end.getDate() + (6 - end.getDay())) // extend to Saturday

  const d = new Date(start)
  while (d <= end) {
    const key = d.toISOString().split('T')[0]
    const data = dataMap[key]
    const value = data ? (metric === 'points' ? data.points : data.tasks) : 0
    const isFuture = d > today
    cells.push({ key, value, dow: d.getDay(), isFuture })
    d.setDate(d.getDate() + 1)
  }

  // Group into weeks (columns)
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  // Month labels
  const months = []
  let lastMonth = -1
  weeks.forEach((week, wi) => {
    const firstDay = week.find(c => !c.isFuture) || week[0]
    const m = new Date(firstDay.key).getMonth()
    if (m !== lastMonth) {
      months.push({ index: wi, label: MONTH_LABELS[m] })
      lastMonth = m
    }
  })

  // Max value for color scaling
  const maxVal = Math.max(1, ...cells.map(c => c.value))

  return { weeks, months, maxVal }
}

export default function Analytics({ onClose, isDesktop }) {
  const settings = loadSettings()
  const labels = loadLabels()
  const labelMap = Object.fromEntries(labels.map(l => [l.id, l]))
  const [stats, setStats] = useState(null)
  const [range, setRange] = useState(30)
  const [history, setHistory] = useState(null)
  const [chartMode, setChartMode] = useState('tasks')
  const [heatMapData, setHeatMapData] = useState(null)
  const [heatMapMetric, setHeatMapMetric] = useState('tasks')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchFilters, setSearchFilters] = useState({})
  const [completedOpen, setCompletedOpen] = useState(false)
  const searchTimer = useRef(null)

  useEffect(() => {
    fetch('/api/analytics')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setStats(data) })
      .catch(() => {})
  }, [])

  // Heat map: always fetch 365 days of daily data
  useEffect(() => {
    fetch('/api/analytics/history?days=365')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setHeatMapData(data.daily) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    const params = range ? `?days=${range}` : ''
    fetch(`/api/analytics/history${params}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setHistory(data) })
      .catch(() => {})
  }, [range])

  // Search completed tasks
  const doSearch = useCallback(() => {
    const params = new URLSearchParams({ status: 'done', sort: 'completed_at', limit: '50' })
    if (searchQuery) params.set('q', searchQuery)
    if (searchFilters.energy) params.set('energy', searchFilters.energy)
    if (searchFilters.size) params.set('size', searchFilters.size)
    if (searchFilters.tag) params.set('tag', searchFilters.tag)
    fetch(`/api/tasks?${params}`)
      .then(res => res.ok ? res.json() : [])
      .then(setSearchResults)
      .catch(() => setSearchResults([]))
  }, [searchQuery, searchFilters])

  useEffect(() => {
    if (!completedOpen) return
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(doSearch, 400)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [doSearch, completedOpen])

  const tasksToday = stats?.tasksToday || 0
  const pointsToday = stats?.pointsToday || 0
  const streak = stats?.streak || 0
  const bestTasks = stats?.bestTasks || 0
  const bestPoints = stats?.bestPoints || 0
  const longestStreak = stats?.longestStreak || 0
  const taskGoal = settings.daily_task_goal || 3
  const pointsGoal = settings.daily_points_goal || 15

  const rings = [
    { progress: taskGoal > 0 ? tasksToday / taskGoal : 0, color: '#52C97F' },
    { progress: pointsGoal > 0 ? pointsToday / pointsGoal : 0, color: '#FFB347' },
    { progress: streak > 0 ? Math.min(streak / 7, 1) : 0, color: '#4A9EFF' },
  ]

  // Vacation/free day/reset state (keep existing)
  const [vacationMode, setVacationMode] = useState(settings.vacation_mode || false)
  const [showVacationPicker, setShowVacationPicker] = useState(false)
  const [customDays, setCustomDays] = useState('')
  const todayStr = new Date().toISOString().split('T')[0]
  const [isFreeDay, setIsFreeDay] = useState(() => (settings.free_days || []).includes(todayStr))
  const [resetState, setResetState] = useState('idle')
  const resetTimer = useRef(null)

  useEffect(() => {
    if (vacationMode && settings.vacation_end) {
      const endDate = new Date(settings.vacation_end)
      if (new Date() >= endDate) {
        const current = loadSettings()
        saveSettings({ ...current, vacation_mode: false, vacation_end: null, vacation_started: null })
        setVacationMode(false)
      }
    }
  }, [vacationMode, settings.vacation_end])

  useEffect(() => { return () => { if (resetTimer.current) clearTimeout(resetTimer.current) } }, [])

  const handleVacationClick = () => {
    if (vacationMode) {
      const current = loadSettings()
      saveSettings({ ...current, vacation_mode: false, vacation_started: null, vacation_end: null, streak_current: streak })
      setVacationMode(false)
    } else { setShowVacationPicker(true) }
  }
  const startVacation = (days) => {
    const current = loadSettings()
    const end = new Date(); end.setDate(end.getDate() + days)
    saveSettings({ ...current, vacation_mode: true, vacation_started: new Date().toISOString(), vacation_end: end.toISOString(), streak_current: streak })
    setVacationMode(true); setShowVacationPicker(false); setCustomDays('')
  }
  const handleReset = () => {
    if (resetState === 'idle') {
      setResetState('confirming')
      resetTimer.current = setTimeout(() => setResetState('idle'), 3000)
    } else {
      if (resetTimer.current) clearTimeout(resetTimer.current)
      setResetState('idle')
      const current = loadSettings()
      saveSettings({ ...current, streak_current: 0 })
    }
  }

  // Heat map grid
  const heatMap = useMemo(() => {
    if (!heatMapData) return null
    return buildHeatMapGrid(heatMapData, heatMapMetric)
  }, [heatMapData, heatMapMetric])

  // Chart helpers
  const dailyMax = useMemo(() => {
    if (!history?.daily?.length) return 1
    return Math.max(1, ...history.daily.map(d => chartMode === 'tasks' ? d.tasks : d.points))
  }, [history, chartMode])

  const dowMax = useMemo(() => {
    if (!history?.byDayOfWeek) return 1
    return Math.max(1, ...history.byDayOfWeek.map(d => chartMode === 'tasks' ? d.tasks : d.points))
  }, [history, chartMode])

  // Day of week insight
  const bestDow = useMemo(() => {
    if (!history?.byDayOfWeek) return null
    let max = 0, idx = 0
    history.byDayOfWeek.forEach((d, i) => { if (d.tasks > max) { max = d.tasks; idx = i } })
    return max > 0 ? DOW_LABELS[idx] : null
  }, [history])

  const content = (
    <div className="analytics-content">
      {/* Rings */}
      <FullRings rings={rings} label={`${pointsToday}`} />
      <div className="ring-legend">
        <div className="ring-legend-item"><div className="ring-legend-dot" style={{ background: '#52C97F' }} /><span>Tasks: {tasksToday}/{taskGoal}</span></div>
        <div className="ring-legend-item"><div className="ring-legend-dot" style={{ background: '#FFB347' }} /><span>Points: {pointsToday}/{pointsGoal}</span></div>
        <div className="ring-legend-item"><div className="ring-legend-dot" style={{ background: '#4A9EFF' }} /><span>Streak: {streak}d</span></div>
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-value">{streak}</div><div className="stat-label">Current Streak</div></div>
        <div className="stat-card"><div className="stat-value">{longestStreak}</div><div className="stat-label">Longest Streak</div></div>
        <div className="stat-card"><div className="stat-value">{bestPoints}</div><div className="stat-label">Best Daily Points</div></div>
        <div className="stat-card"><div className="stat-value">{bestTasks}</div><div className="stat-label">Best Daily Tasks</div></div>
      </div>

      <div className="streak-actions-row">
        <button className={`vacation-btn ${vacationMode ? 'active' : ''}`} onClick={handleVacationClick}>
          {vacationMode ? 'End vacation' : 'Vacation mode'}
        </button>
        <button className={`free-day-btn ${isFreeDay ? 'active' : ''}`} onClick={() => {
          const current = loadSettings()
          const freeDays = new Set(current.free_days || [])
          if (isFreeDay) freeDays.delete(todayStr); else freeDays.add(todayStr)
          saveSettings({ ...current, free_days: [...freeDays] })
          setIsFreeDay(!isFreeDay)
        }}>{isFreeDay ? 'Free day on' : 'Free day'}</button>
      </div>

      {showVacationPicker && (
        <div className="vacation-picker">
          <div className="vacation-picker-title">How long?</div>
          <div className="vacation-picker-options">
            <button className="vacation-option" onClick={() => startVacation(3)}>3 days</button>
            <button className="vacation-option" onClick={() => startVacation(5)}>5 days</button>
            <button className="vacation-option" onClick={() => startVacation(7)}>7 days</button>
          </div>
          <div className="vacation-custom-row">
            <input type="number" className="vacation-custom-input" placeholder="Custom days" min="1" max="365" value={customDays} onChange={e => setCustomDays(e.target.value)} onClick={e => e.stopPropagation()} />
            <button className="vacation-option vacation-custom-go" disabled={!customDays || customDays < 1} onClick={() => startVacation(parseInt(customDays, 10))}>Go</button>
          </div>
          <button className="vacation-picker-cancel" onClick={() => { setShowVacationPicker(false); setCustomDays('') }}>Cancel</button>
        </div>
      )}
      {vacationMode && settings.vacation_started && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', marginTop: 6 }}>
          Streak frozen since {new Date(settings.vacation_started).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {settings.vacation_end && <> · ends {new Date(settings.vacation_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>}
        </div>
      )}
      <button className="reset-btn" onClick={handleReset}>
        {resetState === 'confirming' ? 'Are you sure?' : 'Reset streaks'}
      </button>

      {/* ── Time Range + Daily Chart ── */}
      <div className="analytics-divider" />

      <div className="analytics-range-row">
        <div className="analytics-range-picker">
          {[{ v: 7, l: '7d' }, { v: 30, l: '30d' }, { v: 90, l: '90d' }, { v: null, l: 'All' }].map(r => (
            <button key={r.l} className={`range-pill ${range === r.v ? 'active' : ''}`} onClick={() => setRange(r.v)}>{r.l}</button>
          ))}
        </div>
        <div className="analytics-range-picker">
          <button className={`range-pill ${chartMode === 'tasks' ? 'active' : ''}`} onClick={() => setChartMode('tasks')}>Tasks</button>
          <button className={`range-pill ${chartMode === 'points' ? 'active' : ''}`} onClick={() => setChartMode('points')}>Points</button>
        </div>
      </div>

      {history && (
        <div className="analytics-section">
          <div className="analytics-section-title">
            {range ? `Last ${range} days` : 'All time'}{history.totalTasks > 0 && ` · ${history.totalTasks} tasks · ${history.totalPoints} pts`}
          </div>
          {history.daily.length > 0 ? (
            <div className="daily-chart">
              {history.daily.map(d => {
                const val = chartMode === 'tasks' ? d.tasks : d.points
                const pct = (val / dailyMax) * 100
                return (
                  <div key={d.day} className="daily-chart-bar-wrap" title={`${d.day}: ${d.tasks} tasks, ${d.points} pts`}>
                    <div className="daily-chart-bar" style={{ height: `${Math.max(2, pct)}%`, background: chartMode === 'tasks' ? '#52C97F' : '#FFB347' }} />
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 24, fontSize: 13 }}>No completions in this period</div>
          )}
        </div>
      )}

      {/* ── Day of Week ── */}
      {history?.byDayOfWeek && (
        <div className="analytics-section">
          <div className="analytics-section-title">
            By Day of Week{bestDow && <span className="analytics-insight"> · Best day: {bestDow}</span>}
          </div>
          <div className="dow-chart">
            {history.byDayOfWeek.map((d, i) => {
              const val = chartMode === 'tasks' ? d.tasks : d.points
              const pct = (val / dowMax) * 100
              return (
                <div key={i} className="dow-col">
                  <div className="dow-bar-wrap">
                    <div
                      className={`dow-bar ${i === new Date().getDay() ? 'today' : ''}`}
                      style={{ height: `${Math.max(val > 0 ? 8 : 0, pct)}%`, background: chartMode === 'tasks' ? '#52C97F' : '#FFB347' }}
                      title={`${DOW_LABELS[i]}: ${d.tasks} tasks, ${d.points} pts`}
                    />
                  </div>
                  <div className={`dow-label ${i === new Date().getDay() ? 'today' : ''}`}>{DOW_LABELS[i]}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Breakdowns ── */}
      {history && (
        <>
          {/* By Tag */}
          {Object.keys(history.byTag).length > 0 && (
            <div className="analytics-section">
              <div className="analytics-section-title">By Tag</div>
              {Object.entries(history.byTag)
                .sort((a, b) => b[1].tasks - a[1].tasks)
                .map(([tagId, data]) => {
                  const label = labelMap[tagId]
                  if (!label) return null
                  const maxVal = Math.max(...Object.values(history.byTag).map(d => chartMode === 'tasks' ? d.tasks : d.points))
                  const val = chartMode === 'tasks' ? data.tasks : data.points
                  return (
                    <div key={tagId} className="breakdown-row">
                      <div className="breakdown-dot" style={{ background: label.color }} />
                      <div className="breakdown-name">{label.name}</div>
                      <div className="breakdown-bar-track">
                        <div className="breakdown-bar-fill" style={{ width: `${(val / maxVal) * 100}%`, background: label.color }} />
                      </div>
                      <div className="breakdown-value">{data.tasks}<span className="breakdown-pts"> · {data.points}p</span></div>
                    </div>
                  )
                })}
            </div>
          )}

          {/* By Energy */}
          {Object.keys(history.byEnergy).length > 0 && (
            <div className="analytics-section">
              <div className="analytics-section-title">By Energy Type</div>
              {ENERGY_TYPES
                .filter(e => history.byEnergy[e.id])
                .sort((a, b) => (history.byEnergy[b.id]?.tasks || 0) - (history.byEnergy[a.id]?.tasks || 0))
                .map(e => {
                  const data = history.byEnergy[e.id]
                  const maxVal = Math.max(...Object.values(history.byEnergy).map(d => chartMode === 'tasks' ? d.tasks : d.points))
                  const val = chartMode === 'tasks' ? data.tasks : data.points
                  return (
                    <div key={e.id} className="breakdown-row">
                      <EnergyIcon icon={e.icon} color={e.color} size={14} />
                      <div className="breakdown-name">{e.label}</div>
                      <div className="breakdown-bar-track">
                        <div className="breakdown-bar-fill" style={{ width: `${(val / maxVal) * 100}%`, background: e.color }} />
                      </div>
                      <div className="breakdown-value">{data.tasks}<span className="breakdown-pts"> · {data.points}p</span></div>
                    </div>
                  )
                })}
            </div>
          )}

          {/* By Size */}
          {Object.keys(history.bySize).length > 0 && (
            <div className="analytics-section">
              <div className="analytics-section-title">By Size</div>
              {SIZE_ORDER
                .filter(s => history.bySize[s])
                .map(s => {
                  const data = history.bySize[s]
                  const maxVal = Math.max(...Object.values(history.bySize).map(d => chartMode === 'tasks' ? d.tasks : d.points))
                  const val = chartMode === 'tasks' ? data.tasks : data.points
                  return (
                    <div key={s} className="breakdown-row">
                      <span className={`size-pill size-${s.toLowerCase()}`} style={{ fontSize: 10, padding: '1px 6px' }}>{s}</span>
                      <div className="breakdown-name">{SIZE_POINTS[s]}pt base</div>
                      <div className="breakdown-bar-track">
                        <div className="breakdown-bar-fill" style={{ width: `${(val / maxVal) * 100}%`, background: SIZE_COLORS[s] }} />
                      </div>
                      <div className="breakdown-value">{data.tasks}<span className="breakdown-pts"> · {data.points}p</span></div>
                    </div>
                  )
                })}
            </div>
          )}
        </>
      )}

      {/* ── Heat Map ── */}
      {heatMap && (
        <>
          <div className="analytics-divider" />
          <div className="analytics-section">
            <div className="analytics-range-row">
              <div className="analytics-section-title" style={{ marginBottom: 0 }}>Activity</div>
              <div className="analytics-range-picker">
                <button className={`range-pill ${heatMapMetric === 'tasks' ? 'active' : ''}`} onClick={() => setHeatMapMetric('tasks')}>Tasks</button>
                <button className={`range-pill ${heatMapMetric === 'points' ? 'active' : ''}`} onClick={() => setHeatMapMetric('points')}>Points</button>
              </div>
            </div>
            <div className="heatmap-scroll">
              <div className="heatmap">
                <div className="heatmap-dow-labels">
                  {['', 'Mon', '', 'Wed', '', 'Fri', ''].map((l, i) => (
                    <div key={i} className="heatmap-dow-label">{l}</div>
                  ))}
                </div>
                <div className="heatmap-grid">
                  <div className="heatmap-month-labels">
                    {heatMap.months.map((m, i) => (
                      <div key={i} className="heatmap-month-label" style={{ gridColumn: m.index + 1 }}>{m.label}</div>
                    ))}
                  </div>
                  <div className="heatmap-weeks">
                    {heatMap.weeks.map((week, wi) => (
                      <div key={wi} className="heatmap-week">
                        {week.map(cell => (
                          <div
                            key={cell.key}
                            className={`heatmap-cell${cell.isFuture ? ' future' : ''}`}
                            style={{
                              background: cell.isFuture ? 'transparent' : cell.value === 0
                                ? 'var(--surface)'
                                : heatMapMetric === 'tasks'
                                  ? `rgba(82, 201, 127, ${Math.max(0.15, Math.min(1, cell.value / heatMap.maxVal))})`
                                  : `rgba(255, 179, 71, ${Math.max(0.15, Math.min(1, cell.value / heatMap.maxVal))})`
                            }}
                            title={cell.isFuture ? '' : `${cell.key}: ${cell.value} ${heatMapMetric}`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="heatmap-legend">
              <span>Less</span>
              {[0, 0.25, 0.5, 0.75, 1].map(level => (
                <div
                  key={level}
                  className="heatmap-legend-cell"
                  style={{
                    background: level === 0 ? 'var(--surface)' :
                      heatMapMetric === 'tasks'
                        ? `rgba(82, 201, 127, ${Math.max(0.15, level)})`
                        : `rgba(255, 179, 71, ${Math.max(0.15, level)})`
                  }}
                />
              ))}
              <span>More</span>
            </div>
          </div>
        </>
      )}

      {/* ── Completion Search (collapsible) ── */}
      <div className="analytics-divider" />
      <button className="analytics-collapse-toggle" onClick={() => setCompletedOpen(!completedOpen)}>
        <span className={`backlog-arrow ${completedOpen ? 'open' : ''}`}><ChevronRight size={12} /></span>
        Completed Tasks
      </button>
      {completedOpen && (
        <div className="analytics-section" style={{ marginTop: 8 }}>
          <div className="analytics-search">
            <Search size={16} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <input
              className="analytics-search-input"
              placeholder="Search completed tasks..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
          <div className="analytics-filters">
            <select className="analytics-filter-select" value={searchFilters.energy || ''} onChange={e => setSearchFilters(p => ({ ...p, energy: e.target.value || undefined }))}>
              <option value="">All energy</option>
              {ENERGY_TYPES.map(e => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
            <select className="analytics-filter-select" value={searchFilters.size || ''} onChange={e => setSearchFilters(p => ({ ...p, size: e.target.value || undefined }))}>
              <option value="">All sizes</option>
              {SIZE_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            {labels.length > 0 && (
              <select className="analytics-filter-select" value={searchFilters.tag || ''} onChange={e => setSearchFilters(p => ({ ...p, tag: e.target.value || undefined }))}>
                <option value="">All tags</option>
                {labels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
          </div>
          {searchResults && searchResults.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-dim)', padding: 16, fontSize: 13 }}>No completed tasks found</div>
          )}
          {searchResults && searchResults.map(t => (
            <div key={t.id} className="completed-card">
              <div className="completed-card-top">
                <span className="completed-card-title">{t.title}</span>
                {t.size && <span className={`size-pill size-${t.size.toLowerCase()}`} style={{ fontSize: 10, padding: '1px 6px' }}>{t.size}</span>}
              </div>
              <div className="completed-card-meta">
                {t.completed_at && <span>{new Date(t.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                {t.energy && (
                  <span className="completed-card-energy">
                    <EnergyIcon icon={ENERGY_TYPES.find(e => e.id === t.energy)?.icon} color={ENERGY_TYPES.find(e => e.id === t.energy)?.color} size={12} />
                  </span>
                )}
                {t.tags?.map(tagId => {
                  const label = labelMap[tagId]
                  return label ? <span key={tagId} className="task-tag" style={{ background: `${label.color}22`, color: label.color, fontSize: 10, padding: '1px 6px' }}>{label.name}</span> : null
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  if (isDesktop) {
    return (
      <div className="sheet-overlay" onClick={onClose}>
        <div className="sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 640 }}>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
          <div className="edit-task-title-row"><div className="sheet-title">Analytics</div></div>
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Analytics</div>
        <div style={{ width: 50 }} />
      </div>
      {content}
    </div>
  )
}
