import { useCallback, useEffect, useRef, useState } from 'react'
import {
  adviserChat, adviserCommit, adviserAbort,
  adviserListChats, adviserGetActiveChat, adviserGetChat,
  adviserCreateChat, adviserUpdateChat, adviserDeleteChat,
  adviserActivateChat, adviserStarChat, adviserUnstarChat,
} from '../api'

// Quokka now runs as multiple independent chats (replaces the old single-thread model).
// Each chat has its own messages, sessionId, starred state, createdAt, updatedAt, and an
// expiresAt timestamp (null when starred). Non-starred chats expire 30 days after last
// activity; unstarring a chat starts a 7-day grace period.
//
// Status semantics are unchanged from the single-thread era:
//   'idle' | 'streaming' | 'awaiting_confirm' | 'committing' | 'committed' | 'error'

export function useAdviser() {
  const [chats, setChats] = useState([]) // summaries only: {id,title,starred,createdAt,updatedAt,expiresAt,messageCount,isActive}
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [status, setStatus] = useState('idle')
  const [lastError, setLastError] = useState(null)
  const [hydrated, setHydrated] = useState(false)
  const streamRef = useRef(null)
  const pendingAssistantRef = useRef(null)
  const saveTimerRef = useRef(null)

  const refreshChatList = useCallback(async () => {
    const { chats, activeId } = await adviserListChats()
    setChats(chats)
    setActiveId(activeId)
    return { chats, activeId }
  }, [])

  // Hydrate: fetch list + active chat's full contents.
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
        }
      }
      setHydrated(true)
    })()
    return () => { cancelled = true }
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

    await ensureActiveChat()
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
            break
          case 'message': {
            const t = data.text || ''
            pendingAssistantRef.current.content =
              (pendingAssistantRef.current.content || '') + (pendingAssistantRef.current.content ? '\n\n' : '') + t
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
            setStatus(prev => {
              if (prev === 'error') return 'error'
              const hasPlan = pendingAssistantRef.current?.plan?.length > 0
              return hasPlan ? 'awaiting_confirm' : 'idle'
            })
            // Refresh chat list so the title/expiresAt update from this turn is visible
            // in the chat list UI without a manual refresh.
            refreshChatList()
            break
          default:
            break
        }
      },
      onError: (err) => {
        console.error('[Quokka] stream error', err)
        setLastError(err.message || String(err))
        setStatus('error')
      },
      onDone: () => {
        streamRef.current = null
      },
    })
  }, [buildHistory, sessionId, ensureActiveChat, refreshChatList])

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
        setSessionId(null)
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
    if (streamRef.current) { streamRef.current.abort(); streamRef.current = null }
    if (sessionId) { await adviserAbort(sessionId) }
    await adviserActivateChat(id)
    const { chat } = await adviserGetChat(id)
    setActiveId(id)
    setMessages(chat.messages || [])
    setSessionId(chat.sessionId || null)
    setStatus('idle')
    setLastError(null)
    pendingAssistantRef.current = null
    await refreshChatList()
  }, [activeId, sessionId, refreshChatList])

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
    // Active-chat surface (unchanged API for the old UI)
    messages, status, lastError,
    send, commit, abort,
    // Multi-chat surface
    chats, activeId, activeChat,
    newChat, switchChat, deleteChat, starChat, unstarChat,
    refreshChatList,
  }
}
