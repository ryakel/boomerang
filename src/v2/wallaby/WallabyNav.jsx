import { Home, Activity, ListTodo, Sparkles, Menu } from 'lucide-react'
import './WallabyNav.css'

// Wallaby bottom nav: Home · Habits · Tasks · Quokka · More. Quokka is an
// action (opens the adviser), not a destination tab. (Timer + Packages live in
// the More menu.)
const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'habits', label: 'Habits', icon: Activity },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'quokka', label: 'Quokka', icon: Sparkles, action: true },
  { id: 'more', label: 'More', icon: Menu },
]

export default function WallabyNav({ active, onChange, onQuokka }) {
  return (
    <nav className="wb-nav" role="tablist" aria-label="Primary">
      {TABS.map(t => {
        const Icon = t.icon
        const on = !t.action && active === t.id
        return (
          <button
            key={t.id}
            role={t.action ? undefined : 'tab'}
            aria-selected={t.action ? undefined : on}
            className={`wb-nav-tab${on ? ' is-active' : ''}${t.action ? ' wb-nav-tab-action' : ''}`}
            onClick={() => (t.action ? onQuokka?.() : onChange(t.id))}
          >
            <Icon size={22} strokeWidth={on ? 2.4 : 1.9} className="wb-nav-icon" />
            <span className="wb-nav-label">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
