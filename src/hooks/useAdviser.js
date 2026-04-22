import { useCallback, useEffect, useRef, useState } from 'react'
import {
  adviserChat, adviserCommit, adviserAbort,
  adviserGetThread, adviserSaveThread, adviserClearThread,
  adviserListArchive, adviserGetArchivedThread, adviserDeleteArchivedThread, adviserRehydrateThread,
} from '../api'

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
  const [hydrated, setHydrated] = useState(false)
  const streamRef = useRef(null)
  const pendingAssistantRef = useRef(null)
  const saveTimerRef = useRef(null)

  // Hydrate thread from server on mount — iOS aggressively evicts PWA memory,
  // so we can't rely on React state surviving an app-switch. Thread lives in
  // app_data server-side and is fetched on every fresh load.
  useEffect(() => {
    let cancelled = false
    adviserGetThread().then(data => {
      if (cancelled) return
      if (Array.isArray(data.messages) && data.messages.length > 0) {
        setMessages(data.messages)
      }
      if (data.sessionId) setSessionId(data.sessionId)
      setHydrated(true)
    })
    return () => { cancelled = true }
  }, [])

  // Persist thread changes to server, debounced so we don't hammer during a
  // streaming response. Only saves after initial hydration to avoid clobbering
  // a restored thread with the empty default state.
  useEffect(() => {
    if (!hydrated) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      adviserSaveThread({ messages, sessionId })
    }, 400)
    return () => clearTimeout(saveTimerRef.current)
  }, [messages, sessionId, hydrated])

  // Abort the in-flight stream only when the App itself unmounts (i.e. the
  // page is closing). The modal opening/closing does NOT tear down this hook.
  useEffect(() => () => {
    if (streamRef.current) streamRef.current.abort()
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
        // Log full details so Safari remote debugging can see what actually
        // died — the user-facing banner only shows err.message (usually just
        // "Load failed" on iOS).
        console.error('[Quokka] stream error', err)
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
    // Archive-then-clear: the server DELETE moves the current thread into the
    // archive list so it's still accessible via the history UI.
    await adviserClearThread()
  }, [sessionId])

  // --- History / archive ---

  const listArchive = useCallback(() => adviserListArchive(), [])
  const deleteArchived = useCallback((id) => adviserDeleteArchivedThread(id), [])

  const rehydrate = useCallback(async (id) => {
    if (streamRef.current) { streamRef.current.abort(); streamRef.current = null }
    if (sessionId) { await adviserAbort(sessionId) }
    try {
      const restored = await adviserRehydrateThread(id)
      setMessages(restored.messages || [])
      setSessionId(null) // fresh session on next /chat call
      setStatus('idle')
      setLastError(null)
      pendingAssistantRef.current = null
      return true
    } catch (err) {
      setLastError(err.message || String(err))
      return false
    }
  }, [sessionId])

  const previewArchived = useCallback((id) => adviserGetArchivedThread(id), [])

  return {
    messages, status, lastError,
    send, commit, abort, reset,
    listArchive, rehydrate, deleteArchived, previewArchived,
  }
}
