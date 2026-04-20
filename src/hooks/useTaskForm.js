// Shared state and handlers for AddTaskModal and EditTaskModal.
// Extracts the duplicated logic: polish, size/energy inference, Notion linking,
// file attachments, and tag toggling.

import { useState, useRef } from 'react'
import { loadSettings, loadLabels, uuid } from '../store'
import { polishNotes, inferDate, inferSize, suggestNotionLink, generateNotionContent, notionCreatePage, extractAttachmentText } from '../api'
import { processAttachment } from '../utils/imageCompress'

function formatFileSize(bytes) {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

const MAX_TOTAL_SIZE = 5 * 1024 * 1024 // 5MB

export function useTaskForm(initial = {}) {
  const [title, setTitle] = useState(initial.title || '')
  const [notes, setNotes] = useState(initial.notes || '')
  const [selectedTags, setSelectedTags] = useState(initial.tags || [])
  const [dueDate, setDueDate] = useState(initial.dueDate || '')
  const [size, setSize] = useState(initial.size || null)
  // Tracks whether size is "settled" — true after user pick or AI inference.
  // Autosave includes this so the background auto-sizer hook won't override.
  const [sizeInferred, setSizeInferred] = useState(!!initial.sizeInferred || !!initial.size_inferred)
  // Special case: deselect (null) falls back to 'M' and unsets the flag so
  // the background auto-sizer can retry.
  const markSizeSet = (newSize) => {
    if (newSize == null) {
      setSize('M')
      setSizeInferred(false)
    } else {
      setSize(newSize)
      setSizeInferred(true)
    }
  }
  const [energy, setEnergy] = useState(initial.energy || null)
  const [energyLevel, setEnergyLevel] = useState(initial.energyLevel || null)
  const [highPriority, setHighPriority] = useState(initial.highPriority || false)
  const [lowPriority, setLowPriority] = useState(initial.lowPriority || false)

  // Polish state
  const [polishing, setPolishing] = useState(false)
  const [polishError, setPolishError] = useState(null)

  // Size/energy inference state
  const [sizing, setSizing] = useState(false)

  // Notion linking state
  const [notionState, setNotionState] = useState(null)
  const [notionCreating, setNotionCreating] = useState(false)
  const [notionResult, setNotionResult] = useState(initial.notion || null)

  // Attachments state
  const [attachments, setAttachments] = useState(initial.attachments || [])
  const [attachError, setAttachError] = useState(null)
  const [extracting, setExtracting] = useState(false)

  const fileInputRef = useRef(null)

  // --- Handlers ---

  const toggleTag = (id) => {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
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
        !size ? inferSize(newTitle, newNotes) : Promise.resolve({ size: null, energy: null, energyLevel: null }),
      ])
      if (inferredDate) setDueDate(inferredDate)
      if (inferred.size) markSizeSet(inferred.size)
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
      if (inferred.size) markSizeSet(inferred.size)
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
      const labels = loadLabels()
      const tagNames = selectedTags.map(id => labels.find(l => l.id === id)?.name || id)
      const metadata = { tags: tagNames, lastUpdated: new Date().toLocaleDateString() }
      const content = await generateNotionContent(title, notes, false, metadata)
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

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files)
    e.target.value = ''
    if (!files.length) return
    setAttachError(null)
    try {
      const processed = await Promise.all(files.map(processAttachment))
      const results = processed.map(p => ({ id: uuid(), ...p }))
      const currentTotal = attachments.reduce((sum, a) => sum + a.size, 0)
      const newTotal = currentTotal + results.reduce((sum, r) => sum + r.size, 0)
      if (newTotal > MAX_TOTAL_SIZE) {
        setAttachError(`Total attachments exceed 5 MB limit (${formatFileSize(newTotal)})`)
        return
      }
      setAttachments(prev => [...prev, ...results])
    } catch (err) {
      setAttachError(err.message || 'Failed to attach file')
    }
  }

  const removeAttachment = (id) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
    setAttachError(null)
  }

  const handleExtractText = async () => {
    if (!attachments.length || extracting) return
    setAttachError(null)
    setExtracting(true)
    try {
      const text = await extractAttachmentText(attachments)
      if (text) {
        setNotes(prev => prev.trim() ? `${prev.trim()}\n\n${text}` : text)
      }
    } catch (err) {
      setAttachError(err.message || 'Failed to extract text')
    } finally {
      setExtracting(false)
    }
  }

  // Collect all form values into an object (for onAdd/onSave)
  const getFormData = () => ({
    title: title.trim(),
    notes: notes.trim(),
    tags: selectedTags,
    dueDate: dueDate || null,
    size: size || null,
    size_inferred: sizeInferred,
    energy: energy || null,
    energyLevel: energyLevel || null,
    highPriority,
    lowPriority,
    notion: notionResult,
    attachments,
  })

  return {
    // Form state
    title, setTitle,
    notes, setNotes,
    selectedTags, setSelectedTags, toggleTag,
    dueDate, setDueDate,
    size, setSize: markSizeSet,
    sizeInferred, setSizeInferred,
    energy, setEnergy,
    energyLevel, setEnergyLevel,
    highPriority, setHighPriority,
    lowPriority, setLowPriority,

    // Polish
    polishing, polishError, handlePolish,

    // Size/energy inference
    sizing, handleInferSize,

    // Notion
    notionState, setNotionState, notionCreating, notionResult, setNotionResult,
    handleNotionSearch, handleNotionCreate, handleNotionLink,

    // Attachments
    attachments, setAttachments, attachError, fileInputRef,
    handleFileSelect, removeAttachment,
    extracting, handleExtractText,

    // Utility
    getFormData,
    formatFileSize,
  }
}
