import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Flame, Zap, CheckCircle2, Trophy, Star, TrendingUp } from 'lucide-react'
import ContributionHeatmap from './ContributionHeatmap'
import BadgesGrid from '../components/BadgesGrid'
import { computeBadges } from '../../badges'
import { WALLABY_COLORS, historyByDay } from './heatmapUtils'
import './ProfileView.css'

// Wallaby "Profile" / dashboard surface (loggd IMG_1574): avatar + stat pills +
// the big Activity year-grid heatmap + per-habit grids. Stat values come in as
// props (computed by AppV2); the 365-day daily history is fetched here (or
// injected via window/prop for the preview harness).
export default function ProfileView({
  dailyStats = {}, streak = 0, records = {}, lifetimeDone = 0,
  routines = [], dailyHistory, onClose,
}) {
  const [history, setHistory] = useState(dailyHistory || null)
  const [metric, setMetric] = useState('tasks')

  useEffect(() => {
    if (dailyHistory) { setHistory(dailyHistory); return }
    if (typeof window !== 'undefined' && window.__WALLABY_HISTORY__) { setHistory(window.__WALLABY_HISTORY__); return }
    fetch('/api/analytics/history?days=365')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setHistory(d.daily) })
      .catch(() => {})
  }, [dailyHistory])

  const valueByDay = useMemo(() => {
    const m = {}
    for (const d of (history || [])) m[d.day] = metric === 'points' ? d.points : d.tasks
    return m
  }, [history, metric])

  const totalContrib = useMemo(
    () => (history || []).reduce((n, d) => n + (metric === 'points' ? d.points : d.tasks), 0),
    [history, metric],
  )
  const activeDays = useMemo(
    () => (history || []).filter(d => (metric === 'points' ? d.points : d.tasks) > 0).length,
    [history, metric],
  )

  const bestStreak = Math.max(streak, records?.longestStreak || 0)
  const pills = [
    { icon: Flame, label: 'Day streak', value: streak, color: 'var(--wb-cat-orange)' },
    { icon: Zap, label: 'Points today', value: dailyStats?.pointsToday ?? 0, color: 'var(--wb-cat-purple)' },
    { icon: CheckCircle2, label: 'Done today', value: dailyStats?.tasksToday ?? 0, color: 'var(--wb-cat-green)' },
    { icon: Trophy, label: 'Best streak', value: bestStreak, color: 'var(--wb-cat-blue)' },
    { icon: Star, label: 'Lifetime done', value: lifetimeDone, color: 'var(--wb-cat-pink)' },
  ]

  const badges = useMemo(
    () => computeBadges({ lifetimeDone, routines, records, streak, history: history || [] }),
    [lifetimeDone, routines, records, streak, history],
  )

  const habits = (routines || []).filter(r => (r.completed_history?.length || 0) > 0)

  return (
    <div className="wb-profile">
      <header className="wb-profile-head">
        {onClose && (
          <button className="wb-back wb-profile-back" onClick={onClose} aria-label="Back">
            <ArrowLeft size={20} strokeWidth={2.25} />
          </button>
        )}
        <div className="wb-profile-avatar"><TrendingUp size={30} strokeWidth={2.25} color="#fff" /></div>
        <h1 className="wb-profile-name">Your year</h1>
        <p className="wb-profile-bio">{totalContrib} contributions · {activeDays} active day{activeDays === 1 ? '' : 's'}</p>
      </header>

      <div className="wb-profile-pills">
        {pills.map(p => {
          const Icon = p.icon
          return (
            <div key={p.label} className="wb-profile-pill" style={{ '--pill': p.color }}>
              <span className="wb-profile-pill-icon"><Icon size={16} strokeWidth={2.25} /></span>
              <span className="wb-profile-pill-value">{p.value}</span>
              <span className="wb-profile-pill-label">{p.label}</span>
            </div>
          )
        })}
      </div>

      <section className="wb-profile-section">
        <h2 className="wb-profile-section-title">Records</h2>
        <div className="wb-profile-records">
          {[
            { icon: CheckCircle2, label: 'Best day', value: records?.bestTasks ?? 0, unit: 'tasks', color: 'var(--wb-cat-green)' },
            { icon: Zap, label: 'Best points', value: records?.bestPoints ?? 0, unit: 'pts', color: 'var(--wb-cat-purple)' },
            { icon: Trophy, label: 'Longest streak', value: bestStreak, unit: 'days', color: 'var(--wb-cat-blue)' },
          ].map(r => {
            const Icon = r.icon
            return (
              <div key={r.label} className="wb-profile-record" style={{ '--rec': r.color }}>
                <span className="wb-profile-record-icon"><Icon size={15} strokeWidth={2.25} /></span>
                <span className="wb-profile-record-value">{r.value}<em>{r.unit}</em></span>
                <span className="wb-profile-record-label">{r.label}</span>
              </div>
            )
          })}
        </div>
      </section>

      <section className="wb-profile-section">
        <h2 className="wb-profile-section-title">Achievements</h2>
        <BadgesGrid badges={badges} />
      </section>

      <section className="wb-profile-section">
        <div className="wb-profile-section-head">
          <h2 className="wb-profile-section-title">Activity</h2>
          <div className="wb-seg">
            {[{ id: 'tasks', label: 'Tasks' }, { id: 'points', label: 'Points' }].map(m => (
              <button
                key={m.id}
                className={`wb-seg-btn${metric === m.id ? ' is-active' : ''}`}
                onClick={() => setMetric(m.id)}
              >{m.label}</button>
            ))}
          </div>
        </div>
        <div className="wb-profile-card">
          <ContributionHeatmap valueByDay={valueByDay} color="var(--wb-cat-green)" weeks={53} cellSize={9} gap={2} showMonths />
        </div>
      </section>

      {habits.length > 0 && (
        <section className="wb-profile-section">
          <h2 className="wb-profile-section-title">Habits</h2>
          {habits.map((r, i) => (
            <div key={r.id} className="wb-profile-card wb-profile-habit">
              <div className="wb-profile-habit-head">
                <span className="wb-profile-habit-title">{r.title}</span>
                <span className="wb-profile-habit-count">{r.completed_history.length}×</span>
              </div>
              <ContributionHeatmap
                valueByDay={historyByDay(r.completed_history)}
                color={WALLABY_COLORS[i % WALLABY_COLORS.length]}
                weeks={30}
                cellSize={9}
                gap={2}
              />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
