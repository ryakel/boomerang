import { useEffect, useRef, useState } from 'react'
import { Sparkles, Send, StopCircle, RotateCcw, CheckCircle2, XCircle, Loader2, History, Trash2 } from 'lucide-react'
import { renderMarkdown } from '../utils/renderMarkdown'
import './Adviser.css'

const PROMPT_SUGGESTIONS = [
  "I've rescheduled my FAA exam — adjust related tasks",
  'Move my lawn-care tasks to next weekend (bad weather coming)',
  'What should I tackle right now?',
  'Clean up tasks that have been sitting over 30 days',
]

export default function Adviser({ adviser, onClose, isDesktop, onAfterCommit }) {
  // Adviser state is owned by App so the thread survives modal close/reopen.
  const {
    messages, status, lastError,
    send, commit, abort, reset,
    listArchive, rehydrate, deleteArchived,
  } = adviser
  const [input, setInput] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [archive, setArchive] = useState(null) // null = not loaded
  const [archiveLoading, setArchiveLoading] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  const openHistory = async () => {
    setShowHistory(true)
    setArchiveLoading(true)
    try {
      const list = await listArchive()
      setArchive(list)
    } finally {
      setArchiveLoading(false)
    }
  }

  const handleRehydrate = async (id) => {
    const ok = await rehydrate(id)
    if (ok) setShowHistory(false)
  }

  const handleDeleteArchived = async (id) => {
    await deleteArchived(id)
    setArchive(prev => (prev || []).filter(t => t.id !== id))
  }

  // Auto-scroll to bottom on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, status])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Auto-grow the textarea with its content, capped at max-height via CSS
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [input])

  // After a successful commit, give the app a tick then call onAfterCommit
  useEffect(() => {
    if (status === 'committed' && onAfterCommit) {
      onAfterCommit()
    }
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

  const historyPanel = showHistory ? (
    <HistoryPanel
      archive={archive}
      loading={archiveLoading}
      onRehydrate={handleRehydrate}
      onDelete={handleDeleteArchived}
      onClose={() => setShowHistory(false)}
    />
  ) : null

  const headerActions = (
    <div className="adviser-header-actions">
      <button className="adviser-reset-btn" onClick={openHistory} title="Past chats" aria-label="Past chats">
        <History size={16} />
      </button>
      <button className="adviser-reset-btn" onClick={reset} title="Start over" aria-label="Start over">
        <RotateCcw size={16} />
      </button>
    </div>
  )

  const body = (
    <>
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
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
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
          <span>Changes applied. You can ask for more or start over.</span>
          <button className="adviser-inline-btn" onClick={reset}>new chat</button>
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
          {showHistory ? historyPanel : body}
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
      {showHistory ? historyPanel : body}
    </div>
  )
}

function HistoryPanel({ archive, loading, onRehydrate, onDelete, onClose }) {
  return (
    <div className="adviser-history">
      <div className="adviser-history-header">
        <div className="adviser-history-title">Past chats</div>
        <button className="adviser-inline-btn" onClick={onClose}>← back to chat</button>
      </div>
      <div className="adviser-history-list">
        {loading && (
          <div className="adviser-status">
            <Loader2 size={14} className="adviser-spinner" />
            <span>loading…</span>
          </div>
        )}
        {!loading && archive && archive.length === 0 && (
          <div className="adviser-history-empty">
            No past chats yet. They appear here automatically when you hit "Start over" or when a chat has been idle for 24 hours.
          </div>
        )}
        {!loading && archive && archive.map(t => (
          <div key={t.id} className="adviser-history-item">
            <button className="adviser-history-row" onClick={() => onRehydrate(t.id)}>
              <div className="adviser-history-row-title">{t.title}</div>
              <div className="adviser-history-row-meta">
                {new Date(t.archivedAt).toLocaleString()} · {t.messageCount} message{t.messageCount !== 1 ? 's' : ''}
              </div>
            </button>
            <button className="adviser-history-delete" onClick={() => onDelete(t.id)} aria-label="Delete" title="Delete">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
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
