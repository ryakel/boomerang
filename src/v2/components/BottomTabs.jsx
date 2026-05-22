import { ListChecks, FolderKanban } from 'lucide-react'
import './BottomTabs.css'

// Mobile-only bottom tab bar. Two tabs: Today (default) and Spaces.
// Desktop intentionally skipped — it has the Kanban + side drawer
// pattern, doesn't need bottom chrome eating screen height.
//
// `spacesBadge` is a presence boolean (not a counter) sourced from
// useSpaces().wantsAttention — a dot if a pinned project has drifted
// past the stale threshold OR any other future signal worth pinging.
// Counter would invite "I have 4 stale projects, that's bad" anxiety;
// a dot is "hey, peek in here."
//
// Terminal-theme styling lives in src/v2/terminal/tabs.css — lucide
// SVGs hide, labels become `[ today ]` bracketed mono, badge renders
// as a small `•` glyph to the right of the active label.
export default function BottomTabs({ activeTab, onTabChange, spacesBadge = false }) {
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
        aria-label={spacesBadge ? 'Spaces (attention needed)' : 'Spaces'}
        className={`v2-bottom-tab${activeTab === 'spaces' ? ' is-active' : ''}${spacesBadge ? ' has-badge' : ''}`}
        onClick={() => onTabChange('spaces')}
      >
        <span className="v2-bottom-tab-icon-wrap">
          <FolderKanban size={22} strokeWidth={1.75} className="v2-bottom-tab-icon" aria-hidden="true" />
        </span>
        <span className="v2-bottom-tab-label" data-terminal-label="spaces">Spaces</span>
        {spacesBadge && <span className="v2-bottom-tab-badge" aria-hidden="true" />}
      </button>
    </nav>
  )
}
