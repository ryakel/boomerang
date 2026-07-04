import { ChevronRight, BarChart3, Package, Settings, FolderKanban, CheckCircle2, ScrollText, Sprout } from 'lucide-react'
import './shell.css'

// Kept "More" — the low-frequency surfaces. Arcs (projects) routes to the
// existing ProjectsView; Flight log (profile) arrives with K5's dashboard.
// Loop suggestions moved to a Sparkles button on the Loops surface
// (2026-06-11) — suggestions are about loops, they live with loops.
export default function MoreView({ onOpenProjects, onOpenAnalytics, onOpenPackages, onOpenDone, onOpenActivity, onOpenSettings, onOpenGrowthAreas }) {
  const rows = [
    { icon: FolderKanban, label: 'Arcs', sub: 'Long-term projects · sessions + steps', onClick: onOpenProjects },
    { icon: BarChart3, label: 'Analytics', sub: 'Productivity insights', onClick: onOpenAnalytics },
    { icon: CheckCircle2, label: 'Caught', sub: 'Everything you finished', onClick: onOpenDone },
    { icon: Package, label: 'Packages', sub: 'Track deliveries', onClick: onOpenPackages },
    { icon: Sprout, label: 'Growth areas', sub: 'Standing reminders about yourself', onClick: onOpenGrowthAreas },
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
