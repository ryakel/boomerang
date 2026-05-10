import { useState, useEffect } from 'react'
import { Sparkles, Trash2, FolderKanban, Archive, Plus, X as XIcon, Search, Paperclip, FileText, Sun, ChevronDown, ChevronRight, RotateCw } from 'lucide-react'
import { loadLabels, ENERGY_TYPES, STATUS_META, uuid } from '../../store'
import { useTaskForm } from '../../hooks/useTaskForm'
import { researchTask } from '../../api'
import WeatherSection, { resolveWeatherVisibility } from '../../components/WeatherSection'
import ModalShell from './ModalShell'
import DateField from './DateField'
import './AddTaskModal.css' // shared form-control styles
import './EditTaskModal.css'

const ENERGY_LEVEL_LABELS = [
  { lvl: 1, label: 'Low' },
  { lvl: 2, label: 'Medium' },
  { lvl: 3, label: 'High' },
]

const SIZE_OPTIONS = ['XS', 'S', 'M', 'L', 'XL']

// Status options shown as segmented buttons. Mirrors v1's STATUS_CYCLE +
// the explicit Done/Backlog/Projects affordances. We collapse "open" to
// "not_started" since that's how STATUS_META keys it.
const STATUS_OPTIONS = ['not_started', 'doing', 'waiting']

const CADENCE_OPTIONS = ['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'custom']

export default function EditTaskModal({ task, onSave, onClose, onDelete, onBacklog, onProject, onStatusChange, onConvertToRoutine, weather }) {
  const form = useTaskForm({
    title: task.title,
    notes: task.notes || '',
    tags: task.tags || [],
    dueDate: task.due_date || '',
    size: task.size || null,
    energy: task.energy || null,
    energyLevel: task.energyLevel || null,
    highPriority: task.high_priority || false,
    lowPriority: task.low_priority || false,
    sizeInferred: !!task.size_inferred,
    attachments: task.attachments || [],
    notion: task.notion_page_id ? { id: task.notion_page_id, url: task.notion_url } : null,
  })

  // Research state — inline because only EditTaskModal supports it; not worth
  // promoting into useTaskForm since AddTaskModal doesn't use it.
  const [showResearch, setShowResearch] = useState(false)
  const [researchPrompt, setResearchPrompt] = useState('')
  const [researching, setResearching] = useState(false)
  const [researchError, setResearchError] = useState(null)

  const runResearch = async () => {
    const prompt = researchPrompt.trim()
    if (!prompt && !form.attachments.length) return
    setResearching(true)
    setResearchError(null)
    try {
      const result = await researchTask(form.title || 'Untitled task', form.notes, prompt, form.attachments)
      if (result?.notes) form.setNotes(result.notes)
      setResearchPrompt('')
      setShowResearch(false)
    } catch (e) {
      setResearchError(e?.message || 'Research failed')
    } finally {
      setResearching(false)
    }
  }

  // Comments — task-local thread of dated notes. Same shape v1 uses.
  const [comments, setComments] = useState(task.comments || [])
  const [newComment, setNewComment] = useState('')
  const [showComments, setShowComments] = useState(comments.length > 0)

  // Per-task weather + GCal-duration overrides.
  const [weatherHidden, setWeatherHidden] = useState(!!task.weather_hidden)
  const [forecastDrawerOpen, setForecastDrawerOpen] = useState(false)
  const [gcalDuration, setGcalDuration] = useState(task.gcal_duration || '')

  const addComment = () => {
    const text = newComment.trim()
    if (!text) return
    setComments(prev => [...prev, { id: uuid(), text, created_at: new Date().toISOString() }])
    setNewComment('')
  }
  const removeComment = (id) => setComments(prev => prev.filter(c => c.id !== id))

  const [currentStatus, setCurrentStatus] = useState(task.status === 'open' ? 'not_started' : task.status)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [cadence, setCadence] = useState('weekly')
  const [customDays, setCustomDays] = useState(14)

  // Checklists — multi-list shape: [{ id, name, items: [{id, text, completed}], hideCompleted }]
  // Migrate old flat task.checklist if present (covered by migration 018 server-side
  // but kept here for localStorage tasks that haven't round-tripped yet).
  const [checklists, setChecklists] = useState(() => {
    if (task.checklists?.length) return task.checklists
    if (task.checklist?.length) return [{ id: uuid(), name: 'Checklist', items: task.checklist, hideCompleted: false }]
    return []
  })
  const [newCheckItems, setNewCheckItems] = useState({}) // { checklistId: string }
  const [confirmDeleteChecklist, setConfirmDeleteChecklist] = useState(null)

  const labels = loadLabels()
  const today = new Date().toISOString().split('T')[0]

  // Auto-save title/notes/due/priority/size/energy/tags on blur/change is
  // common in v1 EditTaskModal. v2 keeps the explicit Save button for now —
  // less surprising for the new UI, easier to reason about. PR8 polish can
  // add per-field autosave if it feels natural in use.
  const handleSave = () => {
    if (!form.title.trim()) return
    onSave(task.id, {
      title: form.title.trim(),
      notes: form.notes,
      tags: form.selectedTags,
      due_date: form.dueDate || null,
      size: form.size,
      energy: form.energy,
      energyLevel: form.energyLevel,
      high_priority: form.highPriority,
      low_priority: form.lowPriority,
      size_inferred: !!form.size,
      checklists,
      attachments: form.attachments,
      comments,
      notion_page_id: form.notionResult?.id || null,
      notion_url: form.notionResult?.url || null,
      weather_hidden: weatherHidden,
      gcal_duration: gcalDuration ? parseInt(gcalDuration, 10) : null,
      last_touched: new Date().toISOString(),
    })
    onClose()
  }

  // Checklist mutators — kept inline for clarity. Drag-drop reorder is the
  // notable omission vs v1; can be added in a follow-up if it gets missed.
  const addChecklist = () => {
    setChecklists(prev => [...prev, { id: uuid(), name: 'Checklist', items: [], hideCompleted: false }])
  }
  const renameChecklist = (clId, name) => {
    setChecklists(prev => prev.map(c => (c.id === clId ? { ...c, name } : c)))
  }
  const removeChecklist = (clId) => {
    setChecklists(prev => prev.filter(c => c.id !== clId))
    setConfirmDeleteChecklist(null)
  }
  const toggleHideCompleted = (clId) => {
    setChecklists(prev => prev.map(c => (c.id === clId ? { ...c, hideCompleted: !c.hideCompleted } : c)))
  }
  const toggleItem = (clId, itemId) => {
    setChecklists(prev => prev.map(c => (
      c.id === clId
        ? { ...c, items: c.items.map(i => (i.id === itemId ? { ...i, completed: !i.completed } : i)) }
        : c
    )))
  }
  const renameItem = (clId, itemId, text) => {
    setChecklists(prev => prev.map(c => (
      c.id === clId
        ? { ...c, items: c.items.map(i => (i.id === itemId ? { ...i, text } : i)) }
        : c
    )))
  }
  const removeItem = (clId, itemId) => {
    setChecklists(prev => prev.map(c => (
      c.id === clId ? { ...c, items: c.items.filter(i => i.id !== itemId) } : c
    )))
  }
  const addItem = (clId) => {
    const text = (newCheckItems[clId] || '').trim()
    if (!text) return
    setChecklists(prev => prev.map(c => (
      c.id === clId ? { ...c, items: [...c.items, { id: uuid(), text, completed: false }] } : c
    )))
    setNewCheckItems(prev => ({ ...prev, [clId]: '' }))
  }

  const handleStatusChange = (newStatus) => {
    setCurrentStatus(newStatus)
    onStatusChange(task.id, newStatus)
  }

  const handleConvertToRoutine = () => {
    if (!form.title.trim()) return
    onConvertToRoutine(task.id, {
      title: form.title.trim(),
      cadence,
      customDays: cadence === 'custom' ? Number(customDays) : undefined,
      tags: form.selectedTags,
      notes: form.notes,
    })
  }

  const priorityState = form.highPriority ? 'high' : form.lowPriority ? 'low' : 'normal'
  const cyclePriority = () => {
    if (priorityState === 'normal') { form.setHighPriority(true); form.setLowPriority(false) }
    else if (priorityState === 'high') { form.setHighPriority(false); form.setLowPriority(true) }
    else { form.setHighPriority(false); form.setLowPriority(false) }
  }
  const priorityLabel = priorityState === 'high' ? '! High' : priorityState === 'low' ? '↓ Low' : 'Normal'

  // Esc on confirm-delete view rolls back to normal view rather than closing.
  useEffect(() => {
    if (!confirmDelete) return
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirmDelete(false) } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [confirmDelete])

  return (
    <ModalShell open={!!task} onClose={onClose} title="Edit task" terminalTitle="> task --edit" width="narrow">
      <input
        className="v2-form-input v2-form-title"
        placeholder="What needs doing?"
        value={form.title}
        onChange={e => form.setTitle(e.target.value)}
      />

      <div className="v2-form-section">
        <label className="v2-form-label">Status</label>
        <div className="v2-form-segmented v2-edit-status-row">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              className={`v2-form-seg${currentStatus === s ? ' v2-form-seg-active' : ''}`}
              onClick={() => handleStatusChange(s)}
            >
              {STATUS_META[s]?.label || s}
            </button>
          ))}
          <button
            className={`v2-form-seg v2-edit-status-done${currentStatus === 'done' ? ' v2-form-seg-active' : ''}`}
            onClick={() => handleStatusChange('done')}
            title="Mark complete"
          >
            ✓ Done
          </button>
        </div>
      </div>

      <div className="v2-form-section">
        <label className="v2-form-label">Notes</label>
        <textarea
          className="v2-form-textarea"
          placeholder="Brain dump here…"
          value={form.notes}
          onChange={e => form.setNotes(e.target.value)}
        />
        <div className="v2-edit-notes-toolbar">
          {form.notes.trim() && (
            <button className="v2-form-ai-pill v2-form-ai-pill-inline" onClick={form.handlePolish} disabled={form.polishing}>
              {form.polishing ? <span className="v2-spinner" /> : <Sparkles size={12} strokeWidth={1.75} />}
              {form.polishing ? 'Polishing…' : 'Polish'}
            </button>
          )}
          <button
            className="v2-form-ai-pill v2-form-ai-pill-inline"
            onClick={(e) => { e.preventDefault(); setShowResearch(s => !s) }}
            disabled={researching}
            title="Ask the AI to research and append findings to notes"
          >
            {researching ? <span className="v2-spinner" /> : <Search size={12} strokeWidth={1.75} />}
            {researching ? 'Researching…' : 'Research'}
          </button>
        </div>
        {form.polishError && <div className="v2-form-error">{form.polishError}</div>}
        {form.polishApplied && (form.polishApplied.addedLabels.length > 0 || form.suggestedChecklist) && (
          <div className="v2-edit-polish-applied">
            {form.polishApplied.addedLabels.length > 0 && (
              <span>
                Polish added label{form.polishApplied.addedLabels.length === 1 ? '' : 's'}: {form.polishApplied.addedLabels.join(', ')}.
              </span>
            )}
            {form.suggestedChecklist && (
              <span className="v2-edit-polish-checklist">
                Checklist suggested: <strong>{form.suggestedChecklist.name}</strong> ({form.suggestedChecklist.items.length} items)
                <button
                  type="button"
                  className="v2-edit-polish-apply"
                  onClick={() => {
                    const cl = form.consumeSuggestedChecklist()
                    if (cl) setChecklists(prev => [...prev, {
                      id: uuid(),
                      name: cl.name || 'Checklist',
                      items: (cl.items || []).map(it => ({ id: uuid(), text: it.text || '', completed: false })),
                      hideCompleted: false,
                    }])
                  }}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="v2-edit-polish-dismiss"
                  onClick={() => form.consumeSuggestedChecklist()}
                  aria-label="Dismiss suggestion"
                >
                  ✕
                </button>
              </span>
            )}
          </div>
        )}
        {researchError && <div className="v2-form-error">{researchError}</div>}
        {showResearch && (
          <div className="v2-edit-research-row">
            <input
              className="v2-form-input"
              placeholder="What do you need to know?"
              value={researchPrompt}
              onChange={e => setResearchPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runResearch() } }}
              autoFocus
            />
            <button
              className="v2-edit-research-go"
              onClick={runResearch}
              disabled={researching || (!researchPrompt.trim() && !form.attachments.length)}
            >
              {researching ? '…' : 'Go'}
            </button>
          </div>
        )}
      </div>

      {(() => {
        const forecast = weather?.status?.cache?.forecast
        const weatherReady = !!(weather?.enabled && forecast?.days?.length)
        if (!weatherReady) return null
        const liveTask = { ...task, title: form.title, energy: form.energy, tags: form.selectedTags, weather_hidden: weatherHidden }
        const visibility = resolveWeatherVisibility({ task: liveTask, labels, weatherEnabled: true })
        if (visibility === 'hidden') return null
        const hideToggle = (
          <label className="v2-edit-weather-hide">
            <input
              type="checkbox"
              checked={weatherHidden}
              onChange={e => setWeatherHidden(e.target.checked)}
            />
            <span>Hide weather on this card</span>
          </label>
        )
        if (visibility === 'visible') {
          return (
            <div className="v2-form-section v2-edit-weather">
              <label className="v2-form-label">7-day forecast</label>
              <WeatherSection forecast={forecast} dueDate={form.dueDate || null} />
              {hideToggle}
            </div>
          )
        }
        // 'drawer' — collapsed by default, expand to reveal
        return (
          <div className="v2-form-section v2-edit-weather">
            <button
              type="button"
              className="v2-edit-weather-drawer"
              onClick={() => setForecastDrawerOpen(o => !o)}
              aria-expanded={forecastDrawerOpen}
            >
              {forecastDrawerOpen ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
              <Sun size={14} strokeWidth={1.75} />
              <span>7-day forecast</span>
            </button>
            {forecastDrawerOpen && (
              <div className="v2-edit-weather-drawer-body">
                <WeatherSection forecast={forecast} dueDate={form.dueDate || null} />
                {hideToggle}
              </div>
            )}
          </div>
        )
      })()}

      <div className="v2-form-row">
        <div className="v2-form-field">
          <label className="v2-form-label">Due</label>
          <DateField value={form.dueDate} onChange={form.setDueDate} min={today} />
        </div>
        <div className="v2-form-field">
          <label className="v2-form-label">Priority</label>
          <button
            className={`v2-form-pri-toggle v2-form-pri-${priorityState}`}
            onClick={cyclePriority}
          >
            {priorityLabel}
          </button>
        </div>
      </div>

      {form.dueDate && (
        <div className="v2-form-section">
          <label className="v2-form-label" htmlFor="v2-gcal-duration">GCal duration override (min)</label>
          <div className="v2-settings-row-hint" style={{ marginTop: -4, marginBottom: 4 }}>
            Default uses size mapping (XS=15, S=30, M=60, L=120, XL=240). Leave blank for default.
          </div>
          <input
            id="v2-gcal-duration"
            className="v2-form-input v2-edit-duration-input"
            type="number"
            min="5"
            max="480"
            step="5"
            placeholder={form.size ? { XS: '15', S: '30', M: '60', L: '120', XL: '240' }[form.size] || 'auto' : 'auto'}
            value={gcalDuration}
            onChange={e => setGcalDuration(e.target.value ? parseInt(e.target.value, 10) : '')}
          />
        </div>
      )}

      <div className="v2-form-section">
        <label className="v2-form-label">Size</label>
        <div className="v2-form-segmented">
          {SIZE_OPTIONS.map(s => (
            <button
              key={s}
              className={`v2-form-seg${form.size === s ? ' v2-form-seg-active' : ''}`}
              onClick={() => form.setSize(form.size === s ? null : s)}
            >
              {s}
            </button>
          ))}
          <button
            className="v2-form-ai-pill v2-form-ai-pill-inline"
            onClick={form.handleInferSize}
            disabled={form.sizing || !form.title.trim()}
          >
            {form.sizing ? <span className="v2-spinner" /> : <Sparkles size={12} strokeWidth={1.75} />}
            {form.sizing ? 'Sizing…' : 'Auto'}
          </button>
        </div>
      </div>

      <div className="v2-form-section">
        <label className="v2-form-label">Energy type</label>
        <div className="v2-form-energy-grid">
          {ENERGY_TYPES.map(et => {
            const selected = form.energy === et.id
            return (
              <button
                key={et.id}
                className={`v2-form-energy-pill${selected ? ' v2-form-energy-pill-active' : ''}`}
                onClick={() => form.setEnergy(form.energy === et.id ? null : et.id)}
                style={selected ? { borderColor: et.color, color: et.color } : undefined}
              >
                {et.label}
              </button>
            )
          })}
        </div>
        {form.energy && (
          <>
            <label className="v2-form-label" style={{ marginTop: 14 }}>Energy drain</label>
            <div className="v2-form-segmented">
              {ENERGY_LEVEL_LABELS.map(({ lvl, label }) => (
                <button
                  key={lvl}
                  className={`v2-form-seg${form.energyLevel === lvl ? ' v2-form-seg-active' : ''}`}
                  onClick={() => form.setEnergyLevel(form.energyLevel === lvl ? null : lvl)}
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Checklists — multi-list. Empty state shows just the "+ Add checklist"
          pill below; CHECKLISTS label only renders when at least one exists. */}
      <div className={`v2-form-section${checklists.length === 0 ? ' v2-form-section-compact' : ''}`}>
        {checklists.length > 0 && (
          <div className="v2-edit-checklist-head">
            <label className="v2-form-label">Checklists</label>
            {checklists.reduce((n, c) => n + c.items.length, 0) > 0 && (
              <span className="v2-edit-checklist-summary">
                {checklists.reduce((n, c) => n + c.items.filter(i => i.completed).length, 0)}/{checklists.reduce((n, c) => n + c.items.length, 0)} done
              </span>
            )}
          </div>
        )}
        {checklists.map(cl => {
          const completed = cl.items.filter(i => i.completed).length
          const total = cl.items.length
          const pct = total ? Math.round((completed / total) * 100) : 0
          const visible = cl.hideCompleted ? cl.items.filter(i => !i.completed) : cl.items
          const hidden = cl.hideCompleted ? cl.items.filter(i => i.completed).length : 0
          return (
            <div key={cl.id} className="v2-edit-checklist">
              <div className="v2-edit-checklist-header">
                <input
                  className="v2-edit-checklist-name"
                  value={cl.name}
                  onChange={e => renameChecklist(cl.id, e.target.value)}
                />
                {total > 0 && completed > 0 && (
                  <button
                    type="button"
                    className="v2-edit-checklist-toggle"
                    onClick={() => toggleHideCompleted(cl.id)}
                  >
                    {cl.hideCompleted ? 'Show completed' : 'Hide completed'}
                  </button>
                )}
                {confirmDeleteChecklist === cl.id ? (
                  <span className="v2-edit-checklist-confirm">
                    Delete?
                    <button type="button" onClick={() => removeChecklist(cl.id)}>Yes</button>
                    <button type="button" onClick={() => setConfirmDeleteChecklist(null)}>No</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="v2-edit-checklist-delete"
                    onClick={() => setConfirmDeleteChecklist(cl.id)}
                    aria-label="Delete checklist"
                  >
                    <Trash2 size={13} strokeWidth={1.75} />
                  </button>
                )}
              </div>
              {total > 0 && (
                <div className="v2-edit-checklist-progress">
                  <div className="v2-edit-checklist-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              )}
              <ul className="v2-edit-checklist-items">
                {visible.map(item => (
                  <li key={item.id} className="v2-edit-checklist-item">
                    <input
                      type="checkbox"
                      className="v2-edit-checklist-check"
                      checked={item.completed}
                      onChange={() => toggleItem(cl.id, item.id)}
                    />
                    <input
                      className={`v2-edit-checklist-text${item.completed ? ' v2-edit-checklist-text-done' : ''}`}
                      value={item.text}
                      onChange={e => renameItem(cl.id, item.id, e.target.value)}
                    />
                    <button
                      type="button"
                      className="v2-edit-checklist-item-remove"
                      onClick={() => removeItem(cl.id, item.id)}
                      aria-label="Remove item"
                    >
                      <XIcon size={12} strokeWidth={2} />
                    </button>
                  </li>
                ))}
              </ul>
              {hidden > 0 && (
                <div className="v2-edit-checklist-hidden">{hidden} completed item{hidden > 1 ? 's' : ''} hidden</div>
              )}
              <div className="v2-edit-checklist-add">
                <input
                  className="v2-edit-checklist-add-input"
                  placeholder="Add item…"
                  value={newCheckItems[cl.id] || ''}
                  onChange={e => setNewCheckItems(prev => ({ ...prev, [cl.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(cl.id) } }}
                />
              </div>
            </div>
          )
        })}
        <button type="button" className="v2-edit-checklist-new" onClick={addChecklist}>
          <Plus size={13} strokeWidth={2} /> {checklists.length === 0 ? 'Add checklist' : 'Add another checklist'}
        </button>
      </div>

      {/* Attachments — file uploads with optional AI text extraction. The
          ATTACHMENTS label only renders when there's content; empty state is
          a lone "+ Attach files" pill in the affordance strip below. */}
      <div className={`v2-form-section${form.attachments.length === 0 ? ' v2-form-section-compact' : ''}`}>
        {form.attachments.length > 0 && (
          <div className="v2-edit-attach-head">
            <label className="v2-form-label">Attachments</label>
            <span className="v2-edit-attach-summary">
              {form.attachments.length} · {form.formatFileSize(form.attachments.reduce((n, a) => n + a.size, 0))}
            </span>
          </div>
        )}
        <input
          ref={form.fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.csv,.json"
          hidden
          onChange={form.handleFileSelect}
        />
        <div className="v2-edit-attach-actions">
          <button
            type="button"
            className={form.attachments.length > 0 ? 'v2-form-ai-pill v2-form-ai-pill-inline' : 'v2-edit-add-pill'}
            onClick={() => form.fileInputRef.current?.click()}
          >
            <Paperclip size={12} strokeWidth={1.75} /> Attach files
          </button>
          {form.attachments.length > 0 && (
            <button
              type="button"
              className="v2-form-ai-pill v2-form-ai-pill-inline"
              onClick={form.handleExtractText}
              disabled={form.extracting}
              title="Run AI text extraction on attachments and append to notes"
            >
              {form.extracting ? <span className="v2-spinner" /> : <FileText size={12} strokeWidth={1.75} />}
              {form.extracting ? 'Extracting…' : 'Extract text'}
            </button>
          )}
        </div>
        {form.attachError && <div className="v2-form-error">{form.attachError}</div>}
        {form.attachments.length > 0 && (
          <ul className="v2-edit-attach-list">
            {form.attachments.map(a => (
              <li key={a.id} className="v2-edit-attach-item">
                <span className="v2-edit-attach-name">{a.name}</span>
                <span className="v2-edit-attach-size">{form.formatFileSize(a.size)}</span>
                <button
                  type="button"
                  className="v2-edit-attach-remove"
                  onClick={() => form.removeAttachment(a.id)}
                  aria-label={`Remove ${a.name}`}
                >
                  <XIcon size={13} strokeWidth={2} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Connections — Notion link/create. Lives next to Checklists +
          Attachments because it's the third "linking content" affordance.
          CONNECTIONS label only when something is linked or in-flight; empty
          state is just the "Notion" pill. */}
      <div className={`v2-form-section${!form.notionResult && !form.notionState ? ' v2-form-section-compact' : ''}`}>
        {(form.notionResult || form.notionState) && (
          <div className="v2-edit-attach-head">
            <label className="v2-form-label">Connections</label>
          </div>
        )}
        <div className="v2-edit-connections">
          {form.notionResult ? (
            <div className="v2-edit-connection-pill v2-edit-connection-linked">
              <a href={form.notionResult.url} target="_blank" rel="noopener noreferrer">Notion ↗</a>
              <button
                type="button"
                className="v2-edit-connection-unlink"
                onClick={() => form.setNotionResult(null)}
                aria-label="Unlink Notion page"
              >
                <XIcon size={11} strokeWidth={2} />
              </button>
            </div>
          ) : !form.notionState ? (
            <button
              type="button"
              className="v2-edit-add-pill"
              onClick={form.handleNotionSearch}
              disabled={!form.title.trim()}
              title="Search Notion for matching pages, or create a new one"
            >
              <Search size={12} strokeWidth={1.75} /> Notion
            </button>
          ) : null}
        </div>
        {form.notionState === 'searching' && (
          <div className="v2-edit-notion-status">
            <span className="v2-spinner" /> Searching Notion…
          </div>
        )}
        {form.notionState?.action === 'error' && (
          <div className="v2-form-error">
            {form.notionState.reason}
            <button
              type="button"
              className="v2-form-ai-pill v2-form-ai-pill-static"
              onClick={form.handleNotionSearch}
              style={{ marginLeft: 8 }}
            >
              Retry
            </button>
          </div>
        )}
        {form.notionState && form.notionState !== 'searching' && form.notionState.action !== 'error' && (
          <div className="v2-edit-notion-suggestions">
            {form.notionState.pages?.length > 0 && (
              <>
                <div className="v2-edit-notion-reason">{form.notionState.reason}</div>
                <ul className="v2-edit-notion-list">
                  {form.notionState.pages.map(page => (
                    <li key={page.id}>
                      <button
                        type="button"
                        className="v2-edit-notion-page"
                        onClick={() => form.handleNotionLink(page)}
                      >
                        {page.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="v2-edit-notion-actions">
              <button
                type="button"
                className="v2-form-ai-pill v2-form-ai-pill-static"
                onClick={form.handleNotionCreate}
                disabled={form.notionCreating}
              >
                {form.notionCreating ? <span className="v2-spinner" /> : <Plus size={12} strokeWidth={2} />}
                {form.notionCreating ? 'Creating…' : 'Create new Notion page'}
              </button>
              <button
                type="button"
                className="v2-edit-notion-cancel"
                onClick={() => form.setNotionState(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {labels.length > 0 && (
        <div className="v2-form-section">
          <label className="v2-form-label">Labels</label>
          <div className="v2-form-label-grid">
            {labels.map(lbl => {
              const active = form.selectedTags.includes(lbl.id)
              return (
                <button
                  key={lbl.id}
                  className={`v2-form-label-pill${active ? ' v2-form-label-pill-active' : ''}`}
                  onClick={() => form.toggleTag(lbl.id)}
                  style={active ? { background: lbl.color, borderColor: lbl.color, color: '#fff' } : undefined}
                  title={lbl.name}
                >
                  {lbl.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Routine-conversion picker — only visible while the user is actively
          converting. Trigger lives as a small pill in the bottom action row. */}
      {!task.routine_id && makeRecurring && (
        <div className="v2-form-section">
          <label className="v2-form-label">Cadence</label>
          <div className="v2-edit-routine-row">
            <select
              className="v2-form-input v2-edit-routine-select"
              value={cadence}
              onChange={e => setCadence(e.target.value)}
            >
              {CADENCE_OPTIONS.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            {cadence === 'custom' && (
              <input
                className="v2-form-input v2-edit-routine-days"
                type="number"
                min="1"
                value={customDays}
                onChange={e => setCustomDays(e.target.value)}
                placeholder="days"
              />
            )}
            <button className="v2-edit-routine-confirm" onClick={handleConvertToRoutine}>Convert</button>
            <button className="v2-edit-routine-cancel" onClick={() => setMakeRecurring(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Comments — task-local thread. COMMENTS label only when content
          OR explicitly opened; otherwise just the "+ Add" pill. */}
      <div className={`v2-form-section${comments.length === 0 && !showComments ? ' v2-form-section-compact' : ''}`}>
        {(comments.length > 0 || showComments) && (
          <div className="v2-edit-attach-head">
            <label className="v2-form-label">Comments</label>
            {comments.length > 0 && (
              <span className="v2-edit-attach-summary">{comments.length}</span>
            )}
          </div>
        )}
        {!showComments && (
          <button type="button" className="v2-edit-add-pill" onClick={() => setShowComments(true)}>
            <Plus size={12} strokeWidth={2} /> Add comment
          </button>
        )}
        {showComments && (
          <>
            {comments.length > 0 && (
              <ul className="v2-edit-comment-list">
                {comments.map(c => (
                  <li key={c.id} className="v2-edit-comment-item">
                    <div className="v2-edit-comment-text">{c.text}</div>
                    <div className="v2-edit-comment-meta">
                      <span className="v2-edit-comment-time">
                        {new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        {' · '}
                        {new Date(c.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <button
                        type="button"
                        className="v2-edit-comment-remove"
                        onClick={() => removeComment(c.id)}
                        aria-label="Remove comment"
                      >
                        <XIcon size={11} strokeWidth={2} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="v2-edit-comment-input-row">
              <input
                className="v2-form-input"
                placeholder="Add a comment…"
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addComment() } }}
              />
              <button
                className="v2-edit-research-go"
                disabled={!newComment.trim()}
                onClick={addComment}
              >
                Add
              </button>
            </div>
          </>
        )}
      </div>

      <div className="v2-form-section v2-edit-manage">
        <div className="v2-edit-manage-label">Manage</div>
        <div className="v2-edit-actions-row">
          <button
            className="v2-edit-action"
            onClick={() => { onBacklog(task.id, true); onClose() }}
            title="Move to backlog"
          >
            <Archive size={14} strokeWidth={1.75} /> <span className="v2-edit-action-label" data-terminal-cmd="> archive">Backlog</span>
          </button>
          <button
            className="v2-edit-action"
            onClick={() => { onProject(task.id, true); onClose() }}
            title="Move to projects"
          >
            <FolderKanban size={14} strokeWidth={1.75} /> <span className="v2-edit-action-label" data-terminal-cmd="> move-to-projects">Projects</span>
          </button>
          {!task.routine_id && !makeRecurring && (
            <button
              className="v2-edit-action"
              onClick={() => setMakeRecurring(true)}
              title="Convert this task into a recurring routine"
            >
              <RotateCw size={14} strokeWidth={1.75} /> <span className="v2-edit-action-label" data-terminal-cmd="> make-recurring">Make recurring</span>
            </button>
          )}
          {!confirmDelete ? (
            <button
              className="v2-edit-action v2-edit-action-danger"
              onClick={() => setConfirmDelete(true)}
              title="Delete task"
            >
              <Trash2 size={14} strokeWidth={1.75} /> <span className="v2-edit-action-label" data-terminal-cmd="> delete --confirm">Delete</span>
            </button>
          ) : (
            <div className="v2-edit-confirm-delete">
              <span className="v2-edit-confirm-label">Delete?</span>
              <button
                className="v2-edit-action v2-edit-action-confirm-yes"
                onClick={() => { onDelete(task.id); onClose() }}
              >
                Yes
              </button>
              <button
                className="v2-edit-action"
                onClick={() => setConfirmDelete(false)}
              >
                No
              </button>
            </div>
          )}
        </div>
      </div>

      <button
        className="v2-form-submit"
        disabled={!form.title.trim()}
        onClick={handleSave}
      >
        Save changes
      </button>
    </ModalShell>
  )
}
