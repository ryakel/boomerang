import { useState } from 'react'
import { FolderKanban } from 'lucide-react'
import { sortTasks } from '../../store'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import TaskCard from './TaskCard'
import './ProjectsView.css'

export default function ProjectsView({ open, tasks, onClose, onComplete, onEdit, onSnooze }) {
  const [expandedTaskId, setExpandedTaskId] = useState(null)
  const projectTasks = sortTasks(tasks.filter(t => t.status === 'project'), 'name')

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Projects"
      subtitle={projectTasks.length > 0
        ? `${projectTasks.length} project${projectTasks.length !== 1 ? 's' : ''} · no notifications, take your time`
        : undefined}
      width="wide"
    >
      {projectTasks.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          body={`Move longer-term tasks here so they stop nagging you. Use "Move to projects" in any task's edit modal.`}
        />
      ) : (
        <div className="v2-projects-list">
          {projectTasks.map(t => (
            <TaskCard
              key={t.id}
              task={t}
              expanded={expandedTaskId === t.id}
              onToggleExpand={setExpandedTaskId}
              onComplete={onComplete}
              onEdit={onEdit}
              onSnooze={onSnooze}
            />
          ))}
        </div>
      )}
    </ModalShell>
  )
}
