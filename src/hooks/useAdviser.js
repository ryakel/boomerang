import { useCallback, useEffect, useRef, useState } from 'react'
import {
  adviserChat, adviserCommit, adviserAbort,
  adviserListChats, adviserGetActiveChat, adviserGetChat,
  adviserCreateChat, adviserUpdateChat, adviserDeleteChat,

  adviserActivateChat, adviserStarChat, adviserUnstarChat,
} from '../api'

function quokkaLog(...args) {
  const line = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
  console.log('[Quokka]', line)
  fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines: [`[Quokka] ${line}`] }),
  }).catch(() => {})
}

// Quokka now runs as multiple independent chats (replaces the old single-thread model).
// Each chat has its own messages, sessionId, starred state, createdAt, updatedAt, and an
// expiresAt timestamp (null when starred). Non-starred chats expire 30 days after last
// activity; unstarring a chat starts a 7-day grace period.
//
// Status semantics:
//   'idle' | 'streaming' | 'awaiting_confirm' | 'committing' | 'committed' | 'error' | 'queued'
//
// Background runner support (2026-05-17, F): the server-side chat turn now
// runs as a detached async task on the session, not the HTTP request. The
// client can disconnect (background the PWA, switch chats) and reconnect
// later — reconnection replays buffered events from the session. A new
// message arriving while the runner is busy is queued server-side and runs
// after the current turn completes / plan is committed.

export function useAdviser() {
  const [chats, setChats] = useState([]) // summaries only: {id,title,starred,createdAt,updatedAt,expiresAt,messageCount,isActive}
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [sessionId, _setSessionId] = useState(null)
  const sessionIdRef = useRef(null)
  const setSessionId = useCallback((id) => { sessionIdRef.current = id; _setSessionId(id) }, [])
  const [status, setStatus] = useState('idle')
  const [lastError, setLastError] = useState(null)
  const [hydrated, setHydrated] = useState(false)
  // Server-reported runner state for the active session: 'idle' | 'running'
  // | 'awaiting_confirm' | 'committed' | 'errored' | 'aborted'. Different
  // from `status` which is the client-side UI state — `runnerState`
  // tells us "is there server-side work in flight" so we can show "still
  // working in the background" indicators on reconnect.
  const [runnerState, setRunnerState] = useState('idle')
  // Length of the queued-messages buffer reported by the server. >0 means
  // a follow-up message will run after the current turn / commit.
  const [queueLength, setQueueLength] = useState(0)
  const streamRef = useRef(null)
  const pendingAssistantRef = useRef(null)
  const saveTimerRef = useRef(null)

  const refreshChatList = useCallback(async () => {
    const { chats, activeId } = await adviserListChats()
    setChats(chats)
    setActiveId(activeId)
    return { chats, activeId }
  }, [])

  // Hydrate: fetch list + active chat's full contents. If the active
  // chat has a sessionId, try to subscribe to any in-flight runner
  // (which may have been running while the user backgrounded the PWA).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { activeId } = await refreshChatList()
      if (cancelled) return
      if (activeId) {
        const { chat } = await adviserGetActiveChat()
        if (cancelled) return
        if (chat) {
          setMessages(chat.messages || [])
          setSessionId(chat.sessionId || null)
          // If there's an existing sessionId, opportunistically try to
          // re-attach. If the server's session is gone (TTL expired or
          // commit/abort happened), the subscribe will 404 and we stay
          // idle. If alive, the buffered events replay through the
          // event handler below — the user sees "still working" state.
          if (chat.sessionId) {
            tryResubscribe(chat.sessionId)
          }
        }
      }
      setHydrated(true)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshChatList])

  // Persist active chat's messages + sessionId, debounced. Never clobbers a chat with
  // the empty default state — so a brand-new (unsent) chat doesn't overwrite itself.
  useEffect(() => {
    if (!hydrated || !activeId) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      adviserUpdateChat(activeId, { messages, sessionId })
    }, 400)
    return () => clearTimeout(saveTimerRef.current)
  }, [messages, sessionId, hydrated, activeId])

  // Abort in-flight stream only when the app is tearing down. Modal open/close does not
  // unmount this hook.
  useEffect(() => () => {
    if (streamRef.current) streamRef.current.abort()
    if (sessionId) adviserAbort(sessionId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Shared SSE event handler. Used by both `send` (new user message) and
  // `tryResubscribe` (re-attach to an in-flight runner). The handler
  // mutates pendingAssistantRef + setMessages as events arrive.
  // `opts.expectingNewTurn` = true when we're starting fresh and the
  // first `turn` event should create an assistant placeholder; false when
  // we already have a placeholder set up by the caller.
  const makeEventHandler = useCallback((opts = {}) => {
    let placeholderReady = !opts.expectingNewTurn
    const ensurePlaceholder = () => {
      if (placeholderReady) return
      const placeholder = { role: 'assistant', content: '', toolEvents: [], plan: [] }
      pendingAssistantRef.current = placeholder
      setMessages(prev => {
        // If the last message is already an assistant placeholder from a
        // pre-disconnect render, reuse it. Otherwise append a new one.
        const last = prev[prev.length - 1]
        if (last?.role === 'assistant' && !last.committed) {
          pendingAssistantRef.current = { ...last }
          return prev
        }
        return [...prev, placeholder]
      })
      placeholderReady = true
    }

    return (event, data) => {
      switch (event) {
        case 'session':
          quokkaLog('stream connected, sessionId=' + data.sessionId, 'runnerState=' + (data.runnerState || 'idle'))
          setSessionId(data.sessionId)
          if (data.runnerState) setRunnerState(data.runnerState)
          break
        case 'runner_state':
          setRunnerState(data.state)
          // Map server runner state to client UI status.
          if (data.state === 'running') setStatus(prev => prev === 'error' ? 'error' : 'streaming')
          else if (data.state === 'awaiting_confirm') setStatus('awaiting_confirm')
          else if (data.state === 'idle') setStatus(prev => prev === 'error' ? 'error' : 'idle')
          else if (data.state === 'aborted') setStatus('idle')
          else if (data.state === 'errored') setStatus('error')
          break
        case 'queue_update':
          setQueueLength(data.length || 0)
          break
        case 'turn':
          ensurePlaceholder()
          break
        case 'message': {
          ensurePlaceholder()
          const t = data.text || ''
          if (!pendingAssistantRef.current) break
          pendingAssistantRef.current.content =
            (pendingAssistantRef.current.content || '') + (pendingAssistantRef.current.content ? '\n\n' : '') + t
          setMessages(prev => [...prev.slice(0, -1), { ...pendingAssistantRef.current }])
          break
        }
        case 'tool_call': {
          ensurePlaceholder()
          if (!pendingAssistantRef.current) break
          if (!pendingAssistantRef.current.toolEvents) pendingAssistantRef.current.toolEvents = []
          pendingAssistantRef.current.toolEvents.push({
            id: data.id, name: data.name, input: data.input, status: 'running',
          })
          setMessages(prev => [...prev.slice(0, -1), { ...pendingAssistantRef.current }])
          break
        }
        case 'tool_result': {
          if (!pendingAssistantRef.current) break
          const evt = (pendingAssistantRef.current.toolEvents || []).find(e => e.id === data.id)
          if (evt) {
            evt.status = data.result?.error ? 'error' : (data.result?.staged ? 'staged' : 'done')
            evt.result = data.result
          }
          setMessages(prev => [...prev.slice(0, -1), { ...pendingAssistantRef.current }])
          break
        }
        case 'plan':
          ensurePlaceholder()
          if (!pendingAssistantRef.current) break
          pendingAssistantRef.current.plan = data.steps || []
          setMessages(prev => [...prev.slice(0, -1), { ...pendingAssistantRef.current }])
          break
        case 'committed':
          // Server confirms the staged plan was applied. Mark the last
          // assistant message as committed so the UI shows "Applied N
          // changes." Reset placeholder so future events start fresh.
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (!last || last.role !== 'assistant') return prev
            return [...prev.slice(0, -1), { ...last, committed: true, commitResults: data.results || [] }]
          })
          setStatus('committed')
          pendingAssistantRef.current = null
          placeholderReady = false
          break
        case 'error':
          setLastError(data.message || 'Adviser error')
          setStatus('error')
          break
        case 'done': {
          const hasPlan = pendingAssistantRef.current?.plan?.length > 0
          quokkaLog('done, hasPlan=' + hasPlan)
          setStatus(prev => {
            if (prev === 'error') return 'error'
            return hasPlan ? 'awaiting_confirm' : 'idle'
          })
          refreshChatList()
          break
        }
        case 'push_sent':
          // Informational; no UI side effect needed.
          break
        default:
          break
      }
    }
  }, [refreshChatList])

  // Try to re-attach to an in-flight server session. If alive, opens an
  // SSE stream in subscribe-only mode — buffered events replay first,
  // then live events stream in. If the session is dead (404), no-op.
  const tryResubscribe = useCallback((sid) => {
    if (streamRef.current) return
    quokkaLog('resubscribe attempt, sessionId=' + sid)
    const handler = makeEventHandler({ expectingNewTurn: false })
    streamRef.current = adviserChat({
      sessionId: sid,
      subscribeOnly: true,
      onEvent: handler,
      onError: (err) => {
        if (!String(err?.message || '').includes('404')) {
          quokkaLog('resubscribe failed:', err?.message)
        }
        streamRef.current = null
      },
      onDone: () => { streamRef.current = null },
    })
  }, [makeEventHandler])

  const buildHistory = useCallback(() => {
    const history = []
    for (const m of messages) {
      if (m.role === 'user') history.push({ role: 'user', content: m.content })
      else if (m.role === 'assistant' && m.content) history.push({ role: 'assistant', content: m.content })
    }
    return history
  }, [messages])

  // Ensures we have an active chat to write into. If none, create one on demand so the
  // first user message has somewhere to land.
  const ensureActiveChat = useCallback(async () => {
    if (activeId) return activeId
    const { chat } = await adviserCreateChat()
    setActiveId(chat.id)
    await refreshChatList()
    return chat.id
  }, [activeId, refreshChatList])

  const send = useCallback(async (text) => {
    if (!text?.trim()) return
    if (streamRef.current) return

    const chatId = await ensureActiveChat()
    quokkaLog('send: message="' + text.trim().slice(0, 50) + '" sessionId=' + (sessionId || 'null'))
    setLastError(null)

    // If a server-side runner is busy or has a staged plan, the message
    // queues server-side. UI shows "queued" status until the runner
    // catches up. Otherwise: normal start.
    const willQueue = runnerState === 'running' || runnerState === 'awaiting_confirm'
    setStatus(willQueue ? 'queued' : 'streaming')

    const userMsg = { role: 'user', content: text.trim() }
    if (willQueue) {
      setMessages(prev => [...prev, userMsg])
    } else {
      const assistantMsg = { role: 'assistant', content: '', toolEvents: [], plan: [] }
      pendingAssistantRef.current = assistantMsg
      setMessages(prev => [...prev, userMsg, assistantMsg])
    }

    const history = buildHistory()
    const handler = makeEventHandler({ expectingNewTurn: !willQueue })

    streamRef.current = adviserChat({
      message: text.trim(),
      history,
      sessionId,
      chatId,
      onEvent: handler,
      onError: (err) => {
        const sid = sessionIdRef.current
        quokkaLog('stream error:', err.message || err, 'sessionId=' + (sid || 'null'))
        streamRef.current = null
        if (sid) {
          quokkaLog('auto-resubscribe in 2s, sessionId=' + sid)
          setTimeout(() => tryResubscribe(sid), 2000)
        } else {
          setLastError(err.message || String(err))
          setStatus('error')
        }
      },
      onDone: () => {
        streamRef.current = null
      },
    })
  }, [buildHistory, sessionId, ensureActiveChat, runnerState, makeEventHandler])

  const commit = useCallback(async () => {
    if (!sessionId) return
    if (status === 'committing') return
    setStatus('committing')
    try {
      const outcome = await adviserCommit(sessionId)
      if (outcome.ok) {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (!last || last.role !== 'assistant') return prev
          return [...prev.slice(0, -1), { ...last, committed: true, commitResults: outcome.results }]
        })
        setStatus('committed')
        // Session lives on (commit doesn't delete it now) so queued
        // follow-ups can advance. Keep sessionId for any new messages
        // in this conversation. Runner state will transition to idle
        // via the SSE stream, which is still subscribed.
      } else {
        setLastError(outcome.error || 'Commit failed')
        setStatus('error')
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

  // "New chat" — create a fresh chat and switch to it. The current chat stays put in the
  // list (it'll naturally expire in 30 days unless the user starred it).
  const newChat = useCallback(async () => {
    if (streamRef.current) { streamRef.current.abort(); streamRef.current = null }
    if (sessionId) { await adviserAbort(sessionId) }
    const { chat } = await adviserCreateChat()
    setActiveId(chat.id)
    setMessages([])
    setSessionId(null)
    setStatus('idle')
    setLastError(null)
    pendingAssistantRef.current = null
    await refreshChatList()
  }, [sessionId, refreshChatList])

  const switchChat = useCallback(async (id) => {
    if (id === activeId) return
    // Drop the SSE stream but DO NOT abort the server-side runner —
    // it can keep running in the background. The user might switch
    // chats while Quokka is mid-thought on the first one. When they
    // switch back, tryResubscribe re-attaches.
    if (streamRef.current) { streamRef.current.abort(); streamRef.current = null }
    await adviserActivateChat(id)
    const { chat } = await adviserGetChat(id)
    setActiveId(id)
    setMessages(chat.messages || [])
    setSessionId(chat.sessionId || null)
    setStatus('idle')
    setRunnerState('idle')
    setQueueLength(0)
    setLastError(null)
    pendingAssistantRef.current = null
    if (chat.sessionId) tryResubscribe(chat.sessionId)
    await refreshChatList()
  }, [activeId, refreshChatList, tryResubscribe])

  const deleteChat = useCallback(async (id) => {
    await adviserDeleteChat(id)
    if (id === activeId) {
      setActiveId(null)
      setMessages([])
      setSessionId(null)
      setStatus('idle')
      pendingAssistantRef.current = null
    }
    await refreshChatList()
  }, [activeId, refreshChatList])

  const starChat = useCallback(async (id) => {
    await adviserStarChat(id)
    await refreshChatList()
  }, [refreshChatList])

  const unstarChat = useCallback(async (id) => {
    await adviserUnstarChat(id)
    await refreshChatList()
  }, [refreshChatList])

  // Convenience: the active chat summary (for UI banners)
  const activeChat = chats.find(c => c.id === activeId) || null

  return {
    // Active-chat surface
    messages, status, lastError,
    send, commit, abort,
    // Background-runner state — UI can show "still working" indicators
    // when reconnecting mid-turn, "queued" pill when a follow-up message
    // is waiting, etc.
    runnerState, queueLength,
    // Multi-chat surface
    chats, activeId, activeChat,
    newChat, switchChat, deleteChat, starChat, unstarChat,
    refreshChatList,
  }
}
