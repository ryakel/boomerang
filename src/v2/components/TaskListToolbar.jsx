import { useEffect, useRef, useState } from 'react'
import { ArrowUpDown } from 'lucide-react'
import './TaskListToolbar.css'

const SORT_OPTIONS = [
  { value: 'age', label: 'Age' },
  { value: 'due_date', label: 'Due date' },
  { value: 'size', label: 'Size' },
  { value: 'name', label: 'Name' },
]

export default function TaskListToolbar({
  labels,
  routinesCount,
  activeFilter,
  onFilterChange,
  onOpenRoutines,
  sortBy,
  onSortChange,
}) {
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef(null)

  useEffect(() => {
    if (!sortOpen) return
    const handleClick = (e) => {
      if (sortRef.current && !sortRef.current.contains(e.target)) setSortOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [sortOpen])

  const handleSortPick = (value) => {
    onSortChange(value)
    setSortOpen(false)
  }

  return (
    <div className="v2-toolbar">
      <div className="v2-toolbar-pills" role="tablist" aria-label="Filter tasks">
        <button
          className={`v2-toolbar-pill${activeFilter === 'all' ? ' v2-toolbar-pill-active' : ''}`}
          onClick={() => onFilterChange('all')}
          role="tab"
          aria-selected={activeFilter === 'all'}
        >
          All
        </button>
        {labels.map(label => {
          const active = activeFilter === label.id
          return (
            <button
              key={label.id}
              className={`v2-toolbar-pill${active ? ' v2-toolbar-pill-active' : ''}`}
              onClick={() => onFilterChange(label.id)}
              style={active ? { background: label.color, borderColor: label.color, color: '#fff' } : {}}
              role="tab"
              aria-selected={active}
            >
              {label.name.charAt(0).toUpperCase() + label.name.slice(1)}
            </button>
          )
        })}
        <button
          className="v2-toolbar-pill v2-toolbar-pill-routines"
          onClick={onOpenRoutines}
          title="Open routines"
        >
          Routines{routinesCount > 0 ? ` · ${routinesCount}` : ''}
        </button>
      </div>
      <div className="v2-toolbar-sort" ref={sortRef}>
        <button
          className="v2-toolbar-sort-btn"
          onClick={() => setSortOpen(o => !o)}
          title={`Sort: ${SORT_OPTIONS.find(o => o.value === sortBy)?.label || 'Age'}`}
          aria-haspopup="menu"
          aria-expanded={sortOpen}
        >
          <ArrowUpDown size={14} strokeWidth={1.75} />
        </button>
        {sortOpen && (
          <div className="v2-toolbar-sort-menu" role="menu">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`v2-toolbar-sort-option${sortBy === opt.value ? ' v2-toolbar-sort-option-active' : ''}`}
                onClick={() => handleSortPick(opt.value)}
                role="menuitemradio"
                aria-checked={sortBy === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
