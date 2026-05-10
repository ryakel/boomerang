import { useEffect, useRef, useState } from 'react'
import './TypingPrompt.css'

// Types out each phrase in `phrases` sequentially, ONE TIME. As each
// phrase finishes typing, it stays on screen and the next phrase types
// below it. Once the last phrase finishes, the animation stops — the
// final layout shows every phrase as a typed line, no looping.
//
// Used by Quokka's empty state to demo what the user could ask. The
// static suggestion buttons below give the actual one-tap shortcut;
// this is just the visual "Quokka can do these things" demo.
//
// `prefers-reduced-motion` short-circuits to rendering all phrases
// statically with no typing animation.
export default function TypingPrompt({
  phrases,
  typeMs = 45,
  holdMs = 700,
}) {
  const [completed, setCompleted] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [currentText, setCurrentText] = useState('')
  const [phase, setPhase] = useState('typing')   // typing | holding | done
  const reducedMotion = useRef(false)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    reducedMotion.current = mq?.matches || false
  }, [])

  useEffect(() => {
    if (!Array.isArray(phrases) || phrases.length === 0) return
    if (reducedMotion.current) {
      setCompleted(phrases)
      setPhase('done')
      return
    }
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
        setCompleted(prev => [...prev, phrase])
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

  return (
    <div className="v2-typing-prompt" aria-hidden="true">
      {completed.map((p, i) => (
        <div key={i} className="v2-typing-prompt-line v2-typing-prompt-line-complete">
          {p}
        </div>
      ))}
      {phase !== 'done' && (
        <div className="v2-typing-prompt-line v2-typing-prompt-line-active">
          <span className="v2-typing-prompt-text">{currentText}</span>
          <span className="v2-typing-prompt-cursor">_</span>
        </div>
      )}
    </div>
  )
}
