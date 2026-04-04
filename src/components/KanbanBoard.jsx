import { useMemo } from 'react'
import TaskCard from './TaskCard'

function KanbanColumn({ title, tasks, onComplete, onSnooze, onEdit, onExtend, onStatusChange, onUpdate, onDelete }) {
  return (
    <div className="kanban-column">
      <div className="kanban-column-header">
        {title}
        <span className="kanban-column-count">{tasks.length}</span>
      </div>
      <div className="kanban-column-body">
        {tasks.length === 0 && (
          <div className="kanban-column-empty">No tasks</div>
        )}
        {tasks.map(t => (
          <TaskCard
            key={t.id}
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
        ))}
      </div>
    </div>
  )
}

export default function KanbanBoard({
  filteredDoing, filteredStale, filteredUpNext,
  filteredWaiting, filteredSnoozed, filteredBacklog,
  onComplete, onSnooze, onEdit, onExtend,
  onStatusChange, onUpdate, onDelete,
}) {
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

  const callbacks = { onComplete, onSnooze, onEdit, onExtend, onStatusChange, onUpdate, onDelete }
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
      <KanbanColumn title="Doing" tasks={doing} {...callbacks} />
      <KanbanColumn title="Up Next" tasks={upNext} {...callbacks} />
      <KanbanColumn title="Waiting" tasks={waiting} {...callbacks} />
      <KanbanColumn title="Snoozed" tasks={filteredSnoozed} {...callbacks} />
      <KanbanColumn title="Backlog" tasks={filteredBacklog} {...callbacks} />
    </div>
  )
}
