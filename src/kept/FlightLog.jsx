import { useEffect, useMemo, useState } from 'react'
import { Flame, Trophy, Star, Zap, Target, CalendarCheck } from 'lucide-react'
import ModalShell from '../components/ModalShell'
import BadgesGrid from '../components/BadgesGrid'
import DensityRibbon from './DensityRibbon'
import { computeBadges } from '../badges'
import './shell.css'
import './flightlog.css'

// Flight log (K4) — the avatar's real destination: your whole arc in one
// place. Records strip, the year as a Density Ribbon (tasks or points),
// and the full achievements wall. Reads the analytics daily series; no
// new data.
export default function FlightLog({
  open, onClose,
  tasks = [], routines = [], records = {}, streak = 0, dailyStats = {},
}) {
  const [history, setHistory] = useState([])
  const [metric, setMetric] = useState('tasks')

  useEffect(() => {
    if (!open) return
    fetch('/api/analytics/history?days=365')
      .then(r => (r.ok ? r.json() : null))
      .then(d => setHistory(d?.daily || []))
      .catch(() => setHistory([]))
  }, [open])

  const lifetimeDone = useMemo(() => tasks.filter(t => t.status === 'done').length, [tasks])
  const totalPoints = useMemo(() => history.reduce((n, d) => n + (d.points || 0), 0), [history])
  const valueByDay = useMemo(() => {
    const m = {}
    for (const d of history) m[d.day] = metric === 'points' ? (d.points || 0) : (d.tasks || 0)
    return m
  }, [history, metric])

  const badges = useMemo(() => computeBadges({
    lifetimeDone, routines, records, streak, history, tasks,
  }), [lifetimeDone, routines, records, streak, history, tasks])

  const bestStreak = Math.max(streak || 0, records?.longestStreak || 0)
  const stats = [
    { Icon: Flame, label: 'rally', value: `↻ ${streak || 0}` },
    { Icon: Trophy, label: 'best rally', value: bestStreak },
    { Icon: Star, label: 'lifetime', value: `${lifetimeDone}×` },
    { Icon: Zap, label: 'points (yr)', value: totalPoints },
    { Icon: Target, label: 'best day', value: `${records?.bestTasks || 0}×` },
    { Icon: CalendarCheck, label: 'today', value: `${dailyStats?.tasksToday ?? 0}×` },
  ]

  return (
    <ModalShell open={open} onClose={onClose} title="Flight log" subtitle="Your year, in arcs" width="wide">
      <div className="bm-fl-stats">
        {stats.map(s => (
          <div key={s.label} className="bm-fl-stat">
            <s.Icon size={14} strokeWidth={2.1} className="bm-fl-stat-icon" />
            <div className="bm-fl-stat-num">{s.value}</div>
            <div className="bm-fl-stat-cap">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bm-fl-year">
        <div className="bm-fl-year-head">
          <span className="bm-fl-year-title">Your year</span>
          <div className="bm-fl-toggle" role="tablist" aria-label="Year metric">
            <button role="tab" aria-selected={metric === 'tasks'}
              className={`bm-fl-toggle-btn${metric === 'tasks' ? ' is-active' : ''}`}
              onClick={() => setMetric('tasks')}>Catches</button>
            <button role="tab" aria-selected={metric === 'points'}
              className={`bm-fl-toggle-btn${metric === 'points' ? ' is-active' : ''}`}
              onClick={() => setMetric('points')}>Points</button>
          </div>
        </div>
        <DensityRibbon valueByDay={valueByDay} />
      </div>

      <div className="bm-fl-badges">
        <div className="bm-fl-year-title" style={{ marginBottom: 8 }}>Achievements</div>
        <BadgesGrid badges={badges} />
      </div>
    </ModalShell>
  )
}
