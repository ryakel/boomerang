#!/usr/bin/env node
/**
 * Generate realistic, messy ADHD-style seed data for dev testing.
 * Uses Claude API to produce tasks, routines, labels, and settings.
 *
 * Usage: ANTHROPIC_API_KEY=sk-ant-... node scripts/generate-seed-data.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { randomUUID } from 'crypto'

// --- Load API key from env or .env file ---
let apiKey = process.env.ANTHROPIC_API_KEY
if (!apiKey && existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf-8')
  apiKey = envFile.match(/(?:VITE_)?ANTHROPIC_API_KEY="?([^"\n]+)"?/)?.[1]
}
if (!apiKey) {
  console.error('Error: ANTHROPIC_API_KEY not found in environment or .env file')
  process.exit(1)
}

const today = new Date().toISOString().split('T')[0]

const prompt = `Generate realistic test data for an ADHD task manager app called Boomerang. The data should feel like a real person with ADHD has been using the app for 3-6 months — messy, inconsistent, with plenty of forgotten/avoided tasks.

Return ONLY a valid JSON object (no markdown fences, no explanation) with this exact structure:

{
  "labels": [...],
  "settings": {...},
  "tasks": [...],
  "routines": [...]
}

TODAY'S DATE: ${today}

=== LABELS (8-12 items) ===
Each: { "id": "UUID", "name": "string", "color": "#hex" }
Colors must be from: #4A9EFF, #52C97F, #FFB347, #FF6240, #A78BFA, #F472B6, #34D399, #FBBF24, #60A5FA, #FB923C
Include realistic categories like: work, personal, health, home, finance, errands, social, creative, urgent, phone-call, low-energy, quick-win

=== SETTINGS ===
Use these exact defaults (dev-friendly, no API keys):
{
  "staleness_days": 2,
  "reframe_threshold": 3,
  "default_due_days": 7,
  "max_open_tasks": 10,
  "sort_by": "age",
  "daily_task_goal": 3,
  "daily_points_goal": 15,
  "vacation_mode": false,
  "vacation_started": null,
  "vacation_end": null,
  "free_days": [],
  "streak_current": 4,
  "digest_time": "07:00",
  "notifications_enabled": false,
  "notif_overdue": true,
  "notif_stale": true,
  "notif_nudge": true,
  "notif_freq_overdue": 0.5,
  "notif_freq_stale": 0.5,
  "notif_freq_nudge": 1,
  "notif_freq_size": 1,
  "notif_freq_pileup": 2,
  "notif_freq_highpri_before": 24,
  "notif_freq_highpri_due": 1,
  "notif_freq_highpri_overdue": 0.5,
  "notif_highpri_escalate": true,
  "quiet_hours_enabled": true,
  "quiet_hours_start": "22:00",
  "quiet_hours_end": "08:00",
  "stale_warn_days": 7,
  "stale_warn_pct": 50,
  "custom_instructions": "I have ADHD. Phone calls and confrontations are extremely hard for me. Errands feel overwhelming unless they're quick. I work best in the morning for focused desk work.",
  "anthropic_api_key": "",
  "notion_token": "",
  "notion_parent_page_id": "",
  "notion_sync_parent_id": "",
  "notion_sync_parent_title": "",
  "notion_last_sync": null,
  "trello_api_key": "",
  "trello_secret": "",
  "trello_board_id": "",
  "trello_board_name": "",
  "trello_list_id": "",
  "trello_list_name": "",
  "trello_list_mapping": null,
  "trello_last_sync": null,
  "gcal_client_id": "",
  "gcal_client_secret": "",
  "gcal_calendar_id": "primary",
  "gcal_sync_enabled": false,
  "gcal_sync_statuses": ["not_started", "doing", "waiting", "open"],
  "gcal_use_timed_events": true,
  "gcal_default_time": "09:00",
  "gcal_event_duration": 60,
  "gcal_remove_on_complete": true,
  "gcal_pull_enabled": false,
  "gcal_event_buffer": false,
  "gcal_last_sync": null,
  "_freq_migrated": true
}

=== TASKS (45-55 items) ===
Each task: {
  "id": "UUID",
  "title": "string",
  "status": "not_started" | "doing" | "waiting" | "done",
  "notes": "string or empty string",
  "due_date": "YYYY-MM-DD or null",
  "snoozed_until": "ISO datetime or null",
  "snooze_count": number (0-15),
  "staleness_days": 2,
  "last_touched": "ISO datetime",
  "created_at": "ISO datetime",
  "completed_at": "ISO datetime or null",
  "reframe_notes": "string or null",
  "notion_page_id": null,
  "notion_url": null,
  "trello_card_id": null,
  "trello_card_url": null,
  "gcal_event_id": null,
  "gcal_duration": "integer minutes or null",
  "routine_id": null,
  "high_priority": false or true,
  "size": "XS" | "S" | "M" | "L" | "XL" | null,
  "energy": "desk" | "people" | "errand" | "confrontation" | "creative" | "physical" | null,
  "energyLevel": 1 | 2 | 3 | null,
  "attachments": [],
  "checklist": [],
  "checklists": [],
  "comments": [],
  "toast_messages": null,
  "trello_sync_enabled": null
}

IMPORTANT distribution requirements:
- ~20 tasks with status "not_started" (mix of recent and ancient)
- ~8 tasks with status "doing" (some started weeks ago and forgotten)
- ~5 tasks with status "waiting" (waiting on other people)
- ~15 tasks with status "done" (completed_at spread over last 60 days)
- ~5 tasks with NO size and NO energy (user never categorized them)
- ~10 tasks snoozed 3+ times (snooze_count 3-15), some with snoozed_until in the past (forgotten snoozes)
- ~8 tasks with due_date in the past (overdue)
- ~5 tasks with due_date in the next 7 days
- ~5 tasks with checklists that are partially completed
- ~3 tasks with comments
- ~3 tasks with reframe_notes (AI-generated motivational reframes)
- ~4 tasks marked high_priority (at least 2 that are overdue — classic ADHD)
- ~3 tasks with gcal_duration set (15, 30, 90 etc)
- created_at dates should span 1-180 days ago
- Use label IDs from the labels array you generated for tags arrays
- Use REALISTIC ADHD task titles: "call dentist about that weird bill", "reply to sarah's text from like 2 weeks ago", "figure out why the water bill is so high", "that thing mom asked me to do", "research new therapist accepting my insurance", "cancel free trial before it charges me", "return amazon package (been sitting by the door for 3 weeks)", etc.

For checklists, use this format:
[{ "id": "UUID", "name": "Steps", "items": [{ "id": "UUID", "text": "step text", "completed": true/false }], "hideCompleted": false }]

For comments, use this format:
[{ "id": "UUID", "author": "me", "text": "comment text", "timestamp": "ISO datetime" }]

=== ROUTINES (5-8 items) ===
Each: {
  "id": "UUID",
  "title": "string",
  "cadence": "daily" | "weekly" | "monthly" | "quarterly" | "custom",
  "custom_days": number or null,
  "notes": "string or empty",
  "tags": [],
  "energy": "desk" | "people" | "errand" | "creative" | "physical" | null,
  "energyLevel": 1 | 2 | 3 | null,
  "high_priority": false,
  "paused": 0 or 1,
  "end_date": "YYYY-MM-DD or null",
  "created_at": "ISO datetime",
  "completed_history": ["ISO datetime", ...],
  "notion_page_id": null,
  "notion_url": null
}

Include routines like: "take meds", "review weekly tasks", "clean kitchen", "exercise", "check bank account". Make 1-2 paused. completed_history should have 5-20 entries for active routines, 1-3 for paused ones. Link 3-4 tasks to routines via routine_id matching.

REMEMBER: Return ONLY valid JSON, no markdown, no explanation. All UUIDs should be valid UUID v4 format (8-4-4-4-12 hex pattern).`

console.log('Calling Claude API to generate seed data...')

const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    messages: [{ role: 'user', content: prompt }],
  }),
})

if (!response.ok) {
  const err = await response.text()
  console.error(`API error ${response.status}: ${err}`)
  process.exit(1)
}

const result = await response.json()
let text = result.content[0].text

// Strip markdown fences if present
const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
if (fenceMatch) text = fenceMatch[1]

let data
try {
  data = JSON.parse(text.trim())
} catch (e) {
  console.error('Failed to parse Claude response as JSON:', e.message)
  console.error('Raw response (first 500 chars):', text.slice(0, 500))
  writeFileSync('scripts/seed-data-raw.txt', text)
  console.error('Full response saved to scripts/seed-data-raw.txt')
  process.exit(1)
}

// Post-process: replace all IDs with fresh UUIDs for guaranteed uniqueness
const idMap = new Map()

function freshId(oldId) {
  if (!oldId) return null
  if (!idMap.has(oldId)) idMap.set(oldId, randomUUID())
  return idMap.get(oldId)
}

// Remap routine IDs first so task.routine_id references work
if (data.routines) {
  for (const r of data.routines) {
    const oldId = r.id
    r.id = freshId(oldId)
  }
}

if (data.labels) {
  for (const l of data.labels) {
    const oldId = l.id
    l.id = freshId(oldId)
  }
}

// Remap tasks — routine_id references need to use the same idMap
if (data.tasks) {
  for (const t of data.tasks) {
    t.id = freshId(t.id)
    if (t.routine_id) t.routine_id = freshId(t.routine_id)
    // Remap tag IDs to match remapped label IDs
    if (t.tags) t.tags = t.tags.map(tag => freshId(tag) || tag)
    // Remap checklist/item IDs
    if (t.checklists) {
      for (const cl of t.checklists) {
        cl.id = randomUUID()
        if (cl.items) cl.items.forEach(item => { item.id = randomUUID() })
      }
    }
    if (t.comments) {
      for (const c of t.comments) c.id = randomUUID()
    }
  }
}

// Remap routine tags
if (data.routines) {
  for (const r of data.routines) {
    if (r.tags) r.tags = r.tags.map(tag => freshId(tag) || tag)
  }
}

// Validate counts
const taskCount = data.tasks?.length || 0
const routineCount = data.routines?.length || 0
const labelCount = data.labels?.length || 0
const statusCounts = {}
for (const t of data.tasks || []) {
  statusCounts[t.status] = (statusCounts[t.status] || 0) + 1
}

console.log(`Generated: ${taskCount} tasks, ${routineCount} routines, ${labelCount} labels`)
console.log(`Status distribution:`, statusCounts)

writeFileSync('scripts/seed-data.json', JSON.stringify(data, null, 2))
console.log('Seed data written to scripts/seed-data.json')
