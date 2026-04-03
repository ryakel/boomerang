import { useState, useRef, useEffect } from 'react'
import { loadLabels, loadSettings, RECURRENCE_OPTIONS, ENERGY_TYPES } from '../store'
import { researchTask, trelloCreateCard, trelloBoardLists } from '../api'
import { useTaskForm } from '../hooks/useTaskForm'

export default function EditTaskModal({ task, onSave, onConvertToRoutine, onClose }) {
  const form = useTaskForm({
    title: task.title,
    notes: task.notes || '',
    tags: task.tags || [],
    dueDate: task.due_date || '',
    size: task.size || null,
    energy: task.energy || null,
    energyLevel: task.energyLevel || null,
    highPriority: task.high_priority || false,
    notion: task.notion_page_id ? { id: task.notion_page_id, url: task.notion_url } : null,
    attachments: task.attachments || [],
  })

  // EditTaskModal-specific state
  const [showResearch, setShowResearch] = useState(false)
  const [researchPrompt, setResearchPrompt] = useState('')
  const [researching, setResearching] = useState(false)
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [cadence, setCadence] = useState('weekly')
  const [customDays, setCustomDays] = useState(14)
  const [checklist, setChecklist] = useState(task.checklist || [])
  const [newCheckItem, setNewCheckItem] = useState('')
  const [comments, setComments] = useState(task.comments || [])
  const [newComment, setNewComment] = useState('')
  const [trelloResult, setTrelloResult] = useState(
    task.trello_card_id ? { id: task.trello_card_id, url: task.trello_card_url } : null
  )
  const [trelloPushing, setTrelloPushing] = useState(false)
  const [trelloLists, setTrelloLists] = useState([])
  const [trelloConfigured] = useState(() => {
    const s = loadSettings()
    return !!(s.trello_board_id || s.trello_list_mapping)
  })
  const [trelloPushListId, setTrelloPushListId] = useState(() => {
    const s = loadSettings()
    const status = task.status === 'backlog' ? 'not_started' : (task.status || 'not_started')
    const mappedList = s.trello_list_mapping?.[status]
    return mappedList || s.trello_list_id || ''
  })

  const inputRef = useRef(null)
  const labels = loadLabels()

  useEffect(() => {
    inputRef.current?.focus()
    const s = loadSettings()
    if (s.trello_board_id) {
      trelloBoardLists(s.trello_board_id).then(lists => {
        setTrelloLists(lists)
        if (!trelloPushListId && lists.length > 0) {
          setTrelloPushListId(lists[0].id)
        }
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = () => {
    if (!form.title.trim()) return
    if (makeRecurring) {
      onConvertToRoutine(task.id, {
        title: form.title.trim(),
        cadence,
        customDays: cadence === 'custom' ? customDays : null,
        tags: form.selectedTags,
        notes: form.notes.trim(),
      })
    } else {
      const formData = form.getFormData()
      onSave(task.id, {
        title: formData.title,
        notes: formData.notes,
        tags: formData.tags,
        due_date: formData.dueDate,
        size: formData.size,
        energy: formData.energy,
        energyLevel: formData.energyLevel,
        high_priority: formData.highPriority,
        notion_page_id: formData.notion?.id || null,
        notion_url: formData.notion?.url || null,
        trello_card_id: trelloResult?.id || null,
        trello_card_url: trelloResult?.url || null,
        attachments: formData.attachments,
        checklist,
        comments,
      })
    }
    onClose()
  }

  const handleTrelloPush = async () => {
    if (!form.title.trim() || !trelloPushListId) return
    setTrelloPushing(true)
    try {
      const card = await trelloCreateCard(form.title.trim(), form.notes.trim(), trelloPushListId)
      setTrelloResult({ id: card.id, url: card.url })
    } catch { /* ignore */ }
    finally { setTrelloPushing(false) }
  }

  const handleResearch = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!researchPrompt.trim()) return
    setResearching(true)
    try {
      const result = await researchTask(form.title || 'Untitled task', form.notes, researchPrompt.trim())
      if (result.notes) {
        const separator = form.notes.trim() ? '\n\n' : ''
        form.setNotes(prev => (prev.trim() ? prev.trim() + separator : '') + result.notes)
      }
      setResearchPrompt('')
      setShowResearch(false)
    } catch { /* ignore */ }
    finally { setResearching(false) }
  }

  const today = new Date().toISOString().split('T')[0]
  const isAlreadyRoutine = !!task.routine_id

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <button className="sheet-handle" onClick={() => { if (form.title.trim()) handleSubmit(); else onClose(); }} />
        <button className="modal-close-btn" onClick={onClose} aria-label="Close">✕</button>
        <div className="sheet-title">Edit Task</div>
        <div className="autosave-hint">Changes save automatically</div>

        <input
          ref={inputRef}
          className="add-input"
          placeholder="Task title"
          value={form.title}
          onChange={e => form.setTitle(e.target.value)}
        />

        <div className="settings-label" style={{ marginBottom: 6 }}>Notes</div>
        <div className="notes-wrapper">
          <textarea
            className="notes-input"
            placeholder="Notes..."
            value={form.notes}
            onChange={e => form.setNotes(e.target.value)}
          />
          <div className="notes-actions">
            {form.notes.trim() && (
              <button className="polish-btn" onClick={form.handlePolish} disabled={form.polishing}>
                {form.polishing ? <span className="spinner" /> : '✨'} {form.polishing ? 'Polishing...' : 'Polish'}
              </button>
            )}
            <button
              className="polish-btn research-btn"
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowResearch(!showResearch) }}
              disabled={researching}
            >
              {researching ? <span className="spinner" /> : '🔍'} {researching ? 'Researching...' : 'Research'}
            </button>
          </div>
          {showResearch && (
            <div className="research-prompt-row">
              <input
                className="research-prompt-input"
                placeholder="What do you need to know?"
                value={researchPrompt}
                onChange={e => setResearchPrompt(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleResearch(e) }}
                autoFocus
              />
              <button
                className="research-go-btn"
                onClick={handleResearch}
                disabled={!researchPrompt.trim() || researching}
              >
                Go
              </button>
            </div>
          )}
        </div>
        {form.polishError && (
          <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{form.polishError}</div>
        )}

        {!makeRecurring && (
          <>
            <div className="settings-label" style={{ marginBottom: 6 }}>Due date</div>
            <input
              className="add-input date-input"
              type="date"
              value={form.dueDate}
              min={today}
              onChange={e => form.setDueDate(e.target.value)}
            />
          </>
        )}

        <div className="settings-label" style={{ marginBottom: 6 }}>Labels</div>
        <div className="tag-selector">
          {labels.map(label => (
            <button
              key={label.id}
              className={`tag-toggle ${form.selectedTags.includes(label.id) ? 'selected' : ''}`}
              style={form.selectedTags.includes(label.id) ? { background: label.color } : { '--tag-hover-color': label.color }}
              onClick={() => form.toggleTag(label.id)}
            >
              {label.name}
            </button>
          ))}
        </div>

        <div className="settings-label" style={{ marginBottom: 6 }}>Size</div>
        <div className="size-selector">
          {['XS', 'S', 'M', 'L', 'XL'].map(s => (
            <button
              key={s}
              className={`size-select-btn size-${s.toLowerCase()}${form.size === s ? ' selected' : ''}`}
              onClick={() => form.setSize(form.size === s ? null : s)}
            >
              {s}
            </button>
          ))}
          <button className="polish-btn" onClick={form.handleInferSize} disabled={form.sizing || !form.title.trim()} style={{ marginTop: 0, marginLeft: 8 }}>
            {form.sizing ? <span className="spinner" /> : '✨'} {form.sizing ? 'Sizing...' : 'Auto'}
          </button>
        </div>

        <div className="settings-label" style={{ marginBottom: 6 }}>Energy Type</div>
        <div className="energy-selector">
          {ENERGY_TYPES.map(et => (
            <button
              key={et.id}
              className={`energy-select-btn${form.energy === et.id ? ' selected' : ''}`}
              onClick={() => form.setEnergy(form.energy === et.id ? null : et.id)}
              title={et.label}
            >
              {et.icon}
            </button>
          ))}
        </div>
        {form.energy && (
          <>
            <div className="settings-label" style={{ marginBottom: 6 }}>Drain Level</div>
            <div className="energy-selector">
              {[1, 2, 3].map(lvl => (
                <button
                  key={lvl}
                  className={`energy-select-btn energy-level-btn${form.energyLevel === lvl ? ' selected' : ''}`}
                  onClick={() => form.setEnergyLevel(form.energyLevel === lvl ? null : lvl)}
                >
                  {'⚡'.repeat(lvl)}
                </button>
              ))}
            </div>
          </>
        )}

        <button
          className={`priority-toggle ${form.highPriority ? 'active' : ''}`}
          onClick={() => form.setHighPriority(!form.highPriority)}
          style={{ marginBottom: 12 }}
        >
          <span style={{ fontWeight: 800 }}>!</span> High Priority
        </button>

        {/* Attachments */}
        <input
          ref={form.fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={form.handleFileSelect}
        />
        <button className="attach-btn" onClick={() => form.fileInputRef.current?.click()}>
          + Attach files
        </button>
        {form.attachError && (
          <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{form.attachError}</div>
        )}
        {form.attachments.length > 0 && (
          <div className="attachment-list">
            {form.attachments.map(a => (
              <div key={a.id} className="attachment-item">
                <span className="attachment-name">{a.name}</span>
                <span className="attachment-size">{form.formatFileSize(a.size)}</span>
                <button className="attachment-remove" onClick={() => form.removeAttachment(a.id)}>x</button>
              </div>
            ))}
          </div>
        )}

        {/* Checklist */}
        <div className="settings-label" style={{ marginBottom: 6, marginTop: 4 }}>Checklist</div>
        <div className="checklist-edit-section">
          {checklist.map((item) => (
            <div key={item.id} className="checklist-edit-item">
              <input
                type="checkbox"
                className="checklist-checkbox"
                checked={item.completed}
                onChange={() => {
                  setChecklist(prev => prev.map(i =>
                    i.id === item.id ? { ...i, completed: !i.completed } : i
                  ))
                }}
              />
              <input
                className="checklist-edit-input"
                value={item.text}
                onChange={e => {
                  setChecklist(prev => prev.map(i =>
                    i.id === item.id ? { ...i, text: e.target.value } : i
                  ))
                }}
              />
              <button className="checklist-delete" onClick={() => {
                setChecklist(prev => prev.filter(i => i.id !== item.id))
              }}>x</button>
            </div>
          ))}
          <div className="checklist-add-row">
            <input
              className="checklist-add-input"
              placeholder="Add item..."
              value={newCheckItem}
              onChange={e => setNewCheckItem(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newCheckItem.trim()) {
                  setChecklist(prev => [...prev, { id: crypto.randomUUID(), text: newCheckItem.trim(), completed: false }])
                  setNewCheckItem('')
                }
              }}
            />
            <button
              className="checklist-add-btn"
              disabled={!newCheckItem.trim()}
              onClick={() => {
                if (newCheckItem.trim()) {
                  setChecklist(prev => [...prev, { id: crypto.randomUUID(), text: newCheckItem.trim(), completed: false }])
                  setNewCheckItem('')
                }
              }}
            >+</button>
          </div>
        </div>

        {/* Comments */}
        <div className="settings-label" style={{ marginBottom: 6, marginTop: 4 }}>Comments</div>
        <div className="comments-section">
          {comments.length > 0 && comments.map(c => (
            <div key={c.id} className="comment-item">
              <div className="comment-text">{c.text}</div>
              <div className="comment-time">{new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            </div>
          ))}
          <div className="comment-input-row">
            <input
              className="comment-input"
              placeholder="Add a comment..."
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newComment.trim()) {
                  setComments(prev => [...prev, { id: crypto.randomUUID(), text: newComment.trim(), created_at: new Date().toISOString() }])
                  setNewComment('')
                }
              }}
            />
            <button
              className="comment-add-btn"
              disabled={!newComment.trim()}
              onClick={() => {
                if (newComment.trim()) {
                  setComments(prev => [...prev, { id: crypto.randomUUID(), text: newComment.trim(), created_at: new Date().toISOString() }])
                  setNewComment('')
                }
              }}
            >Add</button>
          </div>
        </div>

        {/* Recurring toggle */}
        {!isAlreadyRoutine && (
          <div style={{ marginTop: 4 }}>
            <label className="notif-check">
              <input
                type="checkbox"
                checked={makeRecurring}
                onChange={e => setMakeRecurring(e.target.checked)}
              />
              <span>Make this recurring</span>
            </label>
            {makeRecurring && (
              <div style={{ marginTop: 8 }}>
                <div className="settings-label" style={{ marginBottom: 6 }}>Frequency</div>
                <div className="notif-freq-row" style={{ flexWrap: 'wrap' }}>
                  {RECURRENCE_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      className={`notif-freq ${cadence === opt.value ? 'notif-freq-active' : ''}`}
                      onClick={() => setCadence(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {cadence === 'custom' && (
                  <div style={{ marginTop: 8 }}>
                    <div className="settings-label" style={{ marginBottom: 4 }}>Every how many days?</div>
                    <input
                      className="settings-input"
                      type="number"
                      min="1"
                      max="365"
                      value={customDays}
                      onChange={e => setCustomDays(parseInt(e.target.value) || 1)}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isAlreadyRoutine && (
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
            This task is part of a routine.
          </div>
        )}

        {/* Connections */}
        <div className="settings-label" style={{ marginBottom: 8, marginTop: 4 }}>Connections</div>

        {/* Notion in-progress states */}
        {!form.notionResult && form.notionState === 'searching' && (
          <div className="notion-searching" style={{ marginBottom: 8 }}><span className="spinner" /> Searching Notion...</div>
        )}
        {!form.notionResult && form.notionState?.action === 'error' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{form.notionState.reason}</div>
            <button className="ci-upload-btn" onClick={form.handleNotionSearch}>Retry</button>
          </div>
        )}
        {!form.notionResult && form.notionState && form.notionState !== 'searching' && form.notionState.action !== 'error' && (
          <div className="notion-suggestions" style={{ marginBottom: 8 }}>
            {form.notionState.pages?.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>{form.notionState.reason}</div>
                {form.notionState.pages.map(page => (
                  <button key={page.id} className="notion-page-btn" onClick={() => form.handleNotionLink(page)}>
                    {page.title}
                  </button>
                ))}
              </>
            )}
            <button
              className="ci-upload-btn"
              onClick={form.handleNotionCreate}
              disabled={form.notionCreating}
              style={{ marginTop: 8 }}
            >
              {form.notionCreating ? <><span className="spinner" /> Creating...</> : '+ Create new Notion page'}
            </button>
          </div>
        )}

        {/* Trello list picker (when not yet linked) */}
        {!trelloResult && trelloLists.length > 0 && (
          <select
            className="add-input"
            style={{ fontSize: 13, marginBottom: 8 }}
            value={trelloPushListId}
            onChange={e => setTrelloPushListId(e.target.value)}
          >
            <option value="" disabled>Trello list...</option>
            {trelloLists.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        )}

        {/* Connection buttons — linked items become open links */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {form.notionResult ? (
            <div className="connection-linked-btn">
              <a href={form.notionResult.url} target="_blank" rel="noopener" className="connection-link">Notion ↗</a>
              <button className="connection-unlink" onClick={() => form.setNotionResult(null)} title="Unlink">✕</button>
            </div>
          ) : !form.notionState && (
            <button className="ci-upload-btn" onClick={form.handleNotionSearch} disabled={!form.title.trim()}>
              Notion
            </button>
          )}
          {trelloResult ? (
            <div className="connection-linked-btn">
              <a href={trelloResult.url} target="_blank" rel="noopener" className="connection-link">Trello ↗</a>
              <button className="connection-unlink" onClick={() => setTrelloResult(null)} title="Unlink">✕</button>
            </div>
          ) : trelloConfigured ? (
            <button
              className="ci-upload-btn"
              onClick={handleTrelloPush}
              disabled={trelloPushing || !form.title.trim() || !trelloPushListId}
            >
              {trelloPushing ? <><span className="spinner" /> Pushing...</> : 'Trello'}
            </button>
          ) : null}
        </div>

        <button className="submit-btn" disabled={!form.title.trim()} onClick={handleSubmit} style={{ marginTop: 16 }}>
          {makeRecurring ? 'Convert to Routine' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
