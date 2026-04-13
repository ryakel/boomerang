import { useState, useRef, useEffect, useCallback } from 'react'
import './EditTaskModal.css'
import { loadLabels, loadSettings, loadRoutines, formatCadence, RECURRENCE_OPTIONS, ACTIVE_STATUSES, STATUS_META, ENERGY_TYPES, uuid } from '../store'
import { polishNotes, researchTask, inferDate, inferSize, suggestNotionLink, generateNotionContent, notionCreatePage, notionUploadFile, trelloCreateCard, trelloCreateChecklist, trelloAddCheckItem, trelloUploadAttachment, trelloBoardLists } from '../api'
import { Sparkles, Search, ChevronRight, Trash2, Plus } from 'lucide-react'
import EnergyIcon from './EnergyIcon'
import { useIsDesktop } from '../hooks/useIsDesktop'

function formatFileSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

const MAX_TOTAL_SIZE = 5 * 1024 * 1024 // 5MB

export default function EditTaskModal({ task, onSave, onConvertToRoutine, onClose, onDelete, onBacklog, onProject, onStatusChange, onOpenRoutine }) {
  const isDesktop = useIsDesktop()
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
  // Migrate old flat checklist → named checklists
  const [checklists, setChecklists] = useState(() => {
    if (task.checklists?.length) return task.checklists
    if (task.checklist?.length) return [{ id: uuid(), name: 'Checklist', items: task.checklist, hideCompleted: false }]
    return []
  })
  const [newCheckItems, setNewCheckItems] = useState({}) // { checklistId: string }
  const [confirmDeleteChecklist, setConfirmDeleteChecklist] = useState(null)
  // Collapsible sections — expand if content exists
  const [expandedSections, setExpandedSections] = useState(() => {
    const s = new Set()
    if (task.checklists?.length || task.checklist?.length) s.add('checklists')
    if (task.comments?.length) s.add('comments')
    if (task.attachments?.length) s.add('attachments')
    return s
  })
  const toggleSection = (key) => setExpandedSections(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })
  const dragRef = useRef(null) // { checklistId, itemId }
  const [dragOver, setDragOver] = useState(null) // { checklistId, itemId }

  const handleDragStart = (checklistId, itemId) => {
    dragRef.current = { checklistId, itemId }
  }

  const handleDragOver = (e, checklistId, itemId) => {
    e.preventDefault()
    setDragOver({ checklistId, itemId })
  }

  const handleDragEnd = () => {
    if (!dragRef.current || !dragOver) {
      dragRef.current = null
      setDragOver(null)
      return
    }
    const src = dragRef.current
    const dst = dragOver
    dragRef.current = null
    setDragOver(null)

    if (src.checklistId === dst.checklistId && src.itemId === dst.itemId) return

    setChecklists(prev => {
      const next = prev.map(c => ({ ...c, items: [...c.items] }))
      const srcList = next.find(c => c.id === src.checklistId)
      const dstList = next.find(c => c.id === dst.checklistId)
      if (!srcList || !dstList) return prev

      const srcIdx = srcList.items.findIndex(i => i.id === src.itemId)
      if (srcIdx === -1) return prev
      const [item] = srcList.items.splice(srcIdx, 1)

      const dstIdx = dstList.items.findIndex(i => i.id === dst.itemId)
      if (dstIdx === -1) {
        dstList.items.push(item)
      } else {
        dstList.items.splice(dstIdx, 0, item)
      }
      return next
    })
  }

  const handleDropOnList = (e, checklistId) => {
    e.preventDefault()
    if (!dragRef.current) return
    const src = dragRef.current
    dragRef.current = null
    setDragOver(null)

    if (src.checklistId === checklistId) return

    setChecklists(prev => {
      const next = prev.map(c => ({ ...c, items: [...c.items] }))
      const srcList = next.find(c => c.id === src.checklistId)
      const dstList = next.find(c => c.id === checklistId)
      if (!srcList || !dstList) return prev

      const srcIdx = srcList.items.findIndex(i => i.id === src.itemId)
      if (srcIdx === -1) return prev
      const [item] = srcList.items.splice(srcIdx, 1)
      dstList.items.push(item)
      return next
    })
  }
  const [comments, setComments] = useState(task.comments || [])
  const [newComment, setNewComment] = useState('')
  const [trelloResult, setTrelloResult] = useState(
    task.trello_card_id ? { id: task.trello_card_id, url: task.trello_card_url } : null
  )
  const [highPriority, setHighPriority] = useState(task.high_priority || false)
  const [lowPriority, setLowPriority] = useState(task.low_priority || false)
  const [gcalDuration, setGcalDuration] = useState(task.gcal_duration || '')
  const cyclePriority = () => {
    if (!highPriority && !lowPriority) { setHighPriority(true); setLowPriority(false) }
    else if (highPriority) { setHighPriority(false); setLowPriority(true) }
    else { setHighPriority(false); setLowPriority(false) }
  }
  const priorityLabel = highPriority ? '! High' : lowPriority ? '↓ Low' : 'Normal'
  const priorityClass = highPriority ? ' active' : lowPriority ? ' low' : ''
  const [currentStatus, setCurrentStatus] = useState(task.status === 'open' ? 'not_started' : task.status)
  const [trelloPushing, setTrelloPushing] = useState(false)
  const [trelloLists, setTrelloLists] = useState([])
  const [trelloConfigured] = useState(() => {
    const s = loadSettings()
    return !!(s.trello_board_id || s.trello_list_mapping)
  })
  const [trelloPushListId, setTrelloPushListId] = useState(() => {
    const s = loadSettings()
    const status = (task.status === 'backlog' || task.status === 'project') ? 'not_started' : (task.status || 'not_started')
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
        low_priority: lowPriority,
        notion_page_id: notionResult?.id || null,
        notion_url: notionResult?.url || null,
        trello_card_id: trelloResult?.id || null,
        trello_card_url: trelloResult?.url || null,
        attachments,
        checklists,
        checklist: [], // clear old field after migration
        comments,
        gcal_duration: gcalDuration ? parseInt(gcalDuration, 10) : null,
      })
      flashSaved()
    }, 1000)

    return () => clearTimeout(autoSaveTimer.current)
  }, [title, notes, selectedTags, dueDate, size, energy, energyLevel, highPriority, lowPriority, notionResult, trelloResult, attachments, checklists, comments, gcalDuration]) // eslint-disable-line react-hooks/exhaustive-deps

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
        low_priority: lowPriority,
        notion_page_id: notionResult?.id || null,
        notion_url: notionResult?.url || null,
        trello_card_id: trelloResult?.id || null,
        trello_card_url: trelloResult?.url || null,
        attachments,
        checklists,
        checklist: [],
        comments,
        gcal_duration: gcalDuration ? parseInt(gcalDuration, 10) : null,
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
      const routine = task.routine_id ? loadRoutines().find(r => r.id === task.routine_id) : null
      const tagNames = selectedTags.map(id => labels.find(l => l.id === id)?.name || id)
      const energyType = energy ? ENERGY_TYPES.find(t => t.id === energy)?.label : undefined
      const metadata = {
        tags: tagNames,
        lastUpdated: task.last_touched ? new Date(task.last_touched).toLocaleDateString() : new Date().toLocaleDateString(),
        lastPerformed: task.completed_at ? new Date(task.completed_at).toLocaleDateString() : undefined,
        frequency: routine ? formatCadence(routine) : undefined,
        dueDate: dueDate || undefined,
        size: size || undefined,
        energy: energyType || undefined,
        energyLevel: energyLevel || undefined,
        priority: highPriority ? 'High' : undefined,
        status: task.status || undefined,
      }

      // Build enriched notes with checklists and attachment references
      let enrichedNotes = notes.trim()
      if (checklists.length > 0) {
        const clText = checklists.map(cl => {
          const header = `## ${cl.name || 'Checklist'}`
          const items = cl.items.map(i => `- [${i.completed ? 'x' : ' '}] ${i.text}`).join('\n')
          return `${header}\n${items}`
        }).join('\n\n')
        enrichedNotes = enrichedNotes ? `${enrichedNotes}\n\n${clText}` : clText
      }
      const content = await generateNotionContent(title, enrichedNotes, !!task.routine_id, metadata)
      const page = await notionCreatePage(title, content, settings.notion_parent_page_id || null)

      // Upload attachments to the Notion page
      for (const att of attachments) {
        try {
          await notionUploadFile(page.id, att.name, att.type, att.data)
        } catch { /* continue with remaining attachments */ }
      }

      setNotionResult(page)
      setNotionState(null)

      // Persist Notion link immediately for ongoing sync
      onSave(task.id, {
        notion_page_id: page.id,
        notion_url: page.url,
      })
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
      // Create card with notes only (checklists go as native Trello checklists)
      const card = await trelloCreateCard(title.trim(), notes.trim(), trelloPushListId)

      // Create native Trello checklists and store IDs for ongoing sync
      const updatedChecklists = [...checklists]
      for (let ci = 0; ci < updatedChecklists.length; ci++) {
        const cl = updatedChecklists[ci]
        if (!cl.items.length) continue
        const trelloCl = await trelloCreateChecklist(card.id, cl.name || 'Checklist')
        const updatedItems = [...cl.items]
        for (let ii = 0; ii < updatedItems.length; ii++) {
          const trelloItem = await trelloAddCheckItem(trelloCl.id, updatedItems[ii].text, updatedItems[ii].completed)
          updatedItems[ii] = { ...updatedItems[ii], trello_check_item_id: trelloItem.id }
        }
        updatedChecklists[ci] = { ...cl, trello_checklist_id: trelloCl.id, items: updatedItems }
      }
      setChecklists(updatedChecklists)

      // Upload attachments
      for (const att of attachments) {
        await trelloUploadAttachment(card.id, att.name, att.type, att.data)
      }

      setTrelloResult({ id: card.id, url: card.url })

      // Enable ongoing sync and persist card ID + checklist IDs together
      onSave(task.id, {
        trello_card_id: card.id,
        trello_card_url: card.url,
        trello_sync_enabled: true,
        checklists: updatedChecklists,
      })
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

  const runResearch = async (prompt, fileAttachments) => {
    setResearching(true)
    try {
      const result = await researchTask(title || 'Untitled task', notes, prompt, fileAttachments || attachments)
      if (result.notes) {
        const separator = notes.trim() ? '\n\n' : ''
        setNotes(prev => (prev.trim() ? prev.trim() + separator : '') + result.notes)
      }
      return true
    } catch { return false }
    finally { setResearching(false) }
  }

  const handleResearch = async (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!researchPrompt.trim()) return
    const ok = await runResearch(researchPrompt.trim())
    if (ok) {
      setResearchPrompt('')
      setShowResearch(false)
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
        id: uuid(),
        name: file.name,
        type: file.type,
        size: file.size,
        data: reader.result.split(',')[1],
      })
      reader.readAsDataURL(file)
    }))
    Promise.all(readers).then(results => {
      const newAttachments = [...attachments, ...results]
      setAttachments(newAttachments)
      // Auto-research new attachments
      const names = results.map(r => r.name).join(', ')
      runResearch(`Analyze the attached file(s) (${names}) and provide relevant notes for this task.`, newAttachments)
    })
    e.target.value = ''
  }

  const removeAttachment = (id) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
    setAttachError(null)
  }

  const today = new Date().toISOString().split('T')[0]
  const isAlreadyRoutine = !!task.routine_id
  const parentRoutine = isAlreadyRoutine ? loadRoutines().find(r => r.id === task.routine_id) : null

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

  // Pull-to-close on the handle bar
  const sheetRef = useRef(null)
  const handleRef = useRef(null)
  const pullRef = useRef({ startY: 0, active: false })
  useEffect(() => {
    const handle = handleRef.current
    const sheet = sheetRef.current
    if (!handle || !sheet) return
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
      if (dy > 60) { handleClose() }
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`sheet-overlay${isDesktop ? ' sheet-overlay-drawer' : ''}`} onClick={handleClose}>
      <div className={`sheet${isDesktop ? ' sheet-drawer' : ''}`} ref={sheetRef} onClick={e => e.stopPropagation()}>
        {!isDesktop && <button ref={handleRef} className="sheet-handle" onClick={handleClose} />}
        <button className="modal-close-btn" onClick={handleClose} aria-label="Close">✕</button>
        <span className={`autosave-pill autosave-pill-floating ${justSaved ? 'autosave-pill-saved' : ''}`}>
          {justSaved ? '✓ Saved' : 'Auto Save'}
        </span>
        <div className="sheet-title">Edit Task</div>
        {isAlreadyRoutine && (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)', marginBottom: 8, marginTop: -8 }}>
            Part of routine: {onOpenRoutine ? (
              <button onClick={() => onOpenRoutine(task.routine_id)} style={{ color: '#A78BFA', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                {parentRoutine?.title || 'Unknown'} →
              </button>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{parentRoutine?.title || 'Unknown'}</span>
            )}
          </div>
        )}

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
              <button className={`polish-btn${polishing ? ' loading' : ''}`} onClick={handlePolish} disabled={polishing}>
                <Sparkles size={14} /> Polish
              </button>
            )}
            <button
              className={`polish-btn research-btn${researching ? ' loading' : ''}`}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); setShowResearch(!showResearch) }}
              disabled={researching}
            >
              <Search size={14} /> Research
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

        {/* Scheduling: Due date + Duration + Priority */}
        {!makeRecurring && (
          <div className="scheduling-row">
            <div className="scheduling-field">
              <div className="settings-label">Due</div>
              <input
                className="routine-select"
                type="date"
                value={dueDate}
                min={today}
                onChange={e => setDueDate(e.target.value)}
                style={{ marginBottom: 0, fontSize: 13 }}
              />
            </div>
            {dueDate && (
              <div className="scheduling-field">
                <div className="settings-label">Dur (min)</div>
                <input
                  className="dur-input"
                  type="number"
                  min="5"
                  max="480"
                  step="5"
                  placeholder={size ? { XS: '15', S: '30', M: '60', L: '120', XL: '240' }[size] || 'auto' : 'auto'}
                  value={gcalDuration}
                  onChange={e => setGcalDuration(e.target.value ? parseInt(e.target.value, 10) : '')}
                />
              </div>
            )}
            <div className="scheduling-field">
              <div className="settings-label">Pri</div>
              <button
                className={`priority-toggle${priorityClass}`}
                onClick={cyclePriority}
              >
                {priorityLabel}
              </button>
            </div>
          </div>
        )}

        {/* Labels */}
        <div className="settings-label" style={{ marginBottom: 4 }}>Labels</div>
        <select
          className="routine-select"
          value=""
          onChange={e => { if (e.target.value) toggleTag(e.target.value) }}
          style={{ marginBottom: selectedTags.length > 0 ? 6 : 12 }}
        >
          <option value="">Add label...</option>
          {labels.filter(l => !selectedTags.includes(l.id)).map(label => (
            <option key={label.id} value={label.id}>{label.name}</option>
          ))}
        </select>
        {selectedTags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
            {selectedTags.map(id => {
              const label = labels.find(l => l.id === id)
              if (!label) return null
              return (
                <button key={id} className="routine-label-pill" style={{ background: label.color }} onClick={() => toggleTag(id)}>
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
                className={`size-select-btn size-${s.toLowerCase()}${size === s ? ' selected' : ''}`}
                onClick={() => setSize(size === s ? null : s)}
              >
                {s}
              </button>
            ))}
            <button className="polish-btn" onClick={handleInferSize} disabled={sizing || !title.trim()} style={{ marginTop: 0, marginLeft: 8 }}>
              {sizing ? <span className="spinner" /> : <Sparkles size={14} />} {sizing ? 'Sizing...' : 'Auto'}
            </button>
          </div>

          <div className="settings-label" style={{ marginBottom: 4 }}>Energy Type</div>
          <div className="energy-selector">
            {ENERGY_TYPES.map(et => (
              <button
                key={et.id}
                className={`energy-select-btn energy-type-btn${energy === et.id ? ' selected' : ''}`}
                onClick={() => setEnergy(energy === et.id ? null : et.id)}
                title={et.label}
              >
                <EnergyIcon icon={et.icon} color={et.color} size={18} />
                <span className="energy-type-label">{et.label}</span>
              </button>
            ))}
          </div>

          {energy && (
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
                    className={`energy-select-btn energy-level-btn${energyLevel === lvl ? ' selected' : ''}`}
                    onClick={() => setEnergyLevel(energyLevel === lvl ? null : lvl)}
                  >
                    <span className={`energy-dot ${dotClass} active`} style={{ display: 'inline-block', marginRight: 4 }} /> {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Attachments — collapsible */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
        <div className="section-header" onClick={() => { if (attachments.length > 0 || expandedSections.has('attachments')) toggleSection('attachments'); else { fileInputRef.current?.click(); } }}>
          <span className="settings-label">Attachments</span>
          <div className="section-header-right">
            {attachments.length > 0 && <span className="section-badge">{attachments.length}</span>}
            {attachments.length > 0 ? (
              <ChevronRight size={14} className={`section-chevron${expandedSections.has('attachments') ? ' expanded' : ''}`} />
            ) : (
              <button className="checklist-add-list-btn" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>
                <Plus size={12} /> Add
              </button>
            )}
          </div>
        </div>
        {expandedSections.has('attachments') && (
          <>
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
          </>
        )}

        {/* Checklists — collapsible */}
        <div className="section-header" onClick={() => { if (checklists.length > 0) toggleSection('checklists') }}>
          <span className="settings-label">Checklists</span>
          <div className="section-header-right">
            {checklists.reduce((sum, cl) => sum + cl.items.length, 0) > 0 && (
              <span className="section-badge">
                {checklists.reduce((sum, cl) => sum + cl.items.filter(i => i.completed).length, 0)}/{checklists.reduce((sum, cl) => sum + cl.items.length, 0)}
              </span>
            )}
            <button
              className="checklist-add-list-btn"
              onClick={(e) => {
                e.stopPropagation()
                setChecklists(prev => [...prev, { id: uuid(), name: 'Checklist', items: [], hideCompleted: false }])
                setExpandedSections(prev => new Set(prev).add('checklists'))
              }}
            >
              <Plus size={12} /> Add
            </button>
            {checklists.length > 0 && (
              <ChevronRight size={14} className={`section-chevron${expandedSections.has('checklists') ? ' expanded' : ''}`} />
            )}
          </div>
        </div>

        {expandedSections.has('checklists') && checklists.map((cl) => {
          const completed = cl.items.filter(i => i.completed).length
          const total = cl.items.length
          const pct = total ? Math.round((completed / total) * 100) : 0
          const visibleItems = cl.hideCompleted ? cl.items.filter(i => !i.completed) : cl.items
          const hiddenCount = cl.hideCompleted ? cl.items.filter(i => i.completed).length : 0

          return (
            <div key={cl.id} className="checklist-group">
              <div className="checklist-group-header">
                <input
                  className="checklist-name-input"
                  value={cl.name}
                  onChange={e => {
                    setChecklists(prev => prev.map(c =>
                      c.id === cl.id ? { ...c, name: e.target.value } : c
                    ))
                  }}
                />
                <div className="checklist-header-actions">
                  {total > 0 && completed > 0 && (
                    <button
                      className="checklist-hide-toggle"
                      onClick={() => {
                        setChecklists(prev => prev.map(c =>
                          c.id === cl.id ? { ...c, hideCompleted: !c.hideCompleted } : c
                        ))
                      }}
                    >
                      {cl.hideCompleted ? 'Show completed' : 'Hide completed'}
                    </button>
                  )}
                  {confirmDeleteChecklist === cl.id ? (
                    <span className="checklist-confirm-delete">
                      Delete?
                      <button onClick={() => {
                        setChecklists(prev => prev.filter(c => c.id !== cl.id))
                        setConfirmDeleteChecklist(null)
                      }}>Yes</button>
                      <button onClick={() => setConfirmDeleteChecklist(null)}>No</button>
                    </span>
                  ) : (
                    <button
                      className="checklist-delete-list"
                      onClick={() => setConfirmDeleteChecklist(cl.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {total > 0 && (
                <div className="checklist-progress-bar-wrap">
                  <div className="checklist-progress-bar">
                    <div className="checklist-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="checklist-progress-text">{completed}/{total}</span>
                </div>
              )}

              <div className="checklist-edit-section" onDragOver={e => e.preventDefault()} onDrop={e => handleDropOnList(e, cl.id)}>
                {visibleItems.map((item) => (
                  <div
                    key={item.id}
                    className={`checklist-edit-item${dragOver?.checklistId === cl.id && dragOver?.itemId === item.id ? ' drag-over' : ''}`}
                    draggable
                    onDragStart={() => handleDragStart(cl.id, item.id)}
                    onDragOver={e => handleDragOver(e, cl.id, item.id)}
                    onDragEnd={handleDragEnd}
                  >
                    <span className="checklist-drag-handle">⠿</span>
                    <input
                      type="checkbox"
                      className="checklist-checkbox"
                      checked={item.completed}
                      onChange={() => {
                        setChecklists(prev => prev.map(c =>
                          c.id === cl.id ? { ...c, items: c.items.map(i =>
                            i.id === item.id ? { ...i, completed: !i.completed } : i
                          )} : c
                        ))
                      }}
                    />
                    <input
                      className="checklist-edit-input"
                      value={item.text}
                      onChange={e => {
                        setChecklists(prev => prev.map(c =>
                          c.id === cl.id ? { ...c, items: c.items.map(i =>
                            i.id === item.id ? { ...i, text: e.target.value } : i
                          )} : c
                        ))
                      }}
                    />
                    <button className="checklist-delete" onClick={() => {
                      setChecklists(prev => prev.map(c =>
                        c.id === cl.id ? { ...c, items: c.items.filter(i => i.id !== item.id) } : c
                      ))
                    }}>x</button>
                  </div>
                ))}
                {hiddenCount > 0 && (
                  <div className="checklist-hidden-count">{hiddenCount} completed item{hiddenCount > 1 ? 's' : ''} hidden</div>
                )}
                <div className="checklist-add-row">
                  <input
                    className="checklist-add-input"
                    placeholder="Add item..."
                    value={newCheckItems[cl.id] || ''}
                    onChange={e => setNewCheckItems(prev => ({ ...prev, [cl.id]: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (newCheckItems[cl.id] || '').trim()) {
                        setChecklists(prev => prev.map(c =>
                          c.id === cl.id ? { ...c, items: [...c.items, { id: uuid(), text: newCheckItems[cl.id].trim(), completed: false }] } : c
                        ))
                        setNewCheckItems(prev => ({ ...prev, [cl.id]: '' }))
                      }
                    }}
                  />
                  <button
                    className="checklist-add-btn"
                    disabled={!(newCheckItems[cl.id] || '').trim()}
                    onClick={() => {
                      if ((newCheckItems[cl.id] || '').trim()) {
                        setChecklists(prev => prev.map(c =>
                          c.id === cl.id ? { ...c, items: [...c.items, { id: uuid(), text: newCheckItems[cl.id].trim(), completed: false }] } : c
                        ))
                        setNewCheckItems(prev => ({ ...prev, [cl.id]: '' }))
                      }
                    }}
                  >+</button>
                </div>
              </div>
            </div>
          )
        })}

        {/* Comments — collapsible */}
        <div className="section-header" onClick={() => { if (comments.length > 0) toggleSection('comments'); else setExpandedSections(prev => new Set(prev).add('comments')) }}>
          <span className="settings-label">Comments</span>
          <div className="section-header-right">
            {comments.length > 0 && <span className="section-badge">{comments.length}</span>}
            {comments.length > 0 ? (
              <ChevronRight size={14} className={`section-chevron${expandedSections.has('comments') ? ' expanded' : ''}`} />
            ) : (
              <button className="checklist-add-list-btn" onClick={(e) => { e.stopPropagation(); setExpandedSections(prev => new Set(prev).add('comments')) }}>
                <Plus size={12} /> Add
              </button>
            )}
          </div>
        </div>
        {expandedSections.has('comments') && (
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
                    setComments(prev => [...prev, { id: uuid(), text: newComment.trim(), created_at: new Date().toISOString() }])
                    setNewComment('')
                  }
                }}
              />
              <button
                className="comment-add-btn"
                disabled={!newComment.trim()}
                onClick={() => {
                  if (newComment.trim()) {
                    setComments(prev => [...prev, { id: uuid(), text: newComment.trim(), created_at: new Date().toISOString() }])
                    setNewComment('')
                  }
                }}
              >Add</button>
            </div>
          </div>
        )}

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Trello list</span>
            <select
              className="add-input"
              style={{ fontSize: 13, flex: 1 }}
              value={trelloPushListId}
              onChange={e => setTrelloPushListId(e.target.value)}
            >
              <option value="" disabled>Select list...</option>
              {trelloLists.map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
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

        {(onDelete || onBacklog || onProject) && (
          <div className="modal-danger-zone">
            {onProject && (
              task.status !== 'project' ? (
                <button className="danger-btn secondary" style={{ borderColor: '#A78BFA', color: '#A78BFA' }} onClick={() => { onProject(task.id, true); onClose() }}>
                  Move to Projects
                </button>
              ) : (
                <button className="danger-btn secondary" onClick={() => { onProject(task.id, false); onClose() }}>
                  Activate
                </button>
              )
            )}
            {onBacklog && task.status !== 'project' && (
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
