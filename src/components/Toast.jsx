import { useEffect, useRef } from 'react'
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

// Pre-fetch AI message so it's ready before the toast mounts.
// Returns a promise that resolves to the AI message or null.
const aiCache = { pending: null, taskId: null }

export function prefetchToastMessage(task, variant, todayCount) {
  const daysOnList = Math.floor(
    (Date.now() - new Date(task.created_at).getTime()) / 86400000
  )
  aiCache.taskId = task.id
  aiCache.pending = generateToastMessage(task.title, variant, {
    daysOnList,
    todayCount,
    energy: task.energy,
    energyLevel: task.energyLevel,
  }).catch(() => null)
}

function getStaticMessage(daysOnList, isReopen) {
  if (isReopen) return pickRandom(MESSAGES_REOPEN)
  if (daysOnList === 0) return pickRandom(MESSAGES_QUICK)
  if (daysOnList <= 3) return pickRandom(MESSAGES_NORMAL)
  return pickRandom(MESSAGES_LONG)
}

export default function Toast({ task, todayCount, variant = 'complete', onDone, onUndo }) {
  const isReopen = variant === 'reopen'
  const daysOnList = Math.floor(
    (Date.now() - new Date(task.created_at).getTime()) / 86400000
  )

  // All values computed once — no state, no swaps, no re-renders
  const frozen = useRef(null)
  if (!frozen.current) {
    const staticMsg = getStaticMessage(daysOnList, isReopen)
    let subtitle
    if (isReopen) {
      subtitle = `"${task.title}" is back on the list`
    } else {
      const s = daysOnList === 0 ? 'Same-day finish'
        : daysOnList === 1 ? '1 day on the list'
        : `${daysOnList} days on the list`
      const pts = computeTaskPoints(task)
      subtitle = `${s}${todayCount > 1 ? ` · ${todayCount} done today` : ''} · +${pts} pts`
    }
    frozen.current = { message: staticMsg, subtitle }
  }

  // Check if prefetched AI message is already resolved
  useEffect(() => {
    if (aiCache.pending && aiCache.taskId === task.id) {
      const promise = aiCache.pending
      aiCache.pending = null
      aiCache.taskId = null
      // Race: if AI already resolved, update the ref before paint
      // If not, we just keep the static — no swap
      promise.then(aiMsg => {
        if (aiMsg && frozen.current) {
          frozen.current.message = aiMsg
        }
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    const timer = setTimeout(() => onDoneRef.current(), 4000)
    return () => clearTimeout(timer)
  }, [])

  const { message, subtitle } = frozen.current

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
