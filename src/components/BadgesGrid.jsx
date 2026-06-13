import { useEffect, useState } from 'react'
import { X, Check } from 'lucide-react'
import { badgeSummary, stampEarnedBadges } from '../badges'
import './BadgesGrid.css'

const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' }

// Format a stored 'YYYY-MM-DD' earn date as M/D.
function fmtEarned(on) {
  if (!on) return ''
  const [, m, d] = on.split('-')
  return `${Number(m)}/${Number(d)}`
}

// Detail overlay — opens on tap. Earned badges show the date + tier; locked
// ones show progress and, when the badge tracks a set of discrete pieces
// (e.g. Balanced Diet's energy types), a done/outstanding checklist.
function BadgeDetail({ badge, onClose }) {
  if (!badge) return null
  const mystery = badge.hidden && !badge.earned
  const remaining = Math.max(0, (badge.target || 0) - (badge.current || 0))
  const pct = badge.target ? Math.min(100, Math.round((badge.current / badge.target) * 100)) : 0
  return (
    <div className="v2-badge-detail-overlay" onClick={onClose}>
      <div
        className={`v2-badge-detail v2-badge-${badge.tier}${badge.earned ? ' is-earned' : ''}`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={mystery ? 'Hidden achievement' : badge.name}
      >
        <button className="v2-badge-detail-close" onClick={onClose} aria-label="Close"><X size={16} strokeWidth={2} /></button>
        <span className="v2-badge-detail-emoji">{mystery ? '❓' : badge.emoji}</span>
        <h3 className="v2-badge-detail-name">{mystery ? '???' : badge.name}</h3>
        {!mystery && (
          <span className={`v2-badge-tier-chip v2-badge-tier-${badge.tier}`}>{TIER_LABEL[badge.tier] || badge.tier}</span>
        )}
        <p className="v2-badge-detail-desc">{mystery ? 'A hidden achievement — keep playing to reveal it.' : badge.desc}</p>

        {!mystery && (badge.earned ? (
          <div className="v2-badge-detail-earned">
            ✓ Earned{badge.earnedOn ? ` ${fmtEarned(badge.earnedOn)}` : ''}
          </div>
        ) : (
          <div className="v2-badge-detail-progress-wrap">
            <div className="v2-badge-detail-bar">
              <span className="v2-badge-detail-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="v2-badge-detail-count">
              <b>{badge.current}</b> of <b>{badge.target}</b>
              {remaining > 0 && <span className="v2-badge-detail-togo"> · {remaining} to go</span>}
            </div>
            {Array.isArray(badge.checklist) && badge.checklist.length > 0 && (
              <div className="v2-badge-checklist">
                {badge.checklistTitle && <div className="v2-badge-checklist-title">{badge.checklistTitle}</div>}
                <ul>
                  {badge.checklist.map((item, i) => (
                    <li key={i} className={item.done ? 'is-done' : ''}>
                      <span className="v2-badge-checklist-mark">{item.done ? <Check size={12} strokeWidth={3} /> : ''}</span>
                      {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// Shared, theme-agnostic achievements grid. Earned badges render in their tier
// color; locked ones are dimmed with a progress bar; HIDDEN badges render as
// mystery cards until earned. Tap any card for a detail overlay. Earned state
// is stamped durably on first render where a badge qualifies (stampEarnedBadges
// — see Derived-Stat Durability Rules). Used in AnalyticsModal (all skins) +
// Wallaby Profile. Sorted earned-first, then closest-to-earning, mysteries last.
export default function BadgesGrid({ badges = [] }) {
  const [selected, setSelected] = useState(null)
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
        {/* Tier legend — the card tints are bronze / silver / gold by prestige. */}
        <div className="v2-badges-legend" aria-label="Tier colors">
          <span className="v2-badges-legend-item"><i className="v2-badge-swatch v2-swatch-bronze" /> Bronze</span>
          <span className="v2-badges-legend-item"><i className="v2-badge-swatch v2-swatch-silver" /> Silver</span>
          <span className="v2-badges-legend-item"><i className="v2-badge-swatch v2-swatch-gold" /> Gold</span>
        </div>
        <span className="v2-badges-count">{earned}/{total} earned</span>
      </div>
      <div className="v2-badges-grid">
        {sorted.map(b => {
          const mystery = b.hidden && !b.earned
          const pct = Math.min(100, Math.round((b.current / b.target) * 100))
          return (
            <button
              key={b.id}
              type="button"
              className={`v2-badge v2-badge-${b.tier}${b.earned ? ' is-earned' : ''}${mystery ? ' v2-badge-mystery' : ''}`}
              onClick={() => setSelected(b)}
              aria-label={mystery ? 'Hidden achievement' : `${b.name} — ${b.earned ? 'earned' : `${b.current} of ${b.target}`}`}
            >
              <span className="v2-badge-emoji">{mystery ? '❓' : b.emoji}</span>
              <span className="v2-badge-name">{mystery ? '???' : b.name}</span>
              <span className="v2-badge-desc">{mystery ? 'Hidden — keep playing' : b.desc}</span>
              {!mystery && (b.earned
                ? <span className="v2-badge-earned-tag">{b.earnedOn ? `Earned ${fmtEarned(b.earnedOn)}` : 'Earned'}</span>
                : (
                  <span className="v2-badge-progress">
                    <span className="v2-badge-progress-fill" style={{ width: `${pct}%` }} />
                    <span className="v2-badge-progress-label">{b.current}/{b.target}</span>
                  </span>
                ))}
            </button>
          )
        })}
      </div>
      {selected && <BadgeDetail badge={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
