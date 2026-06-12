import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import './shell.css'
import './desktop.css'

const COLUMNS = [
  { id: 'not_started', label: 'Up next' },
  { id: 'doing', label: 'Doing' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'done', label: 'Done' },
]
const ACTIVE = ['not_started', 'doing', 'waiting', 'in_progress']

// Board view mode (K5) — desktop-only status columns with native drag-and-
// drop. Dragging a card to a column changes its status; dropping on Done
// catches it through the canonical completion handler (toast, points,
// undo — everything rides along). Kanban, demoted to a view mode.
export default function BoardView({ tasks = [], onStatusChange, onToggleComplete, onOpenTask }) {
  const [dragId, setDragId] = useState(null)
  const [overCol, setOverCol] = useState(null)

  const cols = useMemo(() => {
    const m = { not_started: [], doing: [], waiting: [], done: [] }
    for (const t of tasks) {
      if (t.status === 'done') { m.done.push(t); continue }
      if (t.status === 'in_progress' || t.status === 'doing') m.doing.push(t)
      else if (t.status === 'waiting') m.waiting.push(t)
      else if (t.status === 'not_started') m.not_started.push(t)
    }
    m.done = m.done
      .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))
      .slice(0, 15)
    return m
  }, [tasks])

  const handleDrop = (colId) => {
    setOverCol(null)
    if (!dragId) return
    const task = tasks.find(t => t.id === dragId)
    setDragId(null)
    if (!task || task.status === colId) return
    if (colId === 'done') {
      if (task.status !== 'done') onToggleComplete?.(task)
    } else if (task.status === 'done') {
      onToggleComplete?.(task) // reopen, then place
      if (colId !== 'not_started') onStatusChange?.(task.id, colId)
    } else {
      onStatusChange?.(task.id, colId)
    }
  }

  return (
    <div className="bm-board">
      {COLUMNS.map(col => (
        <div
          key={col.id}
          className={`bm-board-col${overCol === col.id ? ' is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOverCol(col.id) }}
          onDragLeave={() => setOverCol(o => (o === col.id ? null : o))}
          onDrop={() => handleDrop(col.id)}
        >
          <div className="bm-board-head">
            {col.label} <span className="bm-sec-n">{cols[col.id].length}</span>
          </div>
          <div className="bm-board-cards">
            {cols[col.id].map(t => (
              <div
                key={t.id}
                className={`bm-board-card${t.status === 'done' ? ' is-done' : ''}${dragId === t.id ? ' is-dragging' : ''}`}
                draggable
                onDragStart={() => setDragId(t.id)}
                onDragEnd={() => { setDragId(null); setOverCol(null) }}
                onClick={() => onOpenTask?.(t)}
              >
                {t.status === 'done' && <Check size={12} strokeWidth={3} className="bm-board-card-chk" />}
                <span className="bm-board-card-title">{t.title}</span>
                {t.high_priority && t.status !== 'done' && <span className="bm-board-hi">!</span>}
              </div>
            ))}
            {cols[col.id].length === 0 && <div className="bm-board-empty">Drop here</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

export { ACTIVE as BOARD_ACTIVE }
