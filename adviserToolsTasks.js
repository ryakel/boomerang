// adviserToolsTasks.js — Task + routine tools for the AI Adviser.
//
// Each mutation tool captures the pre-mutation state in its execute() closure and
// returns a compensation callback that restores it if a later plan step fails.

import crypto from 'crypto'
import {
  upsertTask, getTask, deleteTask, queryTasks, updateTaskPartial,
  upsertRoutine, getRoutine, getAllRoutines, deleteRoutine, updateRoutinePartial,
  getChildTasks, computeProjectBudget, computeSessionPoints, logProjectSession,
  PROJECT_CONSTANTS,
} from './db.js'
import { registerTool } from './adviserTools.js'

const TASK_FIELDS = [
  'title', 'notes', 'due_date', 'status', 'size', 'energy', 'energy_level',
  'tags', 'high_priority', 'low_priority', 'snoozed_until', 'checklist',
  'reframe_notes', 'weather_hidden', 'gcal_duration',
]

function summarizeTask(t) {
  if (!t) return null
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    due_date: t.due_date || null,
    size: t.size || null,
    energy: t.energy || null,
    energy_level: t.energy_level || null,
    tags: t.tags || [],
    high_priority: !!t.high_priority,
    snoozed_until: t.snoozed_until || null,
    snooze_indefinite: !!t.snooze_indefinite,
    notion_page_id: t.notion_page_id || null,
    trello_card_id: t.trello_card_id || null,
    gcal_event_id: t.gcal_event_id || null,
    created_at: t.created_at,
    completed_at: t.completed_at || null,
    parent_id: t.parent_id || null,
    pinned_to_today: !!t.pinned_to_today,
    nag_allowed: !!t.nag_allowed,
    session_count: t.session_count || 0,
    last_session_at: t.last_session_at || null,
    child_visibility: t.child_visibility || 'backstage',
  }
}

function summarizeRoutine(r) {
  if (!r) return null
  return {
    id: r.id,
    title: r.title,
    cadence: r.cadence,
    schedule_day_of_week: r.schedule_day_of_week ?? null,
    tags: r.tags || [],
    paused: !!r.paused,
    end_date: r.end_date || null,
    last_completed: r.completed_history?.[r.completed_history.length - 1] || null,
    // Sequences: expose the chain template so adviser can address steps
    // by id when calling add/edit/remove/reorder_follow_up tools.
    follow_ups: Array.isArray(r.follow_ups)
      ? r.follow_ups.map((s, i) => ({
          step_index: i,
          step_id: s.id,
          title: s.title,
          offset_minutes: s.offset_minutes,
          ...(s.energy_type ? { energy_type: s.energy_type } : {}),
          ...(s.energy_level ? { energy_level: s.energy_level } : {}),
          ...(s.notes ? { notes: s.notes } : {}),
        }))
      : [],
  }
}

function taskLabel(id) {
  const t = getTask(id)
  if (!t) return `(missing task ${id.slice(0, 8)})`
  const title = t.title?.trim() || '(untitled)'
  return title.length > 60 ? `${title.slice(0, 57)}…` : title
}

function routineLabel(id) {
  const r = getRoutine(id)
  if (!r) return `(missing routine ${id.slice(0, 8)})`
  const title = r.title?.trim() || '(untitled)'
  return title.length > 60 ? `${title.slice(0, 57)}…` : title
}

function pickTaskUpdates(input) {
  const out = {}
  for (const k of TASK_FIELDS) {
    if (input[k] !== undefined) out[k] = input[k]
  }
  return out
}

export function registerTaskTools() {
  // --- READ ---
  registerTool({
    name: 'search_tasks',
    description: 'Search tasks by keyword/status/tag/energy. Use this FIRST to find tasks before modifying them. Returns up to `limit` compact task summaries (default 20).',
    readOnly: true,
    schema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Keyword in title or notes' },
        status: { type: 'string', description: 'Comma-separated: not_started,doing,waiting,done,project,backlog' },
        tag: { type: 'string' },
        energy: { type: 'string', enum: ['desk', 'people', 'errand', 'confrontation', 'creative', 'physical'] },
        size: { type: 'string', enum: ['XS', 'S', 'M', 'L', 'XL'] },
        high_priority: { type: 'boolean' },
        limit: { type: 'integer', default: 20 },
        sort: { type: 'string', enum: ['due_date', 'created_at', 'size', 'title', 'completed_at'] },
      },
    },
    execute: async (args) => {
      const filters = { ...args, limit: args.limit || 20 }
      const results = queryTasks(filters)
      return { result: { count: results.length, tasks: results.map(summarizeTask) } }
    },
  })

  registerTool({
    name: 'get_task',
    description: 'Fetch a single task with full details (notes, checklist, all fields).',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    execute: async ({ id }) => {
      const task = getTask(id)
      if (!task) throw new Error(`Task not found: ${id}`)
      return { result: task }
    },
  })

  // --- CREATE ---
  registerTool({
    name: 'create_task',
    description: 'Create a new task. Defaults: size M, status not_started. Size/energy will be auto-refined by the background AI sizer. For multi-part tasks, populate `checklist` with sub-items so the user gets one umbrella task with a checklist rather than 8 separate tasks.',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        due_date: { type: 'string', description: 'ISO date (YYYY-MM-DD)' },
        tags: { type: 'array', items: { type: 'string' } },
        high_priority: { type: 'boolean' },
        low_priority: { type: 'boolean' },
        status: { type: 'string', enum: ['not_started', 'doing', 'waiting', 'project', 'backlog'] },
        size: { type: 'string', enum: ['XS', 'S', 'M', 'L', 'XL'] },
        energy: { type: 'string', enum: ['desk', 'people', 'errand', 'confrontation', 'creative', 'physical'] },
        energy_level: { type: 'integer', enum: [1, 2, 3] },
        checklist_items: {
          type: 'array',
          description: 'Pre-populated sub-items for a multi-part task. Each item: {text, checked?}. Rendered as a single "Checklist" section on the task card.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              checked: { type: 'boolean' },
            },
            required: ['text'],
          },
        },
        checklist_name: {
          type: 'string',
          description: 'Optional name for the checklist (default: "Checklist").',
        },
      },
      required: ['title'],
    },
    preview: (args) => {
      const parts = [`Create task: "${args.title}"`]
      if (args.due_date) parts.push(`due ${args.due_date}`)
      if (args.checklist_items?.length) parts.push(`${args.checklist_items.length} checklist item${args.checklist_items.length !== 1 ? 's' : ''}`)
      return parts.join(' · ')
    },
    execute: async (args) => {
      const id = `task-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
      const now = new Date().toISOString()
      const items = Array.isArray(args.checklist_items) ? args.checklist_items.map((item, i) => ({
        id: `ci-${Date.now()}-${i}-${crypto.randomBytes(2).toString('hex')}`,
        text: String(item.text || '').trim(),
        completed: !!item.checked,
      })).filter(item => item.text) : []
      const checklists = items.length > 0 ? [{
        id: `cl-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        name: args.checklist_name?.trim() || 'Checklist',
        items,
        hideCompleted: false,
      }] : []
      const task = {
        id,
        title: args.title,
        notes: args.notes || '',
        due_date: args.due_date || null,
        tags: args.tags || [],
        high_priority: !!args.high_priority,
        low_priority: !!args.low_priority,
        status: args.status || 'not_started',
        size: args.size || 'M',
        energy: args.energy || null,
        energy_level: args.energy_level || null,
        size_inferred: args.size ? true : false,
        checklist: [],
        checklists,
        created_at: now,
        updated_at: now,
        last_touched: now,
      }
      upsertTask(task)
      return {
        result: { id, task: summarizeTask(getTask(id)) },
        compensation: async () => { deleteTask(id) },
      }
    },
  })

  // --- UPDATE ---
  registerTool({
    name: 'update_task',
    description: 'Update any subset of task fields. Only provided fields change. For common transitions prefer complete_task/reopen_task/snooze_task/move_to_projects.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        notes: { type: 'string' },
        due_date: { type: ['string', 'null'] },
        status: { type: 'string', enum: ['not_started', 'doing', 'waiting', 'done', 'project', 'backlog'] },
        size: { type: 'string', enum: ['XS', 'S', 'M', 'L', 'XL'] },
        energy: { type: 'string' },
        energy_level: { type: 'integer', enum: [1, 2, 3] },
        tags: { type: 'array', items: { type: 'string' } },
        high_priority: { type: 'boolean' },
        low_priority: { type: 'boolean' },
        snoozed_until: { type: ['string', 'null'] },
        checklist: { type: 'array' },
        gcal_duration: { type: ['integer', 'null'] },
        weather_hidden: { type: 'boolean' },
      },
      required: ['id'],
    },
    preview: (args) => {
      const changes = Object.keys(args).filter(k => k !== 'id')
      return `Update "${taskLabel(args.id)}": ${changes.join(', ') || '(no changes)'}`
    },
    execute: async (args) => {
      const before = getTask(args.id)
      if (!before) throw new Error(`Task not found: ${args.id}`)
      const updates = pickTaskUpdates(args)
      const now = new Date().toISOString()
      updates.updated_at = now
      updates.last_touched = now
      updateTaskPartial(args.id, updates)
      return {
        result: { id: args.id, task: summarizeTask(getTask(args.id)) },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  // --- DELETE ---
  registerTool({
    name: 'delete_task',
    description: 'Permanently delete a task. Use sparingly — prefer move_to_backlog for "maybe someday" items.',
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    preview: (args) => `Delete task "${taskLabel(args.id)}"`,
    execute: async ({ id }) => {
      const before = getTask(id)
      if (!before) throw new Error(`Task not found: ${id}`)
      deleteTask(id)
      return {
        result: { id, deleted: true },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  // --- STATUS SHORTCUTS ---
  const statusShortcut = (name, description, status, extra = () => ({})) => {
    registerTool({
      name,
      description,
      schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
      preview: (args) => `${description.split('.')[0]}: "${taskLabel(args.id)}"`,
      execute: async ({ id }) => {
        const before = getTask(id)
        if (!before) throw new Error(`Task not found: ${id}`)
        const now = new Date().toISOString()
        const updates = { status, updated_at: now, last_touched: now, ...extra(before) }
        updateTaskPartial(id, updates)
        return {
          result: { id, task: summarizeTask(getTask(id)) },
          compensation: async () => { upsertTask(before) },
        }
      },
    })
  }

  statusShortcut('complete_task', 'Mark a task done. Sets status=done and completed_at=now.', 'done',
    () => ({ completed_at: new Date().toISOString() }))
  statusShortcut('reopen_task', 'Reopen a completed task. Sets status=not_started and clears completed_at.', 'not_started',
    () => ({ completed_at: null }))
  statusShortcut('move_to_projects', 'Move to Projects (long-term, no notifications by default — see project_set_nag_policy to opt in).', 'project')
  statusShortcut('move_to_backlog', 'Move to Backlog (someday/maybe, hidden from main view).', 'backlog')
  statusShortcut('activate_task', 'Move a project/backlog task back to the active list.', 'not_started')

  // --- PROJECT TOOLS ---
  // Pinning, session logging, child management, nag policy. These all
  // operate on tasks where status='project'. They share the same capture-
  // and-restore compensation pattern as the rest of the task tools.

  registerTool({
    name: 'list_project_children',
    description: 'List child tasks (status + size + energy) of a project. Use to figure out what the project is actually composed of before adding/editing.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
    execute: async ({ project_id }) => {
      const project = getTask(project_id)
      if (!project) throw new Error(`Project not found: ${project_id}`)
      const children = getChildTasks(project_id)
      const budget = computeProjectBudget(project)
      const sessionPoints = computeSessionPoints(project)
      return {
        result: {
          project: summarizeTask(project),
          children: children.map(summarizeTask),
          budget,
          session_points: sessionPoints,
          session_count: project.session_count || 0,
          session_cap: PROJECT_CONSTANTS.SESSION_CAP,
          pinned_to_today: !!project.pinned_to_today,
          nag_allowed: !!project.nag_allowed,
        },
      }
    },
  })

  registerTool({
    name: 'pin_project_to_today',
    description: 'Pin or unpin a project to the main task list. Pinning surfaces it as a "Pinned projects" section above the regular task list. Visibility only — no nags are introduced.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        pinned: { type: 'boolean', description: 'true to pin, false to unpin' },
      },
      required: ['id', 'pinned'],
    },
    preview: (args) => `${args.pinned ? 'Pin' : 'Unpin'} project "${taskLabel(args.id)}"`,
    execute: async ({ id, pinned }) => {
      const before = getTask(id)
      if (!before) throw new Error(`Project not found: ${id}`)
      if (before.status !== 'project') throw new Error('pin_project_to_today requires a project (status=project)')
      updateTaskPartial(id, { pinned_to_today: !!pinned, last_touched: new Date().toISOString() })
      return {
        result: { id, pinned: !!pinned },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  registerTool({
    name: 'log_project_session',
    description: 'Log a "worked on this" session for a project — awards a fraction of the project effort budget as points, bumps the streak, and writes an activity-log entry. Capped at 10 sessions per project before requiring a child completion.',
    schema: {
      type: 'object',
      properties: { project_id: { type: 'string' } },
      required: ['project_id'],
    },
    preview: (args) => `Log a session on "${taskLabel(args.project_id)}"`,
    execute: async ({ project_id }) => {
      const before = getTask(project_id)
      if (!before) throw new Error(`Project not found: ${project_id}`)
      if (before.status !== 'project') throw new Error('log_project_session requires a project (status=project)')
      const result = logProjectSession(project_id)
      if (result.capped) {
        return {
          result: { capped: true, session_count: result.sessionCount, session_cap: result.sessionCap },
        }
      }
      return {
        result: {
          points: result.points,
          session_count: result.sessionCount,
          session_cap: result.sessionCap,
          timestamp: result.timestamp,
        },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  registerTool({
    name: 'project_set_nag_policy',
    description: 'Toggle whether a project can produce notifications when it has no due date. Off = silent (default). On = calm stale/nudge reminders fire. When a due date IS set on the project, escalation runs regardless of this flag.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        nag_allowed: { type: 'boolean' },
      },
      required: ['id', 'nag_allowed'],
    },
    preview: (args) => `${args.nag_allowed ? 'Enable' : 'Disable'} nags on project "${taskLabel(args.id)}"`,
    execute: async ({ id, nag_allowed }) => {
      const before = getTask(id)
      if (!before) throw new Error(`Project not found: ${id}`)
      if (before.status !== 'project') throw new Error('project_set_nag_policy requires a project (status=project)')
      updateTaskPartial(id, { nag_allowed: !!nag_allowed, last_touched: new Date().toISOString() })
      return {
        result: { id, nag_allowed: !!nag_allowed },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  registerTool({
    name: 'link_task_to_project',
    description: 'Set a task\'s parent_id to a project (so completing the task counts toward the project). Pass parent_id=null to unlink. Optionally set child_visibility: "active" surfaces the child in the main list under the pinned project; "backstage" hides it until you drill into the project.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        parent_id: { type: ['string', 'null'] },
        child_visibility: { type: 'string', enum: ['active', 'backstage'] },
      },
      required: ['id'],
    },
    preview: (args) => args.parent_id
      ? `Link "${taskLabel(args.id)}" under project "${taskLabel(args.parent_id)}"${args.child_visibility ? ` (${args.child_visibility})` : ''}`
      : `Unlink "${taskLabel(args.id)}" from its project`,
    execute: async ({ id, parent_id, child_visibility }) => {
      const before = getTask(id)
      if (!before) throw new Error(`Task not found: ${id}`)
      if (parent_id) {
        const parent = getTask(parent_id)
        if (!parent) throw new Error(`Parent project not found: ${parent_id}`)
        if (parent.status !== 'project') throw new Error('Parent must be a project (status=project)')
        if (parent_id === id) throw new Error('A task cannot be its own parent')
      }
      const updates = {
        parent_id: parent_id || null,
        last_touched: new Date().toISOString(),
      }
      if (child_visibility) updates.child_visibility = child_visibility
      updateTaskPartial(id, updates)
      return {
        result: { id, parent_id: parent_id || null, child_visibility: child_visibility || before.child_visibility },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  registerTool({
    name: 'snooze_task',
    description: 'Snooze a task until a given ISO timestamp (hides from active list + suppresses notifications until then).',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        until: { type: 'string', description: 'ISO datetime (YYYY-MM-DDTHH:MM:SS.sssZ)' },
      },
      required: ['id', 'until'],
    },
    preview: (args) => `Snooze "${taskLabel(args.id)}" until ${args.until}`,
    execute: async ({ id, until }) => {
      const before = getTask(id)
      if (!before) throw new Error(`Task not found: ${id}`)
      const now = new Date().toISOString()
      updateTaskPartial(id, {
        snoozed_until: until,
        snooze_count: (before.snooze_count || 0) + 1,
        updated_at: now,
        last_touched: now,
      })
      return {
        result: { id, snoozed_until: until },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  // --- ROUTINES (READ) ---
  registerTool({
    name: 'list_routines',
    description: 'List all recurring routines with their cadence, weekday anchor, and last completion.',
    readOnly: true,
    schema: { type: 'object', properties: {} },
    execute: async () => {
      const rs = getAllRoutines()
      return { result: { count: rs.length, routines: rs.map(summarizeRoutine) } }
    },
  })

  registerTool({
    name: 'get_routine',
    description: 'Fetch full details for a single routine.',
    readOnly: true,
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    execute: async ({ id }) => {
      const r = getRoutine(id)
      if (!r) throw new Error(`Routine not found: ${id}`)
      return { result: r }
    },
  })

  // --- ROUTINES (MUTATION) ---
  registerTool({
    name: 'create_routine',
    description: 'Create a recurring routine. Cadence: daily|weekly|monthly|quarterly|annually|custom. schedule_day_of_week 0=Sun..6=Sat (ignored for daily).',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        cadence: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'custom'] },
        custom_interval_days: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
        high_priority: { type: 'boolean' },
        end_date: { type: 'string' },
        schedule_day_of_week: { type: 'integer', minimum: 0, maximum: 6 },
      },
      required: ['title', 'cadence'],
    },
    preview: (args) => `Create routine: "${args.title}" (${args.cadence})`,
    execute: async (args) => {
      const id = `rt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
      const now = new Date().toISOString()
      const routine = {
        id,
        title: args.title,
        notes: args.notes || '',
        cadence: args.cadence,
        custom_interval_days: args.custom_interval_days || null,
        tags: args.tags || [],
        high_priority: !!args.high_priority,
        end_date: args.end_date || null,
        schedule_day_of_week: args.schedule_day_of_week ?? null,
        paused: false,
        completed_history: [],
        created_at: now,
        updated_at: now,
      }
      upsertRoutine(routine)
      return {
        result: { id, routine: summarizeRoutine(getRoutine(id)) },
        compensation: async () => { deleteRoutine(id) },
      }
    },
  })

  registerTool({
    name: 'update_routine',
    description: 'Update any subset of routine fields.',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        notes: { type: 'string' },
        cadence: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'custom'] },
        custom_interval_days: { type: 'integer' },
        tags: { type: 'array', items: { type: 'string' } },
        paused: { type: 'boolean' },
        end_date: { type: ['string', 'null'] },
        schedule_day_of_week: { type: ['integer', 'null'], minimum: 0, maximum: 6 },
      },
      required: ['id'],
    },
    preview: (args) => `Update routine "${routineLabel(args.id)}"`,
    execute: async (args) => {
      const before = getRoutine(args.id)
      if (!before) throw new Error(`Routine not found: ${args.id}`)
      const updates = { ...args, updated_at: new Date().toISOString() }
      delete updates.id
      updateRoutinePartial(args.id, updates)
      return {
        result: { id: args.id, routine: summarizeRoutine(getRoutine(args.id)) },
        compensation: async () => { upsertRoutine(before) },
      }
    },
  })

  registerTool({
    name: 'delete_routine',
    description: 'Permanently delete a routine. Existing tasks spawned from it are NOT deleted.',
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    preview: (args) => `Delete routine "${routineLabel(args.id)}"`,
    execute: async ({ id }) => {
      const before = getRoutine(id)
      if (!before) throw new Error(`Routine not found: ${id}`)
      deleteRoutine(id)
      return {
        result: { id, deleted: true },
        compensation: async () => { upsertRoutine(before) },
      }
    },
  })

  registerTool({
    name: 'research_task',
    description: 'Enrich an existing task with AI-researched notes. Use when the user asks to research something about a task (e.g. "look into the best approach for <task>", "what do I need to know about <X>"). The researched notes are APPENDED to the task\'s existing notes under a dated "--- Research (YYYY-MM-DD) ---" divider; existing notes are preserved. The research call runs its own Claude session with web search enabled, so it can cite current sources.',
    schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        focus: { type: 'string', description: 'Optional: what specifically to research. Example: "current FAA written-exam study plan recommendations". If omitted, researches the task generally based on title + existing notes.' },
      },
      required: ['task_id'],
    },
    preview: (args) => {
      const t = taskLabel(args.task_id)
      return args.focus ? `Research "${t}": ${args.focus}` : `Research "${t}"`
    },
    execute: async (args, deps) => {
      if (!deps.anthropicKey) throw new Error('No Anthropic API key configured — research unavailable')
      const before = getTask(args.task_id)
      if (!before) throw new Error(`Task not found: ${args.task_id}`)

      const prompt = `Research this task and write concise, actionable notes for someone with ADHD.

Task: ${before.title}
${before.notes ? `Existing notes:\n${before.notes}\n` : ''}${args.focus ? `Research focus: ${args.focus}\n` : ''}
Produce:
- Key facts or concrete next-steps
- 2-4 links to authoritative sources if you search the web
- Options or trade-offs worth knowing, if applicable

Keep it under 400 words. Plain prose + short bulleted lists are fine. No preamble, no "I researched X" — just the notes.`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': deps.anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error?.message || `Research call ${response.status}`)

      const researchText = (data.content || [])
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('\n\n')
        .trim()
      if (!researchText) throw new Error('Research returned no content')

      const today = new Date().toISOString().split('T')[0]
      const divider = `\n\n--- Research (${today}) ---\n`
      const newNotes = (before.notes || '').trim()
        ? `${before.notes}${divider}${researchText}`
        : researchText

      const now = new Date().toISOString()
      updateTaskPartial(args.task_id, { notes: newNotes, updated_at: now, last_touched: now })

      return {
        result: { task_id: args.task_id, added_chars: researchText.length },
        compensation: async () => {
          updateTaskPartial(args.task_id, {
            notes: before.notes, updated_at: before.updated_at, last_touched: before.last_touched,
          })
        },
      }
    },
  })

  registerTool({
    name: 'spawn_routine_now',
    description: 'Create a one-off task from a routine immediately, due today. Does NOT advance the cadence clock — the normal schedule continues.',
    schema: {
      type: 'object',
      properties: { routine_id: { type: 'string' } },
      required: ['routine_id'],
    },
    preview: (args) => `Spawn task from routine "${routineLabel(args.routine_id)}"`,
    execute: async ({ routine_id }) => {
      const routine = getRoutine(routine_id)
      if (!routine) throw new Error(`Routine not found: ${routine_id}`)
      const id = `task-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
      const now = new Date().toISOString()
      const today = now.split('T')[0]
      const task = {
        id,
        title: routine.title,
        notes: routine.notes || '',
        due_date: today,
        tags: routine.tags || [],
        high_priority: !!routine.high_priority,
        status: 'not_started',
        size: 'M',
        size_inferred: false,
        routine_id,
        created_at: now,
        updated_at: now,
        last_touched: now,
      }
      upsertTask(task)
      return {
        result: { id, task: summarizeTask(getTask(id)) },
        compensation: async () => { deleteTask(id) },
      }
    },
  })

  // === Sequences PR 5: chain-editing tools =============================
  // Atomic operations on a routine's `follow_ups` array (the chain
  // template). All four tools capture the entire pre-state of the
  // routine in their compensation closure so a rollback restores the
  // chain regardless of what changed.
  //
  // The routine `follow_ups` field is the TEMPLATE — already-spawned
  // task instances carry their own snapshot via PR 1's spawn copy,
  // so editing the template never retroactively mutates in-flight
  // tasks. Adviser-driven changes only affect the NEXT spawn cycle.

  const ENERGY_TYPE_ENUM = ['desk', 'people', 'errand', 'confrontation', 'creative', 'physical']

  const summarizeChain = (routine) => {
    const chain = Array.isArray(routine?.follow_ups) ? routine.follow_ups : []
    return chain.map((s, i) => ({
      step_index: i,
      step_id: s.id,
      title: s.title,
      offset_minutes: s.offset_minutes,
      ...(s.energy_type ? { energy_type: s.energy_type } : {}),
      ...(s.energy_level ? { energy_level: s.energy_level } : {}),
      ...(s.notes ? { notes: s.notes } : {}),
    }))
  }

  registerTool({
    name: 'add_follow_up',
    description: `Append (or insert) a follow-up step to a routine's chain template. Steps fire in order after each previous step is COMPLETED — \`offset_minutes\` is the delay from that completion. Sub-day offsets snooze the spawned task until trigger time so it doesn't surface in the list until the cycle is up.`,
    schema: {
      type: 'object',
      properties: {
        routine_id: { type: 'string' },
        title: { type: 'string', minLength: 1 },
        offset_minutes: { type: 'integer', minimum: 0 },
        energy_type: { type: 'string', enum: ENERGY_TYPE_ENUM },
        energy_level: { type: 'integer', minimum: 1, maximum: 3 },
        notes: { type: 'string' },
        step_index: { type: 'integer', minimum: 0, description: '0-based insertion position. Default: append to end.' },
      },
      required: ['routine_id', 'title', 'offset_minutes'],
    },
    preview: (args) => `Add chain step "${args.title}" to routine "${routineLabel(args.routine_id)}"`,
    execute: async (args) => {
      const before = getRoutine(args.routine_id)
      if (!before) throw new Error(`Routine not found: ${args.routine_id}`)
      const stepId = crypto.randomUUID()
      const newStep = {
        id: stepId,
        title: args.title.trim(),
        offset_minutes: Math.max(0, args.offset_minutes),
        ...(args.energy_type ? { energy_type: args.energy_type } : {}),
        ...(args.energy_level ? { energy_level: args.energy_level } : {}),
        ...(args.notes ? { notes: args.notes.trim() } : {}),
      }
      const oldChain = Array.isArray(before.follow_ups) ? before.follow_ups : []
      const newChain = oldChain.slice()
      const idx = Number.isInteger(args.step_index) && args.step_index >= 0 && args.step_index <= newChain.length
        ? args.step_index
        : newChain.length
      newChain.splice(idx, 0, newStep)
      updateRoutinePartial(args.routine_id, { follow_ups: newChain })
      return {
        result: { routine_id: args.routine_id, step_id: stepId, chain: summarizeChain(getRoutine(args.routine_id)) },
        compensation: async () => { upsertRoutine(before) },
      }
    },
  })

  registerTool({
    name: 'edit_follow_up',
    description: 'Update one or more fields of a single chain step. Identify the step by `step_id` (preferred) or `step_index` (0-based). Only fields you pass are changed.',
    schema: {
      type: 'object',
      properties: {
        routine_id: { type: 'string' },
        step_id: { type: 'string' },
        step_index: { type: 'integer', minimum: 0 },
        title: { type: 'string', minLength: 1 },
        offset_minutes: { type: 'integer', minimum: 0 },
        energy_type: { type: ['string', 'null'], enum: [...ENERGY_TYPE_ENUM, null] },
        energy_level: { type: ['integer', 'null'], minimum: 1, maximum: 3 },
        notes: { type: ['string', 'null'] },
      },
      required: ['routine_id'],
    },
    preview: (args) => `Edit chain step in routine "${routineLabel(args.routine_id)}"`,
    execute: async (args) => {
      const before = getRoutine(args.routine_id)
      if (!before) throw new Error(`Routine not found: ${args.routine_id}`)
      const oldChain = Array.isArray(before.follow_ups) ? before.follow_ups : []
      let idx = -1
      if (args.step_id) {
        idx = oldChain.findIndex(s => s.id === args.step_id)
      } else if (Number.isInteger(args.step_index)) {
        idx = args.step_index
      }
      if (idx < 0 || idx >= oldChain.length) {
        throw new Error(`Step not found in chain (step_id=${args.step_id ?? '∅'}, step_index=${args.step_index ?? '∅'})`)
      }
      const newChain = oldChain.slice()
      const target = { ...newChain[idx] }
      if (typeof args.title === 'string' && args.title.trim()) target.title = args.title.trim()
      if (Number.isInteger(args.offset_minutes)) target.offset_minutes = Math.max(0, args.offset_minutes)
      if (Object.prototype.hasOwnProperty.call(args, 'energy_type')) {
        if (args.energy_type) target.energy_type = args.energy_type
        else delete target.energy_type
      }
      if (Object.prototype.hasOwnProperty.call(args, 'energy_level')) {
        if (args.energy_level) target.energy_level = args.energy_level
        else delete target.energy_level
      }
      if (Object.prototype.hasOwnProperty.call(args, 'notes')) {
        if (args.notes && args.notes.trim()) target.notes = args.notes.trim()
        else delete target.notes
      }
      newChain[idx] = target
      updateRoutinePartial(args.routine_id, { follow_ups: newChain })
      return {
        result: { routine_id: args.routine_id, step_id: target.id, chain: summarizeChain(getRoutine(args.routine_id)) },
        compensation: async () => { upsertRoutine(before) },
      }
    },
  })

  registerTool({
    name: 'remove_follow_up',
    description: 'Remove a step from a routine\'s chain. Identify the step by `step_id` or `step_index`. Already-spawned tasks are NOT affected — only the template changes.',
    schema: {
      type: 'object',
      properties: {
        routine_id: { type: 'string' },
        step_id: { type: 'string' },
        step_index: { type: 'integer', minimum: 0 },
      },
      required: ['routine_id'],
    },
    preview: (args) => `Remove chain step from routine "${routineLabel(args.routine_id)}"`,
    execute: async (args) => {
      const before = getRoutine(args.routine_id)
      if (!before) throw new Error(`Routine not found: ${args.routine_id}`)
      const oldChain = Array.isArray(before.follow_ups) ? before.follow_ups : []
      let idx = -1
      if (args.step_id) {
        idx = oldChain.findIndex(s => s.id === args.step_id)
      } else if (Number.isInteger(args.step_index)) {
        idx = args.step_index
      }
      if (idx < 0 || idx >= oldChain.length) {
        throw new Error(`Step not found in chain (step_id=${args.step_id ?? '∅'}, step_index=${args.step_index ?? '∅'})`)
      }
      const removed = oldChain[idx]
      const newChain = oldChain.slice(0, idx).concat(oldChain.slice(idx + 1))
      updateRoutinePartial(args.routine_id, { follow_ups: newChain })
      return {
        result: { routine_id: args.routine_id, removed_step: removed, chain: summarizeChain(getRoutine(args.routine_id)) },
        compensation: async () => { upsertRoutine(before) },
      }
    },
  })

  registerTool({
    name: 'reorder_follow_ups',
    description: 'Reorder a routine\'s chain. Provide either `step_ids` (preferred — array of step ids in the new order) OR a single (`from_index`, `to_index`) pair to move one step. The lengths and ids must match the existing chain exactly when using `step_ids`.',
    schema: {
      type: 'object',
      properties: {
        routine_id: { type: 'string' },
        step_ids: { type: 'array', items: { type: 'string' } },
        from_index: { type: 'integer', minimum: 0 },
        to_index: { type: 'integer', minimum: 0 },
      },
      required: ['routine_id'],
    },
    preview: (args) => `Reorder chain steps in routine "${routineLabel(args.routine_id)}"`,
    execute: async (args) => {
      const before = getRoutine(args.routine_id)
      if (!before) throw new Error(`Routine not found: ${args.routine_id}`)
      const oldChain = Array.isArray(before.follow_ups) ? before.follow_ups : []
      let newChain
      if (Array.isArray(args.step_ids)) {
        if (args.step_ids.length !== oldChain.length) {
          throw new Error(`step_ids length (${args.step_ids.length}) does not match chain length (${oldChain.length})`)
        }
        const byId = new Map(oldChain.map(s => [s.id, s]))
        newChain = args.step_ids.map(id => {
          const step = byId.get(id)
          if (!step) throw new Error(`Step id "${id}" not found in chain`)
          return step
        })
      } else if (Number.isInteger(args.from_index) && Number.isInteger(args.to_index)) {
        if (args.from_index < 0 || args.from_index >= oldChain.length) throw new Error(`from_index out of range`)
        if (args.to_index < 0 || args.to_index >= oldChain.length) throw new Error(`to_index out of range`)
        newChain = oldChain.slice()
        const [moved] = newChain.splice(args.from_index, 1)
        newChain.splice(args.to_index, 0, moved)
      } else {
        throw new Error('reorder_follow_ups requires either `step_ids` or both `from_index`+`to_index`')
      }
      updateRoutinePartial(args.routine_id, { follow_ups: newChain })
      return {
        result: { routine_id: args.routine_id, chain: summarizeChain(getRoutine(args.routine_id)) },
        compensation: async () => { upsertRoutine(before) },
      }
    },
  })
}
