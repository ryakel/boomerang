import { ListChecks, FolderKanban, Plus, Compass } from 'lucide-react'
import './BottomTabs.css'

export default function BottomTabs({ activeTab, onTabChange, onAdd, onWhatNow }) {
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
        className="v2-bottom-tab v2-bottom-tab-action"
        onClick={onAdd}
        aria-label="New task"
      >
        <span className="v2-bottom-tab-icon-wrap v2-bottom-tab-action-icon">
          <Plus size={22} strokeWidth={2} className="v2-bottom-tab-icon" aria-hidden="true" />
        </span>
        <span className="v2-bottom-tab-label" data-terminal-label="new">New</span>
      </button>
      <button
        type="button"
        className="v2-bottom-tab v2-bottom-tab-action"
        onClick={onWhatNow}
        aria-label="What can I do now?"
      >
        <span className="v2-bottom-tab-icon-wrap v2-bottom-tab-action-icon">
          <Compass size={22} strokeWidth={1.75} className="v2-bottom-tab-icon" aria-hidden="true" />
        </span>
        <span className="v2-bottom-tab-label" data-terminal-label="what now">What now</span>
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
