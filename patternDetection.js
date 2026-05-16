/**
 * Pattern detection scanner — Activity Prompts PR 3.
 *
 * Once a week (Sunday 3am local) we scan the previous 12 months of completed
 * tasks looking for normalized-title clusters that recur on a detectable
 * cadence (weekly / monthly / quarterly / annually). Anything that passes
 * the confidence floor is upserted into `pattern_suggestions` for the user
 * to triage in the SuggestionsModal.
 *
 * Detection algorithm:
 *   1. Source = tasks where status IN ('done','completed') AND completed_at >=
 *      now - 12 months AND routine_id IS NULL (don't re-detect already-
 *      routinized work).
 *   2. Normalize titles (lowercase, strip articles, collapse whitespace).
 *   3. Optional AI clustering pass merges near-duplicates ("mow lawn"~
 *      "mow the grass") — only runs when anthropic_api_key is set, and is
 *      bounded to keep cost predictable.
 *   4. Per cluster: compute inter-completion deltas, classify cadence by
 *      mean+stddev windows, score confidence as
 *      `min(1.0, count/6) * (1 - stddev/mean)`. Discard < 0.45.
 *   5. Dedup against existing pattern_suggestions: same normalized_title
 *      means "update count/last_seen" not "insert new"; dismissed/accepted
 *      rows are left alone.
 *
 * Full spec in wiki/Activity-Prompts.md.
 */

import { readFileSync, existsSync } from 'fs'
import { queryTasks, getData, upsertPatternSuggestion, countPendingSuggestions, getAllRoutines } from './db.js'

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000
const CONFIDENCE_FLOOR = 0.45

// --- AI clustering helper. Gated on anthropic_api_key. ---

let anthropicKey = process.env.ANTHROPIC_API_KEY
if (!anthropicKey && existsSync('.env')) {
  const envFile = readFileSync('.env', 'utf-8')
  anthropicKey = anthropicKey || envFile.match(/(?:VITE_)?ANTHROPIC_API_KEY="?([^"\n]+)"?/)?.[1]
}

function getAnthropicKey() {
  return anthropicKey || getData('settings')?.anthropic_api_key || null
}

// --- Normalization ---

const STOP_PREFIXES = ['the ', 'a ', 'an ', 'my ', 'our ']
const TRAILING_PUNCT = /[.!?,;:\-—]+$/

function normalizeTitle(title) {
  let t = (title || '').toLowerCase().trim()
  t = t.replace(/\s+/g, ' ')
  t = t.replace(TRAILING_PUNCT, '').trim()
  for (const p of STOP_PREFIXES) {
    if (t.startsWith(p)) { t = t.slice(p.length); break }
  }
  return t
}

// --- Cadence classification from interval distribution ---

// Each entry: { name, meanMin, meanMax, stddevMax }. Order matters — first
// match wins. Tight stddev requirements weed out coincidental clusters.
const CADENCE_WINDOWS = [
  { name: 'daily',     meanMin: 1,   meanMax: 2,   stddevMax: 1 },
  { name: 'weekly',    meanMin: 6,   meanMax: 10,  stddevMax: 3 },
  { name: 'monthly',   meanMin: 26,  meanMax: 35,  stddevMax: 7 },
  { name: 'quarterly', meanMin: 85,  meanMax: 100, stddevMax: 15 },
  { name: 'annually',  meanMin: 320, meanMax: 400, stddevMax: 60 },
]

function classifyCadence(intervalsDays) {
  if (!intervalsDays.length) return null
  const mean = intervalsDays.reduce((a, b) => a + b, 0) / intervalsDays.length
  const variance = intervalsDays.reduce((acc, x) => acc + (x - mean) ** 2, 0) / intervalsDays.length
  const stddev = Math.sqrt(variance)
  for (const w of CADENCE_WINDOWS) {
    if (mean >= w.meanMin && mean <= w.meanMax && stddev <= w.stddevMax) {
      return { name: w.name, mean, stddev }
    }
  }
  return null
}

// --- Confidence ---

function confidence(occurrenceCount, mean, stddev) {
  const countFactor = Math.min(1.0, occurrenceCount / 6)
  const consistencyFactor = mean > 0 ? Math.max(0, 1 - stddev / mean) : 0
  return countFactor * consistencyFactor
}

// --- Core scan (no AI) ---

function buildBaseClusters(tasks) {
  const groups = new Map() // normalized → { sampleTitles: Set, completions: [Date], displayTitle }
  for (const t of tasks) {
    const norm = normalizeTitle(t.title)
    if (!norm) continue
    const completedAt = new Date(t.completed_at).getTime()
    if (!groups.has(norm)) {
      groups.set(norm, { normalized: norm, sampleTitles: new Set(), completions: [], displayTitle: t.title })
    }
    const g = groups.get(norm)
    g.sampleTitles.add(t.title)
    g.completions.push(completedAt)
  }
  // Sort each group's completions ascending
  for (const g of groups.values()) g.completions.sort((a, b) => a - b)
  return Array.from(groups.values())
}

// --- AI clustering pass (optional second-stage merge) ---
// Runs when the api key is set AND we have candidates that didn't reach the
// occurrence floor on their own — these are the near-duplicates that the
// title-normalization step couldn't merge ("mow lawn" vs "mow the grass").
// Bounded to ~50 candidate titles per run to cap API cost.
async function maybeAiCluster(clusters) {
  const key = getAnthropicKey()
  if (!key) return clusters

  // Only consider clusters with 1-2 completions (those are the lonely
  // candidates AI might be able to merge into a bigger group).
  const candidates = clusters.filter(c => c.completions.length <= 2).slice(0, 50)
  if (candidates.length < 2) return clusters

  const titleList = candidates.map((c, i) => `${i + 1}. ${c.displayTitle}`).join('\n')
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        system: 'You are a clustering helper. Given a list of task titles, group ones that describe the SAME recurring activity (e.g., "mow the lawn" and "mow grass" are the same; "buy milk" and "buy bread" are NOT). Reply with a JSON array of clusters, each an array of 1-indexed numbers from the input. Singletons may be omitted. Reply ONLY with the JSON, no prose.',
        messages: [{ role: 'user', content: titleList }],
      }),
    })
    if (!res.ok) return clusters
    const data = await res.json()
    const text = data.content?.[0]?.text?.trim() || '[]'
    const parsed = JSON.parse(text.replace(/^```json\n?|\n?```$/g, ''))
    if (!Array.isArray(parsed)) return clusters

    // Apply merges. For each AI cluster of size >= 2, combine the underlying
    // candidate entries into a single cluster (keep the most common title as
    // displayTitle).
    const used = new Set()
    const merged = []
    for (const group of parsed) {
      if (!Array.isArray(group) || group.length < 2) continue
      const members = group
        .map(i => candidates[i - 1])
        .filter(Boolean)
      if (members.length < 2) continue
      members.forEach(m => used.add(m.normalized))
      const all = members.reduce(
        (acc, m) => {
          m.sampleTitles.forEach(t => acc.sampleTitles.add(t))
          acc.completions.push(...m.completions)
          return acc
        },
        { sampleTitles: new Set(), completions: [] }
      )
      all.completions.sort((a, b) => a - b)
      merged.push({
        normalized: members[0].normalized, // anchor on first member's normalized form
        displayTitle: members[0].displayTitle,
        sampleTitles: all.sampleTitles,
        completions: all.completions,
      })
    }
    // Everything not consumed by AI merging stays unchanged
    const untouched = clusters.filter(c => !used.has(c.normalized))
    return [...untouched, ...merged]
  } catch {
    return clusters
  }
}

// --- Main entry ---

export async function runPatternScan() {
  const sinceMs = Date.now() - TWELVE_MONTHS_MS
  const allTasks = queryTasks({})
  const sourceTasks = allTasks.filter(t =>
    (t.status === 'done' || t.status === 'completed') &&
    t.completed_at &&
    new Date(t.completed_at).getTime() >= sinceMs &&
    !t.routine_id // skip already-routinized tasks
  )
  if (sourceTasks.length < 3) return { surfaced: 0, scanned: sourceTasks.length, candidates: 0 }

  // Skip clusters where the user already has a routine for the title (the
  // routinization happened post-completion but pre-scan, e.g. they're in
  // PR1 auto-roll territory now). We don't want to re-suggest something
  // they already accepted by hand.
  const existingRoutineTitles = new Set(
    getAllRoutines().map(r => normalizeTitle(r.title)).filter(Boolean)
  )

  let clusters = buildBaseClusters(sourceTasks)
  clusters = await maybeAiCluster(clusters)

  let surfaced = 0
  let candidates = 0
  for (const cluster of clusters) {
    if (existingRoutineTitles.has(cluster.normalized)) continue
    const intervalsDays = []
    for (let i = 1; i < cluster.completions.length; i++) {
      intervalsDays.push((cluster.completions[i] - cluster.completions[i - 1]) / 86400000)
    }
    const cadence = classifyCadence(intervalsDays)

    // Annual special case: 2 occurrences with a long-enough gap counts.
    const isAnnualPair =
      cluster.completions.length === 2 &&
      intervalsDays[0] >= 320 && intervalsDays[0] <= 400

    if (!cadence && !isAnnualPair) continue
    if (cluster.completions.length < 3 && !isAnnualPair) continue

    const finalCadence = cadence?.name || 'annually'
    const finalMean = cadence?.mean || intervalsDays[0]
    const finalStddev = cadence?.stddev || 0
    const conf = confidence(cluster.completions.length, finalMean, finalStddev)
    candidates++
    if (conf < CONFIDENCE_FLOOR && !isAnnualPair) continue

    upsertPatternSuggestion({
      normalized_title: cluster.normalized,
      display_title: cluster.displayTitle,
      sample_titles: Array.from(cluster.sampleTitles),
      detected_cadence: finalCadence,
      occurrence_count: cluster.completions.length,
      last_seen_at: cluster.completions[cluster.completions.length - 1],
      confidence: isAnnualPair ? Math.max(conf, 0.5) : conf,
    })
    surfaced++
  }

  return { surfaced, scanned: sourceTasks.length, candidates }
}

// --- Weekly scheduler. Same lifecycle pattern as other server loops. ---

let scanTimer = null

function userLocalParts(now = new Date()) {
  const tz = getData('settings')?.user_timezone
  if (!tz) {
    return { dow: now.getDay(), hour: now.getHours() }
  }
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: 'numeric', hour12: false,
    })
    const parts = f.formatToParts(now)
    const wdStr = parts.find(p => p.type === 'weekday')?.value || 'Sun'
    const wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const hourStr = parts.find(p => p.type === 'hour')?.value || '0'
    return { dow: wdMap[wdStr] ?? now.getDay(), hour: parseInt(hourStr, 10) || 0 }
  } catch {
    return { dow: now.getDay(), hour: now.getHours() }
  }
}

// Track the last scan day so we only fire once per Sunday-3am-window.
let lastScanDay = null

async function tick() {
  try {
    const { dow, hour } = userLocalParts()
    // Sunday 03:00–03:59 local. Single fire per Sunday — gate on a YYYY-MM-DD
    // marker in app_data to survive process restarts.
    if (dow !== 0 || hour !== 3) return
    const today = new Date().toISOString().slice(0, 10)
    if (lastScanDay === today) return
    const stored = getData('pattern_last_scan')
    if (stored === today) { lastScanDay = today; return }
    lastScanDay = today

    const result = await runPatternScan()
    if (result.surfaced > 0) {
      console.log(`[Patterns] Weekly scan surfaced ${result.surfaced} suggestion(s) from ${result.scanned} completed tasks`)
    }
    // Stamp last scan day in app_data
    const { setData } = await import('./db.js')
    setData('pattern_last_scan', today)
  } catch (err) {
    console.error('[Patterns] Scan tick failed:', err.message)
  }
}

export function startPatternDetection() {
  if (scanTimer) return
  // Check once an hour. The tick gates itself to Sunday 3am local.
  scanTimer = setInterval(tick, 60 * 60 * 1000)
  // Run an immediate check so a fresh start during the Sunday-3am window
  // doesn't miss the slot.
  tick().catch(() => {})
  console.log('[Patterns] Scanner lifecycle started (Sunday 3am local)')
}

export function stopPatternDetection() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null }
}

// Exported for the manual /api/suggestions/scan endpoint + tests
export { countPendingSuggestions }
