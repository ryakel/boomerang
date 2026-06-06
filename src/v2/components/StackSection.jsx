import { memo } from 'react'
import SectionLabel from './SectionLabel'
import TaskCard from './TaskCard'
import { useTerminalMode } from '../hooks/useTerminalMode'
import './StackSection.css'

// Format 'HH:MM' 24h → compact 12h ('20:00' → '8pm', '08:30' → '8:30am').
function fmtTime(t) {
  if (!t) return ''
  const [hh, mm] = String(t).split(':').map(Number)
  const ampm = hh >= 12 ? 'pm' : 'am'
  const h12 = hh % 12 || 12
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ampm}` : `${h12}${ampm}`
}

// Routine "stacks": one routine that fans out into several INDEPENDENT task
// cards each cycle (vs follow_ups, a dependent chain). Each surfaced cycle —
// keyed by (routine_id, due_date) — renders under its own header with a
// progress pip (done/total) and the pending clear bonus. Members are regular
// TaskCards; completing the LAST one pays a 20% bonus (handled in
// AppV2.handleComplete). Mobile-only — desktop Kanban shows members in their
// natural status columns, mirroring ProjectPinnedSection.
function StackSection({
  groups,
  expandedTaskId,
  onToggleExpand,
  onComplete,
  onEdit,
  onSnooze,
  onSkipAdvance,
  weatherByDate,
  routineStreaks,
}) {
  const isTerminal = useTerminalMode()
  if (!groups || groups.length === 0) return null

  return (
    <>
      <SectionLabel count={groups.length} sigil={isTerminal ? '#' : '▦'}>
        Stacks
      </SectionLabel>
      {groups.map(g => {
        const time = fmtTime(g.routine?.trigger_time)
        return (
          <div key={g.key} className="v2-stack-block">
            <div className="v2-stack-head">
              <span className="v2-stack-title">{g.routine?.title}</span>
              {time && <span className="v2-stack-time">{time}</span>}
              <span className="v2-stack-progress">{g.doneCount}/{g.total}</span>
              {g.bonusPreview > 0 && (
                <span className="v2-stack-bonus">+{g.bonusPreview} on clear</span>
              )}
            </div>
            <div className="v2-stack-members">
              {g.surfaced.map(t => (
                <div key={t.id} className="v2-stack-member">
                  <span className="v2-stack-member-prefix" aria-hidden="true">▸</span>
                  <div className="v2-stack-member-card">
                    <TaskCard
                      task={t}
                      expanded={expandedTaskId === t.id}
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
          </div>
        )
      })}
    </>
  )
}

export default memo(StackSection)
