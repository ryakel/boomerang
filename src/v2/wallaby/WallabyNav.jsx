import { Home, Activity, Sparkles, ListTodo, Menu } from 'lucide-react'
import './WallabyNav.css'

// Wallaby bottom nav: Home · Habits · Quokka · Tasks · More. Quokka is its own
// page (the adviser). (Timer + Packages live in the More menu.)
// Each tab lights up its own color when active (not a single shared accent).
const TABS = [
  { id: 'home', label: 'Home', icon: Home, color: 'var(--wb-cat-blue)' },
  { id: 'habits', label: 'Habits', icon: Activity, color: 'var(--wb-cat-green)' },
  { id: 'quokka', label: 'Quokka', icon: Sparkles, color: 'var(--wb-cat-purple)' },
  { id: 'tasks', label: 'Tasks', icon: ListTodo, color: 'var(--wb-cat-orange)' },
  { id: 'more', label: 'More', icon: Menu, color: 'var(--wb-cat-pink)' },
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
            style={{ '--nav-color': t.color }}
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
