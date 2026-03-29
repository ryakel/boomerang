import { useState, useRef, useEffect } from 'react'
import { loadLabels, loadSettings } from '../store'
import { polishNotes, inferDate, suggestNotionLink, generateNotionContent, notionCreatePage } from '../api'

export default function AddTaskModal({ onAdd, onClose }) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [dueDate, setDueDate] = useState('')
  const [polishing, setPolishing] = useState(false)
  const [polishError, setPolishError] = useState(null)
  const [notionState, setNotionState] = useState(null) // null | 'searching' | {action, pages, page_id, reason}
  const [notionCreating, setNotionCreating] = useState(false)
  const [notionResult, setNotionResult] = useState(null) // {id, url}
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
    onAdd(title.trim(), selectedTags, dueDate || null, notes.trim(), notionResult)
    onClose()
  }

  const handlePolish = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!notes.trim()) return
    setPolishing(true)
    setPolishError(null)
    try {
      const result = await polishNotes(title || 'Untitled task', notes)
      const newTitle = result.title && (!title.trim() || result.title !== title) ? result.title : title
      const newNotes = result.notes || notes
      setTitle(newTitle)
      setNotes(newNotes)

      // Infer date from polished content
      if (!dueDate) {
        try {
          const inferred = await inferDate(newTitle, newNotes)
          if (inferred) setDueDate(inferred)
        } catch { /* date inference is optional */ }
      }
    } catch (err) {
      setPolishError(err.message)
    } finally {
      setPolishing(false)
    }
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

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-title">Add Task</div>

        <input
          ref={inputRef}
          className="add-input"
          placeholder="What needs doing?"
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
        />

        <div className="settings-label" style={{ marginBottom: 6 }}>Notes</div>
        <div className="notes-wrapper">
          <textarea
            className="notes-input"
            placeholder="Brain dump here..."
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
          {notes.trim() && (
            <button className="polish-btn" onClick={handlePolish} disabled={polishing}>
              {polishing ? <span className="spinner" /> : '✨'} {polishing ? 'Polishing...' : 'Polish'}
            </button>
          )}
        </div>
        {polishError && (
          <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{polishError}</div>
        )}

        <div className="settings-label" style={{ marginBottom: 6 }}>Due date</div>
        <input
          className="add-input date-input"
          type="date"
          value={dueDate}
          min={today}
          onChange={e => setDueDate(e.target.value)}
        />

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

        {/* Notion integration */}
        <div className="settings-label" style={{ marginBottom: 6 }}>Notion</div>
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
          Add Task
        </button>
      </div>
    </div>
  )
}
