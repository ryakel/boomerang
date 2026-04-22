import { useCallback, useEffect, useRef, useState } from 'react'
import { adviserChat, adviserCommit, adviserAbort } from '../api'

// Conversation shape:
//   messages: [
//     { role: 'user', content: string },
//     { role: 'assistant', content: string, toolEvents: [{name, input, result}], plan: [{stepId, toolName, preview}] },
//   ]
//
// Status:
//   'idle'                — no stream active
//   'streaming'           — model is generating / tool-use loop running
//   'awaiting_confirm'    — stream done, staged plan awaiting user confirm/abort
//   'committing'          — plan being executed atomically
//   'committed'           — last commit succeeded
//   'error'               — last stream or commit errored (see lastError)

export function useAdviser() {
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('idle')
  const [lastError, setLastError] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const streamRef = useRef(null)
  const pendingAssistantRef = useRef(null)

  // Clean up ONLY when the owning component (App) unmounts — which in practice
  // means the page is closing. The adviser modal opening/closing does NOT tear
  // down this hook, so a user can close the modal, come back, and find the same
  // thread. Server session TTL (10 min) cleans up truly abandoned sessions.
  useEffect(() => () => {
    if (streamRef.current) streamRef.current.abort()
    // Fire-and-forget abort to free the server session on real unmount
    if (sessionId) adviserAbort(sessionId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const buildHistory = useCallback(() => {
    // Convert messages → Anthropic-style [{role, content}]. Only text content
    // survives across turns; staged-plan + tool events do not because the server's
    // next turn recreates them fresh.
    const history = []
    for (const m of messages) {
      if (m.role === 'user') history.push({ role: 'user', content: m.content })
      else if (m.role === 'assistant' && m.content) history.push({ role: 'assistant', content: m.content })
    }
    return history
  }, [messages])

  const send = useCallback((text) => {
    if (!text?.trim()) return
    if (streamRef.current) return // already streaming

    setLastError(null)
    setStatus('streaming')

    const userMsg = { role: 'user', content: text.trim() }
    const assistantMsg = { role: 'assistant', content: '', toolEvents: [], plan: [] }
    pendingAssistantRef.current = assistantMsg
    setMessages(prev => [...prev, userMsg, assistantMsg])

    const history = buildHistory()

    streamRef.current = adviserChat({
      message: text.trim(),
      history,
      sessionId,
      onEvent: (event, data) => {
        switch (event) {
          case 'session':
            setSessionId(data.sessionId)
            break
          case 'turn':
            // Could surface turn count, not needed for V1
            break
          case 'message': {
            const text = data.text || ''
            pendingAssistantRef.current.content =
              (pendingAssistantRef.current.content || '') + (pendingAssistantRef.current.content ? '\n\n' : '') + text
            setMessages(prev => [...prev.slice(0, -1), { ...pendingAssistantRef.current }])
            break
          }
          case 'tool_call': {
            pendingAssistantRef.current.toolEvents.push({
              id: data.id, name: data.name, input: data.input, status: 'running',
            })
            setMessages(prev => [...prev.slice(0, -1), { ...pendingAssistantRef.current }])
            break
          }
          case 'tool_result': {
            const evt = pendingAssistantRef.current.toolEvents.find(e => e.id === data.id)
            if (evt) {
              evt.status = data.result?.error ? 'error' : (data.result?.staged ? 'staged' : 'done')
              evt.result = data.result
            }
            setMessages(prev => [...prev.slice(0, -1), { ...pendingAssistantRef.current }])
            break
          }
          case 'plan':
            pendingAssistantRef.current.plan = data.steps || []
            setMessages(prev => [...prev.slice(0, -1), { ...pendingAssistantRef.current }])
            break
          case 'error':
            setLastError(data.message || 'Adviser error')
            setStatus('error')
            break
          case 'done':
            // Move into awaiting_confirm if we have staged steps, else idle.
            setStatus(prev => {
              if (prev === 'error') return 'error'
              const hasPlan = pendingAssistantRef.current?.plan?.length > 0
              return hasPlan ? 'awaiting_confirm' : 'idle'
            })
            break
          default:
            break
        }
      },
      onError: (err) => {
        setLastError(err.message || String(err))
        setStatus('error')
      },
      onDone: () => {
        streamRef.current = null
      },
    })
  }, [buildHistory, sessionId])

  const commit = useCallback(async () => {
    if (!sessionId) return
    if (status === 'committing') return
    setStatus('committing')
    try {
      const outcome = await adviserCommit(sessionId)
      if (outcome.ok) {
        // Mark the last assistant plan as committed
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== 'assistant') return prev
          return [...prev.slice(0, -1), { ...last, committed: true, commitResults: outcome.results }]
        })
        setStatus('committed')
        setSessionId(null) // server cleared the session on success
      } else {
        setLastError(outcome.error || 'Commit failed')
        setStatus('error')
        // Still keep the plan visible; user can abort + retry.
        if (outcome.results) {
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (!last || last.role !== 'assistant') return prev
            return [...prev.slice(0, -1), { ...last, commitResults: outcome.results }]
          })
        }
      }
    } catch (err) {
      setLastError(err.message || String(err))
      setStatus('error')
    }
  }, [sessionId, status])

  const abort = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.abort()
      streamRef.current = null
    }
    if (sessionId) {
      await adviserAbort(sessionId)
      setSessionId(null)
    }
    setStatus('idle')
  }, [sessionId])

  const reset = useCallback(async () => {
    if (streamRef.current) { streamRef.current.abort(); streamRef.current = null }
    if (sessionId) { await adviserAbort(sessionId) }
    setMessages([])
    setStatus('idle')
    setLastError(null)
    setSessionId(null)
    pendingAssistantRef.current = null
  }, [sessionId])

  return { messages, status, lastError, send, commit, abort, reset }
}
