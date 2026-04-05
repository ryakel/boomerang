import { useEffect, useState, useMemo } from 'react'
import './Toast.css'
import { computeTaskPoints } from '../store'
import { generateToastMessage } from '../api'

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

function getStaticMessage(daysOnList, isReopen) {
  if (isReopen) return pickRandom(MESSAGES_REOPEN)
  if (daysOnList === 0) return pickRandom(MESSAGES_QUICK)
  if (daysOnList <= 3) return pickRandom(MESSAGES_NORMAL)
  return pickRandom(MESSAGES_LONG)
}

function getSubtitle(daysOnList, todayCount) {
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
  return subtitle
}

export default function Toast({ task, todayCount, variant = 'complete', onDone, onUndo }) {
  const isReopen = variant === 'reopen'
  const daysOnList = Math.floor(
    (Date.now() - new Date(task.created_at).getTime()) / 86400000
  )

  // Compute static message and subtitle once on mount (no re-randomizing)
  const staticMessage = useMemo(() => getStaticMessage(daysOnList, isReopen), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [message, setMessage] = useState(staticMessage)

  const subtitle = useMemo(() => {
    if (isReopen) return `"${task.title}" is back on the list`
    const s = getSubtitle(daysOnList, todayCount)
    const pts = computeTaskPoints(task)
    return `${s} · +${pts} pts`
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Try AI generation in background, replace static if it arrives fast enough
  useEffect(() => {
    let cancelled = false
    const timeout = setTimeout(() => { cancelled = true }, 3000)

    generateToastMessage(task.title, variant, {
      daysOnList,
      todayCount,
      energy: task.energy,
      energyLevel: task.energyLevel,
    }).then(aiMsg => {
      clearTimeout(timeout)
      if (!cancelled && aiMsg) setMessage(aiMsg)
    }).catch(() => {})

    return () => { cancelled = true; clearTimeout(timeout) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = setTimeout(onDone, 4000)
    return () => clearTimeout(timer)
  }, [onDone])

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
