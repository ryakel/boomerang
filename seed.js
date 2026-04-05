/**
 * Dev seed system — populates the DB with realistic ADHD-messy test data.
 *
 * Activated by SEED_DB=1 at server startup (after initDb).
 * Primary path: calls Claude API to generate fresh data each time.
 * Fallback: loads scripts/seed-data.json if no API key is available.
 */

import { readFileSync, existsSync } from 'fs'
import { clearAllData, setAllData, flushNow } from './db.js'

// The same prompt the standalone generator uses, inlined for container startup
function buildPrompt() {
  const today = new Date().toISOString().split('T')[0]
  return `Generate realistic test data for an ADHD task manager app called Boomerang. The data should feel like a real person with ADHD has been using the app for 3-6 months — messy, inconsistent, with plenty of forgotten/avoided tasks.

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
Colors from: #4A9EFF, #52C97F, #FFB347, #FF6240, #A78BFA, #F472B6, #34D399, #FBBF24, #60A5FA, #FB923C
Include: work, personal, health, home, finance, errands, social, creative, urgent, phone-call, low-energy, quick-win

=== SETTINGS ===
Use these exact defaults:
${JSON.stringify(defaultSettings(), null, 2)}

=== TASKS (45-55 items) ===
Each task must have ALL of these fields:
{
  "id": "UUID", "title": "string", "status": "not_started"|"doing"|"waiting"|"done",
  "notes": "string or empty", "due_date": "YYYY-MM-DD or null",
  "snoozed_until": "ISO datetime or null", "snooze_count": 0-15,
  "staleness_days": 2, "last_touched": "ISO datetime", "created_at": "ISO datetime",
  "completed_at": "ISO datetime or null", "reframe_notes": "string or null",
  "notion_page_id": null, "notion_url": null, "trello_card_id": null,
  "trello_card_url": null, "gcal_event_id": null, "gcal_duration": null,
  "routine_id": null, "high_priority": false, "size": "XS"|"S"|"M"|"L"|"XL"|null,
  "energy": "desk"|"people"|"errand"|"confrontation"|"creative"|"physical"|null,
  "energyLevel": 1|2|3|null, "attachments": [], "checklist": [],
  "checklists": [], "comments": [], "toast_messages": null, "trello_sync_enabled": null
}

Distribution:
- ~20 not_started (mix recent + ancient), ~8 doing (some forgotten), ~5 waiting, ~15 done
- ~5 with NO size/energy, ~10 snoozed 3+ times, ~8 overdue, ~5 due this week
- ~5 with partially-completed checklists, ~3 with comments, ~3 with reframe_notes
- ~4 high_priority (2+ overdue), ~3 with gcal_duration (15/30/90 min)
- created_at spanning 1-180 days ago
- Use label IDs from your labels array for tags
- REALISTIC ADHD titles: "call dentist about that weird bill", "reply to sarah's text from like 2 weeks ago", "figure out why the water bill is so high", "that thing mom asked me to do", etc.

Checklist format: [{ "id": "UUID", "name": "Steps", "items": [{ "id": "UUID", "text": "step", "completed": true/false }], "hideCompleted": false }]
Comment format: [{ "id": "UUID", "author": "me", "text": "comment", "timestamp": "ISO datetime" }]

=== ROUTINES (5-8 items) ===
Each: { "id": "UUID", "title": "string", "cadence": "daily"|"weekly"|"monthly"|"quarterly"|"custom",
  "custom_days": null, "notes": "", "tags": [], "energy": "...", "energyLevel": 1-3|null,
  "high_priority": false, "paused": 0|1, "end_date": null, "created_at": "ISO datetime",
  "completed_history": ["ISO datetime"...], "notion_page_id": null, "notion_url": null }

Include: "take meds", "review weekly tasks", "clean kitchen", "exercise", "check bank account"
1-2 paused. 5-20 completed_history entries for active, 1-3 for paused. Link 3-4 tasks via routine_id.

RETURN ONLY VALID JSON.`
}

function defaultSettings() {
  return {
    staleness_days: 2, reframe_threshold: 3, default_due_days: 7, max_open_tasks: 10,
    sort_by: 'age', daily_task_goal: 3, daily_points_goal: 15,
    vacation_mode: false, vacation_started: null, vacation_end: null, free_days: [],
    streak_current: 4, digest_time: '07:00',
    notifications_enabled: false, notif_overdue: true, notif_stale: true, notif_nudge: true,
    notif_freq_overdue: 0.5, notif_freq_stale: 0.5, notif_freq_nudge: 1,
    notif_freq_size: 1, notif_freq_pileup: 2,
    notif_freq_highpri_before: 24, notif_freq_highpri_due: 1, notif_freq_highpri_overdue: 0.5,
    notif_highpri_escalate: true,
    quiet_hours_enabled: true, quiet_hours_start: '22:00', quiet_hours_end: '08:00',
    stale_warn_days: 7, stale_warn_pct: 50,
    custom_instructions: 'I have ADHD. Phone calls and confrontations are extremely hard for me. Errands feel overwhelming unless they\'re quick. I work best in the morning for focused desk work.',
    anthropic_api_key: '', notion_token: '', notion_parent_page_id: '',
    notion_sync_parent_id: '', notion_sync_parent_title: '', notion_last_sync: null,
    trello_api_key: '', trello_secret: '', trello_board_id: '', trello_board_name: '',
    trello_list_id: '', trello_list_name: '', trello_list_mapping: null, trello_last_sync: null,
    gcal_client_id: '', gcal_client_secret: '', gcal_calendar_id: 'primary',
    gcal_sync_enabled: false, gcal_sync_statuses: ['not_started', 'doing', 'waiting', 'open'],
    gcal_use_timed_events: true, gcal_default_time: '09:00', gcal_event_duration: 60,
    gcal_remove_on_complete: true, gcal_pull_enabled: false, gcal_event_buffer: false,
    gcal_last_sync: null, _freq_migrated: true,
  }
}

async function generateViaApi(apiKey) {
  console.log('[Seed] Generating fresh data via Claude API (30s timeout)...')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      messages: [{ role: 'user', content: buildPrompt() }],
    }),
  })

  clearTimeout(timeout)

  if (!resp.ok) {
    const err = await resp.text()
    throw new Error(`Claude API ${resp.status}: ${err.slice(0, 200)}`)
  }

  const result = await resp.json()
  let text = result.content[0].text

  // Strip markdown fences if present
  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fence) text = fence[1]

  return JSON.parse(text.trim())
}

function loadFallback() {
  const path = new URL('./scripts/seed-data.json', import.meta.url).pathname
  if (!existsSync(path)) {
    throw new Error(`[Seed] No API key and no fallback at ${path}`)
  }
  console.log('[Seed] No API key — loading static fallback from scripts/seed-data.json')
  return JSON.parse(readFileSync(path, 'utf-8'))
}

/**
 * Seed the database. Called from server.js after initDb() when SEED_DB=1.
 * @param {string|undefined} apiKey - Anthropic API key (from env)
 */
export async function seedDatabase(apiKey) {
  console.log('[Seed] SEED_DB=1 detected — seeding database...')

  let data
  if (apiKey) {
    try {
      data = await generateViaApi(apiKey)
    } catch (err) {
      console.warn(`[Seed] API generation failed: ${err.message}`)
      console.warn('[Seed] Falling back to static seed data...')
      data = loadFallback()
    }
  } else {
    data = loadFallback()
  }

  // Validate minimal structure
  if (!data.tasks || !data.routines || !data.labels || !data.settings) {
    throw new Error('[Seed] Invalid seed data — missing tasks, routines, labels, or settings')
  }

  // Wipe and reload
  clearAllData()
  setAllData(data)
  flushNow()

  const statusCounts = {}
  for (const t of data.tasks) statusCounts[t.status] = (statusCounts[t.status] || 0) + 1

  console.log(`[Seed] Done! ${data.tasks.length} tasks, ${data.routines.length} routines, ${data.labels.length} labels`)
  console.log(`[Seed] Status distribution:`, statusCounts)
}
