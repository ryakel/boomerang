import { memo, useState } from 'react'
import { Pin, Plus, Activity, Edit3 } from 'lucide-react'
import SectionLabel from './SectionLabel'
import TaskCard from './TaskCard'
import { computeProjectBudget, computeProjectSessionPoints, PROJECT_SESSION_CAP } from '../../scoring'
import { useTerminalMode } from '../hooks/useTerminalMode'
import './ProjectPinnedSection.css'

// Pinned projects appear at the top of the main task list with their own
// section header. Each project gets a dedicated card with progress meta +
// Log Session + Add Child + Unpin actions. Active children of the pinned
// project surface as regular task cards beneath, prefixed with a "↳"
// continuation glyph.
//
// Projects whose budget cap is exhausted (10 sessions logged with no
// child completion) show a greyed-out Log Session button with the cap
// message instead of a tappable affordance.

function ProjectPinnedSection({
  projects,
  activeChildren,
  allTasks,
  expandedTaskId,
  onToggleExpand,
  onLogSession,
  onUnpin,
  onAddChild,
  onEditProject,
  onComplete,
  onEdit,
  onSnooze,
  onSkipAdvance,
  weatherByDate,
  routineStreaks,
}) {
  const isTerminal = useTerminalMode()
  const [logging, setLogging] = useState(null) // project id mid-tap
  const [feedback, setFeedback] = useState(null) // { id, text }

  if (projects.length === 0) return null

  const handleLog = async (project) => {
    if (logging) return
    setLogging(project.id)
    try {
      const result = await onLogSession(project.id)
      setFeedback({ id: project.id, text: `+${result.points} pts logged` })
      setTimeout(() => setFeedback(f => f?.id === project.id ? null : f), 2500)
    } catch (err) {
      if (err.code === 'SESSION_CAP_REACHED') {
        setFeedback({ id: project.id, text: `Cap reached (${err.sessionCap})` })
        setTimeout(() => setFeedback(f => f?.id === project.id ? null : f), 3000)
      } else {
        setFeedback({ id: project.id, text: 'Failed to log' })
        setTimeout(() => setFeedback(f => f?.id === project.id ? null : f), 3000)
      }
    } finally {
      setLogging(null)
    }
  }

  return (
    <>
      <SectionLabel count={projects.length} sigil={isTerminal ? '*' : '★'}>
        Pinned projects
      </SectionLabel>
      {projects.map(project => {
        const children = activeChildren.filter(c => c.parent_id === project.id)
        const budget = computeProjectBudget(project, allTasks)
        const sessionPts = computeProjectSessionPoints(project, allTasks)
        const sessionCount = project.session_count || 0
        const capped = sessionCount >= PROJECT_SESSION_CAP
        const lastSession = project.last_session_at ? new Date(project.last_session_at) : null
        const daysSinceLast = lastSession
          ? Math.max(0, Math.floor((Date.now() - lastSession.getTime()) / 86400000))
          : null
        const fb = feedback?.id === project.id ? feedback.text : null

        return (
          <div key={project.id} className="v2-pp-block">
            <div className="v2-pp-card">
              <button
                type="button"
                className="v2-pp-main"
                onClick={() => onEditProject(project)}
                aria-label={`Open ${project.title}`}
              >
                <div className="v2-pp-title-row">
                  <span className="v2-pp-title">{project.title}</span>
                  {project.due_date && (
                    <span className="v2-pp-due">due {project.due_date}</span>
                  )}
                </div>
                <div className="v2-pp-meta">
                  <span className="v2-pp-sessions">
                    {sessionCount > 0 ? `🔥 ${sessionCount} session${sessionCount === 1 ? '' : 's'}` : 'no sessions yet'}
                  </span>
                  <span className="v2-pp-meta-sep">·</span>
                  <span>{children.length} active sub{children.length === 1 ? '' : 's'}</span>
                  <span className="v2-pp-meta-sep">·</span>
                  <span>budget {budget} pts</span>
                  {daysSinceLast !== null && (
                    <>
                      <span className="v2-pp-meta-sep">·</span>
                      <span>
                        last touched {daysSinceLast === 0 ? 'today' : `${daysSinceLast}d ago`}
                      </span>
                    </>
                  )}
                </div>
              </button>
              <div className="v2-pp-actions">
                <button
                  type="button"
                  className={`v2-pp-action v2-pp-action-primary${capped ? ' v2-pp-action-disabled' : ''}`}
                  onClick={() => !capped && handleLog(project)}
                  disabled={capped || logging === project.id}
                  title={capped ? `Cap reached — complete a sub or the project to log more` : `Log a +${sessionPts}-pt session`}
                >
                  <Activity size={14} strokeWidth={1.75} />
                  <span>{capped ? `Capped ${sessionCount}/${PROJECT_SESSION_CAP}` : `+${sessionPts} session`}</span>
                </button>
                <button
                  type="button"
                  className="v2-pp-action"
                  onClick={() => onAddChild(project)}
                  title="Add a sub-task under this project"
                >
                  <Plus size={14} strokeWidth={1.75} />
                  <span>Sub</span>
                </button>
                <button
                  type="button"
                  className="v2-pp-action v2-pp-action-icon"
                  onClick={() => onEditProject(project)}
                  aria-label="Edit project"
                  title="Edit project"
                >
                  <Edit3 size={14} strokeWidth={1.75} />
                </button>
                <button
                  type="button"
                  className="v2-pp-action v2-pp-action-icon"
                  onClick={() => onUnpin(project.id)}
                  aria-label="Unpin"
                  title="Unpin from today"
                >
                  <Pin size={14} strokeWidth={1.75} />
                </button>
              </div>
              {fb && <div className="v2-pp-feedback">{fb}</div>}
            </div>
            {children.length > 0 && (
              <div className="v2-pp-children">
                {children.map(child => (
                  <div key={child.id} className="v2-pp-child">
                    <span className="v2-pp-child-prefix" aria-hidden="true">↳</span>
                    <div className="v2-pp-child-card">
                      <TaskCard
                        task={child}
                        expanded={expandedTaskId === child.id}
                        onToggleExpand={onToggleExpand}
                        onComplete={onComplete}
                        onEdit={onEdit}
                        onSnooze={onSnooze}
                        onSkipAdvance={onSkipAdvance}
                        weatherByDate={weatherByDate}
                        routineStreaks={routineStreaks}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

export default memo(ProjectPinnedSection)
