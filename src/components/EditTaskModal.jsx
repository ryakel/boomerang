import { useState, useRef, useEffect } from 'react'
import { loadLabels, loadSettings, RECURRENCE_OPTIONS } from '../store'
import { polishNotes, inferDate, suggestNotionLink, generateNotionContent, notionCreatePage } from '../api'

export default function EditTaskModal({ task, onSave, onConvertToRoutine, onClose }) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes || '')
  const [selectedTags, setSelectedTags] = useState(task.tags || [])
  const [dueDate, setDueDate] = useState(task.due_date || '')
  const [polishing, setPolishing] = useState(false)
  const [notionState, setNotionState] = useState(null)
  const [notionCreating, setNotionCreating] = useState(false)
  const [notionResult, setNotionResult] = useState(
    task.notion_page_id ? { id: task.notion_page_id, url: task.notion_url } : null
  )
  const [size, setSize] = useState(task.size || null)
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [cadence, setCadence] = useState('weekly')
  const [customDays, setCustomDays] = useState(14)
  const inputRef = useRef(null)
  const labels = loadLabels()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const toggleTag = (id) => {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  const handleSubmit = () => {
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
        notion_page_id: notionResult?.id || null,
        notion_url: notionResult?.url || null,
      })
    }
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
      if (!dueDate) {
        try {
          const inferred = await inferDate(newTitle, newNotes)
          if (inferred) setDueDate(inferred)
        } catch { /* date inference is optional */ }
      }
    } catch { /* ignore */ }
    finally { setPolishing(false) }
  }

  const today = new Date().toISOString().split('T')[0]
  const isAlreadyRoutine = !!task.routine_id

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <button className="sheet-handle" onClick={() => { if (title.trim()) handleSubmit(); else onClose(); }} />
        <div className="sheet-title">Edit Task</div>

        <input
          ref={inputRef}
          className="add-input"
          placeholder="Task title"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />

        <div className="settings-label" style={{ marginBottom: 6 }}>Notes</div>
        <div className="notes-wrapper">
          <textarea
            className="notes-input"
            placeholder="Notes..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          {notes.trim() && (
            <button className="polish-btn" onClick={handlePolish} disabled={polishing}>
              {polishing ? <span className="spinner" /> : '✨'} {polishing ? 'Polishing...' : 'Polish'}
            </button>
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

        {/* Notion */}
        <div className="settings-label" style={{ marginBottom: 6, marginTop: 4 }}>Notion</div>
        {notionResult ? (
          <div className="notion-linked">
            <span>Linked to Notion</span>
            <a href={notionResult.url} target="_blank" rel="noopener" className="notion-link">Open ↗</a>
            <button className="ci-clear-btn" onClick={() => setNotionResult(null)} style={{ marginLeft: 'auto' }}>Unlink</button>
          </div>
        ) : notionState === 'searching' ? (
          <div className="notion-searching"><span className="spinner" /> Searching Notion...</div>
        ) : notionState?.action === 'error' ? (
          <div>
            <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{notionState.reason}</div>
            <button className="ci-upload-btn" onClick={handleNotionSearch}>Retry</button>
          </div>
        ) : notionState ? (
          <div className="notion-suggestions">
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
        ) : (
          <button className="ci-upload-btn" onClick={handleNotionSearch} disabled={!title.trim()}>
            Find or create Notion page
          </button>
        )}

        <button className="submit-btn" disabled={!title.trim()} onClick={handleSubmit} style={{ marginTop: 16 }}>
          {makeRecurring ? 'Convert to Routine' : 'Save Changes'}
        </button>
      </div>
    </div>
  )
}
