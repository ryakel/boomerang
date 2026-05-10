import { useEffect, useRef, useState } from 'react'
import {
  Sparkles, Send, StopCircle, CheckCircle2, XCircle, Loader2,
  History, Trash2, Plus, Star, AlertCircle,
} from 'lucide-react'
import { renderMarkdown } from '../../utils/renderMarkdown'
import ModalShell from './ModalShell'
import EmptyState from './EmptyState'
import TypingSuggestions from './TypingSuggestions'
import './AdviserModal.css'

const PROMPT_SUGGESTIONS = [
  "I've rescheduled my exam — adjust related tasks",
  'Move my lawn-care tasks to next weekend (bad weather coming)',
  'What should I tackle right now?',
  'Clean up tasks that have been sitting over 30 days',
]

const DAY_MS = 24 * 60 * 60 * 1000

function daysUntil(ts) {
  if (ts == null) return null
  return Math.ceil((ts - Date.now()) / DAY_MS)
}

function formatToolName(name) {
  return (name || '').replace(/_/g, ' ')
}

function ToolStepIcon({ status }) {
  if (status === 'running') return <Loader2 size={12} className="v2-adviser-spin" />
  if (status === 'error') return <XCircle size={12} />
  if (status === 'staged') return <span className="v2-adviser-tool-staged-dot">●</span>
  return <CheckCircle2 size={12} />
}

function MessageBubble({ message }) {
  if (message.role === 'user') {
    return (
      <div className="v2-adviser-msg v2-adviser-msg-user">
        <div className="v2-adviser-msg-content">{message.content}</div>
      </div>
    )
  }
  const events = message.toolEvents || []
  const plan = message.plan || []
  return (
    <div className="v2-adviser-msg v2-adviser-msg-assistant">
      {events.length > 0 && (
        <div className="v2-adviser-tool-log">
          {events.map((e, i) => (
            <div key={i} className={`v2-adviser-tool-step v2-adviser-tool-${e.status}`}>
              <ToolStepIcon status={e.status} />
              <span className="v2-adviser-tool-name">{formatToolName(e.name)}</span>
              {e.status === 'error' && e.result?.error && (
                <span className="v2-adviser-tool-error">{e.result.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {message.content && (
        <div className="v2-adviser-msg-content v2-adviser-msg-markdown">
          {renderMarkdown(typeof message.content === 'string' ? message.content : String(message.content ?? ''))}
        </div>
      )}
      {plan.length > 0 && !message.committed && (
        <div className="v2-adviser-plan">
          <div className="v2-adviser-plan-title">Planned changes ({plan.length})</div>
          {plan.map(step => (
            <div key={step.stepId} className="v2-adviser-plan-step">
              <span className="v2-adviser-plan-bullet">›</span>
              <span>{step.preview}</span>
            </div>
          ))}
        </div>
      )}
      {message.committed && message.commitResults && (
        <div className="v2-adviser-plan v2-adviser-plan-committed">
          <div className="v2-adviser-plan-title">
            <CheckCircle2 size={14} /> Applied {message.commitResults.filter(r => r.ok).length} change{message.commitResults.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

function ExpiryBanner({ chat, onStar }) {
  if (chat?.starred || chat?.expiresAt == null) return null
  const days = daysUntil(chat.expiresAt)
  if (days == null || days > 7) return null
  return (
    <div className="v2-adviser-expiry">
      <AlertCircle size={14} />
      <span>This chat will be deleted in {days <= 0 ? 'less than a day' : `${days} day${days !== 1 ? 's' : ''}`}.</span>
      <button className="v2-adviser-link" onClick={onStar}>star to keep</button>
    </div>
  )
}

function ChatList({ chats, activeId, onSwitch, onDelete, onStar, onUnstar, onNew, onBack }) {
  return (
    <div className="v2-adviser-history">
      <div className="v2-adviser-history-bar">
        <button className="v2-adviser-history-btn" onClick={onBack}>← Back to chat</button>
        <button className="v2-adviser-history-btn v2-adviser-history-btn-primary" onClick={onNew}>
          <Plus size={14} strokeWidth={2} /> New
        </button>
      </div>
      {chats.length === 0 ? (
        <EmptyState
          title="No chats yet"
          body="Start a conversation and it'll appear here."
        />
      ) : (
        <ul className="v2-adviser-chat-list">
          {chats.map(c => {
            const days = daysUntil(c.expiresAt)
            const expiring = !c.starred && days != null && days <= 7
            const active = c.id === activeId
            return (
              <li key={c.id} className={`v2-adviser-chat-item${active ? ' v2-adviser-chat-item-active' : ''}`}>
                <button className="v2-adviser-chat-row" onClick={() => onSwitch(c.id)}>
                  <div className="v2-adviser-chat-title">
                    {active && <span className="v2-adviser-chat-active-dot">●</span>}
                    {c.title || 'Untitled chat'}
                  </div>
                  <div className="v2-adviser-chat-meta">
                    {new Date(c.updatedAt).toLocaleString()} · {c.messageCount} msg{c.messageCount !== 1 ? 's' : ''}
                    {c.starred && <span className="v2-adviser-chat-star"> · ⭐ starred</span>}
                    {expiring && (
                      <span className="v2-adviser-chat-expiring">
                        {' · '}expires in {days <= 0 ? '<1' : days}d
                      </span>
                    )}
                  </div>
                </button>
                <button
                  className="v2-adviser-chat-icon-btn"
                  onClick={() => c.starred ? onUnstar(c.id) : onStar(c.id)}
                  title={c.starred ? 'Unstar (7-day grace)' : 'Star to keep'}
                  aria-label={c.starred ? 'Unstar' : 'Star'}
                >
                  <Star size={14} fill={c.starred ? 'currentColor' : 'none'} />
                </button>
                <button
                  className="v2-adviser-chat-icon-btn v2-adviser-chat-icon-btn-danger"
                  onClick={() => onDelete(c.id)}
                  title="Delete"
                  aria-label="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function AdviserModal({ open, adviser, onClose, onAfterCommit }) {
  const {
    messages, status, lastError,
    send, commit, abort,
    chats, activeId, activeChat,
    newChat, switchChat, deleteChat, starChat, unstarChat,
  } = adviser
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, status])

  useEffect(() => { if (open && !showHistory) inputRef.current?.focus() }, [open, activeId, showHistory])

  // Auto-grow textarea up to a sensible max.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  useEffect(() => {
    if (status === 'committed' && onAfterCommit) onAfterCommit()
  }, [status, onAfterCommit])

  const streaming = status === 'streaming'
  const committing = status === 'committing'
  const awaitingConfirm = status === 'awaiting_confirm'
  const canSend = input.trim().length > 0 && !streaming && !committing

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!canSend) return
    send(input)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const handleNewChat = async () => {
    await newChat()
    setShowHistory(false)
  }

  const handleSwitch = async (id) => {
    await switchChat(id)
    setShowHistory(false)
  }

  return (
    <ModalShell open={open} onClose={onClose} title="Quokka" terminalTitle="> quokka" width="wide">
      <div className="v2-adviser-toolbar">
        <button
          className="v2-adviser-tool-btn"
          onClick={() => setShowHistory(v => !v)}
          aria-label="Chat history"
        >
          <History size={14} strokeWidth={1.75} /> {chats.length > 0 ? `${chats.length} chat${chats.length !== 1 ? 's' : ''}` : 'Chats'}
        </button>
        <button
          className="v2-adviser-tool-btn v2-adviser-tool-btn-primary"
          onClick={handleNewChat}
        >
          <Plus size={14} strokeWidth={2} /> New chat
        </button>
      </div>

      {showHistory ? (
        <ChatList
          chats={chats}
          activeId={activeId}
          onSwitch={handleSwitch}
          onDelete={deleteChat}
          onStar={starChat}
          onUnstar={unstarChat}
          onNew={handleNewChat}
          onBack={() => setShowHistory(false)}
        />
      ) : (
        <>
          {activeChat && <ExpiryBanner chat={activeChat} onStar={() => starChat(activeChat.id)} />}

          <div className="v2-adviser-messages" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="v2-adviser-empty">
                <div className="v2-adviser-empty-icon"><Sparkles size={28} strokeWidth={1.5} /></div>
                <div className="v2-adviser-empty-title">G'day from Quokka</div>
                <div className="v2-adviser-empty-body">
                  I can make changes across tasks, routines, calendar, Notion, Trello, Gmail, packages, weather, and settings. Every action is previewed before it runs.
                </div>
                <TypingSuggestions
                  phrases={PROMPT_SUGGESTIONS}
                  onSelect={(s) => { setInput(s); inputRef.current?.focus() }}
                />
              </div>
            ) : (
              <>
                {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
                {streaming && (
                  <div className="v2-adviser-status">
                    <Loader2 size={14} className="v2-adviser-spin" />
                    <span>thinking…</span>
                    <button className="v2-adviser-link" onClick={abort}>stop</button>
                  </div>
                )}
                {committing && (
                  <div className="v2-adviser-status">
                    <Loader2 size={14} className="v2-adviser-spin" />
                    <span>applying changes…</span>
                  </div>
                )}
                {lastError && (
                  <div className="v2-adviser-error">
                    <XCircle size={14} />
                    <span>{lastError}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {awaitingConfirm && (
            <div className="v2-adviser-confirm-bar">
              <div className="v2-adviser-confirm-summary">
                Review the {(messages[messages.length - 1]?.plan || []).length} planned change{(messages[messages.length - 1]?.plan || []).length !== 1 ? 's' : ''} above.
              </div>
              <div className="v2-adviser-confirm-actions">
                <button className="v2-adviser-btn v2-adviser-btn-secondary" onClick={abort}>Cancel</button>
                <button className="v2-adviser-btn v2-adviser-btn-primary" onClick={commit}>
                  Apply {(messages[messages.length - 1]?.plan || []).length} change{(messages[messages.length - 1]?.plan || []).length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          )}

          {status === 'committed' && (
            <div className="v2-adviser-committed-bar">
              <CheckCircle2 size={16} />
              <span>Changes applied. Ask for more or start a fresh chat.</span>
              <button className="v2-adviser-link" onClick={handleNewChat}>new chat</button>
            </div>
          )}

          <form className="v2-adviser-composer" onSubmit={handleSubmit}>
            <textarea
              ref={inputRef}
              className="v2-adviser-input"
              placeholder={awaitingConfirm ? 'Confirm or cancel the plan above first…' : 'What should I do?'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={streaming || committing || awaitingConfirm}
            />
            <button type="submit" className="v2-adviser-send" disabled={!canSend} aria-label="Send">
              {streaming ? <StopCircle size={18} /> : <Send size={18} strokeWidth={1.75} />}
            </button>
          </form>
        </>
      )}
    </ModalShell>
  )
}
