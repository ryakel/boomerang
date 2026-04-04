import { useState, useRef, useEffect, useCallback } from 'react'
import { loadLabels, loadSettings, RECURRENCE_OPTIONS, ACTIVE_STATUSES, STATUS_META, ENERGY_TYPES } from '../store'
import { polishNotes, researchTask, inferDate, inferSize, suggestNotionLink, generateNotionContent, notionCreatePage, trelloCreateCard, trelloBoardLists } from '../api'
import EnergyIcon from './EnergyIcon'

function formatFileSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

const MAX_TOTAL_SIZE = 5 * 1024 * 1024 // 5MB

export default function EditTaskModal({ task, onSave, onConvertToRoutine, onClose, onDelete, onBacklog, onStatusChange }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes || '')
  const [selectedTags, setSelectedTags] = useState(task.tags || [])
  const [dueDate, setDueDate] = useState(task.due_date || '')
  const [polishing, setPolishing] = useState(false)
  const [showResearch, setShowResearch] = useState(false)
  const [researchPrompt, setResearchPrompt] = useState('')
  const [researching, setResearching] = useState(false)
  const [notionState, setNotionState] = useState(null)
  const [notionCreating, setNotionCreating] = useState(false)
  const [notionResult, setNotionResult] = useState(
    task.notion_page_id ? { id: task.notion_page_id, url: task.notion_url } : null
  )
  const [size, setSize] = useState(task.size || null)
  const [energy, setEnergy] = useState(task.energy || null)
  const [energyLevel, setEnergyLevel] = useState(task.energyLevel || null)
  const [sizing, setSizing] = useState(false)
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [cadence, setCadence] = useState('weekly')
  const [customDays, setCustomDays] = useState(14)
  const [attachments, setAttachments] = useState(task.attachments || [])
  const [attachError, setAttachError] = useState(null)
  const [checklist, setChecklist] = useState(task.checklist || [])
  const [newCheckItem, setNewCheckItem] = useState('')
  const [comments, setComments] = useState(task.comments || [])
  const [newComment, setNewComment] = useState('')
  const [trelloResult, setTrelloResult] = useState(
    task.trello_card_id ? { id: task.trello_card_id, url: task.trello_card_url } : null
  )
  const [highPriority, setHighPriority] = useState(task.high_priority || false)
  const [currentStatus, setCurrentStatus] = useState(task.status === 'open' ? 'not_started' : task.status)
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
  const [justSaved, setJustSaved] = useState(false)
  const savedTimer = useRef(null)
  const autoSaveTimer = useRef(null)
  const initialRender = useRef(true)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const labels = loadLabels()

  const flashSaved = useCallback(() => {
    setJustSaved(true)
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setJustSaved(false), 2000)
  }, [])

  // Auto-save on any field change (debounced 1s)
  useEffect(() => {
    // Skip the initial render — don't save on mount
    if (initialRender.current) {
      initialRender.current = false
      return
    }
    if (!title.trim() || makeRecurring) return

    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => {
      onSave(task.id, {
        title: title.trim(),
        notes: notes.trim(),
        tags: selectedTags,
        due_date: dueDate || null,
        size: size || null,
        energy: energy || null,
        energyLevel: energyLevel || null,
        high_priority: highPriority,
        notion_page_id: notionResult?.id || null,
        notion_url: notionResult?.url || null,
        trello_card_id: trelloResult?.id || null,
        trello_card_url: trelloResult?.url || null,
        attachments,
        checklist,
        comments,
      })
      flashSaved()
    }, 1000)

    return () => clearTimeout(autoSaveTimer.current)
  }, [title, notes, selectedTags, dueDate, size, energy, energyLevel, highPriority, notionResult, trelloResult, attachments, checklist, comments]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    inputRef.current?.focus()
    const s = loadSettings()
    if (s.trello_board_id) {
      trelloBoardLists(s.trello_board_id).then(lists => {
        setTrelloLists(lists)
        // If no list selected yet, default to the first one
        if (!trelloPushListId && lists.length > 0) {
          setTrelloPushListId(lists[0].id)
        }
      }).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleTag = (id) => {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  const saveChanges = () => {
    if (!title.trim()) return
    if (makeRecurring) {
      onConvertToRoutine(task.id, {
        title: title.trim(),
        cadence,
        customDays: cadence === 'custom' ? customDays : null,
        tags: selectedTags,
        notes: notes.trim(),
      })
    } else {
      onSave(task.id, {
        title: title.trim(),
        notes: notes.trim(),
        tags: selectedTags,
        due_date: dueDate || null,
        size: size || null,
        energy: energy || null,
        energyLevel: energyLevel || null,
        high_priority: highPriority,
        notion_page_id: notionResult?.id || null,
        notion_url: notionResult?.url || null,
        trello_card_id: trelloResult?.id || null,
        trello_card_url: trelloResult?.url || null,
        attachments,
        checklist,
        comments,
      })
    }
  }

  const handleSubmit = () => {
    saveChanges()
    onClose()
  }

  const handleNotionSearch = async () => {
    if (!title.trim()) return
    setNotionState('searching')
    try {
      const result = await suggestNotionLink(title, notes)
      setNotionState(result)
    } catch (err) {
      setNotionState({ action: 'error', reason: err.message })
    }
  }

  const handleNotionCreate = async () => {
    setNotionCreating(true)
    try {
      const settings = loadSettings()
      const content = await generateNotionContent(title, notes)
      const page = await notionCreatePage(title, content, settings.notion_parent_page_id || null)
      setNotionResult(page)
      setNotionState(null)
    } catch (err) {
      setNotionState({ action: 'error', reason: err.message })
    } finally {
      setNotionCreating(false)
    }
  }

  const handleNotionLink = (page) => {
    setNotionResult({ id: page.id, url: page.url })
    setNotionState(null)
  }

  const handleTrelloPush = async () => {
    if (!title.trim() || !trelloPushListId) return
    setTrelloPushing(true)
    try {
      const card = await trelloCreateCard(title.trim(), notes.trim(), trelloPushListId)
      setTrelloResult({ id: card.id, url: card.url })
    } catch { /* ignore */ }
    finally { setTrelloPushing(false) }
  }

  const handlePolish = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!notes.trim()) return
    setPolishing(true)
    try {
      const result = await polishNotes(title || 'Untitled task', notes)
      const newTitle = result.title || title
      const newNotes = result.notes || notes
      setTitle(newTitle)
      setNotes(newNotes)
      const [inferredDate, inferred] = await Promise.all([
        !dueDate ? inferDate(newTitle, newNotes).catch(() => null) : Promise.resolve(null),
        !size ? inferSize(newTitle, newNotes) : Promise.resolve({ size: null, energy: null, energyLevel: null }),
      ])
      if (inferredDate) setDueDate(inferredDate)
      if (inferred.size) setSize(inferred.size)
      if (inferred.energy) setEnergy(inferred.energy)
      if (inferred.energyLevel) setEnergyLevel(inferred.energyLevel)
    } catch { /* ignore */ }
    finally { setPolishing(false) }
  }

  const handleResearch = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!researchPrompt.trim()) return
    setResearching(true)
    try {
      const result = await researchTask(title || 'Untitled task', notes, researchPrompt.trim())
      if (result.notes) {
        const separator = notes.trim() ? '\n\n' : ''
        setNotes(prev => (prev.trim() ? prev.trim() + separator : '') + result.notes)
      }
      setResearchPrompt('')
      setShowResearch(false)
    } catch { /* ignore */ }
    finally { setResearching(false) }
  }

  const handleInferSize = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!title.trim()) return
    setSizing(true)
    try {
      const inferred = await inferSize(title, notes)
      if (inferred.size) setSize(inferred.size)
      if (inferred.energy) setEnergy(inferred.energy)
      if (inferred.energyLevel) setEnergyLevel(inferred.energyLevel)
    } catch { /* ignore */ }
    finally { setSizing(false) }
  }

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setAttachError(null)
    const currentTotal = attachments.reduce((sum, a) => sum + a.size, 0)
    const newTotal = currentTotal + files.reduce((sum, f) => sum + f.size, 0)
    if (newTotal > MAX_TOTAL_SIZE) {
      setAttachError(`Total attachments exceed 5 MB limit (${formatFileSize(newTotal)})`)
      e.target.value = ''
      return
    }
    const readers = files.map(file => new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        data: reader.result.split(',')[1],
      })
      reader.readAsDataURL(file)
    }))
    Promise.all(readers).then(results => {
      setAttachments(prev => [...prev, ...results])
    })
    e.target.value = ''
  }

  const removeAttachment = (id) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
    setAttachError(null)
  }

  const today = new Date().toISOString().split('T')[0]
  const isAlreadyRoutine = !!task.routine_id

  const handleClose = () => {
    clearTimeout(autoSaveTimer.current)
    if (title.trim() && !makeRecurring) {
      saveChanges()
      flashSaved()
      setTimeout(onClose, 300)
    } else {
      onClose()
    }
  }

  return (
    <div className="sheet-overlay" onClick={handleClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <button className="sheet-handle" onClick={handleClose} />
        <button className="modal-close-btn" onClick={handleClose} aria-label="Close">✕</button>
        <div className="edit-task-title-row">
          <div className="sheet-title">Edit Task</div>
          <span className={`autosave-pill ${justSaved ? 'autosave-pill-saved' : ''}`}>
            {justSaved ? '✓ Saved' : 'Auto Save'}
          </span>
        </div>

        <input
          ref={inputRef}
          className="add-input"
          placeholder="Task title"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />

        {onStatusChange && currentStatus !== 'backlog' && (
          <>
            <div className="settings-label" style={{ marginBottom: 6 }}>Status</div>
            <div className="status-selector">
              {[...ACTIVE_STATUSES, 'done'].map(s => (
                <button
                  key={s}
                  className={`status-btn${currentStatus === s ? ' active' : ''}`}
                  style={{ '--status-color': STATUS_META[s].color }}
                  onClick={() => {
                    setCurrentStatus(s)
                    onStatusChange(task.id, s)
                  }}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="settings-label" style={{ marginBottom: 6 }}>Notes</div>
        <div className="notes-wrapper">
          <textarea
            className="notes-input"
            placeholder="Notes..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          <div className="notes-actions">
            {notes.trim() && (
              <button className="polish-btn" onClick={handlePolish} disabled={polishing}>
                {polishing ? <span className="spinner" /> : '✨'} {polishing ? 'Polishing...' : 'Polish'}
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

        {!makeRecurring && (
          <>
            <div className="settings-label" style={{ marginBottom: 6 }}>Due date</div>
            <input
              className="add-input date-input"
              type="date"
              value={dueDate}
              min={today}
              onChange={e => setDueDate(e.target.value)}
            />
          </>
        )}

        <div className="settings-label" style={{ marginBottom: 6 }}>Labels</div>
        <div className="tag-selector">
          {labels.map(label => (
            <button
              key={label.id}
              className={`tag-toggle ${selectedTags.includes(label.id) ? 'selected' : ''}`}
              style={selectedTags.includes(label.id) ? { background: label.color } : { '--tag-hover-color': label.color }}
              onClick={() => toggleTag(label.id)}
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
              className={`size-select-btn size-${s.toLowerCase()}${size === s ? ' selected' : ''}`}
              onClick={() => setSize(size === s ? null : s)}
            >
              {s}
            </button>
          ))}
          <button className="polish-btn" onClick={handleInferSize} disabled={sizing || !title.trim()} style={{ marginTop: 0, marginLeft: 8 }}>
            {sizing ? <span className="spinner" /> : '✨'} {sizing ? 'Sizing...' : 'Auto'}
          </button>
        </div>

        <div className="settings-label" style={{ marginBottom: 6 }}>Energy Type</div>
        <div className="energy-selector">
          {ENERGY_TYPES.map(et => (
            <button
              key={et.id}
              className={`energy-select-btn${energy === et.id ? ' selected' : ''}`}
              onClick={() => setEnergy(energy === et.id ? null : et.id)}
              title={et.label}
            >
              <EnergyIcon icon={et.icon} color={et.color} size={18} />
            </button>
          ))}
        </div>
        {energy && (
          <>
            <div className="settings-label" style={{ marginBottom: 6 }}>Drain Level</div>
            <div className="energy-selector">
              {[
                { lvl: 1, label: 'Low', dotClass: 'dot-1' },
                { lvl: 2, label: 'Med', dotClass: 'dot-2' },
                { lvl: 3, label: 'High', dotClass: 'dot-3' },
              ].map(({ lvl, label, dotClass }) => (
                <button
                  key={lvl}
                  className={`energy-select-btn energy-level-btn${energyLevel === lvl ? ' selected' : ''}`}
                  onClick={() => setEnergyLevel(energyLevel === lvl ? null : lvl)}
                >
                  <span className={`energy-dot ${dotClass} active`} style={{ display: 'inline-block', marginRight: 4 }} /> {label}
                </button>
              ))}
            </div>
          </>
        )}

        <button
          className={`priority-toggle ${highPriority ? 'active' : ''}`}
          onClick={() => setHighPriority(!highPriority)}
          style={{ marginBottom: 12 }}
        >
          <span style={{ fontWeight: 800 }}>!</span> High Priority
        </button>

        {/* Attachments */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <button className="attach-btn" onClick={() => fileInputRef.current?.click()}>
          + Attach files
        </button>
        {attachError && (
          <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{attachError}</div>
        )}
        {attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map(a => (
              <div key={a.id} className="attachment-item">
                <span className="attachment-name">{a.name}</span>
                <span className="attachment-size">{formatFileSize(a.size)}</span>
                <button className="attachment-remove" onClick={() => removeAttachment(a.id)}>x</button>
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
        {!notionResult && notionState === 'searching' && (
          <div className="notion-searching" style={{ marginBottom: 8 }}><span className="spinner" /> Searching Notion...</div>
        )}
        {!notionResult && notionState?.action === 'error' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{notionState.reason}</div>
            <button className="ci-upload-btn" onClick={handleNotionSearch}>Retry</button>
          </div>
        )}
        {!notionResult && notionState && notionState !== 'searching' && notionState.action !== 'error' && (
          <div className="notion-suggestions" style={{ marginBottom: 8 }}>
            {notionState.pages?.length > 0 && (
              <>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>{notionState.reason}</div>
                {notionState.pages.map(page => (
                  <button key={page.id} className="notion-page-btn" onClick={() => handleNotionLink(page)}>
                    {page.title}
                  </button>
                ))}
              </>
            )}
            <button
              className="ci-upload-btn"
              onClick={handleNotionCreate}
              disabled={notionCreating}
              style={{ marginTop: 8 }}
            >
              {notionCreating ? <><span className="spinner" /> Creating...</> : '+ Create new Notion page'}
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
          {notionResult ? (
            <div className="connection-linked-btn">
              <a href={notionResult.url} target="_blank" rel="noopener" className="connection-link">Notion ↗</a>
              <button className="connection-unlink" onClick={() => setNotionResult(null)} title="Unlink">✕</button>
            </div>
          ) : !notionState && (
            <button className="ci-upload-btn" onClick={handleNotionSearch} disabled={!title.trim()}>
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
              disabled={trelloPushing || !title.trim() || !trelloPushListId}
            >
              {trelloPushing ? <><span className="spinner" /> Pushing...</> : 'Trello'}
            </button>
          ) : null}
        </div>

        {makeRecurring && (
          <button className="submit-btn" disabled={!title.trim()} onClick={handleSubmit} style={{ marginTop: 16 }}>
            Convert to Routine
          </button>
        )}

        {(onDelete || onBacklog) && (
          <div className="modal-danger-zone">
            {onBacklog && (
              task.status !== 'backlog' ? (
                <button className="danger-btn secondary" onClick={() => { onBacklog(task.id, true); onClose() }}>
                  Move to Backlog
                </button>
              ) : (
                <button className="danger-btn secondary" onClick={() => { onBacklog(task.id, false); onClose() }}>
                  Activate
                </button>
              )
            )}
            {onDelete && (
              <button className="danger-btn delete" onClick={() => { onDelete(task.id); onClose() }}>
                Delete Task
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
