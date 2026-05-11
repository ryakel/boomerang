import { useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings } from '../../store'
import './TicTacToe.css'

// Hidden engagement game. Triggered by 7-tapping the EditTaskModal
// title (Android build-number metaphor). Win once per day → +1 point
// gets folded into computeDailyStats via the easter_egg_wins setting.
//
// AI strategy (intentionally moderate, not unbeatable):
//   1. Always take a winning move
//   2. 70% chance to block the player's winning move
//   3. Otherwise random open square
// Player wins ~30% of the time when AI fails to block — enough that
// it's genuinely beatable as a daily engagement loop.

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function checkWin(board, p) {
  return LINES.some(line => line.every(i => board[i] === p))
}

function findWinningMove(board, p) {
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue
    const test = board.slice()
    test[i] = p
    if (checkWin(test, p)) return i
  }
  return -1
}

function pickMove(board, ai, human) {
  // Always take a winning move
  const winIdx = findWinningMove(board, ai)
  if (winIdx !== -1) return winIdx
  // 70% chance to block — leaves a beatable seam.
  const blockIdx = findWinningMove(board, human)
  if (blockIdx !== -1 && Math.random() < 0.7) return blockIdx
  // Otherwise random open square
  const open = []
  for (let i = 0; i < 9; i++) if (!board[i]) open.push(i)
  return open[Math.floor(Math.random() * open.length)]
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function alreadyWonToday() {
  const wins = loadSettings().easter_egg_wins || {}
  return !!wins[todayIso()]
}

function stampWin() {
  const settings = loadSettings()
  const wins = { ...(settings.easter_egg_wins || {}) }
  const today = todayIso()
  if (wins[today]) return false
  wins[today] = true
  saveSettings({ ...settings, easter_egg_wins: wins })
  return true
}

export default function TicTacToe({ open, onClose, onPointEarned }) {
  const [board, setBoard] = useState(Array(9).fill(null))
  const [turn, setTurn] = useState('X') // X = player, O = AI
  const [outcome, setOutcome] = useState(null) // null | 'win' | 'lose' | 'tie'
  const [pointEarned, setPointEarned] = useState(false)
  const aiTimer = useRef(null)

  useEffect(() => () => {
    if (aiTimer.current) clearTimeout(aiTimer.current)
  }, [])

  // Reset state when reopening
  useEffect(() => {
    if (open) {
      setBoard(Array(9).fill(null))
      setTurn('X')
      setOutcome(null)
      setPointEarned(false)
    }
  }, [open])

  useEffect(() => {
    if (turn !== 'O' || outcome) return
    aiTimer.current = setTimeout(() => {
      setBoard(prev => {
        const idx = pickMove(prev, 'O', 'X')
        if (idx < 0) return prev
        const next = prev.slice()
        next[idx] = 'O'
        if (checkWin(next, 'O')) {
          setOutcome('lose')
        } else if (next.every(Boolean)) {
          setOutcome('tie')
        } else {
          setTurn('X')
        }
        return next
      })
    }, 450)
    return () => clearTimeout(aiTimer.current)
  }, [turn, outcome])

  const tapCell = (i) => {
    if (outcome || board[i] || turn !== 'X') return
    setBoard(prev => {
      const next = prev.slice()
      next[i] = 'X'
      if (checkWin(next, 'X')) {
        setOutcome('win')
        const fresh = stampWin()
        if (fresh) {
          setPointEarned(true)
          onPointEarned?.()
        }
      } else if (next.every(Boolean)) {
        setOutcome('tie')
      } else {
        setTurn('O')
      }
      return next
    })
  }

  const playAgain = () => {
    setBoard(Array(9).fill(null))
    setTurn('X')
    setOutcome(null)
    setPointEarned(false)
  }

  if (!open) return null

  const statusLine = (() => {
    if (outcome === 'win') {
      if (pointEarned) return '// you win! +1 point'
      return alreadyWonToday()
        ? '// you win! (already claimed today)'
        : '// you win!'
    }
    if (outcome === 'lose') return '// you lose'
    if (outcome === 'tie') return '// tie game'
    return turn === 'X' ? '// your turn' : '// thinking…'
  })()

  return (
    <div className="v2-ttt-overlay" onClick={onClose}>
      <div className="v2-ttt-modal" onClick={e => e.stopPropagation()}>
        <div className="v2-ttt-header">
          <span className="v2-ttt-title">&gt; tic-tac-toe</span>
          <button className="v2-ttt-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="v2-ttt-status">{statusLine}</div>
        <div className="v2-ttt-grid" role="grid" aria-label="tic-tac-toe board">
          {board.map((cell, i) => (
            <button
              key={i}
              type="button"
              className={`v2-ttt-cell${cell ? ` v2-ttt-cell-${cell.toLowerCase()}` : ''}`}
              onClick={() => tapCell(i)}
              disabled={!!cell || !!outcome || turn !== 'X'}
              aria-label={cell ? `${cell} at position ${i + 1}` : `empty position ${i + 1}`}
            >
              {cell || ' '}
            </button>
          ))}
        </div>
        <div className="v2-ttt-actions">
          {outcome && (
            <button type="button" className="v2-ttt-btn" onClick={playAgain}>[ play again ]</button>
          )}
          <button type="button" className="v2-ttt-btn v2-ttt-btn-close" onClick={onClose}>[ close ]</button>
        </div>
      </div>
    </div>
  )
}
