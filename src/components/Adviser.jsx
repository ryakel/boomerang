import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, StopCircle, CheckCircle2, XCircle, Loader2, History, Trash2, Plus, Star, AlertCircle } from 'lucide-react'
import { renderMarkdown } from '../utils/renderMarkdown'
import './Adviser.css'

const PROMPT_SUGGESTIONS = [
  "I've rescheduled my FAA exam — adjust related tasks",
  'Move my lawn-care tasks to next weekend (bad weather coming)',
  'What should I tackle right now?',
  'Clean up tasks that have been sitting over 30 days',
]

const DAY_MS = 24 * 60 * 60 * 1000

export default function Adviser({ adviser, onClose, isDesktop, onAfterCommit }) {
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

  useEffect(() => { inputRef.current?.focus() }, [activeId])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
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

  const headerActions = (
    <div className="adviser-header-actions">
      <button className="adviser-reset-btn" onClick={() => setShowHistory(v => !v)} title="Chats" aria-label="Chats">
        <History size={16} />
      </button>
      <button className="adviser-reset-btn" onClick={handleNewChat} title="New chat" aria-label="New chat">
        <Plus size={16} />
      </button>
    </div>
  )

  const body = (
    <>
      {activeChat && <ExpiryBanner chat={activeChat} onStar={() => starChat(activeChat.id)} />}

      <div className="adviser-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="adviser-empty">
            <Sparkles size={32} className="adviser-empty-icon" />
            <div className="adviser-empty-title">Quokka</div>
            <div className="adviser-empty-sub">
              G'day! I can make changes across your tasks, routines, calendar, Notion, Trello, Gmail, or settings. Every action is previewed — nothing runs until you confirm.
            </div>
            <div className="adviser-suggestions">
              {PROMPT_SUGGESTIONS.map((s, i) => (
                <button key={i} className="adviser-suggestion" onClick={() => { setInput(s); inputRef.current?.focus() }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => <MessageBubble key={i} message={m} />)}
        {streaming && (
          <div className="adviser-status">
            <Loader2 size={14} className="adviser-spinner" />
            <span>thinking…</span>
            <button className="adviser-inline-btn" onClick={abort}>stop</button>
          </div>
        )}
        {committing && (
          <div className="adviser-status">
            <Loader2 size={14} className="adviser-spinner" />
            <span>applying changes…</span>
          </div>
        )}
        {lastError && (
          <div className="adviser-error">
            <XCircle size={14} />
            <span>{lastError}</span>
          </div>
        )}
      </div>

      {awaitingConfirm && (
        <ConfirmBar
          plan={messages[messages.length - 1]?.plan || []}
          onConfirm={commit}
          onAbort={abort}
        />
      )}

      {status === 'committed' && (
        <div className="adviser-committed-bar">
          <CheckCircle2 size={16} />
          <span>Changes applied. You can ask for more or start a fresh chat.</span>
          <button className="adviser-inline-btn" onClick={handleNewChat}>new chat</button>
        </div>
      )}

      <form className="adviser-composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="adviser-input"
          placeholder={awaitingConfirm ? 'Confirm or reject the plan above first…' : 'What should I do?'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={streaming || committing || awaitingConfirm}
        />
        <button type="submit" className="adviser-send" disabled={!canSend} aria-label="Send">
          {streaming ? <StopCircle size={18} /> : <Send size={18} />}
        </button>
      </form>
    </>
  )

  const panel = showHistory ? (
    <ChatListPanel
      chats={chats}
      activeId={activeId}
      onSwitch={handleSwitch}
      onDelete={deleteChat}
      onStar={starChat}
      onUnstar={unstarChat}
      onNew={handleNewChat}
      onClose={() => setShowHistory(false)}
    />
  ) : null

  if (isDesktop) {
    return (
      <div className="sheet-overlay" onClick={onClose}>
        <div className="sheet adviser-sheet" onClick={e => e.stopPropagation()}>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
          <div className="edit-task-title-row">
            <div className="sheet-title">
              <Sparkles size={18} className="adviser-title-icon" />
              <span>Quokka</span>
            </div>
            {headerActions}
          </div>
          {showHistory ? panel : body}
        </div>
      </div>
    )
  }

  return (
    <div className="settings-overlay adviser-mobile-overlay">
      <div className="settings-header">
        <button className="settings-back" onClick={onClose}>← Back</button>
        <div className="sheet-title adviser-mobile-title" style={{ margin: 0 }}>
          <Sparkles size={16} className="adviser-title-icon" />
          <span>Quokka</span>
        </div>
        {headerActions}
      </div>
      {showHistory ? panel : body}
    </div>
  )
}

function daysUntil(ts) {
  if (ts == null) return null
  return Math.ceil((ts - Date.now()) / DAY_MS)
}

// Banner shown above the messages area when the active chat is approaching expiry and
// isn't starred. Threshold at 7 days covers both the normal 30d TTL winding down AND the
// explicit 7-day grace period after unstarring.
function ExpiryBanner({ chat, onStar }) {
  if (chat.starred || chat.expiresAt == null) return null
  const days = daysUntil(chat.expiresAt)
  if (days == null || days > 7) return null
  return (
    <div className="adviser-expiry-banner">
      <AlertCircle size={14} />
      <span>
        This chat will be deleted in {days <= 0 ? 'less than a day' : `${days} day${days !== 1 ? 's' : ''}`}.
      </span>
      <button className="adviser-inline-btn" onClick={onStar}>star to keep</button>
    </div>
  )
}

function ChatListPanel({ chats, activeId, onSwitch, onDelete, onStar, onUnstar, onNew, onClose }) {
  return (
    <div className="adviser-history">
      <div className="adviser-history-header">
        <div className="adviser-history-title">Chats</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="adviser-inline-btn" onClick={onNew}>+ new</button>
          <button className="adviser-inline-btn" onClick={onClose}>← back</button>
        </div>
      </div>
      <div className="adviser-history-list">
        {chats.length === 0 && (
          <div className="adviser-history-empty">
            No chats yet. Start a conversation and it'll appear here.
          </div>
        )}
        {chats.map(c => {
          const days = daysUntil(c.expiresAt)
          const expiring = !c.starred && days != null && days <= 7
          return (
            <div key={c.id} className={`adviser-history-item${c.id === activeId ? ' is-active' : ''}`}>
              <button className="adviser-history-row" onClick={() => onSwitch(c.id)}>
                <div className="adviser-history-row-title">
                  {c.id === activeId && <span className="adviser-history-active-dot">●</span>}
                  {c.title}
                </div>
                <div className="adviser-history-row-meta">
                  {new Date(c.updatedAt).toLocaleString()} · {c.messageCount} msg{c.messageCount !== 1 ? 's' : ''}
                  {c.starred && <span className="adviser-history-starred"> · ⭐ starred</span>}
                  {expiring && (
                    <span className="adviser-history-expiring">
                      {' · '}expires in {days <= 0 ? '<1' : days}d
                    </span>
                  )}
                </div>
              </button>
              <button
                className="adviser-history-delete"
                onClick={() => c.starred ? onUnstar(c.id) : onStar(c.id)}
                aria-label={c.starred ? 'Unstar' : 'Star'}
                title={c.starred ? 'Unstar (7-day grace)' : 'Star to keep'}
              >
                <Star size={14} fill={c.starred ? 'currentColor' : 'none'} />
              </button>
              <button className="adviser-history-delete" onClick={() => onDelete(c.id)} aria-label="Delete" title="Delete">
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MessageBubble({ message }) {
  if (message.role === 'user') {
    return (
      <div className="adviser-msg adviser-msg-user">
        <div className="adviser-msg-content">{message.content}</div>
      </div>
    )
  }
  const events = message.toolEvents || []
  const plan = message.plan || []
  return (
    <div className="adviser-msg adviser-msg-assistant">
      {events.length > 0 && (
        <div className="adviser-tool-log">
          {events.map((e, i) => (
            <div key={i} className={`adviser-tool-step adviser-tool-${e.status}`}>
              <ToolStepIcon status={e.status} />
              <span className="adviser-tool-name">{formatToolName(e.name)}</span>
              {e.status === 'error' && e.result?.error && (
                <span className="adviser-tool-error">{e.result.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {message.content && (
        <div className="adviser-msg-content adviser-msg-markdown">{renderMarkdown(message.content)}</div>
      )}
      {plan.length > 0 && !message.committed && (
        <div className="adviser-plan-preview">
          <div className="adviser-plan-title">Planned changes ({plan.length}):</div>
          {plan.map(step => (
            <div key={step.stepId} className="adviser-plan-step">
              <span className="adviser-plan-bullet">›</span>
              <span>{step.preview}</span>
            </div>
          ))}
        </div>
      )}
      {message.committed && message.commitResults && (
        <div className="adviser-plan-preview adviser-plan-committed">
          <div className="adviser-plan-title">
            <CheckCircle2 size={14} /> Applied {message.commitResults.filter(r => r.ok).length} change{message.commitResults.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  )
}

function ToolStepIcon({ status }) {
  if (status === 'running') return <Loader2 size={12} className="adviser-spinner" />
  if (status === 'error') return <XCircle size={12} />
  if (status === 'staged') return <span className="adviser-tool-staged-dot">●</span>
  return <CheckCircle2 size={12} />
}

function formatToolName(name) {
  return (name || '').replace(/_/g, ' ')
}

function ConfirmBar({ plan, onConfirm, onAbort }) {
  return (
    <div className="adviser-confirm-bar">
      <div className="adviser-confirm-summary">
        Review the {plan.length} planned change{plan.length !== 1 ? 's' : ''} above.
      </div>
      <div className="adviser-confirm-actions">
        <button className="adviser-btn adviser-btn-secondary" onClick={onAbort}>Cancel</button>
        <button className="adviser-btn adviser-btn-primary" onClick={onConfirm}>
          Apply {plan.length} change{plan.length !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  )
}
