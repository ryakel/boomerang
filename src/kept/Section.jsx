import { useCallback, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { loadSettings, saveSettings } from '../store'
import './shell.css'

// Collapsible Kept section header (v2's SectionLabel collapse, Kept-styled).
// Collapse state persists in settings.kept_collapsed (cross-device, same
// mechanism as v2's collapsed_sections).
export function useCollapsedSections() {
  const [map, setMap] = useState(() => loadSettings().kept_collapsed || {})
  const toggle = useCallback((id) => {
    setMap(prev => {
      const next = { ...prev, [id]: !prev[id] }
      saveSettings({ ...loadSettings(), kept_collapsed: next })
      return next
    })
  }, [])
  return [map, toggle]
}

export default function Section({ id, label, count, collapsed, onToggle, children }) {
  return (
    <>
      <button className="bm-sec bm-sec-toggle" onClick={() => onToggle(id)} aria-expanded={!collapsed}>
        <span className="bm-sec-tick" /> {label} <span className="bm-sec-n">{count}</span>
        <ChevronDown size={13} strokeWidth={2.5} className={`bm-sec-chev${collapsed ? ' is-collapsed' : ''}`} />
      </button>
      {!collapsed && children}
    </>
  )
}
