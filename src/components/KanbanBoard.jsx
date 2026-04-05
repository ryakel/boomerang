import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import './KanbanBoard.css'
import TaskCard from './TaskCard'

function AddCardInput({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const submit = () => {
    if (text.trim()) {
      onAdd(text.trim())
      setText('')
    }
    setOpen(false)
  }

  if (!open) {
    return (
      <div className="kanban-add-card">
        <button className="kanban-add-card-btn" onClick={() => setOpen(true)}>
          + Add a card
        </button>
      </div>
    )
  }

  return (
    <div className="kanban-add-card">
      <input
        ref={inputRef}
        className="kanban-add-card-input"
        placeholder="Enter a title..."
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setText(''); setOpen(false) }
        }}
        onBlur={submit}
      />
    </div>
  )
}

function KanbanColumn({ title, tasks, defaultStatus, onAddTask, onComplete, onSnooze, onEdit, onExtend, onStatusChange, onUpdate, onDelete, dragOverColumn, onDragOver, onDrop, onDragStart, draggingId }) {
  const acceptsDrop = !!defaultStatus
  return (
    <div
      className={`kanban-column${dragOverColumn === defaultStatus && acceptsDrop ? ' drag-over' : ''}`}
      onDragOver={acceptsDrop ? (e) => { e.preventDefault(); onDragOver(defaultStatus) } : undefined}
      onDragLeave={acceptsDrop ? () => onDragOver(null) : undefined}
      onDrop={acceptsDrop ? (e) => { e.preventDefault(); onDrop(defaultStatus) } : undefined}
    >
      <div className="kanban-column-header">
        {title}
        <span className="kanban-column-count">{tasks.length}</span>
      </div>
      <div className="kanban-column-body">
        {tasks.length === 0 && (
          <div className="kanban-column-empty">{dragOverColumn === defaultStatus && acceptsDrop ? 'Drop here' : 'No tasks'}</div>
        )}
        {tasks.map(t => (
          <div
            key={t.id}
            className={`kanban-card-wrapper${draggingId === t.id ? ' dragging' : ''}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move'
              onDragStart(t.id)
            }}
            onDragEnd={() => onDragStart(null)}
          >
            <TaskCard
              task={t}
              isDesktop
              onComplete={onComplete}
              onSnooze={onSnooze}
              onEdit={onEdit}
              onExtend={onExtend}
              onStatusChange={onStatusChange}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          </div>
        ))}
      </div>
      {defaultStatus && onAddTask && (
        <AddCardInput onAdd={(title) => onAddTask(title, defaultStatus)} />
      )}
    </div>
  )
}

export default function KanbanBoard({
  filteredDoing, filteredStale, filteredUpNext,
  filteredWaiting, filteredSnoozed, filteredBacklog,
  onComplete, onSnooze, onEdit, onExtend,
  onStatusChange, onUpdate, onDelete, onAddTask,
}) {
  const dragRef = useRef(null)
  const [dragOverColumn, setDragOverColumn] = useState(null)
  const [draggingId, setDraggingId] = useState(null)

  const handleDragStart = useCallback((taskId) => {
    dragRef.current = taskId
    setDraggingId(taskId)
  }, [])

  const handleDragOver = useCallback((status) => {
    setDragOverColumn(status)
  }, [])

  const handleDrop = useCallback((targetStatus) => {
    const taskId = dragRef.current
    dragRef.current = null
    setDragOverColumn(null)
    setDraggingId(null)
    if (!taskId || !targetStatus) return
    onStatusChange(taskId, targetStatus)
  }, [onStatusChange])

  // Redistribute stale tasks back into their status columns
  const { doing, upNext, waiting } = useMemo(() => {
    const staleDoing = filteredStale.filter(t => t.status === 'doing')
    const staleWaiting = filteredStale.filter(t => t.status === 'waiting')
    const staleUpNext = filteredStale.filter(t => t.status !== 'doing' && t.status !== 'waiting')

    return {
      doing: [...staleDoing, ...filteredDoing],
      upNext: [...staleUpNext, ...filteredUpNext],
      waiting: [...staleWaiting, ...filteredWaiting],
    }
  }, [filteredStale, filteredDoing, filteredUpNext, filteredWaiting])

  const callbacks = { onComplete, onSnooze, onEdit, onExtend, onStatusChange, onUpdate, onDelete, onAddTask }
  const dragCallbacks = { dragOverColumn, onDragOver: handleDragOver, onDrop: handleDrop, onDragStart: handleDragStart, draggingId }
  const isEmpty = doing.length === 0 && upNext.length === 0 && waiting.length === 0 &&
    filteredSnoozed.length === 0 && filteredBacklog.length === 0

  if (isEmpty) {
    return (
      <div className="kanban-board">
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="empty-state">
            No tasks yet.<br />Add one below to get started.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="kanban-board">
      <KanbanColumn title="Doing" tasks={doing} defaultStatus="doing" {...callbacks} {...dragCallbacks} />
      <KanbanColumn title="Up Next" tasks={upNext} defaultStatus="not_started" {...callbacks} {...dragCallbacks} />
      <KanbanColumn title="Waiting" tasks={waiting} defaultStatus="waiting" {...callbacks} {...dragCallbacks} />
      <KanbanColumn title="Snoozed" tasks={filteredSnoozed} {...callbacks} {...dragCallbacks} />
      <KanbanColumn title="Backlog" tasks={filteredBacklog} defaultStatus="backlog" {...callbacks} {...dragCallbacks} />
    </div>
  )
}
