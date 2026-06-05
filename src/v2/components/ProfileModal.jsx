import { useEffect, useMemo, useState } from 'react'
import { Flame, Zap, CheckCircle2, Trophy, Star } from 'lucide-react'
import ModalShell from './ModalShell'
import ContributionHeatmap from './ContributionHeatmap'
import { routineHeatColor, historyByDay } from './heatmapUtils'
import { computeRecords } from '../../scoring'
import './ProfileModal.css'

// Loggd-style Profile / Dashboard. The signature "see your year" surface:
// a header, colorful stat pills, a big 53-week activity contribution grid
// (reusing the analytics daily data), and per-habit heatmaps below. All of
// it reuses data the app already computes — no new server work.
export default function ProfileModal({
  open, onClose,
  tasks = [], routines = [],
  dailyStats, streak = 0, records,
}) {
  const [daily, setDaily] = useState(null)
  const [metric, setMetric] = useState('tasks')

  useEffect(() => {
    if (!open) return
    fetch('/api/analytics/history?days=365')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setDaily(data.daily) })
      .catch(() => {})
  }, [open])

  const valueByDay = useMemo(() => {
    const m = {}
    for (const d of (daily || [])) m[d.day] = metric === 'points' ? d.points : d.tasks
    return m
  }, [daily, metric])

  const totalContrib = useMemo(
    () => (daily || []).reduce((n, d) => n + (metric === 'points' ? d.points : d.tasks), 0),
    [daily, metric],
  )
  const activeDays = useMemo(
    () => (daily || []).filter(d => (metric === 'points' ? d.points : d.tasks) > 0).length,
    [daily, metric],
  )
  const lifetimeDone = useMemo(() => tasks.filter(t => t.status === 'done').length, [tasks])
  const computedRecords = useMemo(() => computeRecords(tasks), [tasks])
  const rec = records || computedRecords
  const bestStreak = Math.max(streak, rec?.longestStreak || 0)

  const pills = [
    { icon: Flame, label: 'Day streak', value: streak, color: 'var(--lg-orange, var(--v2-accent))' },
    { icon: Zap, label: 'Points today', value: dailyStats?.pointsToday ?? 0, color: 'var(--lg-purple, var(--v2-accent))' },
    { icon: CheckCircle2, label: 'Done today', value: dailyStats?.tasksToday ?? 0, color: 'var(--lg-green, var(--v2-accent))' },
    { icon: Trophy, label: 'Best streak', value: bestStreak, color: 'var(--lg-blue, var(--v2-accent))' },
    { icon: Star, label: 'Lifetime done', value: lifetimeDone, color: 'var(--lg-pink, var(--v2-accent))' },
  ]

  const habits = (routines || []).filter(r => (r.completed_history?.length || 0) > 0)
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <ModalShell open={open} onClose={onClose} title="Dashboard" subtitle={todayLabel} width="wide">
      {/* Stat pills */}
      <div className="v2-profile-pills">
        {pills.map(p => {
          const Icon = p.icon
          return (
            <div key={p.label} className="v2-profile-pill" style={{ '--pill-color': p.color }}>
              <Icon size={16} strokeWidth={2} className="v2-profile-pill-icon" />
              <span className="v2-profile-pill-value">{p.value}</span>
              <span className="v2-profile-pill-label">{p.label}</span>
            </div>
          )
        })}
      </div>

      {/* Activity year grid */}
      <section className="v2-profile-section">
        <div className="v2-profile-section-head">
          <h3 className="v2-profile-heading">Activity</h3>
          <div className="v2-profile-metric">
            <button
              type="button"
              className={`v2-profile-metric-btn${metric === 'tasks' ? ' v2-profile-metric-btn-active' : ''}`}
              onClick={() => setMetric('tasks')}
            >Tasks</button>
            <button
              type="button"
              className={`v2-profile-metric-btn${metric === 'points' ? ' v2-profile-metric-btn-active' : ''}`}
              onClick={() => setMetric('points')}
            >Points</button>
          </div>
        </div>
        <div className="v2-profile-heatmap-wrap">
          <ContributionHeatmap
            valueByDay={valueByDay}
            color="var(--lg-green, var(--v2-accent))"
            weeks={53}
            cellSize={11}
            gap={3}
            showMonths
            unitLabel={metric}
          />
        </div>
        <p className="v2-profile-contrib-note">
          {totalContrib} {metric} across {activeDays} active day{activeDays === 1 ? '' : 's'} in the last year
        </p>
      </section>

      {/* Habit heatmaps */}
      {habits.length > 0 && (
        <section className="v2-profile-section">
          <h3 className="v2-profile-heading">Habits</h3>
          <div className="v2-profile-habits">
            {habits.map(r => (
              <div key={r.id} className="v2-profile-habit">
                <div className="v2-profile-habit-head">
                  <span className="v2-profile-habit-title">{r.title}</span>
                  <span className="v2-profile-habit-count">{r.completed_history.length}×</span>
                </div>
                <div className="v2-profile-heatmap-wrap">
                  <ContributionHeatmap
                    valueByDay={historyByDay(r.completed_history)}
                    color={routineHeatColor(r.id)}
                    weeks={26}
                    cellSize={9}
                    gap={2}
                    unitLabel="done"
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </ModalShell>
  )
}
