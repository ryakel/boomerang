import { useEffect } from 'react'
import './Toast.css'
import { computeTaskPoints } from '../store'

const MESSAGES_QUICK = [
  'Speed run.',
  'That was fast.',
  'In and out.',
  'Quick work.',
  'Nailed it.',
]

const MESSAGES_NORMAL = [
  'Done and done.',
  'One less thing.',
  'Knocked it out.',
  'Off the list.',
  'Nice work.',
  'Handled.',
]

const MESSAGES_LONG = [
  'Finally! That one was hanging around.',
  'Persistence wins.',
  'Worth the wait.',
  'That one fought back, but you got it.',
  'Long time coming — nice.',
]

const MESSAGES_REOPEN = [
  'Back in the ring.',
  'Not done yet? No problem.',
  'Round two — you got this.',
  'Unfinished business.',
  'Second wind incoming.',
  'Still in the fight.',
]

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function getMotivation(daysOnList, todayCount) {
  let message
  if (daysOnList === 0) {
    message = pickRandom(MESSAGES_QUICK)
  } else if (daysOnList <= 3) {
    message = pickRandom(MESSAGES_NORMAL)
  } else {
    message = pickRandom(MESSAGES_LONG)
  }

  let subtitle = ''
  if (daysOnList === 0) {
    subtitle = 'Same-day finish'
  } else if (daysOnList === 1) {
    subtitle = '1 day on the list'
  } else {
    subtitle = `${daysOnList} days on the list`
  }

  if (todayCount > 1) {
    subtitle += ` · ${todayCount} done today`
  }

  return { message, subtitle }
}

export default function Toast({ task, todayCount, variant = 'complete', onDone, onUndo }) {
  let message, subtitle

  if (variant === 'reopen') {
    message = pickRandom(MESSAGES_REOPEN)
    subtitle = `"${task.title}" is back on the list`
  } else {
    const daysOnList = Math.floor(
      (Date.now() - new Date(task.created_at).getTime()) / 86400000
    )
    ;({ message, subtitle } = getMotivation(daysOnList, todayCount))
    const pts = computeTaskPoints(task)
    subtitle += ` · +${pts} pts`
  }

  useEffect(() => {
    const timer = setTimeout(onDone, 4000)
    return () => clearTimeout(timer)
  }, [onDone])

  const isReopen = variant === 'reopen'

  return (
    <div className={`toast ${isReopen ? 'toast-reopen' : ''}`} onClick={onDone}>
      <div className="toast-content">
        <div className="toast-message" style={isReopen ? { color: 'var(--accent)' } : undefined}>
          {message}
        </div>
        <div className="toast-subtitle">{subtitle}</div>
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
