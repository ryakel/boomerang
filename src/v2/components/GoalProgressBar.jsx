import './GoalProgressBar.css'

// Bottom-of-list progress bar. Shows how close the user is to their
// `daily_task_goal` for today. Opt-in via `show_goal_progress`.
// Theme-aware: pill-shape filled bar in light/dark, monospace
// block-character bar in terminal (CSS-only difference).
//
// At-goal vs above-goal: bar fills 100% at goal, then a thin amber
// "stretch" segment past 100% indicates over-achievement.

export default function GoalProgressBar({ tasksToday, goal }) {
  const safeGoal = goal > 0 ? goal : 3
  const fraction = safeGoal > 0 ? tasksToday / safeGoal : 0
  const pct = Math.min(100, Math.round(fraction * 100))
  const overshoot = fraction > 1
  const overshootPct = overshoot ? Math.min(100, Math.round((fraction - 1) * 100)) : 0

  return (
    <div className="v2-goal-progress" role="progressbar" aria-valuenow={tasksToday} aria-valuemin={0} aria-valuemax={safeGoal}>
      <div className="v2-goal-progress-track">
        <div
          className="v2-goal-progress-fill"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
        {overshoot && (
          <div
            className="v2-goal-progress-overshoot"
            style={{ width: `${overshootPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="v2-goal-progress-meta">
        <span className="v2-goal-progress-caption">Goal: {safeGoal} task{safeGoal === 1 ? '' : 's'}</span>
        <span className="v2-goal-progress-count">
          {tasksToday}/{safeGoal} <span className="v2-goal-progress-pct">· {pct}%</span>
        </span>
      </div>
    </div>
  )
}
