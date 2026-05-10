import { useMemo, useState, useRef, useCallback, useEffect } from 'react'
import { Plus } from 'lucide-react'
import TaskCard from './TaskCard'
import './KanbanBoard.css'

function AddCardInline({ onAdd, status }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const submit = () => {
    if (text.trim()) {
      onAdd(text.trim(), status)
      setText('')
    }
    setOpen(false)
  }

  if (!open) {
    return (
      <button className="v2-kanban-add-btn" onClick={() => setOpen(true)}>
        <Plus size={13} strokeWidth={2} /> Add task
      </button>
    )
  }
  return (
    <input
      ref={inputRef}
      className="v2-kanban-add-input"
      placeholder="Title…"
      value={text}
      onChange={e => setText(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') submit()
        if (e.key === 'Escape') { setText(''); setOpen(false) }
      }}
      onBlur={submit}
    />
  )
}

function KanbanColumn({
  title, sigil, tasks, defaultStatus, onAddTask,
  dragOverColumn, onDragOver, onDrop, onDragStart, draggingId,
  expandedTaskId, onToggleExpand, onComplete, onEdit, onSnooze, onSkipAdvance, weatherByDate,
  selectedTaskId, routineStreaks,
}) {
  const acceptsDrop = !!defaultStatus
  const isDropTarget = dragOverColumn === defaultStatus && acceptsDrop

  return (
    <section
      className={`v2-kanban-col${isDropTarget ? ' v2-kanban-col-over' : ''}`}
      onDragOver={acceptsDrop ? (e) => { e.preventDefault(); onDragOver(defaultStatus) } : undefined}
      onDragLeave={acceptsDrop ? () => onDragOver(null) : undefined}
      onDrop={acceptsDrop ? (e) => { e.preventDefault(); onDrop(defaultStatus) } : undefined}
    >
      <div className="v2-kanban-col-head">
        <span className="v2-kanban-col-title" data-sigil={sigil || '✦'}>{title}</span>
        {tasks.length > 0 && <span className="v2-kanban-col-count">{tasks.length}</span>}
      </div>
      <div className="v2-kanban-col-body">
        {tasks.length === 0 && (
          <div className="v2-kanban-col-empty">
            {isDropTarget ? 'Drop here' : 'Empty'}
          </div>
        )}
        {tasks.map(t => (
          <div
            key={t.id}
            className={`v2-kanban-card-wrap${draggingId === t.id ? ' v2-kanban-card-wrap-dragging' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              onDragStart(t.id)
            }}
            onDragEnd={() => onDragStart(null)}
          >
            <TaskCard
              task={t}
              expanded={expandedTaskId === t.id}
              onToggleExpand={onToggleExpand}
              onComplete={onComplete}
              onEdit={onEdit}
              onSnooze={onSnooze}
              onSkipAdvance={onSkipAdvance}
              weatherByDate={weatherByDate}
              selected={selectedTaskId === t.id}
              routineStreaks={routineStreaks}
            />
          </div>
        ))}
      </div>
      {defaultStatus && onAddTask && (
        <AddCardInline onAdd={onAddTask} status={defaultStatus} />
      )}
    </section>
  )
}

export default function KanbanBoard({
  doingTasks, staleTasks, upNextTasks, waitingTasks, snoozedTasks, backlogTasks, projectTasks,
  onAddTask, onStatusChange,
  expandedTaskId, onToggleExpand, onComplete, onEdit, onSnooze, onSkipAdvance, weatherByDate,
  selectedTaskId, routineStreaks,
}) {
  const dragRef = useRef(null)
  const [dragOverColumn, setDragOverColumn] = useState(null)
  const [draggingId, setDraggingId] = useState(null)

  const handleDragStart = useCallback((taskId) => {
    dragRef.current = taskId
    setDraggingId(taskId)
  }, [])

  const handleDragOver = useCallback((status) => setDragOverColumn(status), [])

  const handleDrop = useCallback((targetStatus) => {
    const taskId = dragRef.current
    dragRef.current = null
    setDragOverColumn(null)
    setDraggingId(null)
    if (!taskId || !targetStatus) return
    onStatusChange(taskId, targetStatus)
  }, [onStatusChange])

  // Same redistribution v1 does: stale tasks fold back into their actual
  // status column instead of getting their own bucket — desktop has the
  // horizontal real estate for the natural status grouping.
  const { doing, upNext, waiting } = useMemo(() => {
    const staleDoing = staleTasks.filter(t => t.status === 'doing')
    const staleWaiting = staleTasks.filter(t => t.status === 'waiting')
    const staleOther = staleTasks.filter(t => t.status !== 'doing' && t.status !== 'waiting')
    return {
      doing: [...staleDoing, ...doingTasks],
      upNext: [...staleOther, ...upNextTasks],
      waiting: [...staleWaiting, ...waitingTasks],
    }
  }, [staleTasks, doingTasks, upNextTasks, waitingTasks])

  const dragCallbacks = { dragOverColumn, onDragOver: handleDragOver, onDrop: handleDrop, onDragStart: handleDragStart, draggingId }
  const cardCallbacks = { expandedTaskId, onToggleExpand, onComplete, onEdit, onSnooze, onSkipAdvance, weatherByDate, selectedTaskId, routineStreaks }

  return (
    <div className="v2-kanban">
      <KanbanColumn title="Doing" sigil="→" tasks={doing} defaultStatus="doing" onAddTask={onAddTask} {...dragCallbacks} {...cardCallbacks} />
      <KanbanColumn title="Up next" sigil="+" tasks={upNext} defaultStatus="not_started" onAddTask={onAddTask} {...dragCallbacks} {...cardCallbacks} />
      <KanbanColumn title="Waiting" sigil="…" tasks={waiting} defaultStatus="waiting" onAddTask={onAddTask} {...dragCallbacks} {...cardCallbacks} />
      <KanbanColumn title="Snoozed" sigil="z" tasks={snoozedTasks} {...dragCallbacks} {...cardCallbacks} />
      <KanbanColumn title="Backlog" sigil="≈" tasks={backlogTasks} defaultStatus="backlog" {...dragCallbacks} {...cardCallbacks} />
      <KanbanColumn title="Projects" sigil="§" tasks={projectTasks} defaultStatus="project" {...dragCallbacks} {...cardCallbacks} />
    </div>
  )
}
