import { useRef, useEffect, useCallback } from 'react'
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

  // Pull-to-close on the handle bar
  const sheetRef = useRef(null)
  const handleRef = useRef(null)
  const pullRef = useRef({ startY: 0, active: false })
  const dismissModal = useCallback(() => { if (form.title.trim()) handleSubmit(); else onClose() }, [form.title, handleSubmit, onClose])
  useEffect(() => {
    const handle = handleRef.current
    const sheet = sheetRef.current
    if (!handle || !sheet) return
    const dismiss = () => dismissModal()
    const onStart = (e) => { pullRef.current = { startY: e.touches[0].clientY, active: true } }
    const onMove = (e) => {
      if (!pullRef.current.active) return
      const dy = (e.touches[0].clientY - pullRef.current.startY) * 0.6
      if (dy > 0) {
        e.preventDefault()
        sheet.style.transform = `translateY(${dy}px)`
        sheet.style.transition = 'none'
        sheet.style.opacity = String(Math.max(0.5, 1 - dy / 300))
      }
    }
    const onEnd = () => {
      if (!pullRef.current.active) return
      const dy = parseFloat(sheet.style.transform?.replace(/[^0-9.]/g, '')) || 0
      if (dy > 60) { dismiss() }
      else { sheet.style.transition = 'transform 0.2s, opacity 0.2s'; sheet.style.transform = ''; sheet.style.opacity = '' }
      pullRef.current.active = false
    }
    handle.addEventListener('touchstart', onStart, { passive: true })
    handle.addEventListener('touchmove', onMove, { passive: false })
    handle.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      handle.removeEventListener('touchstart', onStart)
      handle.removeEventListener('touchmove', onMove)
      handle.removeEventListener('touchend', onEnd)
    }
  }, [dismissModal])

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" ref={sheetRef} onClick={e => e.stopPropagation()}>
        <button ref={handleRef} className="sheet-handle" onClick={() => { if (form.title.trim()) handleSubmit(); else onClose(); }} />
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

        <div className="scheduling-row">
          <div className="scheduling-field">
            <div className="settings-label" style={{ marginBottom: 4 }}>Due date</div>
            <input
              className="routine-select"
              type="date"
              value={form.dueDate}
              min={today}
              onChange={e => form.setDueDate(e.target.value)}
              style={{ marginBottom: 0, padding: '8px 10px', fontSize: 14, width: 'auto' }}
            />
          </div>
          <div className="scheduling-field">
            <div className="settings-label" style={{ marginBottom: 4 }}>Priority</div>
            <button
              className={`priority-toggle${form.highPriority ? ' active' : form.lowPriority ? ' low' : ''}`}
              onClick={() => {
                if (!form.highPriority && !form.lowPriority) { form.setHighPriority(true); form.setLowPriority(false) }
                else if (form.highPriority) { form.setHighPriority(false); form.setLowPriority(true) }
                else { form.setHighPriority(false); form.setLowPriority(false) }
              }}
            >
              {form.highPriority ? '! High' : form.lowPriority ? '↓ Low' : 'Normal'}
            </button>
          </div>
        </div>

        <div className="settings-label" style={{ marginBottom: 4 }}>Labels</div>
        <select
          className="routine-select"
          value=""
          onChange={e => { if (e.target.value) form.toggleTag(e.target.value) }}
          style={{ marginBottom: form.selectedTags.length > 0 ? 6 : 12 }}
        >
          <option value="">Add label...</option>
          {labels.filter(l => !form.selectedTags.includes(l.id)).map(label => (
            <option key={label.id} value={label.id}>{label.name}</option>
          ))}
        </select>
        {form.selectedTags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
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

        {/* Categorization group */}
        <div className="form-group">
          <div className="settings-label" style={{ marginBottom: 4 }}>Size</div>
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
              <div className="settings-label" style={{ marginBottom: 4 }}>Energy Type</div>
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
                <>
                  <div className="settings-label" style={{ marginBottom: 4 }}>Energy Drain</div>
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
                </>
              )}
            </>
          )}
        </div>

        {/* Connections: Attachments + Notion inline */}
        <input
          ref={form.fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={form.handleFileSelect}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className="ci-upload-btn" onClick={() => form.fileInputRef.current?.click()}>
            + Attach{form.attachments.length > 0 ? ` (${form.attachments.length})` : ''}
          </button>
          {form.notionResult ? (
            <div className="connection-linked-btn">
              <a href={form.notionResult.url} target="_blank" rel="noopener" className="connection-link">Notion ↗</a>
              <button className="connection-unlink" onClick={() => form.setNotionResult(null)} title="Unlink">✕</button>
            </div>
          ) : form.notionState === 'searching' ? (
            <span style={{ fontSize: 12, color: 'var(--text-dim)', padding: '8px 0' }}><span className="spinner" /> Searching...</span>
          ) : form.notionState?.action === 'error' ? (
            <button className="ci-upload-btn" onClick={form.handleNotionSearch}>Retry Notion</button>
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
              <button className="ci-upload-btn" onClick={form.handleNotionCreate} disabled={form.notionCreating} style={{ marginTop: 8 }}>
                {form.notionCreating ? <><span className="spinner" /> Creating...</> : '+ Create new Notion page'}
              </button>
            </div>
          ) : (
            <button className="ci-upload-btn" onClick={form.handleNotionSearch} disabled={!form.title.trim()}>
              Notion
            </button>
          )}
        </div>
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

        <button className="submit-btn" disabled={!form.title.trim()} onClick={handleSubmit} style={{ marginTop: 4 }}>
          Add Task
        </button>
      </div>
    </div>
  )
}
