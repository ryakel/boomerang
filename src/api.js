import { loadSettings } from './store'

const PROXY_URL = '/api/messages'

function getApiHeaders() {
  const settings = loadSettings()
  const headers = { 'Content-Type': 'application/json' }
  if (settings.anthropic_api_key) headers['x-anthropic-key'] = settings.anthropic_api_key
  if (settings.notion_token) headers['x-notion-token'] = settings.notion_token
  if (settings.trello_api_key) headers['x-trello-key'] = settings.trello_api_key
  if (settings.trello_secret) headers['x-trello-token'] = settings.trello_secret
  return headers
}

function withCustomInstructions(systemPrompt) {
  const { custom_instructions } = loadSettings()
  if (!custom_instructions?.trim()) return systemPrompt
  return `${systemPrompt}\n\nThe user has provided these custom instructions for how you should communicate and behave. Follow them closely:\n---\n${custom_instructions.trim()}\n---`
}

export async function callClaude(systemPrompt, userMessage) {
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

// --- T-shirt sizing + energy inference ---
// Returns { size, energy, energyLevel } in a single API call.
// energy = type of capacity (desk|people|errand|creative|physical)
// energyLevel = drain intensity (1=low, 2=medium, 3=high)
export async function inferSize(title, notes = '') {
  const system = `You estimate task effort and energy requirements for someone with ADHD.

For SIZE, use T-shirt sizes: XS (under 5 min, trivial), S (5-15 min, quick), M (15-60 min, moderate), L (1-4 hours, significant), XL (4+ hours or multi-day). Consider complexity, steps involved, and dependencies.

For ENERGY TYPE, determine what kind of capacity this task draws from:
- "desk" — focused computer/paperwork (writing, coding, paying bills, data entry)
- "people" — social interaction (meetings, lunch with someone, asking favors)
- "errand" — going somewhere physically (pickup, returns, shopping, appointments)
- "creative" — open-ended thinking/making (design, writing, planning, brainstorming)
- "physical" — bodily effort (cleaning, moving, exercise, yard work, assembly)

For ENERGY LEVEL, rate the drain intensity 1-3:
- 1 = low drain, easy/routine (quick text, simple order, light tidying)
- 2 = medium drain, requires focus/effort (presentation prep, store returns, moderate cleaning)
- 3 = high drain, significant willpower needed (difficult conversations, deep cleaning, complex social situations)

Return JSON only: {"size": "XS"|"S"|"M"|"L"|"XL", "energy": "<type>", "energyLevel": 1|2|3}`

  const user = `Task: "${title}"${notes ? `\nNotes: "${notes}"` : ''}\n\nEstimate size, energy type, and energy level. JSON only.`

  try {
    const text = await callClaude(system, user)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return { size: null, energy: null, energyLevel: null }
    const result = JSON.parse(match[0])
    return {
      size: result.size || null,
      energy: result.energy || null,
      energyLevel: result.energyLevel || null,
    }
  } catch {
    return { size: null, energy: null, energyLevel: null }
  }
}

// --- Routine due date suggestion ---
export async function suggestRoutineDueDate(title, notes, cadence, lastCompleted) {
  const today = new Date().toISOString().split('T')[0]
  const system = `You suggest optimal due dates for recurring tasks. Consider the task description, notes, cadence, and when it was last completed. Return JSON only: {"date": "YYYY-MM-DD", "reason": "one sentence"}`

  const user = `Recurring task: "${title}"
Cadence: ${cadence}
Last completed: ${lastCompleted || 'never'}
Today: ${today}
${notes ? `Notes: ${notes}` : ''}

When should this be due? JSON only.`

  try {
    const text = await callClaude(system, user)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

// --- What Now ---
// capacity = optional energy type filter (desk|people|errand|creative|physical|null)
export async function getWhatNow(tasks, time, energy, capacity = null) {
  const ACTIVE = ['not_started', 'doing', 'waiting', 'open']
  const ENERGY_LABELS = { desk: 'Desk', people: 'People', errand: 'Errand', creative: 'Creative', physical: 'Physical' }
  const openTasks = tasks
    .filter(t => ACTIVE.includes(t.status))
    .map(t => {
      const drainLabel = t.energyLevel === 3 ? 'high' : t.energyLevel === 2 ? 'med' : 'low'
      const energyInfo = t.energy ? `, energy: ${ENERGY_LABELS[t.energy] || t.energy} (${drainLabel} drain)` : ''
      return `- "${t.title}" (${t.size || 'unsized'}${energyInfo}, ${t.tags.join(', ') || 'no tags'}, ${Math.floor((Date.now() - new Date(t.last_touched).getTime()) / 86400000)}d old, snoozed ${t.snooze_count}x)`
    })
    .join('\n')

  const capacityRule = capacity
    ? `\nCAPACITY FILTER: The user says they have "${capacity}" energy right now. STRONGLY prefer tasks matching this capacity type. Avoid suggesting tasks with a different energy type unless there are no matching tasks or the match is clearly the best option.`
    : ''

  const system = `You are a helpful assistant for someone with ADHD. You help them pick the right task to work on right now. Be warm, direct, and practical. No fluff. Never be preachy or condescending.

Tasks have t-shirt sizes: XS (~5 min), S (~15 min), M (~30-60 min), L (~half day), XL (~full day+).
Tasks also have energy types (desk, people, errand, creative, physical) and drain levels (low, med, high).
HARD RULE: Never suggest a task bigger than the available time allows. If they have 15 minutes, only suggest XS or S tasks. If they say "fumes" or "low" energy, only suggest XS or S AND prefer low-drain tasks. A medium task requires at least 30 minutes AND moderate energy. Ignore stale/old tasks if they are too big for the window.${capacityRule}

Respond with JSON only — an object with two fields:
- "picks": array of 1-3 objects with "task" (exact task title from the list) and "reason" (one sentence why this is a good pick right now).
- "stretch": if there are fewer than 3 picks, include ONE optional stretch suggestion — a task one size up from what the time/energy normally allows. Same shape: { "task", "reason" }. Omit this field if you already have 3 picks or there's nothing reasonable to stretch to.`

  const user = `Here are my open tasks:\n${openTasks}\n\nI have ${time} and my energy is "${energy}".${capacity ? ` I can do "${capacity}" type work right now.` : ''}\n\nWhat should I work on? Return JSON object only.`

  const text = await callClaude(system, user)
  const objMatch = text.match(/\{[\s\S]*\}/)
  if (objMatch) {
    const parsed = JSON.parse(objMatch[0])
    if (parsed.picks) return parsed
  }
  // Fallback: old array format
  const arrMatch = text.match(/\[[\s\S]*\]/)
  if (arrMatch) return { picks: JSON.parse(arrMatch[0]) }
  throw new Error('Could not parse suggestions')
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

// --- Research ---
export async function researchTask(title, existingNotes, prompt) {
  const system = `You are a research assistant for someone with ADHD. Given a task and a research question, provide practical, actionable research notes. Be specific and concrete — links, steps, options, pros/cons. Format as bullet points starting with "- ". Keep it concise but thorough. Don't repeat what's already in the existing notes. Return JSON only: {"notes": "the research notes as a string with line breaks between bullets"}`

  const context = existingNotes ? `\nExisting notes:\n${existingNotes}` : ''
  const user = `Task: "${title}"${context}\n\nResearch question: "${prompt}"\n\nProvide research notes. JSON only.`

  const text = await callClaude(system, user)
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('Could not parse research results')
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

// Fetch all blocks (content) from a Notion page
export async function notionGetBlocks(pageId) {
  const res = await fetch(`/api/notion/blocks/${pageId}`, { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch page blocks')
  return res.json() // { blocks: [...], plainText: "..." }
}

// Get child pages under a parent page (for sync discovery)
export async function notionGetChildPages(parentId) {
  const res = await fetch(`/api/notion/children/${parentId}`, { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch child pages')
  return res.json() // { pages: [{ id, title, url, last_edited }] }
}

// AI analysis: read a Notion page's content and extract actionable tasks
// One page can produce multiple tasks (e.g., "furnace filter" → "buy filters" + "change filter")
export async function analyzeNotionPage(title, plainTextContent) {
  const system = `You analyze Notion pages and extract actionable tasks for someone with ADHD. Given a page title and content, identify concrete tasks that need to be done.

For each task, determine:
- title: clear, actionable task title (imperative mood)
- size: T-shirt size (XS/S/M/L/XL)
- energy: type of capacity needed (desk/people/errand/creative/physical)
- energyLevel: drain intensity (1=low, 2=medium, 3=high)
- due_date: ISO date (YYYY-MM-DD) if mentioned or inferable, null otherwise
- notes: brief context from the page content
- is_recurring: true if this seems like a recurring task (e.g., "change filter every 3 months")
- recurrence: if recurring, the cadence (daily/weekly/monthly/quarterly/annually)

One page might produce 0-5 tasks. If the page is purely informational with no actionable items, return an empty array.
Return JSON only: {"tasks": [...]}`

  const user = `Notion page: "${title}"\n\nContent:\n${plainTextContent.slice(0, 4000)}\n\nExtract actionable tasks. JSON only.`

  try {
    const text = await callClaude(system, user)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return { tasks: [] }
    return JSON.parse(match[0])
  } catch {
    return { tasks: [] }
  }
}

// AI dedup: match Notion pages to existing Boomerang tasks to avoid duplicates
export async function aiDedupNotionPages(pages, tasks) {
  const userPrompt = `Match these Notion pages to existing tasks if they refer to the same thing (even if worded differently).

Notion pages (unlinked):
${JSON.stringify(pages.map(p => ({ id: p.id, title: p.title })))}

Existing tasks (unlinked):
${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, notes: (t.notes || '').slice(0, 100) })))}

Return ONLY JSON: {"matches":[{"page_id":"...","task_id":"..." or null,"confidence":0.0-1.0}]}
- confidence >= 0.85 means auto-link
- null task_id means create new task(s)
JSON only.`
  const result = await callClaude('You match Notion pages to existing tasks. Only match when clearly the same work item. Return only valid JSON.', userPrompt)
  return extractJSON(result)
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
    if (!res.ok) return { anthropic: false, notion: false, trello: false }
    const data = await res.json()
    return {
      anthropic: !!data.anthropic,
      notion: !!data.notion,
      trello: !!data.trello,
    }
  } catch {
    return { anthropic: false, notion: false, trello: false }
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
  const settings = loadSettings()
  const template = settings.notion_page_template || ''
  const recurring = isRecurring ? '\nThis is a recurring task — include a reusable checklist in the Action Items section.' : ''
  const system = `You create structured Notion page content for tasks. You MUST follow the template structure below, filling each section with relevant content for the given task. Preserve all markdown formatting exactly: ## for headings, - [ ] for to-do items, > for callouts, --- for dividers, - for bullet points. Do not add or remove sections — only populate the existing ones.${recurring}

Template:
${template}`
  const user = `Create Notion page content for:\nTask: "${taskTitle}"${taskNotes ? `\nNotes: ${taskNotes}` : ''}`

  return callClaude(system, user)
}

// --- Trello ---
export async function trelloStatus() {
  try {
    const res = await fetch('/api/trello/status', { headers: getApiHeaders() })
    return res.json()
  } catch {
    return { connected: false }
  }
}

export async function trelloBoards() {
  const res = await fetch('/api/trello/boards', { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch boards')
  return res.json()
}

export async function trelloBoardLists(boardId) {
  const res = await fetch(`/api/trello/boards/${boardId}/lists`, { headers: getApiHeaders() })
  if (!res.ok) throw new Error('Failed to fetch lists')
  return res.json()
}

export async function trelloCreateCard(name, desc, idList) {
  const res = await fetch('/api/trello/cards', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ name, desc, idList }),
  })
  if (!res.ok) throw new Error('Failed to create card')
  return res.json()
}

export async function trelloUpdateCard(cardId, updates) {
  const res = await fetch(`/api/trello/cards/${cardId}`, {
    method: 'PATCH',
    headers: getApiHeaders(),
    body: JSON.stringify(updates),
  })
  if (!res.ok) throw new Error('Failed to update card')
  return res.json()
}

export async function trelloSyncCards(idList) {
  const res = await fetch('/api/trello/sync', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ idList }),
  })
  if (!res.ok) throw new Error('Failed to sync cards')
  return res.json()
}

export async function trelloSyncAllLists(listIds) {
  const res = await fetch('/api/trello/sync-all-lists', {
    method: 'POST',
    headers: getApiHeaders(),
    body: JSON.stringify({ listIds }),
  })
  if (!res.ok) throw new Error('Failed to sync lists')
  return res.json()
}

function extractJSON(text) {
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return JSON.parse(fenced[1].trim())
  // Try parsing directly
  return JSON.parse(text.trim())
}

export async function inferTrelloListMapping(lists) {
  const userPrompt = `Here are the Trello lists for a board:\n${JSON.stringify(lists.map(l => ({ id: l.id, name: l.name })))}\n\nMap each list to one of these task statuses based on the list name:\n- not_started (for "to do", "backlog", "new", "todo" type lists)\n- doing (for "in progress", "working", "active" type lists)\n- waiting (for "on hold", "blocked", "waiting", "review" type lists)\n- done (for "done", "complete", "finished", "archived" type lists)\n\nReturn ONLY a JSON object like: {"not_started":"listId","doing":"listId","waiting":"listId","done":"listId"}\nOmit any status that has no matching list. JSON only, no explanation.`
  const result = await callClaude('You map Trello list names to task statuses. Return only valid JSON, nothing else.', userPrompt)
  return extractJSON(result)
}

export async function aiDedupTrelloCards(cards, tasks) {
  const userPrompt = `Match these Trello cards to existing tasks if they refer to the same thing (even if worded differently).\n\nTrello cards (unlinked):\n${JSON.stringify(cards.map(c => ({ id: c.id, name: c.name, desc: (c.desc || '').slice(0, 100) })))}\n\nExisting tasks (unlinked):\n${JSON.stringify(tasks.map(t => ({ id: t.id, title: t.title, notes: (t.notes || '').slice(0, 100) })))}\n\nReturn ONLY JSON: {"matches":[{"card_id":"...","task_id":"..." or null,"confidence":0.0-1.0}]}\n- confidence >= 0.85 means auto-link\n- null task_id means create a new task\nJSON only.`
  const result = await callClaude('You match Trello cards to existing tasks. Only match when clearly the same work item. Return only valid JSON.', userPrompt)
  return extractJSON(result)
}

// ============================================================
// Per-record Task & Routine API
// ============================================================

export async function serverCreateTask(task, clientId) {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...task, _clientId: clientId }),
  })
  if (!res.ok) throw new Error(`create task failed: ${res.status}`)
  return res.json()
}

export async function serverUpdateTask(id, updates, clientId) {
  const res = await fetch(`/api/tasks/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...updates, _clientId: clientId }),
  })
  if (!res.ok) throw new Error(`update task failed: ${res.status}`)
  return res.json()
}

export async function serverDeleteTask(id) {
  const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete task failed: ${res.status}`)
  return res.json()
}

export async function serverFetchTasks(filters = {}) {
  const params = new URLSearchParams(filters)
  const res = await fetch(`/api/tasks?${params}`)
  if (!res.ok) throw new Error(`fetch tasks failed: ${res.status}`)
  return res.json()
}

export async function serverCreateRoutine(routine, clientId) {
  const res = await fetch('/api/routines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...routine, _clientId: clientId }),
  })
  if (!res.ok) throw new Error(`create routine failed: ${res.status}`)
  return res.json()
}

export async function serverUpdateRoutine(id, updates, clientId) {
  const res = await fetch(`/api/routines/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...updates, _clientId: clientId }),
  })
  if (!res.ok) throw new Error(`update routine failed: ${res.status}`)
  return res.json()
}

export async function serverDeleteRoutine(id) {
  const res = await fetch(`/api/routines/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`delete routine failed: ${res.status}`)
  return res.json()
}
