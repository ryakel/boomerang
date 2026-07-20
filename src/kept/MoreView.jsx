import { ChevronRight, Package, Settings, FolderKanban, StickyNote } from 'lucide-react'
import './shell.css'

// Kept "More" — the low-frequency spaces, pruned to four (2026-07-19
// consolidation: "More is really fucking full"). Everything that already had
// a home elsewhere left: What now? lives on Today, Analytics on the header
// avatar, Caught inside Analytics (Overview → Caught), Activity log inside
// Settings → Data, Growth areas inside the Notebook. Loop suggestions moved
// to a Sparkles button on the Loops surface earlier (2026-06-11).
export default function MoreView({ onOpenProjects, onOpenPackages, onOpenSettings, onOpenNotes }) {
  const rows = [
    { icon: StickyNote, label: 'Notebook', sub: 'Notes + growth areas · pin to Today', onClick: onOpenNotes },
    { icon: FolderKanban, label: 'Arcs', sub: 'Long-term projects · sessions + steps', onClick: onOpenProjects },
    { icon: Package, label: 'Packages', sub: 'Track deliveries', onClick: onOpenPackages },
    { icon: Settings, label: 'Settings', sub: 'App configuration · activity log in Data', onClick: onOpenSettings },
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
