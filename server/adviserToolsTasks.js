// adviserToolsTasks.js — Task + routine tools for the AI Adviser.
//
// Each mutation tool captures the pre-mutation state in its execute() closure and
// returns a compensation callback that restores it if a later plan step fails.

import crypto from 'crypto'
import {
  upsertTask, getTask, deleteTask, queryTasks, updateTaskPartial,
  upsertRoutine, getRoutine, getAllRoutines, deleteRoutine, updateRoutinePartial,
  reconcileRoutineHistory,
  getChildTasks, computeProjectBudget, computeSessionPoints, logProjectSession,
  PROJECT_CONSTANTS,
  setEscalationLadder, logEscalationAttempt, advanceEscalationRung,
  resolveEscalation,
} from './db.js'
import { registerTool, findStagedCreate } from './adviserTools.js'
import { SONNET_MODEL } from './aiModels.js'
import { logAiUsage } from './db.js'

const TASK_FIELDS = [
  'title', 'notes', 'due_date', 'status', 'size', 'energy', 'energy_level',
  'tags', 'high_priority', 'low_priority', 'snoozed_until', 'checklist',
  'reframe_notes', 'weather_hidden', 'gcal_duration',
  // Project + parent-child fields (migration 028). Including them in
  // pickTaskUpdates lets `update_task` set parent_id / child_visibility /
  // pin / nag in one call instead of forcing a separate link_task_to_project
  // tool round-trip.
  'parent_id', 'child_visibility', 'pinned_to_today', 'nag_allowed',
  // Sub-task dependencies (migration 029). blocked_by is an array of
  // sibling sub IDs. A sub is "blocked" (hidden from main list) when
  // any blocker is incomplete.
  'blocked_by',
  // Who this is actually for (migration 038) — e.g. a kid's chore the user
  // supervises rather than their own task. Free text; null = the user's own.
  'assignee',
  // Impact 1-3 (migration 041) — who/what this matters to. Manual sets via
  // Quokka count as hand-set (impact_inferred stamped in the execute paths).
  'impact',
  // DIY-or-hire Reality check (migration 042). Quokka can set/flip a verdict
  // when the user decides ("fine, I'll hire out the deck repair").
  'diy_assessed', 'diy_verdict', 'diy_reason', 'diy_first_move',
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
    assignee: t.assignee || null,
    impact: t.impact ?? null,
    crisis_since: t.crisis_since || null,
    diy_verdict: t.diy_verdict || null,
    diy_first_move: t.diy_first_move || null,
    escalation_rungs: t.escalation_rungs || [],
    escalation_current_rung: t.escalation_current_rung ?? null,
    escalation_attempt_count: (t.escalation_attempt_log || []).length,
    escalation_awaiting_advance: !!t.escalation_awaiting_advance,
    escalation_stuck: !!t.escalation_stuck,
  }
}

function summarizeRoutine(r) {
  if (!r) return null
  return {
    id: r.id,
    title: r.title,
    cadence: r.cadence,
    custom_days: r.custom_days ?? null,
    custom_unit: r.custom_unit || 'days',
    schedule_day_of_week: r.schedule_day_of_week ?? null,
    schedule_day_of_month: r.schedule_day_of_month ?? null,
    schedule_week_of_month: r.schedule_week_of_month ?? null,
    trigger_time: r.trigger_time || null,
    tags: r.tags || [],
    paused: !!r.paused,
    end_date: r.end_date || null,
    assignee: r.assignee || null,
    impact: r.impact ?? null,
    last_completed: r.completed_history?.[r.completed_history.length - 1] || null,
    // Sequences: expose the chain template so adviser can address steps
    // by id when calling add/edit/remove/reorder_follow_up tools.
    follow_ups: Array.isArray(r.follow_ups)
      ? r.follow_ups.map((s, i) => ({
          step_index: i,
          step_id: s.id,
          title: s.title,
          ...(s.at_time
            ? { at_time: s.at_time, ...(s.at_next_day ? { at_next_day: true } : {}) }
            : { offset_minutes: s.offset_minutes }),
          ...(s.energy_type ? { energy_type: s.energy_type } : {}),
          ...(s.energy_level ? { energy_level: s.energy_level } : {}),
          ...(s.notes ? { notes: s.notes } : {}),
        }))
      : [],
    // Stacks: members fan out into independent tasks each cycle (vs follow_ups,
    // a dependent chain). Non-empty ⇒ this routine is a stack.
    members: Array.isArray(r.members)
      ? r.members.map(m => ({
          id: m.id,
          title: m.title,
          ...(m.energy_type ? { energy_type: m.energy_type } : {}),
          ...(m.energy_level ? { energy_level: m.energy_level } : {}),
          ...(m.notes ? { notes: m.notes } : {}),
        }))
      : [],
  }
}

function taskLabel(id, session = null) {
  if (!id) return '(no id)'
  // Real, already-committed task — primary path.
  const t = getTask(id)
  if (t) {
    const title = t.title?.trim() || '(untitled)'
    return title.length > 60 ? `${title.slice(0, 57)}…` : title
  }
  // Forward reference to a not-yet-committed staged create in the same
  // session plan. Resolves the friendly title from the staged input so
  // the preview reads naturally instead of "(missing task abc12345)".
  if (session) {
    const staged = findStagedCreate(session, id)
    if (staged?.input?.title) {
      const title = String(staged.input.title).trim() || '(untitled)'
      return (title.length > 60 ? `${title.slice(0, 57)}…` : title) + ' (pending)'
    }
  }
  return `(missing task ${id.slice(0, 8)})`
}

function routineLabel(id, session = null) {
  if (!id) return '(no id)'
  const r = getRoutine(id)
  if (r) {
    const title = r.title?.trim() || '(untitled)'
    return title.length > 60 ? `${title.slice(0, 57)}…` : title
  }
  // Forward reference to a not-yet-committed staged create_routine in the
  // same session plan. Resolves the friendly title from the staged input
  // so the preview reads naturally instead of "(missing routine abc12345)".
  if (session) {
    const staged = findStagedCreate(session, id)
    if (staged?.input?.title) {
      const title = String(staged.input.title).trim() || '(untitled)'
      return (title.length > 60 ? `${title.slice(0, 57)}…` : title) + ' (pending)'
    }
  }
  return `(missing routine ${id.slice(0, 8)})`
}

function pickTaskUpdates(input) {
  const out = {}
  for (const k of TASK_FIELDS) {
    if (input[k] !== undefined) out[k] = input[k]
  }
  return out
}

// Cycle check for blocked_by graphs. Returns the id of a candidate
// blocker that would create a cycle (i.e. transitively waits on this
// task), or null if all blockers are safe. Used by stagedValidate to
// surface clear errors to the model instead of silently corrupting the
// graph.
function findBlockedByCycle(taskId, candidateBlockers, session) {
  if (!Array.isArray(candidateBlockers) || candidateBlockers.length === 0) return null
  // Walk each candidate's transitive blockers via DB + session.plan.
  // If we ever reach taskId, it's a cycle.
  const sessionEdges = new Map()
  if (session?.plan) {
    for (const step of session.plan) {
      if (step.toolName === 'create_task' || step.toolName === 'update_task') {
        const id = step.input?.id
        if (id && Array.isArray(step.input?.blocked_by)) {
          sessionEdges.set(id, step.input.blocked_by)
        }
      }
    }
  }
  const blockersOf = (id) => {
    // Session-staged values take precedence over DB (newer intent).
    if (sessionEdges.has(id)) return sessionEdges.get(id)
    const t = getTask(id)
    return Array.isArray(t?.blocked_by) ? t.blocked_by : []
  }
  for (const candidate of candidateBlockers) {
    const seen = new Set()
    const stack = [candidate]
    while (stack.length) {
      const cur = stack.pop()
      if (cur === taskId) return candidate
      if (seen.has(cur)) continue
      seen.add(cur)
      for (const up of blockersOf(cur)) stack.push(up)
    }
  }
  return null
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
    description: 'Create a new task. Defaults: size M, status not_started. Size/energy will be auto-refined by the background AI sizer. For multi-part tasks, populate `checklist_items` with sub-items so the user gets one umbrella task with a checklist rather than 8 separate tasks. For PROJECT sub-tasks (the user wants real, independent tasks broken out from a project so each can complete on its own schedule), set `parent_id` to the project id — the task is linked at creation, no follow-up `link_task_to_project` call needed. To create a project itself, set `status: "project"`; optionally `pinned_to_today: true` and `nag_allowed: true`.',
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
        parent_id: {
          type: 'string',
          description: 'When creating a sub-task of an existing project, set this to the project\'s id. The sub-task is linked at creation — do NOT also call link_task_to_project. Leave unset for top-level tasks.',
        },
        child_visibility: {
          type: 'string',
          enum: ['active', 'backstage'],
          description: 'Only used when parent_id is set. "active" (default for new sub-tasks) surfaces this sub in the main list under the pinned parent project. "backstage" keeps it inside the Projects drill-down only.',
        },
        pinned_to_today: {
          type: 'boolean',
          description: 'Project-only flag (ignored unless status=project). When true, the project pins to the main task list as a "Pinned projects" section.',
        },
        nag_allowed: {
          type: 'boolean',
          description: 'When true, this task can trigger calm stale/nudge notifications even without a due date. Default false — any undated task (project or ordinary) is silent by default. A due_date overrides this and triggers full escalation regardless. An active escalation ladder always overrides this too.',
        },
        blocked_by: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of sibling sub task ids that must complete before this sub appears in the main list. Use to model dependency chains (e.g. "Booking day" waits on "Choose destination" + "Research flights"). Hidden from main list until every blocker reaches status=done; shown in the Projects drill-down with a "⏸ waits on X, Y" indicator. Cycles (A blocks B blocks A) are rejected at stage time.',
        },
        assignee: {
          type: 'string',
          description: 'Set when this task is actually for someone else the user supervises (e.g. a kid\'s chore), not the user\'s own task — a name, e.g. "Jack". Leave unset for the user\'s own tasks. Scores a flat 1 point on completion instead of the size x energy formula, but still counts toward the user\'s own daily total.',
        },
        impact: {
          type: 'integer',
          enum: [1, 2, 3],
          description: 'Who/what this matters to: 3 = affects people the user is responsible to (spouse/household) or money/health/legal consequences or unblocks other things; 2 = meaningful forward motion on their own commitments; 1 = self-only, low consequence. Leave unset to let background inference pick it.',
        },
      },
      required: ['title'],
    },
    preview: (args, session) => {
      const parts = [args.status === 'project' ? `Create project: "${args.title}"` : `Create task: "${args.title}"`]
      if (args.parent_id) parts.push(`sub of "${taskLabel(args.parent_id, session)}"`)
      if (args.due_date) parts.push(`due ${args.due_date}`)
      if (args.checklist_items?.length) parts.push(`${args.checklist_items.length} checklist item${args.checklist_items.length !== 1 ? 's' : ''}`)
      if (args.pinned_to_today) parts.push('pinned')
      if (args.nag_allowed) parts.push('nags allowed')
      return parts.join(' · ')
    },
    // Pre-stamp the new task's id at stage time so chained creates (project
    // then subs with parent_id) can reference it. Returned to the model as
    // `id` in the staged response. At commit time, execute uses args.id.
    preStage: (args) => {
      const id = `task-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
      return { id, input: { ...args, id } }
    },
    // Stage-time validation: surface bad parent_id refs to the model NOW
    // instead of letting the whole plan roll back at commit. Accepts a
    // parent_id that points to a real task OR an earlier staged create in
    // the same plan. Also rejects blocked_by entries that would create a
    // cycle or reference non-existent tasks.
    stagedValidate: (args, session) => {
      if (args.parent_id) {
        if (!getTask(args.parent_id) && !findStagedCreate(session, args.parent_id)) {
          return `parent_id "${args.parent_id}" doesn't match any real task or any staged create earlier in this plan. When chaining a project + subs, the create_task response for the project includes an "id" field — use that id as the parent_id for the subs.`
        }
      }
      if (Array.isArray(args.blocked_by) && args.blocked_by.length > 0) {
        for (const id of args.blocked_by) {
          if (!getTask(id) && !findStagedCreate(session, id)) {
            return `blocked_by id "${id}" doesn't match any real task or any staged create earlier in this plan.`
          }
        }
        // Self-reference and cycle detection use the pre-stamped id (preStage)
        // which is already set in args by the time stagedValidate runs.
        const taskId = args.id
        if (taskId && args.blocked_by.includes(taskId)) {
          return 'A task cannot block on itself.'
        }
        if (taskId) {
          const cycleAt = findBlockedByCycle(taskId, args.blocked_by, session)
          if (cycleAt) {
            return `Adding "${cycleAt}" as a blocker would create a cycle — that task (transitively) already waits on this one.`
          }
        }
      }
      return null
    },
    execute: async (args) => {
      // Parent validation already happened at stage time via stagedValidate,
      // but recheck here against the real DB (the parent may have been
      // staged in this same plan and is about to land — commit runs steps
      // in order, so by the time we reach a sub, its parent create has
      // executed).
      if (args.parent_id) {
        const parent = getTask(args.parent_id)
        if (!parent) throw new Error(`Parent not found: ${args.parent_id}`)
        if (args.parent_id === args.id) throw new Error('A task cannot be its own parent')
      }
      // args.id is now always pre-stamped via preStage; fall back to a
      // fresh generation in case anything still calls execute directly.
      const id = args.id || `task-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
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
      // child_visibility defaults to 'active' when a parent is set (matches
      // the manual "+ Add child step" UI) so the sub surfaces under the
      // pinned parent automatically. Without a parent it stays 'backstage'
      // (the column default) which has no visible effect on top-level tasks.
      const childVis = args.parent_id
        ? (args.child_visibility || 'active')
        : 'backstage'
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
        parent_id: args.parent_id || null,
        child_visibility: childVis,
        // pinned_to_today only has visible effect on projects (the "Pinned
        // projects" section is project-only) so it's skipped for other
        // statuses to avoid surprise. nag_allowed now applies to any task.
        pinned_to_today: args.status === 'project' ? !!args.pinned_to_today : false,
        nag_allowed: !!args.nag_allowed,
        assignee: args.assignee || null,
        impact: args.impact ?? null,
        impact_inferred: args.impact != null,
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
    description: 'Update any subset of task fields. Only provided fields change. Use this to link an orphan task to a project (set parent_id), pin a project (pinned_to_today), opt any undated task into nags (nag_allowed), or fix child_visibility — all in a single call, no need for separate link/pin tools. For common transitions prefer complete_task/reopen_task/snooze_task/move_to_projects.',
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
        parent_id: { type: ['string', 'null'], description: 'Link to a project. Pass null to unlink.' },
        child_visibility: { type: 'string', enum: ['active', 'backstage'], description: 'Visibility under the parent project. Only meaningful when parent_id is set.' },
        pinned_to_today: { type: 'boolean', description: 'Project pin toggle (status=project tasks only).' },
        nag_allowed: { type: 'boolean', description: 'Opt this task into calm stale/nudge notifications while it has no due date. Default false for any undated task (ordinary or project) — set true if the user wants reminders on it anyway.' },
        blocked_by: { type: 'array', items: { type: 'string' }, description: 'Array of sibling sub task ids that must complete before this sub becomes visible in the main list. Empty array clears all blockers. Cycles are rejected.' },
        assignee: { type: ['string', 'null'], description: 'Set when this task is actually for someone else the user supervises (e.g. a kid\'s chore) — a name, e.g. "Jack". Pass null to clear (back to the user\'s own task).' },
        impact: { type: ['integer', 'null'], enum: [1, 2, 3, null], description: 'Who/what this matters to: 3 = affects people the user is responsible to / real consequences / unblocks others; 2 = own commitments; 1 = self-only. Pass null to return it to background inference.' },
      },
      required: ['id'],
    },
    preview: (args, session) => {
      const changes = Object.keys(args).filter(k => k !== 'id')
      return `Update "${taskLabel(args.id, session)}": ${changes.join(', ') || '(no changes)'}`
    },
    // Stage-time validation: reject updates pointing at non-existent
    // tasks UNLESS they reference a staged create earlier in the plan
    // (forward reference resolved at commit). Also reject parent_id and
    // blocked_by forward refs + blocked_by cycles.
    stagedValidate: (args, session) => {
      if (!args.id) return 'update_task requires an id'
      const hasReal = !!getTask(args.id)
      const hasStaged = !!findStagedCreate(session, args.id)
      if (!hasReal && !hasStaged) {
        return `update_task target "${args.id}" doesn't match any real task or any staged create earlier in this plan. If you meant to update something you just staged with create_task, use the "id" field from that create_task's response.`
      }
      if (args.parent_id && args.parent_id !== args.id) {
        if (!getTask(args.parent_id) && !findStagedCreate(session, args.parent_id)) {
          return `parent_id "${args.parent_id}" doesn't match any real task or any staged create.`
        }
      }
      if (Array.isArray(args.blocked_by) && args.blocked_by.length > 0) {
        for (const id of args.blocked_by) {
          if (!getTask(id) && !findStagedCreate(session, id)) {
            return `blocked_by id "${id}" doesn't match any real task or any staged create.`
          }
        }
        if (args.blocked_by.includes(args.id)) {
          return 'A task cannot block on itself.'
        }
        const cycleAt = findBlockedByCycle(args.id, args.blocked_by, session)
        if (cycleAt) {
          return `Adding "${cycleAt}" as a blocker would create a cycle — that task (transitively) already waits on this one.`
        }
      }
      return null
    },
    execute: async (args) => {
      const before = getTask(args.id)
      if (!before) throw new Error(`Task not found: ${args.id}`)
      // Validate parent_id refers to a real task (when set).
      if (args.parent_id) {
        if (args.parent_id === args.id) throw new Error('A task cannot be its own parent')
        const parent = getTask(args.parent_id)
        if (!parent) throw new Error(`Parent not found: ${args.parent_id}`)
      }
      const updates = pickTaskUpdates(args)
      const now = new Date().toISOString()
      updates.updated_at = now
      updates.last_touched = now
      // A Quokka-set impact counts as hand-set (background inference backs
      // off); clearing it (null) hands it back to inference.
      if ('impact' in updates) updates.impact_inferred = updates.impact != null
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
    description: 'Permanently delete a task. Idempotent: deleting an already-gone task is a no-op, not an error — duplicate delete steps in the same plan are safe. Use sparingly — prefer move_to_backlog for "maybe someday" items.',
    schema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    preview: (args) => `Delete task "${taskLabel(args.id)}"`,
    execute: async ({ id }) => {
      const before = getTask(id)
      if (!before) {
        // Already deleted (most commonly: model staged duplicate delete
        // steps from overlapping search results). Treat as a no-op so the
        // whole plan doesn't roll back. No compensation needed since
        // nothing was mutated.
        return { result: { id, deleted: false, already_gone: true } }
      }
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
    description: 'Create a recurring routine. Cadence: daily|weekly|monthly|quarterly|annually|custom. For custom, set custom_days as the interval and custom_unit as "days" (default) or "months" — e.g. {cadence:"custom", custom_days:2, custom_unit:"months"} for every-2-months. Due dates follow a FIXED schedule (anchored, not pushed by late completions). schedule_day_of_week 0=Sun..6=Sat — for weekly = "every <weekday>" (ignored for daily). Month-scale cadences (monthly/quarterly/annually/custom-months) anchor the day via EITHER schedule_day_of_month (1..31, "the 18th") OR schedule_week_of_month (1,2,3,4 or -1 for last) + schedule_day_of_week ("1st Monday", "last Friday"); omit both to use the creation day-of-month. trigger_time is an optional "HH:MM" 24h surface-at time — spawned tasks stay hidden (and silent) until that clock time on their due day, e.g. trigger_time:"20:00" for an after-8pm chore.',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        notes: { type: 'string' },
        cadence: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'quarterly', 'annually', 'custom'] },
        custom_days: { type: 'integer', description: 'Interval count for custom cadence (e.g. 2 with custom_unit=months means every 2 months)' },
        custom_unit: { type: 'string', enum: ['days', 'months'], description: 'Unit for custom_days. Default: days.' },
        tags: { type: 'array', items: { type: 'string' } },
        high_priority: { type: 'boolean' },
        end_date: { type: 'string' },
        schedule_day_of_week: { type: 'integer', minimum: 0, maximum: 6, description: 'Weekday 0=Sun..6=Sat. Weekly: "every <weekday>". Month-scale: the weekday for an ordinal anchor (with schedule_week_of_month).' },
        schedule_day_of_month: { type: 'integer', minimum: 1, maximum: 31, description: 'Month-scale only: fixed calendar day, e.g. 18 for "the 18th". Clamped to month length.' },
        schedule_week_of_month: { type: 'integer', enum: [1, 2, 3, 4, -1], description: 'Month-scale only: with schedule_day_of_week → ordinal weekday. 1..4 or -1 (last). E.g. {schedule_week_of_month:1, schedule_day_of_week:1} = "1st Monday".' },
        trigger_time: { type: 'string', description: '"HH:MM" 24h surface-at time. Spawned tasks are hidden/silent until this time on their due day. Omit for any time.' },
        members: {
          type: 'array',
          description: 'Stack members — makes this a "stack" routine that spawns one INDEPENDENT task per member each cycle (sharing the cadence + trigger_time). Different from follow_ups (a dependent chain). Each member scores its own points; clearing every member of a cycle pays a 20% bonus. Provide 2+ items, e.g. an "Evening" routine with members "start dishwasher", "take out trash", "refill milk".',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              energy_type: { type: 'string', enum: ['desk', 'people', 'errand', 'confrontation', 'creative', 'physical'] },
              energy_level: { type: 'integer', enum: [1, 2, 3] },
              notes: { type: 'string' },
            },
            required: ['title'],
          },
        },
        assignee: {
          type: 'string',
          description: 'Set when this loop is actually for someone else the user supervises (e.g. a kid\'s chore), not the user\'s own task — a name, e.g. "Jack". Leave unset for the user\'s own loops. Every spawned task inherits it and scores a flat 1 point on completion instead of the size x energy formula, but still counts toward the user\'s own daily total.',
        },
        impact: {
          type: 'integer',
          enum: [1, 2, 3],
          description: 'Impact 1-3 inherited by every spawned task (3 = household/others affected, 2 = own commitments, 1 = self-only).',
        },
      },
      required: ['title', 'cadence'],
    },
    preview: (args) => `Create routine: "${args.title}" (${args.cadence})${Array.isArray(args.members) && args.members.length ? ` · ${args.members.length}-item stack` : ''}${args.assignee ? ` · for ${args.assignee}` : ''}`,
    // Pre-stamp the new routine's id at stage time so a chained
    // add_follow_up in the same plan can reference it. Returned to the
    // model as `id` in the staged response. At commit time, execute uses
    // args.id.
    preStage: (args) => {
      const id = `rt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
      return { id, input: { ...args, id } }
    },
    execute: async (args) => {
      // args.id is now always pre-stamped via preStage; fall back to a
      // fresh generation in case anything still calls execute directly.
      const id = args.id || `rt-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
      const now = new Date().toISOString()
      const routine = {
        id,
        title: args.title,
        notes: args.notes || '',
        cadence: args.cadence,
        // Accept the legacy `custom_interval_days` arg name too — earlier
        // tool schema advertised it and Claude may still favor it in
        // prior-context-loaded turns. Both names map to the same column.
        custom_days: args.custom_days ?? args.custom_interval_days ?? null,
        custom_unit: args.custom_unit || 'days',
        tags: args.tags || [],
        high_priority: !!args.high_priority,
        end_date: args.end_date || null,
        schedule_day_of_week: args.schedule_day_of_week ?? null,
        schedule_day_of_month: args.schedule_day_of_month ?? null,
        schedule_week_of_month: args.schedule_week_of_month ?? null,
        trigger_time: args.trigger_time || null,
        members: Array.isArray(args.members)
          ? args.members.filter(m => m?.title).map(m => ({
              id: m.id || `m-${crypto.randomBytes(3).toString('hex')}`,
              title: m.title,
              ...(m.energy_type ? { energy_type: m.energy_type } : {}),
              ...(m.energy_level ? { energy_level: m.energy_level } : {}),
              ...(m.notes ? { notes: m.notes } : {}),
            }))
          : [],
        paused: false,
        completed_history: [],
        created_at: now,
        updated_at: now,
        assignee: args.assignee || null,
        impact: args.impact ?? null,
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
        custom_days: { type: 'integer', description: 'Interval count for custom cadence' },
        custom_unit: { type: 'string', enum: ['days', 'months'], description: 'Unit for custom_days. Default: days.' },
        tags: { type: 'array', items: { type: 'string' } },
        paused: { type: 'boolean' },
        end_date: { type: ['string', 'null'] },
        schedule_day_of_week: { type: ['integer', 'null'], minimum: 0, maximum: 6, description: 'Weekday 0=Sun..6=Sat. Weekly: "every <weekday>". Month-scale: weekday for an ordinal anchor (with schedule_week_of_month). Null to clear.' },
        schedule_day_of_month: { type: ['integer', 'null'], minimum: 1, maximum: 31, description: 'Month-scale: fixed calendar day ("the 18th"). Null to clear. Setting this clears any ordinal-weekday anchor.' },
        schedule_week_of_month: { type: ['integer', 'null'], enum: [1, 2, 3, 4, -1, null], description: 'Month-scale: ordinal week (1..4 or -1 last) paired with schedule_day_of_week. Null to clear.' },
        trigger_time: { type: ['string', 'null'], description: '"HH:MM" 24h surface-at time, or null to clear. Spawned tasks stay hidden/silent until this time on their due day.' },
        members: {
          type: 'array',
          description: 'Replace the stack members (the full array). Non-empty ⇒ this is a "stack" routine spawning one independent task per member each cycle; clearing all members pays a 20% bonus. Pass [] to convert back to an ordinary single-task routine. Edits take effect on the NEXT cycle — already-spawned tasks are untouched.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              energy_type: { type: 'string', enum: ['desk', 'people', 'errand', 'confrontation', 'creative', 'physical'] },
              energy_level: { type: 'integer', enum: [1, 2, 3] },
              notes: { type: 'string' },
            },
            required: ['title'],
          },
        },
        last_done: { type: ['string', 'null'], description: 'Set when the routine was last completed, "YYYY-MM-DD" (or null = never done). Drives the next due date — use it to repair a routine that nags as if never done after lost completion history. Sets the most-recent completion entry; does not erase older history.' },
        assignee: { type: ['string', 'null'], description: 'Set when this loop is actually for someone else the user supervises (e.g. a kid\'s chore) — a name, e.g. "Jack". Pass null to clear (back to the user\'s own loop). Only affects future spawns, not already-spawned tasks.' },
        impact: { type: ['integer', 'null'], enum: [1, 2, 3, null], description: 'Impact 1-3 inherited by future spawned tasks. Pass null to clear.' },
      },
      required: ['id'],
    },
    preview: (args) => `Update routine "${routineLabel(args.id)}"`,
    execute: async (args) => {
      const before = getRoutine(args.id)
      if (!before) throw new Error(`Routine not found: ${args.id}`)
      const updates = { ...args, updated_at: new Date().toISOString() }
      // Translate legacy field name → canonical column name. Schema
      // now uses custom_days; older agent context may still send the
      // typo'd custom_interval_days, so map it through.
      if (updates.custom_interval_days != null && updates.custom_days == null) {
        updates.custom_days = updates.custom_interval_days
      }
      delete updates.custom_interval_days
      // last_done is a convenience for setting the most-recent completion. Map
      // it to completed_history (set last entry, or append; null drops the
      // most-recent entry). Noon UTC so the date can't drift across timezones.
      if (updates.last_done !== undefined) {
        const hist = Array.isArray(before.completed_history) ? before.completed_history.slice() : []
        if (updates.last_done === null) {
          hist.pop()
        } else {
          const iso = new Date(`${updates.last_done}T12:00:00Z`).toISOString()
          if (hist.length > 0) hist[hist.length - 1] = iso
          else hist.push(iso)
        }
        updates.completed_history = hist
        delete updates.last_done
      }
      // Normalize stack members: keep titled rows, ensure each has an id.
      if (Array.isArray(updates.members)) {
        updates.members = updates.members.filter(m => m?.title).map(m => ({
          id: m.id || `m-${crypto.randomBytes(3).toString('hex')}`,
          title: m.title,
          ...(m.energy_type ? { energy_type: m.energy_type } : {}),
          ...(m.energy_level ? { energy_level: m.energy_level } : {}),
          ...(m.notes ? { notes: m.notes } : {}),
        }))
      }
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
          model: SONNET_MODEL,
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error?.message || `Research call ${response.status}`)
      if (data?.usage) logAiUsage({ provider: 'anthropic', model: data.model || SONNET_MODEL, feature: 'research_task', input_tokens: data.usage.input_tokens || 0, output_tokens: data.usage.output_tokens || 0 })

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
    preview: (args, session) => `Spawn task from routine "${routineLabel(args.routine_id, session)}"`,
    stagedValidate: (args, session) => {
      if (!getRoutine(args.routine_id) && !findStagedCreate(session, args.routine_id)) {
        return `routine_id "${args.routine_id}" doesn't match any real routine or any staged create_routine earlier in this plan. When chaining onto a routine you're creating in this same plan, the create_routine response includes an "id" field — use that id as the routine_id here.`
      }
      return null
    },
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

  registerTool({
    name: 'reconcile_loops',
    description: 'Close loops (routines) that are stuck OPEN: their spawned task(s) were completed but the completion was never recorded in the routine, so the loop keeps showing as due and never advances. This stamps each missing completion-day from the finished tasks, so the cadence advances and the loop stops nagging. Safe and idempotent — it only adds completion evidence that real done tasks already prove, never removes anything, and re-running does nothing. Skips stacks and habit loops. Use when the user says a loop won\'t close / stays due even though they finished it.',
    schema: { type: 'object', properties: {} },
    preview: () => {
      const { repaired } = reconcileRoutineHistory({ dryRun: true })
      if (repaired.length === 0) return 'Reconcile loops — nothing to fix (all loops already match their completed tasks)'
      const lines = repaired.map(r => `"${r.title}" (+${r.addedDays.length} day${r.addedDays.length === 1 ? '' : 's'})`)
      return `Close ${repaired.length} stuck loop${repaired.length === 1 ? '' : 's'}: ${lines.join(', ')}`
    },
    execute: async () => {
      const { repaired } = reconcileRoutineHistory()
      // Capture pre-state per routine so a later plan failure restores every
      // completed_history we touched (LIFO compensation).
      const before = repaired.map(r => ({ id: r.id, completed_history: r.before }))
      return {
        result: {
          repaired_count: repaired.length,
          repaired: repaired.map(r => ({ id: r.id, title: r.title, added_days: r.addedDays })),
        },
        compensation: async () => {
          for (const r of before) updateRoutinePartial(r.id, { completed_history: r.completed_history })
        },
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
      ...(s.at_time
        ? { at_time: s.at_time, ...(s.at_next_day ? { at_next_day: true } : {}) }
        : { offset_minutes: s.offset_minutes }),
      ...(s.energy_type ? { energy_type: s.energy_type } : {}),
      ...(s.energy_level ? { energy_level: s.energy_level } : {}),
      ...(s.notes ? { notes: s.notes } : {}),
    }))
  }

  registerTool({
    name: 'add_follow_up',
    description: `Append (or insert) a follow-up step to a routine's chain template. Steps fire in order after each previous step is COMPLETED. Time the step EITHER by \`offset_minutes\` (delay from that completion — sub-day offsets snooze the spawned task until the trigger) OR by an absolute clock time with \`at_time\` ("HH:MM" 24h, optionally \`at_next_day\` for "the next morning"). Provide exactly one timing mode; at_time wins if both are sent.`,
    schema: {
      type: 'object',
      properties: {
        routine_id: { type: 'string' },
        title: { type: 'string', minLength: 1 },
        offset_minutes: { type: 'integer', minimum: 0 },
        at_time: { type: 'string', description: 'Absolute clock time "HH:MM" 24h. Mutually exclusive with offset_minutes.' },
        at_next_day: { type: 'boolean', description: 'With at_time: schedule on the day AFTER the step spawns (e.g. "6am next morning").' },
        energy_type: { type: 'string', enum: ENERGY_TYPE_ENUM },
        energy_level: { type: 'integer', minimum: 1, maximum: 3 },
        notes: { type: 'string' },
        step_index: { type: 'integer', minimum: 0, description: '0-based insertion position. Default: append to end.' },
      },
      required: ['routine_id', 'title'],
    },
    preview: (args, session) => `Add chain step "${args.title}" to routine "${routineLabel(args.routine_id, session)}"`,
    // Stage-time validation: surface a bad routine_id to the model NOW
    // instead of letting the whole plan roll back at commit. Accepts a
    // routine_id that points to a real routine OR an earlier staged
    // create_routine in the same plan (the chained-creation case).
    stagedValidate: (args, session) => {
      if (!getRoutine(args.routine_id) && !findStagedCreate(session, args.routine_id)) {
        return `routine_id "${args.routine_id}" doesn't match any real routine or any staged create_routine earlier in this plan. When chaining a follow-up to a routine you're creating in this same plan, the create_routine response includes an "id" field — use that id as the routine_id here.`
      }
      return null
    },
    execute: async (args) => {
      const before = getRoutine(args.routine_id)
      if (!before) throw new Error(`Routine not found: ${args.routine_id}`)
      const stepId = crypto.randomUUID()
      const newStep = {
        id: stepId,
        title: args.title.trim(),
        ...(args.at_time
          ? { at_time: args.at_time, ...(args.at_next_day ? { at_next_day: true } : {}) }
          : { offset_minutes: Math.max(0, args.offset_minutes || 0) }),
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
        offset_minutes: { type: 'integer', minimum: 0, description: 'Switches the step to relative-offset mode (clears any at_time).' },
        at_time: { type: ['string', 'null'], description: 'Absolute clock time "HH:MM" 24h — switches the step to clock-time mode (clears offset_minutes). Pass null to clear and fall back to offset mode.' },
        at_next_day: { type: 'boolean', description: 'With at_time: schedule on the day after the step spawns.' },
        energy_type: { type: ['string', 'null'], enum: [...ENERGY_TYPE_ENUM, null] },
        energy_level: { type: ['integer', 'null'], minimum: 1, maximum: 3 },
        notes: { type: ['string', 'null'] },
      },
      required: ['routine_id'],
    },
    preview: (args, session) => `Edit chain step in routine "${routineLabel(args.routine_id, session)}"`,
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
      // Timing mode is mutually exclusive: setting at_time clears offset_minutes
      // and vice-versa. Passing at_time:null reverts to offset mode.
      if (Object.prototype.hasOwnProperty.call(args, 'at_time')) {
        if (args.at_time) {
          target.at_time = args.at_time
          delete target.offset_minutes
        } else {
          delete target.at_time
          delete target.at_next_day
        }
      }
      if (Object.prototype.hasOwnProperty.call(args, 'at_next_day') && target.at_time) {
        if (args.at_next_day) target.at_next_day = true
        else delete target.at_next_day
      }
      if (Number.isInteger(args.offset_minutes)) {
        target.offset_minutes = Math.max(0, args.offset_minutes)
        delete target.at_time
        delete target.at_next_day
      }
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
    preview: (args, session) => `Remove chain step from routine "${routineLabel(args.routine_id, session)}"`,
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
    preview: (args, session) => `Reorder chain steps in routine "${routineLabel(args.routine_id, session)}"`,
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

  // ============================================================
  // Escalation Ladder — see wiki/Escalation-Ladder.md
  // ============================================================

  registerTool({
    name: 'generate_escalation_ladder',
    description: 'Draft an escalation ladder (ordered contact-attempt tactics) for a task where the user is trying to reach an unresponsive person/organization. `situation` should describe who/what, channels available, and urgency. Runs its own Claude call to draft rungs (label + suggestion + script + tempo), then stages them via set_escalation_ladder for the user to review. Use when the user asks for help with a "not getting a response" task, or when calling this after a Brainstorm request (out of scripted moves — draft NEW tactics distinct from any already on the ladder, which are visible in the task\'s escalation_rungs via get_task).',
    schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        situation: { type: 'string', description: 'Who/what you\'re trying to reach, channels available (email/phone/in-person/etc.), urgency.' },
        existing_rungs_exhausted: { type: 'boolean', description: 'True when this is a Brainstorm request for a stuck ladder — draft rungs distinct from what already exists, and APPEND rather than replace.' },
      },
      required: ['task_id', 'situation'],
    },
    preview: (args) => `Draft an escalation ladder for "${taskLabel(args.task_id)}"`,
    execute: async (args, deps) => {
      if (!deps.anthropicKey) throw new Error('No Anthropic API key configured — ladder drafting unavailable')
      const task = getTask(args.task_id)
      if (!task) throw new Error(`Task not found: ${args.task_id}`)
      const existing = Array.isArray(task.escalation_rungs) ? task.escalation_rungs : []

      const system = `You design "escalation ladders" for an ADHD task app — ordered lists of TACTICS for repeatedly trying to reach an unresponsive person/organization. Each rung is a DIFFERENT approach (not a repeat of the last), e.g. email -> phone call -> call the main line instead of the individual -> ask in person for a manager. Return JSON only: {"rungs":[{"label":"short tactic name","suggestion":"one sentence describing what to do, shown in nudges","script":"a literal 1-2 line opener the user can read or paste when they act - REQUIRED whenever the tactic involves talking to a person, since knowing what to say is the real barrier, not remembering to do it","attempts_before_ready":<int, how many tries before offering to switch tactics>,"nudge_every_days":<int, how often to nudge while on this rung>}]}. 2-5 rungs. The LAST rung should have a higher attempts_before_ready or represent the most escalated real-world option (in person, formal complaint channel, etc.) — do not set attempts_before_ready on it if there's genuinely nowhere further to go after it.`
      const existingNote = existing.length > 0 ? `\n\nExisting rungs already on this ladder (draft NEW, DIFFERENT tactics — do not repeat these):\n${existing.map(r => `- ${r.label}: ${r.suggestion}`).join('\n')}` : ''
      const user = `Task: ${task.title}\nSituation: ${args.situation}${existingNote}`

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': deps.anthropicKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: SONNET_MODEL, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error?.message || `Ladder draft call ${response.status}`)
      if (data?.usage) logAiUsage({ provider: 'anthropic', model: data.model || SONNET_MODEL, feature: 'escalation_ladder', input_tokens: data.usage.input_tokens || 0, output_tokens: data.usage.output_tokens || 0 })
      const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('Could not parse drafted ladder')
      const parsed = JSON.parse(match[0])
      const drafted = (Array.isArray(parsed.rungs) ? parsed.rungs : []).map(r => ({
        id: crypto.randomUUID(),
        label: String(r.label || '').slice(0, 60),
        suggestion: String(r.suggestion || '').slice(0, 300),
        script: r.script ? String(r.script).slice(0, 300) : undefined,
        attempts_before_ready: Number.isInteger(r.attempts_before_ready) ? r.attempts_before_ready : 3,
        nudge_every_days: Number.isInteger(r.nudge_every_days) ? r.nudge_every_days : 2,
      })).filter(r => r.label)
      if (drafted.length === 0) throw new Error('Ladder draft returned no rungs')

      const before = getTask(args.task_id)
      const append = !!args.existing_rungs_exhausted
      const finalRungs = append ? [...existing, ...drafted] : drafted
      const task2 = setEscalationLadder(args.task_id, finalRungs, { append })
      return {
        result: { task_id: args.task_id, rungs: task2.escalation_rungs },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  registerTool({
    name: 'set_escalation_ladder',
    description: 'Directly set/replace (or append to) a task\'s escalation ladder rungs. Prefer generate_escalation_ladder unless the user has dictated exact rungs themselves.',
    schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        rungs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              suggestion: { type: 'string' },
              script: { type: 'string' },
              attempts_before_ready: { type: 'integer' },
              nudge_every_days: { type: 'integer' },
            },
            required: ['label'],
          },
        },
        append: { type: 'boolean', default: false },
      },
      required: ['task_id', 'rungs'],
    },
    preview: (args) => `Set escalation ladder on "${taskLabel(args.task_id)}" (${args.rungs?.length || 0} rungs)`,
    execute: async (args) => {
      const before = getTask(args.task_id)
      if (!before) throw new Error(`Task not found: ${args.task_id}`)
      const rungs = (args.rungs || []).map(r => ({ id: crypto.randomUUID(), attempts_before_ready: 3, nudge_every_days: 2, ...r }))
      const task = setEscalationLadder(args.task_id, rungs, { append: !!args.append })
      return {
        result: { task_id: args.task_id, rungs: task.escalation_rungs },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  registerTool({
    name: 'log_escalation_attempt',
    description: 'Log a contact attempt at the task\'s CURRENT escalation rung — e.g. "I called again just now, still nothing." Awards 1 point.',
    schema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, note: { type: 'string' } },
      required: ['task_id'],
    },
    preview: (args) => `Log a contact attempt on "${taskLabel(args.task_id)}"`,
    execute: async (args) => {
      const before = getTask(args.task_id)
      if (!before) throw new Error(`Task not found: ${args.task_id}`)
      const result = logEscalationAttempt(args.task_id, args.note)
      return {
        result: { task_id: args.task_id, attempts_at_rung: result.attemptsAtRung, threshold_met: result.thresholdMet },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  registerTool({
    name: 'advance_escalation_rung',
    description: 'Move a task\'s escalation ladder to the next rung (switch tactics) — e.g. "move this to calling now."',
    schema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
    preview: (args) => `Advance escalation rung on "${taskLabel(args.task_id)}"`,
    execute: async (args) => {
      const before = getTask(args.task_id)
      if (!before) throw new Error(`Task not found: ${args.task_id}`)
      const task = advanceEscalationRung(args.task_id)
      return {
        result: { task_id: args.task_id, current_rung: task.escalation_current_rung, stuck: task.escalation_stuck },
        compensation: async () => { upsertTask(before) },
      }
    },
  })

  registerTool({
    name: 'resolve_escalation',
    description: 'Close out a task\'s escalation ladder because the user got a response — e.g. "they finally got back to me, close it out." Keeps the rungs + attempt history as a record but clears the active ladder state.',
    schema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
    preview: (args) => `Resolve escalation ladder on "${taskLabel(args.task_id)}"`,
    execute: async (args) => {
      const before = getTask(args.task_id)
      if (!before) throw new Error(`Task not found: ${args.task_id}`)
      resolveEscalation(args.task_id)
      return {
        result: { task_id: args.task_id, resolved: true },
        compensation: async () => { upsertTask(before) },
      }
    },
  })
}
