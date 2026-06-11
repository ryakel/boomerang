import { Home, Repeat2, ListTodo, MoreHorizontal } from 'lucide-react'
import './shell.css'

// Kept bottom nav: Today · Loops · [Throw] · Tasks · More (spec §6).
// One accent — active tabs go gold with a dot, never per-tab colors.
const LEFT = [
  { id: 'today', label: 'Today', icon: Home },
  { id: 'loops', label: 'Loops', icon: Repeat2 },
]
const RIGHT = [
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'more', label: 'More', icon: MoreHorizontal },
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
