import { useRef, useEffect } from 'react'
import './AddTaskModal.css'
import { loadLabels, getDefaultDueDate, ENERGY_TYPES } from '../store'
import { useTaskForm } from '../hooks/useTaskForm'
import { Sparkles } from 'lucide-react'
import EnergyIcon from './EnergyIcon'

export default function AddTaskModal({ onAdd, onClose }) {
  const form = useTaskForm({ dueDate: getDefaultDueDate() })
  const inputRef = useRef(null)
  const labels = loadLabels()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    if (!form.title.trim()) return
    onAdd(form.getFormData())
    onClose()
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <button className="sheet-handle" onClick={() => { if (form.title.trim()) handleSubmit(); else onClose(); }} />
        <div className="sheet-title">Add Task</div>

        <input
          ref={inputRef}
          className="add-input"
          placeholder="What needs doing?"
          value={form.title}
          onChange={e => form.setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
        />

        <div className="settings-label" style={{ marginBottom: 6 }}>Notes</div>
        <div className="notes-wrapper">
          <textarea
            className="notes-input"
            placeholder="Brain dump here..."
            value={form.notes}
            onChange={e => form.setNotes(e.target.value)}
          />
          {form.notes.trim() && (
            <button className="polish-btn" onClick={form.handlePolish} disabled={form.polishing}>
              {form.polishing ? <span className="spinner" /> : <Sparkles size={14} />} {form.polishing ? 'Polishing...' : 'Polish'}
            </button>
          )}
        </div>
        {form.polishError && (
          <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{form.polishError}</div>
        )}

        <div className="settings-label" style={{ marginBottom: 6 }}>Due date</div>
        <input
          className="add-input date-input"
          type="date"
          value={form.dueDate}
          min={today}
          onChange={e => form.setDueDate(e.target.value)}
        />

        <div className="settings-label" style={{ marginBottom: 6 }}>Labels</div>
        <select
          className="routine-select"
          value=""
          onChange={e => { if (e.target.value) form.toggleTag(e.target.value) }}
        >
          <option value="">Add label...</option>
          {labels.filter(l => !form.selectedTags.includes(l.id)).map(label => (
            <option key={label.id} value={label.id}>{label.name}</option>
          ))}
        </select>
        {form.selectedTags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {form.selectedTags.map(id => {
              const label = labels.find(l => l.id === id)
              if (!label) return null
              return (
                <button key={id} className="routine-label-pill" style={{ background: label.color }} onClick={() => form.toggleTag(id)}>
                  {label.name} <span style={{ marginLeft: 4, opacity: 0.7 }}>✕</span>
                </button>
              )
            })}
          </div>
        )}

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
            {form.sizing ? <span className="spinner" /> : <Sparkles size={14} />} {form.sizing ? 'Sizing...' : 'Auto'}
          </button>
        </div>

        {(form.energy || form.size) && (
          <>
            <div className="settings-label" style={{ marginBottom: 6 }}>Energy Type</div>
            <div className="energy-selector">
              {ENERGY_TYPES.map(et => (
                <button
                  key={et.id}
                  className={`energy-select-btn energy-type-btn${form.energy === et.id ? ' selected' : ''}`}
                  onClick={() => form.setEnergy(form.energy === et.id ? null : et.id)}
                  title={et.label}
                >
                  <EnergyIcon icon={et.icon} color={et.color} size={18} />
                  <span className="energy-type-label">{et.label}</span>
                </button>
              ))}
            </div>
            {form.energy && (
              <div className="drain-priority-row">
                <div>
                  <div className="settings-label" style={{ marginBottom: 6 }}>Energy Drain</div>
                  <div className="energy-selector" style={{ marginBottom: 0 }}>
                    {[
                      { lvl: 1, label: 'Low', dotClass: 'dot-1' },
                      { lvl: 2, label: 'Med', dotClass: 'dot-2' },
                      { lvl: 3, label: 'High', dotClass: 'dot-3' },
                    ].map(({ lvl, label, dotClass }) => (
                      <button
                        key={lvl}
                        className={`energy-select-btn energy-level-btn${form.energyLevel === lvl ? ' selected' : ''}`}
                        onClick={() => form.setEnergyLevel(form.energyLevel === lvl ? null : lvl)}
                      >
                        <span className={`energy-dot ${dotClass} active`} style={{ display: 'inline-block', marginRight: 4 }} /> {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="priority-group">
                  <span className="settings-label" style={{ marginBottom: 6 }}>Priority</span>
                  <button
                    className={`priority-btn${form.highPriority ? ' priority-active' : ''}`}
                    onClick={() => form.setHighPriority(!form.highPriority)}
                  >
                    !
                  </button>
                </div>
              </div>
            )}
          </>
        )}

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

        {/* Notion integration */}
        <div className="settings-label" style={{ marginBottom: 6 }}>Notion</div>
        {form.notionResult ? (
          <div className="notion-linked">
            <span>Linked to Notion</span>
            <a href={form.notionResult.url} target="_blank" rel="noopener" className="notion-link">Open ↗</a>
            <button className="ci-clear-btn" onClick={() => form.setNotionResult(null)} style={{ marginLeft: 'auto' }}>Unlink</button>
          </div>
        ) : form.notionState === 'searching' ? (
          <div className="notion-searching"><span className="spinner" /> Searching Notion...</div>
        ) : form.notionState?.action === 'error' ? (
          <div>
            <div style={{ color: 'var(--accent)', fontSize: 12, marginBottom: 8 }}>{form.notionState.reason}</div>
            <button className="ci-upload-btn" onClick={form.handleNotionSearch}>Retry</button>
          </div>
        ) : form.notionState ? (
          <div className="notion-suggestions">
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
        ) : (
          <button className="ci-upload-btn" onClick={form.handleNotionSearch} disabled={!form.title.trim()}>
            Find or create Notion page
          </button>
        )}

        <button className="submit-btn" disabled={!form.title.trim()} onClick={handleSubmit} style={{ marginTop: 12 }}>
          Add Task
        </button>
      </div>
    </div>
  )
}
