import { FolderKanban, RotateCw, BookOpen, ChevronRight } from 'lucide-react'
import ModalShell from './ModalShell'
import './SpacesHub.css'

// Spaces tab destination (Standard / non-Wallaby UI). Hub of the three
// "not-today" surfaces: Projects, Routines, Knowledge. Each row is a
// tappable launcher that opens the existing dedicated modal — we don't
// embed the modals inline. Reason: ProjectsView and RoutinesModal both
// ship their own ModalShell, and refactoring them to render bodyless is
// more risk than reward for D. C-upgrade replaces this row list with rich
// preview cards (live session counts, last-edited timestamps, etc.)
// without changing the launcher contract — `useSpaces()` will feed
// the same hub a richer data shape.
//
// The Wallaby-native surfaces (Dashboard/Habits/Tasks/Goals) live in the
// WallabyShell, NOT here — they're reached via the Wallaby bottom nav. They
// used to be listed here as a fallback, but that leaked Wallaby views into the
// Standard theme's hub, so they were removed (the Wallaby gate must hold).
export default function SpacesHub({
  open, onClose,
  onOpenProjects, onOpenRoutines, onOpenKnowledge,
}) {
  const rows = [
    {
      key: 'projects',
      icon: FolderKanban,
      tint: 'projects',
      label: 'Projects',
      subtitle: 'Long-term work · pin to surface in Today',
      terminalCmd: '> projects',
      onClick: onOpenProjects,
    },
    {
      key: 'routines',
      icon: RotateCw,
      tint: 'routines',
      label: 'Routines',
      subtitle: 'Recurring tasks · cadence + spawn-now',
      terminalCmd: '> routines',
      onClick: onOpenRoutines,
    },
    {
      key: 'knowledge',
      icon: BookOpen,
      tint: 'knowledge',
      label: 'Knowledge',
      subtitle: 'Notion-backed reference · ask Quokka',
      terminalCmd: '> knowledge',
      onClick: onOpenKnowledge,
    },
  ]

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Spaces"
      subtitle="Long-term work, recurring tasks, and reference"
      width="narrow"
    >
      <ul className="v2-spaces-list">
        {rows.map(r => {
          const Icon = r.icon
          return (
            <li key={r.key}>
              <button
                type="button"
                className="v2-spaces-row"
                onClick={() => { onClose(); r.onClick?.() }}
              >
                <Icon size={22} strokeWidth={1.75} className={`v2-spaces-row-icon v2-spaces-row-icon-${r.tint}`} />
                <span className="v2-spaces-row-text">
                  <span className="v2-spaces-row-label">{r.label}</span>
                  <span className="v2-spaces-row-subtitle">{r.subtitle}</span>
                </span>
                <ChevronRight size={18} strokeWidth={1.75} className="v2-spaces-row-chev" />
              </button>
            </li>
          )
        })}
      </ul>
    </ModalShell>
  )
}
