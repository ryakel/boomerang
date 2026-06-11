import { ChevronRight, BarChart3, Package, Settings, FolderKanban, CheckCircle2, ScrollText, Inbox } from 'lucide-react'
import './shell.css'

// Kept "More" — the low-frequency surfaces. Arcs (projects) routes to the
// existing ProjectsView; Flight log (profile) arrives with K5's dashboard.
export default function MoreView({ onOpenProjects, onOpenAnalytics, onOpenPackages, onOpenDone, onOpenActivity, onOpenSuggestions, onOpenSettings }) {
  const rows = [
    { icon: FolderKanban, label: 'Arcs', sub: 'Long-term projects · sessions + steps', onClick: onOpenProjects },
    { icon: BarChart3, label: 'Analytics', sub: 'Productivity insights', onClick: onOpenAnalytics },
    { icon: CheckCircle2, label: 'Caught', sub: 'Everything you finished', onClick: onOpenDone },
    { icon: Package, label: 'Packages', sub: 'Track deliveries', onClick: onOpenPackages },
    { icon: Inbox, label: 'Loop suggestions', sub: 'Recurring patterns spotted in your tasks', onClick: onOpenSuggestions },
    { icon: ScrollText, label: 'Activity log', sub: 'Every change, restorable', onClick: onOpenActivity },
    { icon: Settings, label: 'Settings', sub: 'App configuration', onClick: onOpenSettings },
  ]
  return (
    <div className="bm-surface">
      <div className="bm-title-row"><h1 className="bm-h1">More</h1></div>
      <div className="bm-rows">
        {rows.map(r => {
          const Icon = r.icon
          return (
            <button key={r.label} className="bm-more-row" onClick={r.onClick}>
              <span className="bm-more-icon"><Icon size={17} strokeWidth={2} /></span>
              <span style={{ flex: '1 1 auto', minWidth: 0 }}>
                <span className="bm-more-label">{r.label}</span>
                <div className="bm-more-sub">{r.sub}</div>
              </span>
              <ChevronRight size={17} strokeWidth={1.75} className="bm-more-chev" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
