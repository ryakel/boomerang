import { useEffect } from 'react'
import { badgeSummary, stampEarnedBadges } from '../badges'
import './BadgesGrid.css'

// Shared, theme-agnostic achievements grid. Earned badges render in their tier
// color; locked ones are dimmed with a progress bar; HIDDEN badges render as
// mystery cards until earned. Earned state is stamped durably on first render
// where a badge qualifies (stampEarnedBadges — see Derived-Stat Durability
// Rules). Used in AnalyticsModal (all skins) + Wallaby Profile. Sorted
// earned-first, then closest-to-earning, mysteries last.
export default function BadgesGrid({ badges = [] }) {
  // Stamp any freshly-earned badges into durable settings.
  useEffect(() => { stampEarnedBadges(badges) }, [badges])

  if (!badges.length) return null
  const { earned, total } = badgeSummary(badges)
  const sorted = [...badges].sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1
    if (a.earned) return 0
    const aMystery = a.hidden ? 1 : 0
    const bMystery = b.hidden ? 1 : 0
    if (aMystery !== bMystery) return aMystery - bMystery
    return (b.current / b.target) - (a.current / a.target)
  })
  return (
    <div className="v2-badges">
      <div className="v2-badges-head">
        <span className="v2-badges-count">{earned}/{total} earned</span>
      </div>
      <div className="v2-badges-grid">
        {sorted.map(b => {
          if (b.hidden && !b.earned) {
            return (
              <div key={b.id} className="v2-badge v2-badge-mystery" title="Hidden achievement">
                <span className="v2-badge-emoji">❓</span>
                <span className="v2-badge-name">???</span>
                <span className="v2-badge-desc">Hidden — keep playing</span>
              </div>
            )
          }
          const pct = Math.min(100, Math.round((b.current / b.target) * 100))
          return (
            <div
              key={b.id}
              className={`v2-badge v2-badge-${b.tier}${b.earned ? ' is-earned' : ''}`}
              title={b.earned ? `${b.name} — earned${b.earnedOn ? ` ${b.earnedOn}` : ''}` : `${b.name}: ${b.current}/${b.target}`}
            >
              <span className="v2-badge-emoji">{b.emoji}</span>
              <span className="v2-badge-name">{b.name}</span>
              <span className="v2-badge-desc">{b.desc}</span>
              {b.earned
                ? <span className="v2-badge-earned-tag">{b.earnedOn ? `Earned ${b.earnedOn.slice(5).replace('-', '/')}` : 'Earned'}</span>
                : (
                  <span className="v2-badge-progress">
                    <span className="v2-badge-progress-fill" style={{ width: `${pct}%` }} />
                    <span className="v2-badge-progress-label">{b.current}/{b.target}</span>
                  </span>
                )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
