import { Home, Activity, Sparkles, ListTodo, Menu } from 'lucide-react'
import './WallabyNav.css'

// Wallaby bottom nav: Home · Habits · Quokka · Tasks · More. Quokka is its own
// page (the adviser). (Timer + Packages live in the More menu.)
const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'habits', label: 'Habits', icon: Activity },
  { id: 'quokka', label: 'Quokka', icon: Sparkles },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
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
