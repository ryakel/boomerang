import { Home, Activity, ListTodo, Timer, Menu } from 'lucide-react'
import './WallabyNav.css'

// Wallaby bottom nav (loggd IA): Home · Habits · Tasks · Timer · More.
const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'habits', label: 'Habits', icon: Activity },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'timer', label: 'Timer', icon: Timer },
  { id: 'more', label: 'More', icon: Menu },
]

export default function WallabyNav({ active, onChange }) {
  return (
    <nav className="wb-nav" role="tablist" aria-label="Primary">
      {TABS.map(t => {
        const Icon = t.icon
        const on = active === t.id
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            className={`wb-nav-tab${on ? ' is-active' : ''}`}
            onClick={() => onChange(t.id)}
          >
            <Icon size={22} strokeWidth={on ? 2.4 : 1.9} className="wb-nav-icon" />
            <span className="wb-nav-label">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
