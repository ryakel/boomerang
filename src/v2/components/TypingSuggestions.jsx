import { useEffect, useRef, useState } from 'react'
import './TypingSuggestions.css'

// Renders a vertical list of suggestion slots that type themselves in
// one by one. Used in Quokka's empty state: the same slots that double
// as static clickable suggestion buttons start out empty, type in
// sequentially, and become tappable as each finishes.
//
// No separate "demo" block above the suggestions — the typing IS the
// suggestions. Once the last phrase finishes, every slot is a normal
// clickable button.
//
// `prefers-reduced-motion` short-circuits to all phrases visible
// immediately, no animation.
export default function TypingSuggestions({
  phrases,
  onSelect,
  typeMs = 35,
  holdMs = 500,
}) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [currentText, setCurrentText] = useState('')
  const [phase, setPhase] = useState('typing')   // typing | holding | done
  const reducedMotion = useRef(false)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    reducedMotion.current = mq?.matches || false
    if (reducedMotion.current) setPhase('done')
  }, [])

  useEffect(() => {
    if (!Array.isArray(phrases) || phrases.length === 0) return
    if (phase === 'done') return
    const phrase = phrases[currentIdx]
    if (!phrase) { setPhase('done'); return }
    let timer
    if (phase === 'typing') {
      if (currentText.length < phrase.length) {
        timer = setTimeout(() => setCurrentText(phrase.slice(0, currentText.length + 1)), typeMs)
      } else {
        timer = setTimeout(() => setPhase('holding'), holdMs)
      }
    } else if (phase === 'holding') {
      timer = setTimeout(() => {
        setCurrentText('')
        const next = currentIdx + 1
        if (next >= phrases.length) {
          setPhase('done')
        } else {
          setCurrentIdx(next)
          setPhase('typing')
        }
      }, 0)
    }
    return () => clearTimeout(timer)
  }, [currentText, phase, currentIdx, phrases, typeMs, holdMs])

  if (!Array.isArray(phrases) || phrases.length === 0) return null

  return (
    <div className="v2-typing-suggestions">
      {phrases.map((p, i) => {
        const isComplete = i < currentIdx || phase === 'done'
        const isActive = i === currentIdx && phase !== 'done'
        const display = isComplete ? p : (isActive ? currentText : '')
        return (
          <button
            key={i}
            type="button"
            className={[
              'v2-typing-suggestion',
              isComplete && 'v2-typing-suggestion-complete',
              isActive && 'v2-typing-suggestion-active',
            ].filter(Boolean).join(' ')}
            onClick={isComplete ? () => onSelect?.(p) : undefined}
            disabled={!isComplete}
            aria-label={isComplete ? p : undefined}
            aria-hidden={!isComplete}
          >
            <span className="v2-typing-suggestion-text">{display}</span>
            {isActive && <span className="v2-typing-suggestion-cursor" aria-hidden="true">_</span>}
          </button>
        )
      })}
    </div>
  )
}
