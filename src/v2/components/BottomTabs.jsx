import { ListChecks, FolderKanban } from 'lucide-react'
import './BottomTabs.css'

// Mobile-only bottom tab bar. Two tabs: Today (default) and Spaces.
// Desktop intentionally skipped — it has the Kanban + side drawer
// pattern, doesn't need bottom chrome eating screen height.
//
// Terminal-theme styling lives in src/v2/terminal/tabs.css — lucide
// SVGs hide, labels become `[ today ]` bracketed mono.
export default function BottomTabs({ activeTab, onTabChange }) {
  return (
    <nav className="v2-bottom-tabs" role="tablist" aria-label="Primary navigation">
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'today'}
        className={`v2-bottom-tab${activeTab === 'today' ? ' is-active' : ''}`}
        onClick={() => onTabChange('today')}
      >
        <span className="v2-bottom-tab-icon-wrap">
          <ListChecks size={22} strokeWidth={1.75} className="v2-bottom-tab-icon" aria-hidden="true" />
        </span>
        <span className="v2-bottom-tab-label" data-terminal-label="today">Today</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={activeTab === 'spaces'}
        className={`v2-bottom-tab${activeTab === 'spaces' ? ' is-active' : ''}`}
        onClick={() => onTabChange('spaces')}
      >
        <span className="v2-bottom-tab-icon-wrap">
          <FolderKanban size={22} strokeWidth={1.75} className="v2-bottom-tab-icon" aria-hidden="true" />
        </span>
        <span className="v2-bottom-tab-label" data-terminal-label="spaces">Spaces</span>
      </button>
    </nav>
  )
}
