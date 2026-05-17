import { useState, useMemo } from 'react'
import { FolderKanban, Pin, PinOff, Plus, ChevronDown, ChevronRight } from 'lucide-react'
import { sortTasks, isActiveTask } from '../../store'
import { computeProjectBudget, PROJECT_SESSION_CAP } from '../../scoring'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import TaskCard from './TaskCard'
import './ProjectsView.css'

// Projects modal — list of all projects with drill-down. Each project
// card surfaces session/budget/sub counts + Pin and Add-sub buttons.
// Tap a project to expand its subs inline (active + backstage). Active
// subs render as full TaskCards (so they can be completed/snoozed in
// place); backstage subs show as compact rows.
// "+ New project" lives in the modal header so the user can spin up a
// project from this surface — no more "create a task, then move it"
// roundabout.

export default function ProjectsView({
  open, tasks, onClose, onComplete, onEdit, onSnooze, weatherByDate, routineStreaks,
  onTogglePin, onAddChild, onSetChildVisibility, onCreateProject,
}) {
  const [expandedTaskId, setExpandedTaskId] = useState(null)
  const [expandedProjectId, setExpandedProjectId] = useState(null)

  const projectTasks = useMemo(() => sortTasks(tasks.filter(t => t.status === 'project'), 'name'), [tasks])
  const childrenByParent = useMemo(() => {
    const map = new Map()
    for (const t of tasks) {
      if (!t.parent_id) continue
      if (!map.has(t.parent_id)) map.set(t.parent_id, [])
      map.get(t.parent_id).push(t)
    }
    return map
  }, [tasks])

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Projects"
      terminalTitle="> projects"
      subtitle={projectTasks.length > 0
        ? `${projectTasks.length} project${projectTasks.length !== 1 ? 's' : ''} · no nagging unless you opt in`
        : undefined}
      width="wide"
    >
      {onCreateProject && (
        <div className="v2-pv-toolbar">
          <button
            type="button"
            className="v2-pv-create"
            onClick={onCreateProject}
          >
            <Plus size={14} strokeWidth={1.75} />
            <span data-terminal-cmd="> project --new">New project</span>
          </button>
        </div>
      )}
      {projectTasks.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          body={`Start a long-haul project to track the work without nagging yourself. Add subs for the concrete steps, pin to today when you want to chip away.`}
          terminalCommand="// no projects yet — tap '+ new project' above"
          cta={onCreateProject ? 'New project' : undefined}
          ctaOnClick={onCreateProject}
        />
      ) : (
        <div className="v2-projects-list">
          {projectTasks.map(project => {
            const children = childrenByParent.get(project.id) || []
            const activeChildren = children.filter(c => isActiveTask(c))
            const budget = computeProjectBudget(project, tasks)
            const expanded = expandedProjectId === project.id
            const sessionCount = project.session_count || 0
            const capped = sessionCount >= PROJECT_SESSION_CAP
            return (
              <div key={project.id} className="v2-pv-block">
                <div className={`v2-pv-card${project.pinned_to_today ? ' v2-pv-card-pinned' : ''}`}>
                  <button
                    type="button"
                    className="v2-pv-card-main"
                    onClick={() => setExpandedProjectId(expanded ? null : project.id)}
                  >
                    <span className="v2-pv-chev" aria-hidden="true">
                      {expanded ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
                    </span>
                    <span className="v2-pv-card-main-text">
                      <span className="v2-pv-title">{project.title}</span>
                      <span className="v2-pv-meta">
                        {project.pinned_to_today && (
                          <>
                            <span className="v2-pv-pinned-chip">pinned</span>
                            <span className="v2-pv-meta-sep">·</span>
                          </>
                        )}
                        {children.length === 0 ? 'no subs' : `${activeChildren.length}/${children.length} subs`}
                        <span className="v2-pv-meta-sep">·</span>
                        {sessionCount > 0 ? `🔥 ${sessionCount}${capped ? ` (capped)` : ''}` : 'no sessions'}
                        <span className="v2-pv-meta-sep">·</span>
                        budget {budget}
                      </span>
                    </span>
                  </button>
                  <div className="v2-pv-actions">
                    <button
                      type="button"
                      className={`v2-pv-action${project.pinned_to_today ? ' v2-pv-action-active' : ''}`}
                      onClick={() => onTogglePin && onTogglePin(project.id, !project.pinned_to_today)}
                      aria-label={project.pinned_to_today ? 'Unpin' : 'Pin to today'}
                      title={project.pinned_to_today ? 'Pinned to today — tap to unpin' : 'Pin to today'}
                    >
                      {project.pinned_to_today
                        ? <PinOff size={14} strokeWidth={1.75} />
                        : <Pin size={14} strokeWidth={1.75} />}
                      <span>{project.pinned_to_today ? 'Pinned' : 'Pin'}</span>
                    </button>
                    <button
                      type="button"
                      className="v2-pv-action"
                      onClick={(e) => { e.stopPropagation(); onAddChild && onAddChild(project) }}
                      aria-label="Add sub"
                      title="Add a sub-task under this project"
                    >
                      <Plus size={14} strokeWidth={1.75} />
                      <span>Sub</span>
                    </button>
                    <button
                      type="button"
                      className="v2-pv-action v2-pv-action-edit"
                      onClick={(e) => { e.stopPropagation(); onEdit(project) }}
                      title="Edit project"
                    >
                      Edit
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="v2-pv-children">
                    {children.length === 0 ? (
                      <div className="v2-pv-empty-children">
                        No subs yet. Use the + button above to add one, or ask Quokka.
                      </div>
                    ) : (
                      <>
                        {activeChildren.length > 0 && (
                          <div className="v2-pv-children-group">
                            <div className="v2-pv-children-label">Active</div>
                            {activeChildren.map(child => (
                              <div key={child.id} className="v2-pv-child-card">
                                <TaskCard
                                  task={child}
                                  expanded={expandedTaskId === child.id}
                                  onToggleExpand={setExpandedTaskId}
                                  onComplete={onComplete}
                                  onEdit={onEdit}
                                  onSnooze={onSnooze}
                                  weatherByDate={weatherByDate}
                                  routineStreaks={routineStreaks}
                                />
                                {onSetChildVisibility && (
                                  <button
                                    type="button"
                                    className="v2-pv-visibility-toggle"
                                    onClick={() => onSetChildVisibility(child.id, child.child_visibility === 'active' ? 'backstage' : 'active')}
                                    title={child.child_visibility === 'active' ? 'Hide from main list' : 'Show in main list'}
                                  >
                                    {child.child_visibility === 'active' ? 'In main list' : 'Backstage'}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {children.filter(c => !isActiveTask(c)).length > 0 && (
                          <div className="v2-pv-children-group">
                            <div className="v2-pv-children-label">Other</div>
                            {children.filter(c => !isActiveTask(c)).map(child => (
                              <div key={child.id} className="v2-pv-child-row">
                                <span className="v2-pv-child-status">{child.status}</span>
                                <span className="v2-pv-child-title">{child.title}</span>
                                <button
                                  type="button"
                                  className="v2-pv-child-edit"
                                  onClick={() => onEdit(child)}
                                >
                                  Edit
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </ModalShell>
  )
}
