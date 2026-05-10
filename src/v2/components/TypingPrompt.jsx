import { useEffect, useRef, useState } from 'react'
import './TypingPrompt.css'

// Cycles through a list of phrases, typing each one character by
// character, pausing while complete, then erasing and moving to the
// next. Renders inline with a blinking cursor. Used by Quokka's empty
// state to demo what the user could ask without overwhelming the
// static suggestion list below it.
//
// Respects `prefers-reduced-motion` — if reduced motion is preferred,
// shows the longest phrase statically with no animation.
export default function TypingPrompt({
  phrases,
  typeMs = 55,
  eraseMs = 25,
  holdMs = 1600,
  pauseBetweenMs = 400,
}) {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState('typing')
  const [phraseIdx, setPhraseIdx] = useState(0)
  const reducedMotion = useRef(false)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    reducedMotion.current = mq?.matches || false
  }, [])

  useEffect(() => {
    if (!Array.isArray(phrases) || phrases.length === 0) return
    if (reducedMotion.current) {
      const longest = phrases.reduce((a, b) => (b.length > a.length ? b : a), '')
      setText(longest)
      return
    }
    const phrase = phrases[phraseIdx % phrases.length]
    let timer
    if (phase === 'typing') {
      if (text.length < phrase.length) {
        timer = setTimeout(() => setText(phrase.slice(0, text.length + 1)), typeMs)
      } else {
        timer = setTimeout(() => setPhase('holding'), holdMs)
      }
    } else if (phase === 'holding') {
      timer = setTimeout(() => setPhase('erasing'), 0)
    } else if (phase === 'erasing') {
      if (text.length > 0) {
        timer = setTimeout(() => setText(text.slice(0, -1)), eraseMs)
      } else {
        timer = setTimeout(() => {
          setPhraseIdx(i => (i + 1) % phrases.length)
          setPhase('typing')
        }, pauseBetweenMs)
      }
    }
    return () => clearTimeout(timer)
  }, [text, phase, phraseIdx, phrases, typeMs, eraseMs, holdMs, pauseBetweenMs])

  return (
    <span className="v2-typing-prompt" aria-hidden="true">
      <span className="v2-typing-prompt-text">{text}</span>
      <span className="v2-typing-prompt-cursor">_</span>
    </span>
  )
}
