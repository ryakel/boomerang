import { memo } from 'react'
import { Check, Pencil, Moon, Monitor, Users, MapPin, Palette, Dumbbell, Zap } from 'lucide-react'
import {
  isStale, isSnoozed, isOverdue,
  formatSnoozeLabel, formatDueDate, daysOld, ENERGY_TYPES,
} from '../../store'
import './TaskCard.css'

const ENERGY_ICONS = { Monitor, Users, MapPin, Palette, Dumbbell }

function TaskCard({ task, expanded, onToggleExpand, onComplete, onEdit, onSnooze }) {
  const overdue = isOverdue(task)
  const stale = isStale(task)
  const snoozed = isSnoozed(task)
  // Status economy: only overdue + high-pri get a colored left border in v2.
  // Stale + low-pri move to inline meta / opacity treatment.
  const tone = overdue ? 'overdue' : (task.high_priority ? 'high-pri' : null)

  const energyType = ENERGY_TYPES.find(e => e.id === task.energy)
  const EnergyIcon = energyType ? ENERGY_ICONS[energyType.icon] : null
  const energyLevel = task.energyLevel || 1

  const meta = []
  if (task.due_date) meta.push(formatDueDate(task.due_date))
  if (snoozed) meta.push(formatSnoozeLabel(task.snoozed_until))
  if (stale && !snoozed) meta.push(`${daysOld(task)}d on list`)

  const checklist = Array.isArray(task.checklist_items) ? task.checklist_items : []
  const checkedCount = checklist.filter(c => c.checked).length

  const onMainClick = (e) => {
    // Avoid expanding when clicking actions inside the card
    if (e.target.closest('.v2-card-actions, .v2-card-action')) return
    onToggleExpand(expanded ? null : task.id)
  }

  return (
    <div
      className={[
        'v2-card',
        tone ? `v2-card-${tone}` : '',
        task.low_priority ? 'v2-card-faded' : '',
        expanded ? 'v2-card-expanded-state' : '',
      ].filter(Boolean).join(' ')}
    >
      <button type="button" className="v2-card-main" onClick={onMainClick}>
        <div className="v2-card-content">
          <div className="v2-card-title">{task.title}</div>
          {meta.length > 0 && (
            <div className="v2-card-meta">
              {meta.map((m, i) => (
                <span key={i}>
                  {i > 0 && <span className="v2-card-meta-sep">·</span>}
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
        {energyType && EnergyIcon && (
          <div className="v2-card-energy" title={`${energyType.label} · level ${energyLevel}`}>
            <EnergyIcon size={16} strokeWidth={1.75} color={energyType.color} />
            <span className="v2-card-energy-bolts">
              {Array.from({ length: energyLevel }).map((_, i) => (
                <Zap key={i} size={10} strokeWidth={2.25} fill={energyType.color} color={energyType.color} />
              ))}
            </span>
          </div>
        )}
      </button>

      {expanded && (
        <div className="v2-card-expanded">
          {task.notes && (
            <div className="v2-card-notes">{task.notes}</div>
          )}
          {checklist.length > 0 && (
            <div className="v2-card-checklist-summary">
              {checkedCount} / {checklist.length} done
            </div>
          )}
          <div className="v2-card-actions">
            <button
              className="v2-card-action v2-card-action-primary"
              onClick={() => onComplete(task.id)}
              aria-label="Mark done"
            >
              <Check size={16} strokeWidth={2} />
              <span>Done</span>
            </button>
            <button
              className="v2-card-action"
              onClick={() => onSnooze(task)}
              aria-label="Snooze"
            >
              <Moon size={16} strokeWidth={1.75} />
            </button>
            <button
              className="v2-card-action"
              onClick={() => onEdit(task)}
              aria-label="Edit"
            >
              <Pencil size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(TaskCard)
