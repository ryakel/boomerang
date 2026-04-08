import { useState } from 'react'
import TaskCard from './TaskCard'
import { sortTasks } from '../store'
import './ProjectsView.css'

export default function ProjectsView({ tasks, onComplete, onSnooze, onEdit, onExtend, onStatusChange, onUpdate, onDelete, onClose, isDesktop }) {
  const [sortBy] = useState('name')
  const [expandedTaskId, setExpandedTaskId] = useState(null)

  const projectTasks = sortTasks(tasks.filter(t => t.status === 'project'), sortBy)

  const content = (
    <div className="projects-content">
      {projectTasks.length === 0 ? (
        <div className="projects-empty">
          <div className="projects-empty-icon">📁</div>
          <div className="projects-empty-title">No projects yet</div>
          <div className="projects-empty-subtitle">
            Move longer-term tasks here so they stop nagging you.
            <br />Use "Move to Projects" in any task's edit modal.
          </div>
        </div>
      ) : (
        <div className="projects-list">
          <div className="projects-hint">
            These tasks won't trigger any notifications. Take your time.
          </div>
          {projectTasks.map(t => (
            <div key={t.id} className="project-card-wrapper">
              <TaskCard
                task={t}
                onComplete={onComplete}
                onSnooze={onSnooze}
                onEdit={onEdit}
                onExtend={onExtend}
                onStatusChange={onStatusChange}
                onUpdate={onUpdate}
                onDelete={onDelete}
                expandedId={expandedTaskId}
                onToggleExpand={setExpandedTaskId}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )

  if (isDesktop) {
    return (
      <div className="sheet-overlay" onClick={onClose}>
        <div className="sheet projects-sheet" onClick={e => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
          <div className="edit-task-title-row">
            <div className="sheet-title">Projects</div>
            <div className="projects-count">{projectTasks.length} project{projectTasks.length !== 1 ? 's' : ''}</div>
          </div>
          {content}
        </div>
      </div>
    )
  }

  return (
    <div className="settings-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title" style={{ margin: 0 }}>Projects</div>
        <div className="projects-count">{projectTasks.length} project{projectTasks.length !== 1 ? 's' : ''}</div>
      </div>
      {content}
    </div>
  )
}
