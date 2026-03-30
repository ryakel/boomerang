import { loadSettings } from './store'

const PROXY_URL = '/api/messages'

function getApiHeaders() {
  const settings = loadSettings()
  const headers = { 'Content-Type': 'application/json' }
  if (settings.anthropic_api_key) headers['x-anthropic-key'] = settings.anthropic_api_key
  if (settings.notion_token) headers['x-notion-token'] = settings.notion_token
  return headers
}

function withCustomInstructions(systemPrompt) {
  const { custom_instructions } = loadSettings()
  if (!custom_instructions?.trim()) return systemPrompt
  return `${systemPrompt}\n\nThe user has provided these custom instructions for how you should communicate and behave. Follow them closely:\n---\n${custom_instructions.trim()}\n---`
}

async function callClaude(systemPrompt, userMessage) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: withCustomInstructions(systemPrompt),
      messages: [{ role: 'user', content: userMessage }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API error: ${res.status} ${err}`)
  }

  const data = await res.json()
  return data.content[0].text
}

// --- Date inference ---
export async function inferDate(title, notes = '') {
  const today = new Date().toISOString().split('T')[0]
  const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  const system = `You extract dates from task descriptions. Today is ${today} (${dayOfWeek}). If the text mentions a date or time reference (tomorrow, next Friday, end of month, etc.), return the ISO date string (YYYY-MM-DD). If no date is mentioned, return null. Return JSON only: {"date": "YYYY-MM-DD" or null}`

  const user = `Task: "${title}"${notes ? `\nNotes: "${notes}"` : ''}\n\nExtract the due date. JSON only.`

  const text = await callClaude(system, user)
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  const result = JSON.parse(match[0])
  return result.date || null
}

// --- T-shirt sizing ---
export async function inferSize(title, notes = '') {
  const system = `You estimate task effort using T-shirt sizes: XS (under 5 min, trivial), S (5-15 min, quick), M (15-60 min, moderate), L (1-4 hours, significant), XL (4+ hours or multi-day). Consider complexity, steps involved, and dependencies. Return JSON only: {"size": "XS"|"S"|"M"|"L"|"XL"}`

  const user = `Task: "${title}"${notes ? `\nNotes: "${notes}"` : ''}\n\nEstimate the effort size. JSON only.`

  try {
    const text = await callClaude(system, user)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    const result = JSON.parse(match[0])
    return result.size || null
  } catch {
    return null
  }
}

// --- What Now ---
export async function getWhatNow(tasks, time, energy) {
  const openTasks = tasks
    .filter(t => t.status === 'open')
    .map(t => `- "${t.title}" (${t.tags.join(', ') || 'no tags'}, ${Math.floor((Date.now() - new Date(t.last_touched).getTime()) / 86400000)}d old, snoozed ${t.snooze_count}x)`)
    .join('\n')

  const system = `You are a helpful assistant for someone with ADHD. You help them pick the right task to work on right now. Be warm, direct, and practical. No fluff. Never be preachy or condescending. Respond with JSON only — an array of 1-3 objects with "task" (exact task title from the list) and "reason" (one sentence why this is a good pick right now).`

  const user = `Here are my open tasks:\n${openTasks}\n\nI have ${time} and my energy is "${energy}".\n\nWhich 1-3 tasks should I tackle? Return JSON array only.`

  const text = await callClaude(system, user)
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('Could not parse suggestions')
  return JSON.parse(match[0])
}

// --- Polish notes ---
export async function polishNotes(title, rawNotes) {
  const system = `You are a task assistant for someone with ADHD. You take messy, raw notes about a task and turn them into clear, actionable bullet points. Keep the person's voice — don't make it corporate. Be specific and concrete. If there are implicit next steps, surface them. Return JSON with two fields: "title" (a cleaned-up task title if the original is vague, or the same title if it's already good) and "notes" (the polished notes as a string with line breaks between bullets, each starting with "- ").`

  const user = `Task: "${title}"\n\nRaw notes:\n${rawNotes}\n\nPolish these into clear, actionable notes. Return JSON only.`

  const text = await callClaude(system, user)
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse polished notes')
  return JSON.parse(match[0])
}

// --- Reframe ---
export async function reframeTask(taskTitle, snoozeCount, blocker) {
  const system = `You are a task coach for someone with ADHD. When a task keeps getting snoozed, help break it down or reframe it into actionable steps. Be practical and specific. Respond with JSON only — an array of 1-3 strings, each a new task title that replaces the original stuck task.`

  const user = `The task "${taskTitle}" has been snoozed ${snoozeCount} times.\n\nWhat's blocking them: "${blocker}"\n\nReframe this into 1-3 actionable tasks. Return JSON array of strings only.`

  const text = await callClaude(system, user)
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('Could not parse reframed tasks')
  return JSON.parse(match[0])
}

// --- Notion ---
export async function notionSearch(query) {
  const res = await fetch('/api/notion/search', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ query, limit: 5 }),
  })
  if (!res.ok) throw new Error('Notion search failed')
  return res.json()
}

export async function notionCreatePage(title, content, parentPageId) {
  const res = await fetch('/api/notion/pages', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ title, content, parentPageId }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to create Notion page')
  }
  return res.json()
}

export async function notionUpdatePage(pageId, content) {
  const res = await fetch(`/api/notion/pages/${pageId}`, {
    method: 'PATCH',
    headers: getApiHeaders(),
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error('Failed to update Notion page')
  return res.json()
}

export async function notionStatus() {
  try {
    const res = await fetch('/api/notion/status', { headers: getApiHeaders() })
    return res.json()
  } catch {
    return { connected: false }
  }
}

export async function getKeyStatus() {
  try {
    const res = await fetch('/api/keys/status')
    return res.json()
  } catch {
    return { anthropic: false, notion: false }
  }
}

// --- AI-powered Notion suggestion ---
export async function suggestNotionLink(taskTitle, taskNotes) {
  // Search Notion for related pages
  const searchResults = await notionSearch(taskTitle)
  const pages = searchResults.pages || []

  if (pages.length === 0) {
    return { action: 'create', pages: [], reason: 'No related pages found in Notion.' }
  }

  // Ask Claude to evaluate matches
  const pageList = pages.map(p => `- "${p.title}" (${p.id})`).join('\n')
  const system = `You help link tasks to Notion pages. Given a task and a list of Notion pages, determine if any page is a good match. Return JSON: {"action": "link" or "create", "page_id": "id if linking, null if creating", "reason": "one sentence"}`
  const user = `Task: "${taskTitle}"${taskNotes ? `\nNotes: ${taskNotes}` : ''}\n\nNotion pages found:\n${pageList}\n\nShould we link to an existing page or create a new one? JSON only.`

  const text = await callClaude(system, user)
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { action: 'create', pages, reason: 'Could not determine match.' }

  const result = JSON.parse(match[0])
  return { ...result, pages }
}

// --- AI-generated Notion page content ---
export async function generateNotionContent(taskTitle, taskNotes, isRecurring = false) {
  const context = isRecurring ? 'This is a recurring task, so include a checklist template that can be reused each time.' : ''
  const system = `You create structured Notion page content for tasks. Write clear, actionable content with sections. Use plain text with line breaks. ${context} Keep it concise and practical.`
  const user = `Create Notion page content for:\nTask: "${taskTitle}"${taskNotes ? `\nNotes: ${taskNotes}` : ''}\n\nWrite the content as plain text lines.`

  return callClaude(system, user)
}
