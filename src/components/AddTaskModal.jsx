import { useState, useRef, useEffect } from 'react'
import { loadLabels, loadSettings, getDefaultDueDate, ENERGY_TYPES } from '../store'
import { polishNotes, inferDate, inferSize, suggestNotionLink, generateNotionContent, notionCreatePage } from '../api'

function formatFileSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

const MAX_TOTAL_SIZE = 5 * 1024 * 1024 // 5MB

export default function AddTaskModal({ onAdd, onClose }) {
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedTags, setSelectedTags] = useState([])
  const [dueDate, setDueDate] = useState(getDefaultDueDate)
  const [polishing, setPolishing] = useState(false)
  const [size, setSize] = useState(null)
  const [energy, setEnergy] = useState(null)
  const [energyLevel, setEnergyLevel] = useState(null)
  const [sizing, setSizing] = useState(false)
  const [polishError, setPolishError] = useState(null)
  const [notionState, setNotionState] = useState(null) // null | 'searching' | {action, pages, page_id, reason}
  const [notionCreating, setNotionCreating] = useState(false)
  const [notionResult, setNotionResult] = useState(null) // {id, url}
  const [highPriority, setHighPriority] = useState(false)
  const [attachments, setAttachments] = useState([])
  const [attachError, setAttachError] = useState(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const labels = loadLabels()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const toggleTag = (id) => {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  const handleSubmit = () => {
    if (!title.trim()) return
    onAdd(title.trim(), selectedTags, dueDate || null, notes.trim(), notionResult, size, attachments, highPriority, energy, energyLevel)
    onClose()
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

      // Infer date, size, and energy from polished content
      const [inferredDate, inferred] = await Promise.all([
        !dueDate ? inferDate(newTitle, newNotes).catch(() => null) : Promise.resolve(null),
        inferSize(newTitle, newNotes),
      ])
      if (inferredDate) setDueDate(inferredDate)
      if (inferred.size) setSize(inferred.size)
      if (inferred.energy) setEnergy(inferred.energy)
      if (inferred.energyLevel) setEnergyLevel(inferred.energyLevel)
    } catch (err) {
      setPolishError(err.message)
    } finally {
      setPolishing(false)
    }
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
        <button className="sheet-handle" onClick={() => { if (title.trim()) handleSubmit(); else onClose(); }} />
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

        {(energy || size) && (
          <>
            <div className="settings-label" style={{ marginBottom: 6 }}>Energy Type</div>
            <div className="energy-selector">
              {ENERGY_TYPES.map(et => (
                <button
                  key={et.id}
                  className={`energy-select-btn${energy === et.id ? ' selected' : ''}`}
                  onClick={() => setEnergy(energy === et.id ? null : et.id)}
                  title={et.label}
                >
                  {et.icon}
                </button>
              ))}
            </div>
            {energy && (
              <>
                <div className="settings-label" style={{ marginBottom: 6 }}>Drain Level</div>
                <div className="energy-selector">
                  {[1, 2, 3].map(lvl => (
                    <button
                      key={lvl}
                      className={`energy-select-btn energy-level-btn${energyLevel === lvl ? ' selected' : ''}`}
                      onClick={() => setEnergyLevel(energyLevel === lvl ? null : lvl)}
                    >
                      {'⚡'.repeat(lvl)}
                    </button>
                  ))}
                </div>
              </>
            )}
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

        <button className="submit-btn" disabled={!title.trim()} onClick={handleSubmit} style={{ marginTop: 12 }}>
          Add Task
        </button>
      </div>
    </div>
  )
}
