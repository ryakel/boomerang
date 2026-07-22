import { useState, useEffect, useMemo, useRef } from 'react'
import { Sparkles, Trash2, FolderKanban, Archive, Plus, X as XIcon, Search, Paperclip, FileText, Sun, ChevronDown, ChevronRight, RotateCw, BookOpen } from 'lucide-react'
import { loadLabels, loadSettings, ENERGY_TYPES, STATUS_META, uuid, localYMD } from '../store'
import { useTaskForm } from '../hooks/useTaskForm'
import { researchTask } from '../api'
import WeatherSection, { resolveWeatherVisibility } from './WeatherSection'
import ModalShell from './ModalShell'
import FormDisclosure from './FormDisclosure'
import AutosaveIndicator from './AutosaveIndicator'
import AttachmentViewer from './AttachmentViewer'
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

export default function EditTaskModal({
  task, onSave, onClose, onDelete, onBacklog, onProject, onStatusChange,
  onConvertToRoutine, weather,
  projects = [],
  childTasks = [],
  siblingSubs = [],
  onLogSession, onAddChild, onOpenTask,
  allTasks = [], onMerge,
  onSetEscalationRungs, onLogEscalationAttempt, onAdvanceEscalationRung,
  onDismissEscalationAdvancePrompt, onResolveEscalation, onBrainstormEscalation,
}) {
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
    // notion_url is often null (pull-synced / Quokka-linked tasks store only
    // the page id) — the canonical notion.so/<id-sans-dashes> redirect works
    // for any page the viewer can access, so derive it rather than render a
    // dead "Notion ↗" chip with href=undefined.
    notion: task.notion_page_id
      ? {
          id: task.notion_page_id,
          url: task.notion_url || `https://www.notion.so/${String(task.notion_page_id).replace(/-/g, '')}`,
        }
      : null,
  })

  // Merge-duplicate state (search → pick → confirm; the actual merge is
  // server-side via onMerge → POST /api/tasks/:id/merge).
  const [mergeQuery, setMergeQuery] = useState('')
  const [mergePick, setMergePick] = useState(null)
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeError, setMergeError] = useState(null)
  const mergeCandidates = useMemo(() => {
    const q = mergeQuery.trim().toLowerCase()
    if (q.length < 2) return []
    return allTasks
      .filter(t => t.id !== task.id && t.status !== 'done' && (t.title || '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [mergeQuery, allTasks, task.id])

  // Research state — inline because only EditTaskModal supports it; not worth
  // promoting into useTaskForm since AddTaskModal doesn't use it.
  const [showResearch, setShowResearch] = useState(false)
  const [viewingAttachment, setViewingAttachment] = useState(null)
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

  // Impact (1-3, null = not yet inferred). Manual picks persist with
  // impact_inferred=true — same flag semantics as size — so the background
  // inference never overwrites a hand-set value.
  const [impact, setImpact] = useState(task.impact ?? null)

  // Crisis staleness check-in: "Keep" re-stamps crisis_since (rides the
  // autosave payload), "Demote" swaps the crisis tag for high_priority.
  const [crisisKeepAt, setCrisisKeepAt] = useState(null)

  // Reality-check override: flips the DIY-or-hire verdict without re-running
  // the assessment ("I'm doing it myself anyway" / "Actually, hire it out").
  const [diyOverride, setDiyOverride] = useState(null)

  // Project + parent-child state.
  // - For projects: pinned_to_today + nag_allowed are project-level toggles.
  // - For child tasks: parent_id + child_visibility ('active' surfaces under
  //   pinned parent on main list; 'backstage' is only visible in the
  //   project drill-down).
  // All four feed into savePayload below so the existing autosave loop
  // persists them without extra plumbing.
  const isProject = task.status === 'project'
  const parentProject = task.parent_id ? projects.find(p => p.id === task.parent_id) : null
  const isSub = !!parentProject
  const [pinnedToToday, setPinnedToToday] = useState(!!task.pinned_to_today)
  const [nagAllowed, setNagAllowed] = useState(!!task.nag_allowed)
  const [parentId, setParentId] = useState(task.parent_id || '')
  const [childVisibility, setChildVisibility] = useState(task.child_visibility || 'backstage')
  // blocked_by — array of sibling sub IDs this sub waits on. Hidden from
  // main list when any blocker is incomplete. Cycle prevention happens
  // when computing availableBlockers below.
  const [blockedBy, setBlockedBy] = useState(() => Array.isArray(task.blocked_by) ? task.blocked_by : [])
  // Linked knowledge — Notion page IDs attached to this task. Search via
  // the cached index, no live Notion roundtrips. Resolved into title/type
  // metadata via `knowledgeIndex` below; missing IDs render as a faded
  // "(unknown)" so removal still works after items were deleted in Notion.
  const [knowledgeIds, setKnowledgeIds] = useState(() => Array.isArray(task.knowledge_page_ids) ? task.knowledge_page_ids : [])
  const [knowledgeIndex, setKnowledgeIndex] = useState([])
  const [knowledgePickerOpen, setKnowledgePickerOpen] = useState(false)
  const [knowledgeQuery, setKnowledgeQuery] = useState('')
  const [knowledgeConfigured, setKnowledgeConfigured] = useState(null)
  const [sessionFeedback, setSessionFeedback] = useState(null)
  const [loggingSession, setLoggingSession] = useState(false)
  const availableParents = projects.filter(p => p.id !== task.id)
  const handleLogSessionClick = async () => {
    if (!onLogSession || loggingSession) return
    setLoggingSession(true)
    try {
      const result = await onLogSession(task.id)
      setSessionFeedback({ ok: true, text: `+${result.points} pts logged · ${result.sessionCount}/${result.sessionCap} sessions` })
    } catch (err) {
      if (err.code === 'SESSION_CAP_REACHED') {
        setSessionFeedback({ ok: false, text: `Cap reached — complete a sub or the project to log more.` })
      } else {
        setSessionFeedback({ ok: false, text: 'Failed to log session.' })
      }
    } finally {
      setLoggingSession(false)
      setTimeout(() => setSessionFeedback(null), 4000)
    }
  }

  const addComment = () => {
    const text = newComment.trim()
    if (!text) return
    setComments(prev => [...prev, { id: uuid(), text, created_at: new Date().toISOString() }])
    setNewComment('')
  }
  const removeComment = (id) => setComments(prev => prev.filter(c => c.id !== id))

  // Escalation Ladder — see wiki/Escalation-Ladder.md. Rungs are edited
  // locally (title/mode/etc. share the existing autosave loop, but rungs
  // are structural — closer to Sequences than a text field) and pushed via
  // a dedicated endpoint on explicit Save, mirroring how session logging
  // hits its own endpoint rather than riding the generic task PATCH.
  const [escalationTask, setEscalationTask] = useState(task)
  useEffect(() => { setEscalationTask(task) }, [task.id])
  const [escalationEnabled, setEscalationEnabled] = useState((task.escalation_rungs || []).length > 0)
  const [rungs, setRungs] = useState(() => task.escalation_rungs || [])
  const [rungsDirty, setRungsDirty] = useState(false)
  const [escalationBusy, setEscalationBusy] = useState(false)
  const [escalationFeedback, setEscalationFeedback] = useState(null)
  const isEscalationActive = escalationTask.escalation_current_rung != null
  const currentRung = isEscalationActive ? (escalationTask.escalation_rungs || [])[escalationTask.escalation_current_rung] : null
  const attemptsAtCurrentRung = isEscalationActive
    ? (escalationTask.escalation_attempt_log || []).filter(e => e.rung_index === escalationTask.escalation_current_rung).length
    : 0
  const lastAttempt = (escalationTask.escalation_attempt_log || []).slice(-1)[0]

  const flashEscalationFeedback = (ok, text) => {
    setEscalationFeedback({ ok, text })
    setTimeout(() => setEscalationFeedback(null), 4000)
  }

  const addRung = () => {
    setRungs(prev => [...prev, { id: uuid(), label: '', suggestion: '', script: '', attempts_before_ready: 3, nudge_every_days: 2 }])
    setRungsDirty(true)
  }
  const updateRung = (id, updates) => {
    setRungs(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r))
    setRungsDirty(true)
  }
  const removeRung = (id) => {
    setRungs(prev => prev.filter(r => r.id !== id))
    setRungsDirty(true)
  }
  const saveRungs = async () => {
    if (!onSetEscalationRungs) return
    setEscalationBusy(true)
    try {
      const cleaned = rungs.map(r => ({ ...r, label: r.label.trim() || 'Untitled tactic' })).filter(r => r.label)
      const saved = await onSetEscalationRungs(task.id, cleaned)
      setEscalationTask(saved)
      setRungs(saved.escalation_rungs || [])
      setRungsDirty(false)
      flashEscalationFeedback(true, 'Ladder saved.')
    } catch {
      flashEscalationFeedback(false, 'Failed to save ladder.')
    } finally {
      setEscalationBusy(false)
    }
  }
  const toggleEscalationEnabled = (on) => {
    setEscalationEnabled(on)
    if (on && rungs.length === 0) addRung()
    if (!on) {
      setRungs([])
      setRungsDirty(true)
      onSetEscalationRungs?.(task.id, []).then(setEscalationTask).catch(() => {})
    }
  }
  const handleLogAttempt = async () => {
    if (!onLogEscalationAttempt || escalationBusy) return
    setEscalationBusy(true)
    try {
      const result = await onLogEscalationAttempt(task.id)
      setEscalationTask(result.task)
      flashEscalationFeedback(true, `+1 pt logged · attempt ${result.attemptsAtRung}`)
    } catch {
      flashEscalationFeedback(false, 'Failed to log attempt.')
    } finally {
      setEscalationBusy(false)
    }
  }
  const handleMoveOn = async () => {
    if (!onAdvanceEscalationRung || escalationBusy) return
    setEscalationBusy(true)
    try {
      const updated = await onAdvanceEscalationRung(task.id)
      setEscalationTask(updated)
    } catch {
      flashEscalationFeedback(false, 'Failed to advance.')
    } finally {
      setEscalationBusy(false)
    }
  }
  const handleOneMoreTry = async () => {
    if (!onDismissEscalationAdvancePrompt || escalationBusy) return
    setEscalationBusy(true)
    try {
      const updated = await onDismissEscalationAdvancePrompt(task.id)
      setEscalationTask(updated)
    } finally {
      setEscalationBusy(false)
    }
  }
  const handleGotResponse = async () => {
    if (!onResolveEscalation || escalationBusy) return
    setEscalationBusy(true)
    try {
      const updated = await onResolveEscalation(task.id)
      setEscalationTask(updated)
      flashEscalationFeedback(true, `Caught them! ${(updated.escalation_rungs || []).length} rung${(updated.escalation_rungs || []).length === 1 ? '' : 's'} and you got a response.`)
    } catch {
      flashEscalationFeedback(false, 'Failed to resolve.')
    } finally {
      setEscalationBusy(false)
    }
  }

  const [currentStatus, setCurrentStatus] = useState(task.status === 'open' ? 'not_started' : task.status)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [makeRecurring, setMakeRecurring] = useState(false)
  const [cadence, setCadence] = useState('weekly')
  const [customDays, setCustomDays] = useState(14)
  const [customUnit, setCustomUnit] = useState('days')

  // Backdated completion. When the user did the task earlier but forgot to
  // tick it off, they can edit "Completed on" here so the daily streak and
  // points credit the right calendar day. The ISO string is the source of
  // truth (preserves time-of-day across edits); the picker converts to/from
  // YYYY-MM-DD. Field is only rendered when currentStatus === 'done'.
  const [completedAtIso, setCompletedAtIso] = useState(task.completed_at || '')

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
  const today = localYMD()

  // v2 autosaves every field change with a 500ms debounce, mirroring v1
  // behavior the user expects. The Save button is kept as an explicit
  // flush-and-close affordance — useful when the modal is dismissed via
  // route change or in case the autosave debounce hasn't fired yet.
  //
  // Payload is JSON-serialized + ref-compared so reference churn on
  // array/object state (e.g. selectedTags) doesn't fire spurious saves.
  // `last_touched` is omitted here — useTasks.updateTask stamps it.
  const savePayload = useMemo(() => ({
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
    impact,
    impact_inferred: impact != null,
    ...(crisisKeepAt ? { crisis_since: crisisKeepAt } : {}),
    ...(diyOverride ? { diy_verdict: diyOverride.verdict, diy_reason: diyOverride.reason, diy_assessed: true } : {}),
    checklists,
    attachments: form.attachments,
    comments,
    notion_page_id: form.notionResult?.id || null,
    notion_url: form.notionResult?.url || null,
    weather_hidden: weatherHidden,
    gcal_duration: gcalDuration ? parseInt(gcalDuration, 10) : null,
    pinned_to_today: pinnedToToday,
    nag_allowed: nagAllowed,
    parent_id: parentId || null,
    child_visibility: parentId ? childVisibility : 'backstage',
    blocked_by: parentId ? blockedBy : [],
    knowledge_page_ids: knowledgeIds,
    // Only persist completed_at while the task is done. changeStatus()
    // already clears it on done→active transitions; including it here
    // when not-done would re-stamp a stale value on every save.
    ...(currentStatus === 'done' && completedAtIso ? { completed_at: completedAtIso } : {}),
  }), [
    form.title, form.notes, form.selectedTags, form.dueDate,
    form.size, form.energy, form.energyLevel,
    form.highPriority, form.lowPriority,
    form.attachments, form.notionResult,
    checklists, comments, weatherHidden, gcalDuration,
    pinnedToToday, nagAllowed, parentId, childVisibility, blockedBy,
    knowledgeIds, impact, crisisKeepAt, diyOverride,
    currentStatus, completedAtIso,
  ])

  const lastSavedJson = useRef(null)
  const savePayloadRef = useRef(savePayload)
  savePayloadRef.current = savePayload
  // Drives the "✓ Saved" flash in the AutosaveIndicator. Flips true
  // when an autosave fires, back to false after 2s.
  const [justSaved, setJustSaved] = useState(false)
  const justSavedTimer = useRef(null)

  useEffect(() => {
    const json = JSON.stringify(savePayload)
    // First render: capture the loaded-task baseline so we don't fire
    // a redundant save immediately on open.
    if (lastSavedJson.current === null) {
      lastSavedJson.current = json
      return
    }
    if (lastSavedJson.current === json) return
    if (!savePayload.title) return // empty-title guard
    const t = setTimeout(() => {
      lastSavedJson.current = json
      onSave(task.id, savePayload)
      setJustSaved(true)
      if (justSavedTimer.current) clearTimeout(justSavedTimer.current)
      justSavedTimer.current = setTimeout(() => setJustSaved(false), 2000)
    }, 500)
    return () => clearTimeout(t)
  }, [savePayload, onSave, task.id])

  // Clean up the saved-flash timer on unmount.
  useEffect(() => () => {
    if (justSavedTimer.current) clearTimeout(justSavedTimer.current)
  }, [])

  // Flush any pending edits on unmount. Without this, closing the modal
  // (X button, route change) within the 500ms debounce window would
  // strand the user's last few edits.
  useEffect(() => {
    return () => {
      const json = JSON.stringify(savePayloadRef.current)
      if (lastSavedJson.current === json) return
      if (!savePayloadRef.current.title) return
      onSave(task.id, savePayloadRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = () => {
    if (!form.title.trim()) return
    lastSavedJson.current = JSON.stringify(savePayload)
    onSave(task.id, savePayload)
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
    // Stamp a default completed_at when transitioning into done so the
    // "Completed on" picker shows today out of the gate. Keep the existing
    // value if the user is just re-confirming done. Clear it on done→active
    // so a future re-completion doesn't reuse the stale timestamp.
    if (newStatus === 'done') {
      if (!completedAtIso) setCompletedAtIso(new Date().toISOString())
    } else {
      setCompletedAtIso('')
    }
    onStatusChange(task.id, newStatus)
  }

  const handleConvertToRoutine = () => {
    if (!form.title.trim()) return
    onConvertToRoutine(task.id, {
      title: form.title.trim(),
      cadence,
      customDays: cadence === 'custom' ? Number(customDays) : undefined,
      customUnit: cadence === 'custom' ? customUnit : undefined,
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

  // Pull the knowledge index lazily — only when the user touches the
  // Linked-knowledge picker, so most edits don't pay the network cost.
  useEffect(() => {
    if (!knowledgePickerOpen || knowledgeIndex.length > 0) return
    let cancelled = false
    import('../api').then(async (m) => {
      const status = await m.knowledgeStatus().catch(() => ({ configured: false }))
      if (cancelled) return
      setKnowledgeConfigured(!!status?.configured)
      if (!status?.configured) return
      const { items } = await m.knowledgeList({ limit: 200 }).catch(() => ({ items: [] }))
      if (!cancelled) setKnowledgeIndex(items || [])
    })
    return () => { cancelled = true }
  }, [knowledgePickerOpen, knowledgeIndex.length])

  return (
    <ModalShell
      open={!!task}
      onClose={onClose}
      title={isProject ? 'Edit project' : isSub ? 'Edit sub' : 'Edit task'}
      width="narrow"
      headerSlot={<AutosaveIndicator saved={justSaved} />}
    >
      {/* "Sub of <project>" banner — surfaces parent project at the top of
        * the modal when this task is a child. Tap to open the parent's
        * edit modal (replaces this one). Without this banner, the parent
        * link is buried mid-modal in the "Project link" section and hard
        * to spot. */}
      {parentProject && onOpenTask && (
        <button
          type="button"
          className="v2-edit-parent-banner"
          onClick={() => onOpenTask(parentProject)}
        >
          <FolderKanban size={14} strokeWidth={1.75} />
          <span className="v2-edit-parent-banner-label">Sub of</span>
          <span className="v2-edit-parent-banner-title">{parentProject.title}</span>
          <ChevronRight size={14} strokeWidth={1.75} className="v2-edit-parent-banner-arrow" />
        </button>
      )}
      <input
        className="v2-form-input v2-form-title"
        placeholder={isProject ? 'What\'s the project?' : isSub ? 'What\'s the sub?' : 'What needs doing?'}
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

      {currentStatus === 'done' && (
        <div className="v2-form-section">
          <label className="v2-form-label">Completed on</label>
          <div className="v2-settings-row-hint" style={{ marginTop: -4, marginBottom: 4 }}>
            Backdate if you finished this earlier — fixes streak and points credit.
          </div>
          <DateField
            value={completedAtIso ? localYMD(new Date(completedAtIso)) : ''}
            onChange={(ymd) => {
              if (!ymd) { setCompletedAtIso(''); return }
              const [y, m, d] = ymd.split('-').map(Number)
              const original = completedAtIso ? new Date(completedAtIso) : new Date()
              const hh = original.getHours()
              const mm = original.getMinutes()
              const ss = original.getSeconds()
              const next = new Date(y, m - 1, d, hh, mm, ss, 0)
              setCompletedAtIso(next.toISOString())
            }}
            max={today}
            placeholder="pick a date"
            ariaLabelEmpty="Pick completion date"
            ariaLabelFilled={(v) => `Completed ${v} — tap to change`}
            clearLabel="Clear completion date"
            showClear={false}
          />
        </div>
      )}

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

      <div className="v2-form-row v2-form-row-due-priority">
        <div className="v2-form-field">
          <label className="v2-form-label">Due</label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <DateField value={form.dueDate} onChange={form.setDueDate} min={today} />
            {!form.dueDate && (
              <button
                className="v2-form-ai-pill v2-form-ai-pill-inline"
                onClick={form.handleInferDate}
                disabled={form.dateInferring || !form.title.trim()}
                title="Ask AI to extract a due date from the title and notes"
              >
                {form.dateInferring ? <span className="v2-spinner-tiny" /> : <Sparkles size={12} strokeWidth={1.75} />}
                {form.dateInferring ? 'Inferring…' : 'Infer'}
              </button>
            )}
          </div>
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

      {/* Undated ordinary tasks are quiet by default (2026-07-11) — stale/
        * nudge/pile-up notifications skip them unless opted in here, same
        * rule projects have always had. Hidden once a due date is set (the
        * escalation ladder toggle below covers "no due date, contact
        * persistence" tasks on its own). */}
      {!isProject && !form.dueDate && (
        <label className="v2-edit-toggle-row v2-edit-toggle-row-compact" style={{ marginBottom: 14 }}>
          <input
            type="checkbox"
            checked={nagAllowed}
            onChange={e => setNagAllowed(e.target.checked)}
          />
          <span className="v2-edit-toggle-label">
            Remind me about this without a due date
            <span className="v2-edit-toggle-meta">Off by default — stale/nudge reminders stay quiet for undated tasks unless you turn this on.</span>
          </span>
        </label>
      )}

      {/* Critical — toggles the configured critical label (default
        * "critical"; internal identifiers keep the original crisis_* names).
        * The tag is the mechanism: relentless per-task nags on every channel
        * at the critical cadence, auto triage checklist, pinned 🚨 section.
        * Quiet-hours waking stays a separate deliberate tap (decision D1). */}
      {!isProject && (() => {
        const settings = loadSettings()
        const crisisId = settings.crisis_label || 'critical'
        const bypassId = settings.quiet_hours_bypass_label || 'wake-me'
        const crisisOn = form.selectedTags.includes(crisisId)
        const hasWake = form.selectedTags.includes(bypassId)
        const staleDays = settings.crisis_stale_days ?? 7
        const ageDays = task.crisis_since ? Math.floor((Date.now() - new Date(task.crisis_since).getTime()) / 86400000) : 0
        const showStaleBanner = crisisOn && staleDays > 0 && ageDays >= staleDays && !crisisKeepAt
        return (
          <div className="v2-form-section" style={{ marginBottom: 14 }}>
            <label className="v2-edit-toggle-row v2-edit-toggle-row-compact">
              <input
                type="checkbox"
                checked={crisisOn}
                onChange={() => form.toggleTag(crisisId)}
              />
              <span className="v2-edit-toggle-label">
                🚨 Critical
                <span className="v2-edit-toggle-meta">Nags every {settings.notif_freq_crisis ?? 2}h on every channel, pins to the top of Today, auto-drafts a triage checklist. Applies the "{crisisId}" label.</span>
              </span>
            </label>
            {crisisOn && (
              <label className="v2-edit-toggle-row v2-edit-toggle-row-compact" style={{ marginLeft: 26, marginTop: 6 }}>
                <input
                  type="checkbox"
                  checked={hasWake}
                  onChange={() => form.toggleTag(bypassId)}
                />
                <span className="v2-edit-toggle-label">
                  Also wake me for this
                  <span className="v2-edit-toggle-meta">Adds the "{bypassId}" label so urgent pings break through quiet hours.</span>
                </span>
              </label>
            )}
            {showStaleBanner && (
              <div className="v2-edit-crisis-stale-banner">
                <span>Still critical? This has been marked critical for {ageDays} days.</span>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    type="button"
                    className="v2-form-ai-pill v2-form-ai-pill-inline"
                    onClick={() => setCrisisKeepAt(new Date().toISOString())}
                  >
                    Keep — still critical
                  </button>
                  <button
                    type="button"
                    className="v2-form-ai-pill v2-form-ai-pill-inline"
                    onClick={() => { form.toggleTag(crisisId); form.setHighPriority(true); form.setLowPriority(false) }}
                  >
                    Demote to high priority
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })()}

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

      {/* Reality check — the DIY-or-hire verdict on repair/construction
        * tasks (auto-assessed by useRealityCheck, hire-out by default). The
        * override button flips the verdict WITHOUT re-running — 'diy' also
        * returns the nag framing to normal. */}
      {!isProject && (task.diy_assessed || diyOverride) && (() => {
        const verdict = diyOverride?.verdict || task.diy_verdict
        const reason = diyOverride?.reason || task.diy_reason
        const isHire = verdict === 'hire'
        return (
          <div className="v2-form-section v2-edit-diy" style={{ marginBottom: 14 }}>
            <label className="v2-form-label">Reality check</label>
            <div className={`v2-edit-diy-banner${isHire ? ' v2-edit-diy-hire' : ''}`}>
              <div className="v2-edit-diy-verdict">{isHire ? '🛠 Hire it out' : '👍 DIY-able'}</div>
              {reason && <div className="v2-edit-diy-reason">{reason}</div>}
              {isHire && task.diy_first_move && !diyOverride && (
                <div className="v2-edit-diy-move">First move: {task.diy_first_move}</div>
              )}
              <button
                type="button"
                className="v2-form-ai-pill v2-form-ai-pill-inline"
                style={{ marginTop: 6 }}
                onClick={() => setDiyOverride(isHire
                  ? { verdict: 'diy', reason: 'Overridden — doing it myself, eyes open.' }
                  : { verdict: 'hire', reason: 'Overridden — hiring it out.' })}
              >
                {isHire ? "I'm doing it myself anyway" : 'Actually, hire it out'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* Impact — who/what this matters to (1-3). AI-inferred alongside size;
        * a manual pick here persists with impact_inferred so inference backs
        * off. Deselect (tap the active one) returns it to auto. */}
      <div className="v2-form-section">
        <label className="v2-form-label">Impact</label>
        <div className="v2-form-segmented">
          {[[1, '● Low'], [2, '●● Med'], [3, '●●● High']].map(([lvl, label]) => (
            <button
              key={lvl}
              className={`v2-form-seg${impact === lvl ? ' v2-form-seg-active' : ''}`}
              onClick={() => setImpact(impact === lvl ? null : lvl)}
            >
              {label}
            </button>
          ))}
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

      <FormDisclosure label="Attachments" summary={form.attachments.length > 0 ? String(form.attachments.length) : undefined} defaultOpen={form.attachments.length > 0}>
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
                <button
                  type="button"
                  className="v2-edit-attach-name v2-edit-attach-open"
                  onClick={() => setViewingAttachment(a)}
                  title={`Open ${a.name}`}
                >
                  {a.name}
                </button>
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
      </FormDisclosure>

      <FormDisclosure label="Connections" summary={form.notionResult ? 'Notion linked' : undefined} defaultOpen={!!form.notionResult || !!form.notionState}>
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
              <a
                href={form.notionResult.url || (form.notionResult.id ? `https://www.notion.so/${String(form.notionResult.id).replace(/-/g, '')}` : undefined)}
                target="_blank"
                rel="noopener noreferrer"
              >Notion ↗</a>
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
      </FormDisclosure>

      {onMerge && (
        <FormDisclosure label="Merge duplicate">
          <div className="v2-form-section v2-form-section-compact">
            <div className="v2-edit-notion-reason">
              Fold another task into this one — its notes, checklist, tags and links move
              here (earliest due date wins), and the other task is deleted.
            </div>
            <input
              type="text"
              className="v2-form-input"
              placeholder="Search tasks to merge in…"
              value={mergeQuery}
              onChange={e => { setMergeQuery(e.target.value); setMergePick(null); setMergeError(null) }}
            />
            {!mergePick && mergeCandidates.length > 0 && (
              <ul className="v2-edit-notion-list">
                {mergeCandidates.map(t => (
                  <li key={t.id}>
                    <button type="button" className="v2-edit-notion-page" onClick={() => setMergePick(t)}>
                      {t.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {mergePick && (
              <div className="v2-edit-merge-confirm">
                <div className="v2-edit-notion-reason">
                  Merge &ldquo;{mergePick.title}&rdquo; into this task? It will be deleted.
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="v2-settings-btn"
                    disabled={mergeBusy}
                    onClick={async () => {
                      setMergeBusy(true)
                      setMergeError(null)
                      try {
                        await onMerge(task.id, mergePick.id)
                        setMergePick(null)
                        setMergeQuery('')
                      } catch (e) {
                        setMergeError(e.message || 'Merge failed')
                      } finally {
                        setMergeBusy(false)
                      }
                    }}
                  >
                    {mergeBusy ? 'Merging…' : 'Merge'}
                  </button>
                  <button type="button" className="v2-settings-btn" disabled={mergeBusy} onClick={() => setMergePick(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {mergeError && <div className="v2-form-error">{mergeError}</div>}
          </div>
        </FormDisclosure>
      )}

      {labels.length > 0 && (
        <FormDisclosure
          label="Labels"
          summary={form.selectedTags.length > 0 ? `${form.selectedTags.length} selected` : undefined}
          defaultOpen={form.selectedTags.length > 0}
        >
        <div className="v2-form-section">
          <div className="v2-form-label-grid">
            {labels.map(lbl => {
              const active = form.selectedTags.includes(lbl.id)
              return (
                <button
                  key={lbl.id}
                  type="button"
                  className={`v2-form-label-pill${active ? ' v2-form-label-pill-active' : ''}`}
                  onClick={() => form.toggleTag(lbl.id)}
                  style={{ '--label-color': lbl.color }}
                  title={lbl.name}
                >
                  {lbl.name}
                </button>
              )
            })}
          </div>
        </div>
        </FormDisclosure>
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
              <>
                <input
                  className="v2-form-input v2-edit-routine-days"
                  type="number"
                  min="1"
                  value={customDays}
                  onChange={e => setCustomDays(e.target.value)}
                  placeholder="N"
                  aria-label={`Every N ${customUnit}`}
                />
                <select
                  className="v2-form-input v2-edit-routine-unit"
                  value={customUnit}
                  onChange={e => setCustomUnit(e.target.value)}
                  aria-label="Interval unit"
                >
                  <option value="days">days</option>
                  <option value="months">months</option>
                </select>
              </>
            )}
            <button className="v2-edit-routine-confirm" onClick={handleConvertToRoutine}>Convert</button>
            <button className="v2-edit-routine-cancel" onClick={() => setMakeRecurring(false)}>Cancel</button>
          </div>
        </div>
      )}

      <FormDisclosure label="Comments" summary={comments.length > 0 ? String(comments.length) : undefined} defaultOpen={comments.length > 0}>
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
      </FormDisclosure>

      {(isProject || availableParents.length > 0) && (
      <FormDisclosure
        label={isProject ? 'Project' : 'Project link'}
        summary={!isProject && parentId ? 'linked' : undefined}
        defaultOpen={isProject || !!parentId}
      >
      {/* Project-only controls: pinning, nag toggle, session log, add child.
        * For a non-project task, render the "Parent project" picker instead
        * so the user can link / unlink the task to a project. */}
      {isProject ? (
        <div className="v2-form-section v2-edit-project-controls">
          <div className="v2-edit-manage-label">Project</div>
          <div className="v2-edit-project-toggles">
            <label className="v2-edit-toggle-row">
              <input
                type="checkbox"
                checked={pinnedToToday}
                onChange={e => setPinnedToToday(e.target.checked)}
              />
              <span className="v2-edit-toggle-label">
                Pin to today
                <span className="v2-edit-toggle-meta">Surfaces this project on the main list</span>
              </span>
            </label>
            <label className="v2-edit-toggle-row">
              <input
                type="checkbox"
                checked={nagAllowed}
                onChange={e => setNagAllowed(e.target.checked)}
                disabled={!!form.dueDate}
              />
              <span className="v2-edit-toggle-label">
                Allow nags without a due date
                <span className="v2-edit-toggle-meta">
                  {form.dueDate
                    ? 'Due date set — escalation runs anyway, this toggle is ignored.'
                    : 'Off by default. Turn on if you want gentle reminders even with no deadline.'}
                </span>
              </span>
            </label>
          </div>
          <div className="v2-edit-project-sessions">
            <div className="v2-edit-project-sessions-meta">
              {(task.session_count || 0) > 0
                ? `🔥 ${task.session_count} session${task.session_count === 1 ? '' : 's'} logged${task.last_session_at ? ` · last ${new Date(task.last_session_at).toLocaleDateString()}` : ''}`
                : 'No sessions logged yet. Tap below when you chip away at this.'}
            </div>
            <div className="v2-edit-project-actions">
              <button
                type="button"
                className="v2-edit-action v2-edit-action-primary"
                disabled={loggingSession || (task.session_count || 0) >= 10}
                onClick={handleLogSessionClick}
                title={(task.session_count || 0) >= 10 ? 'Session cap reached' : 'Log a session — gives points + bumps the streak'}
              >
                {loggingSession ? 'Logging…' : ((task.session_count || 0) >= 10 ? 'Cap reached' : '+ Log session')}
              </button>
              {onAddChild && (
                <button
                  type="button"
                  className="v2-edit-action"
                  onClick={() => onAddChild(task)}
                  title="Add a sub-task under this project"
                >
                  + Add sub
                </button>
              )}
            </div>
            {sessionFeedback && (
              <div className={`v2-edit-session-feedback v2-edit-session-feedback-${sessionFeedback.ok ? 'ok' : 'warn'}`}>
                {sessionFeedback.text}
              </div>
            )}
          </div>
          {/* Subs list — surfaces the child tasks attached to this project
            * so the user can see and edit them without leaving the modal.
            * Sorted by due date ascending (no-due last). Empty state when
            * the project has no subs yet — nudges the user toward Add sub. */}
          {childTasks.length > 0 ? (
            <div className="v2-edit-subs">
              <div className="v2-edit-subs-label">
                Subs <span className="v2-edit-subs-count">({childTasks.length})</span>
              </div>
              <ul className="v2-edit-subs-list">
                {[...childTasks].sort((a, b) => {
                  const ad = a.due_date || '9999-12-31'
                  const bd = b.due_date || '9999-12-31'
                  return ad.localeCompare(bd)
                }).map(sub => (
                  <li key={sub.id} className="v2-edit-sub-row">
                    <button
                      type="button"
                      className="v2-edit-sub-main"
                      onClick={() => onOpenTask && onOpenTask(sub)}
                      title={sub.notes ? sub.notes.slice(0, 200) : sub.title}
                    >
                      <span className={`v2-edit-sub-dot v2-edit-sub-dot-${sub.status === 'done' ? 'done' : 'active'}`} aria-hidden="true" />
                      <span className={`v2-edit-sub-title${sub.status === 'done' ? ' v2-edit-sub-title-done' : ''}`}>
                        {sub.title}
                      </span>
                      {sub.due_date && <span className="v2-edit-sub-due">due {sub.due_date.slice(5)}</span>}
                      {sub.child_visibility !== 'active' && (
                        <span className="v2-edit-sub-backstage" title="Hidden from main list">backstage</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="v2-edit-subs-empty">
              No subs yet. Tap <strong>+ Add sub</strong> above to break the project into concrete steps.
            </div>
          )}
        </div>
      ) : availableParents.length > 0 ? (
        <div className="v2-form-section v2-edit-project-controls">
          <div className="v2-edit-manage-label">Project link</div>
          <select
            className="v2-edit-parent-select"
            value={parentId}
            onChange={e => setParentId(e.target.value)}
          >
            <option value="">— No parent project —</option>
            {availableParents.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
          {parentId && (
            <label className="v2-edit-toggle-row v2-edit-toggle-row-compact">
              <input
                type="checkbox"
                checked={childVisibility === 'active'}
                onChange={e => setChildVisibility(e.target.checked ? 'active' : 'backstage')}
              />
              <span className="v2-edit-toggle-label">
                Show in main list when the parent project is pinned
                <span className="v2-edit-toggle-meta">Off = visible only inside the Projects modal.</span>
              </span>
            </label>
          )}
          {/* Blocked-by chips. Renders sibling subs of the same parent
            * project as togglable chips. Each chip is a potential blocker.
            * Tap to add/remove. Subs that would create a cycle are filtered
            * out at compute time. Done subs render with a checkmark but
            * stay tappable (the user might be tracking history). */}
          {parentId && siblingSubs.length > 0 && (
            <div className="v2-edit-blockers">
              <div className="v2-edit-blockers-label">Waits on</div>
              {(() => {
                // Build a transitive-blockers map so we can detect cycles.
                // A candidate X is excluded if X (transitively) blocks on
                // the current task — adding X as a blocker would close the
                // loop. Trust the data: blocked_by arrays are authoritative.
                const blockerMap = new Map(
                  siblingSubs.map(s => [s.id, Array.isArray(s.blocked_by) ? s.blocked_by : []])
                )
                blockerMap.set(task.id, blockedBy) // include self in the graph
                const wouldCycle = (candidateId) => {
                  // BFS from candidateId following blocked_by edges.
                  // If we reach task.id, candidate is downstream of task → cycle.
                  const seen = new Set()
                  const stack = [candidateId]
                  while (stack.length) {
                    const cur = stack.pop()
                    if (cur === task.id) return true
                    if (seen.has(cur)) continue
                    seen.add(cur)
                    const ups = blockerMap.get(cur) || []
                    for (const u of ups) stack.push(u)
                  }
                  return false
                }
                const candidates = siblingSubs.filter(s => !wouldCycle(s.id))
                return (
                  <div className="v2-edit-blockers-list">
                    {candidates.map(s => {
                      const selected = blockedBy.includes(s.id)
                      const isDone = s.status === 'done'
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`v2-edit-blocker-chip${selected ? ' v2-edit-blocker-chip-on' : ''}${isDone ? ' v2-edit-blocker-chip-done' : ''}`}
                          onClick={() => {
                            setBlockedBy(prev => selected
                              ? prev.filter(id => id !== s.id)
                              : [...prev, s.id]
                            )
                          }}
                          title={isDone ? `${s.title} (done — no longer blocking)` : s.title}
                        >
                          {selected && <span className="v2-edit-blocker-check">{isDone ? '✓' : '⏸'}</span>}
                          {s.title}
                        </button>
                      )
                    })}
                  </div>
                )
              })()}
              <div className="v2-edit-blockers-hint">
                {blockedBy.length > 0
                  ? `Hidden from the main list until ${blockedBy.length === 1 ? 'this blocker is' : 'these blockers are'} done. Visible in the Projects drill-down with a "⏸ waits on" indicator.`
                  : 'Tap a sibling sub to mark it as a blocker. This sub will only appear in the main list when all blockers are done.'}
              </div>
            </div>
          )}
        </div>
      ) : null}
      </FormDisclosure>
      )}

      {!isProject && (
      <FormDisclosure
        label="Escalation"
        summary={isEscalationActive ? `rung ${escalationTask.escalation_current_rung + 1}/${(escalationTask.escalation_rungs || []).length}` : undefined}
        defaultOpen={escalationEnabled}
      >
      <div className="v2-form-section v2-edit-escalation">
        <label className="v2-edit-toggle-row">
          <input
            type="checkbox"
            checked={escalationEnabled}
            onChange={e => toggleEscalationEnabled(e.target.checked)}
          />
          <span className="v2-edit-toggle-label">
            Track contact attempts for this task
            <span className="v2-edit-toggle-meta">For "waiting on a reply and it's not coming" tasks — repeated attempts to reach someone, with a nudge to change tactic once one approach stalls out.</span>
          </span>
        </label>

        {escalationEnabled && (
          <>
            {escalationTask.escalation_stuck && (
              <div className="v2-edit-escalation-banner v2-edit-escalation-banner-stuck">
                <span>Out of scripted moves on this one.</span>
                {onBrainstormEscalation && (
                  <button type="button" className="v2-edit-action v2-edit-action-primary" onClick={() => onBrainstormEscalation(task)}>
                    Brainstorm next moves
                  </button>
                )}
              </div>
            )}
            {escalationTask.escalation_awaiting_advance && currentRung && (
              <div className="v2-edit-escalation-banner v2-edit-escalation-banner-advance">
                <span>{currentRung.label} has had {attemptsAtCurrentRung} tr{attemptsAtCurrentRung === 1 ? 'y' : 'ies'} with no response. Ready to switch?</span>
                <div className="v2-edit-escalation-banner-actions">
                  <button type="button" className="v2-edit-action v2-edit-action-primary" disabled={escalationBusy} onClick={handleMoveOn}>Move on</button>
                  <button type="button" className="v2-edit-action" disabled={escalationBusy} onClick={handleOneMoreTry}>One more try</button>
                </div>
              </div>
            )}

            {isEscalationActive && currentRung && (
              <div className="v2-edit-escalation-status">
                <div className="v2-edit-escalation-status-line">
                  Rung {escalationTask.escalation_current_rung + 1} of {(escalationTask.escalation_rungs || []).length} · {attemptsAtCurrentRung} attempt{attemptsAtCurrentRung === 1 ? '' : 's'} logged{lastAttempt ? ` · last ${new Date(lastAttempt.at).toLocaleDateString()}` : ''}
                </div>
                {currentRung.script && (
                  <div className="v2-edit-escalation-script">"{currentRung.script}"</div>
                )}
                <div className="v2-edit-escalation-actions">
                  <button type="button" className="v2-edit-action v2-edit-action-primary" disabled={escalationBusy} onClick={handleLogAttempt}>Log attempt</button>
                  <button type="button" className="v2-edit-action" disabled={escalationBusy} onClick={handleMoveOn}>Move on</button>
                  <button type="button" className="v2-edit-action" disabled={escalationBusy} onClick={handleGotResponse}>Got a response</button>
                </div>
              </div>
            )}

            <div className="v2-edit-escalation-rungs">
              <div className="v2-edit-manage-label">Rungs (tactics, in order)</div>
              {rungs.map((rung, idx) => (
                <div key={rung.id} className="v2-edit-escalation-rung">
                  <div className="v2-edit-escalation-rung-head">
                    <span className="v2-edit-escalation-rung-idx">{idx + 1}</span>
                    <input
                      className="v2-edit-escalation-rung-label"
                      placeholder="Tactic (e.g. Email, Call, Call main line)"
                      value={rung.label}
                      onChange={e => updateRung(rung.id, { label: e.target.value })}
                    />
                    <button type="button" className="v2-edit-escalation-rung-remove" onClick={() => removeRung(rung.id)} aria-label="Remove rung">
                      <XIcon size={14} strokeWidth={2} />
                    </button>
                  </div>
                  <textarea
                    className="v2-edit-escalation-rung-suggestion"
                    placeholder="What to do (shown in the nudge)"
                    value={rung.suggestion || ''}
                    onChange={e => updateRung(rung.id, { suggestion: e.target.value })}
                    rows={2}
                  />
                  <input
                    className="v2-edit-escalation-rung-script"
                    placeholder="Script (optional) — what to actually say"
                    value={rung.script || ''}
                    onChange={e => updateRung(rung.id, { script: e.target.value })}
                  />
                  <div className="v2-edit-escalation-rung-tempo">
                    <label>
                      Attempts before ready
                      <input
                        type="number" min={1} max={20}
                        value={rung.attempts_before_ready ?? ''}
                        onChange={e => updateRung(rung.id, { attempts_before_ready: e.target.value ? Number(e.target.value) : null })}
                      />
                    </label>
                    <label>
                      Nudge every (days)
                      <input
                        type="number" min={1} max={30}
                        value={rung.nudge_every_days ?? ''}
                        onChange={e => updateRung(rung.id, { nudge_every_days: e.target.value ? Number(e.target.value) : null })}
                      />
                    </label>
                  </div>
                </div>
              ))}
              <button type="button" className="v2-edit-action" onClick={addRung}>+ Add rung</button>
              {rungsDirty && (
                <button type="button" className="v2-edit-action v2-edit-action-primary" disabled={escalationBusy} onClick={saveRungs}>
                  {escalationBusy ? 'Saving…' : 'Save ladder'}
                </button>
              )}
            </div>
            {escalationFeedback && (
              <div className={`v2-edit-session-feedback v2-edit-session-feedback-${escalationFeedback.ok ? 'ok' : 'warn'}`}>
                {escalationFeedback.text}
              </div>
            )}
          </>
        )}
      </div>
      </FormDisclosure>
      )}

      <FormDisclosure label="Linked knowledge" summary={knowledgeIds.length > 0 ? String(knowledgeIds.length) : undefined} defaultOpen={knowledgeIds.length > 0}>
      {/* Linked knowledge — Notion-backed reference items attached to this
        * task. Renders as chips with an X to unlink. The + chip opens a
        * lightweight search picker against the cached knowledge index.
        * Lazy-loaded on first picker open. */}
      <div className="v2-form-section v2-edit-knowledge">
        <div className="v2-edit-manage-label">Linked knowledge</div>
        <div className="v2-edit-knowledge-chips">
          {knowledgeIds.map(pageId => {
            const item = knowledgeIndex.find(k => k.notion_page_id === pageId)
            const label = item?.title || '(unknown)'
            return (
              <button
                key={pageId}
                type="button"
                className="v2-edit-knowledge-chip"
                onClick={() => setKnowledgeIds(prev => prev.filter(id => id !== pageId))}
                title="Click to unlink"
              >
                <BookOpen size={12} strokeWidth={1.75} />
                <span>{label}</span>
                <XIcon size={12} strokeWidth={2} />
              </button>
            )
          })}
          <button
            type="button"
            className="v2-edit-knowledge-chip v2-edit-knowledge-chip-add"
            onClick={() => setKnowledgePickerOpen(o => !o)}
          >
            <Plus size={12} strokeWidth={2} />
            <span>{knowledgePickerOpen ? 'Cancel' : 'Add'}</span>
          </button>
        </div>
        {knowledgePickerOpen && (
          <div className="v2-edit-knowledge-picker">
            {knowledgeConfigured === false ? (
              <div className="v2-integrations-hint">
                Set up the knowledge base in Settings → Integrations → Notion first.
              </div>
            ) : (
              <>
                <input
                  type="text"
                  className="v2-form-input"
                  placeholder="Search knowledge…"
                  value={knowledgeQuery}
                  onChange={e => setKnowledgeQuery(e.target.value)}
                  autoFocus
                />
                <ul className="v2-edit-knowledge-results">
                  {knowledgeIndex
                    .filter(item => !knowledgeIds.includes(item.notion_page_id))
                    .filter(item => {
                      if (!knowledgeQuery.trim()) return true
                      const q = knowledgeQuery.toLowerCase()
                      return item.title.toLowerCase().includes(q)
                        || (item.tags || []).some(t => t.toLowerCase().includes(q))
                    })
                    .slice(0, 20)
                    .map(item => (
                      <li key={item.notion_page_id}>
                        <button
                          type="button"
                          className="v2-edit-knowledge-result"
                          onClick={() => {
                            setKnowledgeIds(prev => [...prev, item.notion_page_id])
                            setKnowledgeQuery('')
                            setKnowledgePickerOpen(false)
                          }}
                        >
                          <span className="v2-edit-knowledge-result-title">{item.title}</span>
                          {item.type && (
                            <span className="v2-edit-knowledge-result-type">{item.type}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  {knowledgeIndex.length === 0 && (
                    <li className="v2-integrations-hint">No knowledge items yet — ask Quokka to add one.</li>
                  )}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
      </FormDisclosure>

      <div className="v2-form-section v2-edit-manage">
        <div className="v2-edit-manage-label">Manage</div>
        <div className="v2-edit-actions-row">
          <button
            className="v2-edit-action"
            onClick={() => { onBacklog(task.id, true); onClose() }}
            title="Move to backlog"
          >
            <Archive size={14} strokeWidth={1.75} /> <span className="v2-edit-action-label">Backlog</span>
          </button>
          {/* Hide "Move to projects" button when this task IS a project —
            * it'd be a no-op. Same for sub-tasks: moving a sub to project
            * status would orphan it from its parent (status changes); keep
            * the affordance for sub-tasks since the user might want to
            * promote one to its own project. */}
          {!isProject && (
            <button
              className="v2-edit-action"
              onClick={() => { onProject(task.id, true); onClose() }}
              title="Move to projects"
            >
              <FolderKanban size={14} strokeWidth={1.75} /> <span className="v2-edit-action-label">Projects</span>
            </button>
          )}
          {!task.routine_id && !makeRecurring && (
            <button
              className="v2-edit-action"
              onClick={() => setMakeRecurring(true)}
              title="Convert this task into a recurring routine"
            >
              <RotateCw size={14} strokeWidth={1.75} /> <span className="v2-edit-action-label">Make recurring</span>
            </button>
          )}
          {!confirmDelete ? (
            <button
              className="v2-edit-action v2-edit-action-danger"
              onClick={() => setConfirmDelete(true)}
              title={isProject ? 'Delete project (subs become orphans)' : isSub ? 'Delete sub' : 'Delete task'}
            >
              <Trash2 size={14} strokeWidth={1.75} /> <span className="v2-edit-action-label">Delete</span>
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
        Close
      </button>

      {viewingAttachment && (
        <AttachmentViewer
          attachment={viewingAttachment}
          onClose={() => setViewingAttachment(null)}
        />
      )}
    </ModalShell>
  )
}
