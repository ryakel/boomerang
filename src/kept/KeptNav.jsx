import { IconToday, IconLoops, IconTasks, IconMore } from './icons'
import './shell.css'

// Kept bottom nav: Today · Tasks · [Throw] · Loops · More (spec §6; Tasks
// and Loops swapped 2026-06-11 per user preference — Tasks is the higher-
// frequency destination, it sits next to Today).
// One accent — active tabs go gold with a dot, never per-tab colors.
const LEFT = [
  { id: 'today', label: 'Today', icon: IconToday },
  { id: 'tasks', label: 'Tasks', icon: IconTasks },
]
const RIGHT = [
  { id: 'loops', label: 'Loops', icon: IconLoops },
  { id: 'more', label: 'More', icon: IconMore },
]

function Tab({ t, active, onChange }) {
  const Icon = t.icon
  return (
    <button
      role="tab"
      aria-selected={active}
      className={`bm-nav-tab${active ? ' is-active' : ''}`}
      onClick={() => onChange(t.id)}
    >
      <Icon size={21} strokeWidth={active ? 2.3 : 1.9} />
      <span className="bm-nav-label">{t.label}</span>
      <span className="bm-nav-dot" aria-hidden="true" />
    </button>
  )
}

export default function KeptNav({ active, onChange, onThrow }) {
  return (
    <nav className="bm-nav" role="tablist" aria-label="Primary">
      {LEFT.map(t => <Tab key={t.id} t={t} active={active === t.id} onChange={onChange} />)}
      <div className="bm-throw-slot">
        <button className="bm-throw" onClick={onThrow} aria-label="Throw a task">
          <svg width="26" height="26" viewBox="0 0 100 100" fill="none" aria-hidden="true">
            <path d="M 22 52 C 30 18, 70 18, 78 52" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
            <circle cx="78" cy="52" r="8" fill="currentColor" />
            <path d="M 30 70 C 42 82, 58 82, 70 70" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity="0.6" />
          </svg>
        </button>
      </div>
      {RIGHT.map(t => <Tab key={t.id} t={t} active={active === t.id} onChange={onChange} />)}
    </nav>
  )
}
