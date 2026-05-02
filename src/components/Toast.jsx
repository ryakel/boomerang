import { useEffect, useRef } from 'react'
import './Toast.css'
import { computeTaskPoints } from '../store'

const MESSAGES_QUICK = [
  'Speed run!',
  'Blink and you missed it.',
  'Any% completion.',
  'Didn\'t even break a sweat.',
  'That barely counts as procrastinating.',
]

const MESSAGES_NORMAL = [
  'Another one bites the dust.',
  'Look at you being functional.',
  'Crushed it. Next.',
  'That task never stood a chance.',
  'One less thing haunting you.',
  'Off the list, out of your brain.',
]

const MESSAGES_LONG = [
  'The prodigal task returns... completed.',
  'It only took you forever.',
  'Archaeologists found this task.',
  'That one aged like fine wine.',
  'Better late than literally never.',
  'The prophecy is fulfilled.',
]

const MESSAGES_REOPEN = [
  'Surprise! It\'s back.',
  'Plot twist.',
  'The sequel nobody asked for.',
  'Back from the dead.',
  'You thought you were done? Cute.',
  'Round two. Fight!',
]

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getVariantKey(daysOnList, isReopen) {
  if (isReopen) return 'reopen'
  if (daysOnList === 0) return 'complete_quick'
  if (daysOnList <= 3) return 'complete_normal'
  return 'complete_long'
}

function getStaticMessage(daysOnList, isReopen) {
  if (isReopen) return pickRandom(MESSAGES_REOPEN)
  if (daysOnList === 0) return pickRandom(MESSAGES_QUICK)
  if (daysOnList <= 3) return pickRandom(MESSAGES_NORMAL)
  return pickRandom(MESSAGES_LONG)
}

function getStaticSubtitle(daysOnList, todayCount, isReopen, taskTitle) {
  if (isReopen) return `"${taskTitle}" is back on the list`
  let s = daysOnList === 0 ? 'Same-day finish'
    : daysOnList === 1 ? '1 day on the list'
    : `${daysOnList} days on the list`
  if (todayCount > 1) s += ` · ${todayCount} done today`
  return s
}

export default function Toast({ task, todayCount, variant = 'complete', onDone, onUndo, nextTask, onNextTaskClick }) {
  const isReopen = variant === 'reopen'
  const daysOnList = Math.floor(
    (Date.now() - new Date(task.created_at).getTime()) / 86400000
  )

  // All values frozen on mount — zero state, zero re-renders
  const frozen = useRef(null)
  if (!frozen.current) {
    const variantKey = getVariantKey(daysOnList, isReopen)
    const ai = task.toast_messages?.[variantKey]

    const message = ai?.message || getStaticMessage(daysOnList, isReopen)
    const pts = isReopen ? 0 : computeTaskPoints(task)
    const aiSub = ai?.subtitle
    const staticSub = getStaticSubtitle(daysOnList, todayCount, isReopen, task.title)
    const subtitle = aiSub
      ? `${aiSub}${pts ? ` · +${pts} pts` : ''}`
      : `${staticSub}${pts ? ` · +${pts} pts` : ''}`

    frozen.current = { message, subtitle }
  }

  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    // Stay on screen longer when a next-task suggestion is offered so the
    // user has time to consider it without feeling rushed.
    const timeout = nextTask ? 8000 : 4000
    const timer = setTimeout(() => onDoneRef.current(), timeout)
    return () => clearTimeout(timer)
  }, [nextTask])

  const { message, subtitle } = frozen.current

  return (
    <div className={`toast ${isReopen ? 'toast-reopen' : ''}`} onClick={onDone}>
      <div className="toast-content">
        <div className="toast-message" style={isReopen ? { color: 'var(--accent)' } : undefined}>
          {message}
        </div>
        <div className="toast-subtitle">{subtitle}</div>
        {nextTask && (
          <div
            className="toast-next-task"
            style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.15)', fontSize: 12 }}
            onClick={(e) => { e.stopPropagation(); onNextTaskClick?.(nextTask) }}
          >
            <span style={{ opacity: 0.75 }}>Next up: </span>
            <strong style={{ textDecoration: 'underline' }}>{nextTask.title}</strong>
            {nextTask.size && <span style={{ marginLeft: 6, opacity: 0.6 }}>({nextTask.size})</span>}
          </div>
        )}
      </div>
      {onUndo && variant === 'complete' && (
        <button
          className="toast-undo"
          onClick={(e) => {
            e.stopPropagation()
            onUndo()
          }}
        >
          Undo
        </button>
      )}
    </div>
  )
}
