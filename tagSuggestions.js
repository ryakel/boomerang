// tagSuggestions.js — weekly discovery of NEW tags from recent task history.
//
// Sibling to patternDetection.js (which discovers recurring ROUTINES). This one
// reads recent task titles and proposes label names that capture recurring
// THEMES the user doesn't yet have a label for. Suggestions are stored in
// app_data.tag_suggestions; the user accepts (the CLIENT creates the label,
// reusing the normal label CRUD + sync — the server never mutates the labels
// blob, dodging the bulk-write last-writer-wins hazard) or dismisses them from
// the Suggestions inbox.

import { getData, setData, queryTasks } from './db.js'

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const MAX_SUGGESTIONS = 5
const MAX_TITLES = 300

function getAnthropicKey() {
  return getData('settings')?.anthropic_api_key || process.env.ANTHROPIC_API_KEY || null
}

function loadStore() {
  const s = getData('tag_suggestions')
  return Array.isArray(s) ? s : []
}
function saveStore(arr) { setData('tag_suggestions', arr) }

export function listPendingTagSuggestions() {
  return loadStore().filter(s => s.status === 'pending')
}

export function dismissTagSuggestion(id) {
  const arr = loadStore()
  const s = arr.find(x => x.id === id)
  if (!s) return false
  s.status = 'dismissed'
  s.updated_at = Date.now()
  saveStore(arr)
  return true
}

// Scan recent task titles and ask Claude for new tag themes not already covered
// by the user's labels (or already-pending suggestions). Conservative — only
// themes several tasks share. Idempotent against existing names.
export async function runTagScan() {
  const key = getAnthropicKey()
  if (!key) return { ok: false, error: 'No Anthropic API key configured', surfaced: 0, scanned: 0 }

  const sinceMs = Date.now() - NINETY_DAYS_MS
  const tasks = queryTasks({}).filter(t =>
    t.title && t.title.trim() &&
    // recent: undated/active tasks count; completed ones must be within 90d
    (!t.completed_at || new Date(t.completed_at).getTime() >= sinceMs),
  )
  const titles = tasks.map(t => t.title.trim()).slice(0, MAX_TITLES)
  if (titles.length < 8) return { ok: true, surfaced: 0, scanned: titles.length, reason: 'not enough tasks' }

  const labelNames = (getData('labels') || []).map(l => l?.name).filter(Boolean)
  const existingLower = new Set([
    ...labelNames.map(n => n.toLowerCase()),
    ...listPendingTagSuggestions().map(s => s.name.toLowerCase()),
  ])

  const system = `You help an ADHD task app discover useful TAGS. Given the user's recent task titles and their EXISTING labels, propose up to ${MAX_SUGGESTIONS} NEW tag names that would usefully group recurring THEMES across the tasks and are NOT already covered by the existing labels.

Rules:
- Only propose a tag when SEVERAL tasks clearly share that theme — never one-offs.
- Prefer durable contexts/areas of life (e.g. "finances", "home", "health", "kids", "car", "side-project") over verbs or specific task names.
- Tag names: short (1-2 words), lowercase, kebab-case if multi-word.
- Do NOT duplicate or near-duplicate an existing label.

Return JSON only: {"tags":[{"name":"<tag>","rationale":"<one short sentence>","examples":["<task title>","<task title>"]}]}. Return an empty array if nothing clearly stands out.`
  const user = `Existing labels: ${labelNames.join(', ') || '(none)'}\n\nRecent task titles:\n${titles.map(t => `- ${t}`).join('\n')}`

  let proposed = []
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 700,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) return { ok: false, error: `Claude ${res.status}`, surfaced: 0, scanned: titles.length }
    const data = await res.json()
    const text = data?.content?.[0]?.text || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (m) proposed = JSON.parse(m[0]).tags || []
  } catch (e) {
    return { ok: false, error: e.message, surfaced: 0, scanned: titles.length }
  }

  const arr = loadStore()
  let surfaced = 0
  for (const p of proposed) {
    const name = String(p?.name || '').trim().toLowerCase()
    if (!name || name.length > 24 || existingLower.has(name)) continue
    existingLower.add(name)
    arr.push({
      id: `tag-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name,
      rationale: String(p.rationale || '').slice(0, 200),
      examples: Array.isArray(p.examples) ? p.examples.slice(0, 4).map(String) : [],
      status: 'pending',
      created_at: Date.now(),
    })
    surfaced++
  }
  if (surfaced > 0) saveStore(arr)
  return { ok: true, surfaced, scanned: titles.length, candidates: proposed.length }
}

// --- Weekly scheduler. Mirrors patternDetection's lifecycle; Sunday 4am local
// (offset an hour from the routine scan's 3am so the two don't pile up). ---

let scanTimer = null
let lastScanDay = null

function userLocalParts(now = new Date()) {
  const tz = getData('settings')?.user_timezone
  if (!tz) return { dow: now.getDay(), hour: now.getHours() }
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false })
    const parts = f.formatToParts(now)
    const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const dow = wdMap[parts.find(p => p.type === 'weekday')?.value] ?? now.getDay()
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10) || 0
    return { dow, hour }
  } catch {
    return { dow: now.getDay(), hour: now.getHours() }
  }
}

async function tick() {
  try {
    const { dow, hour } = userLocalParts()
    if (dow !== 0 || hour !== 4) return
    const today = new Date().toISOString().slice(0, 10)
    if (lastScanDay === today) return
    if (getData('tag_suggestion_last_scan') === today) { lastScanDay = today; return }
    lastScanDay = today
    const r = await runTagScan()
    if (r.surfaced > 0) console.log(`[TagSuggest] Weekly scan surfaced ${r.surfaced} new tag suggestion(s) from ${r.scanned} tasks`)
    setData('tag_suggestion_last_scan', today)
  } catch (e) {
    console.error('[TagSuggest] tick failed:', e.message)
  }
}

export function startTagSuggestions() {
  if (scanTimer) return
  scanTimer = setInterval(tick, 60 * 60 * 1000)
  tick().catch(() => {})
  console.log('[TagSuggest] Scanner lifecycle started (Sunday 4am local)')
}

export function stopTagSuggestions() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null }
}
