import { useEffect, useRef } from 'react'
import { Settings as SettingsIcon, BarChart3, History, CheckCircle2, Lightbulb, ChevronRight } from 'lucide-react'
import './SystemMenu.css'

// Anchored popover off the header ⚙ icon. Hosts the low-frequency
// system surfaces (Settings, Analytics, Done, Suggestions, Activity
// log). The brand popover already exposes Analytics + Done via the
// wordmark — we surface them here too so the gear menu is a complete
// system index, not "everything except the random two."
//
// Positioned `position: fixed` top-right rather than absolute-inside-
// header because AppV2 owns the open state; rendering inside Header.jsx
// would force the system-menu wiring to pass through Header props.
export default function SystemMenu({
  open, onClose,
  onOpenSettings, onOpenAnalytics, onOpenDone, onOpenSuggestions, onOpenActivityLog,
  hasSuggestions = false,
}) {
  const panelRef = useRef(null)

  // Tap outside closes. Wired at document level; ignores clicks inside
  // the panel or on the originating gear button (which has its own
  // toggle handler).
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => {
      if (panelRef.current?.contains(e.target)) return
      // The ⚙ button has aria-label="More" — let its onClick handle close.
      if (e.target.closest?.('[data-system-menu-anchor]')) return
      onClose()
    }
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDocClick)
      document.addEventListener('touchstart', onDocClick)
    }, 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('touchstart', onDocClick)
    }
  }, [open, onClose])

  if (!open) return null

  const rows = [
    {
      key: 'settings',
      icon: SettingsIcon,
      label: 'Settings',
      terminalCmd: '> settings',
      onClick: onOpenSettings,
      tint: 'settings',
    },
    {
      key: 'analytics',
      icon: BarChart3,
      label: 'Analytics',
      terminalCmd: '> stats',
      onClick: onOpenAnalytics,
      tint: 'analytics',
    },
    {
      key: 'done',
      icon: CheckCircle2,
      label: 'Done',
      terminalCmd: '> done',
      onClick: onOpenDone,
      tint: 'done',
    },
    {
      key: 'suggestions',
      icon: Lightbulb,
      label: 'Suggestions',
      terminalCmd: '> suggestions',
      onClick: onOpenSuggestions,
      tint: 'suggestions',
      badge: hasSuggestions,
    },
    {
      key: 'activity',
      icon: History,
      label: 'Activity log',
      terminalCmd: '> log',
      onClick: onOpenActivityLog,
      tint: 'activity',
    },
  ]

  return (
    <div ref={panelRef} className="v2-system-menu" role="menu" aria-label="System">
      <ul className="v2-system-menu-list">
        {rows.map(r => {
          const Icon = r.icon
          return (
            <li key={r.key}>
              <button
                type="button"
                role="menuitem"
                className="v2-system-menu-row"
                onClick={() => { onClose(); r.onClick?.() }}
              >
                <Icon size={18} strokeWidth={1.75} className={`v2-system-menu-icon v2-system-menu-icon-${r.tint}`} />
                <span className="v2-system-menu-label" data-terminal-cmd={r.terminalCmd}>{r.label}</span>
                {r.badge && <span className="v2-system-menu-badge" aria-label="New" />}
                <ChevronRight size={16} strokeWidth={1.75} className="v2-system-menu-chev" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
